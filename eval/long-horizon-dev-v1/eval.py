#!/usr/bin/env python3
"""Prepare a development task and score its artifacts against durable DSH events."""

import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CASES = {item["id"]: item for item in json.loads((ROOT / "dataset.json").read_text())["cases"]}


def events_from(path: Path) -> list[dict]:
    if path.suffix == ".zstd":
        data = subprocess.run(["zstd", "-dc", str(path)], capture_output=True, check=True, timeout=30).stdout
    else:
        data = path.read_bytes()
    return [json.loads(line) for line in data.splitlines()]


def successful_calls(events: list[dict]) -> list[tuple[dict, dict]]:
    calls = {event["data"]["callId"]: event for event in events if event.get("type") == "tool/call"}
    results = [event for event in events if event.get("type") == "tool/result"
               and event["data"]["message"].get("isError") is False]
    return [(calls[event["data"]["message"]["source"]["callId"]], event) for event in results
            if event["data"]["message"]["source"]["callId"] in calls]


def workspace_command(call: dict, workspace: Path, program: str) -> tuple[str, bool] | None:
    if call["data"]["name"] not in {"bash", "run_code"}:
        return None
    arguments = json.loads(call["data"].get("arguments", "{}"))
    if not isinstance(arguments, dict):
        return None
    workdir = arguments.get("workdir")
    if workdir is not None and Path(workdir).resolve() != workspace.resolve():
        return None
    command = arguments.get("command", "")
    if not isinstance(command, str):
        return None
    match = re.match(rf"\s*node\s+(?:\./)?{re.escape(program)}(?=\s|;|$)", command)
    if match is None:
        return None
    # A leading cd or setup command can make an apparent verification run in a temp copy.
    return command, bool(re.search(r"[;\n]", command[match.end():]))


def verified_output(result: dict, wrapped: bool) -> bool:
    output = "\n".join(block.get("text", "") for block in result["data"]["message"].get("content", [])
                       if isinstance(block, dict) and block.get("type") == "text")
    if "verification passed" not in output:
        return False
    if not wrapped:
        return True
    return re.search(r"\b(?:verify(?:\.mjs)?[- ]?)?exit(?: code)?\s*[:=]\s*0\b", output) is not None


def check_revision(workspace: Path, events: list[dict]) -> dict:
    source = ROOT / "fixtures/revision-and-evidence"
    for name in ("data.csv", "verify.mjs"):
        assert hashlib.sha256((workspace / name).read_bytes()).digest() == hashlib.sha256((source / name).read_bytes()).digest(), f"{name} changed"
    assert (workspace / "analyze.mjs").is_file(), "analyze.mjs missing"
    with (source / "data.csv").open(newline="") as file:
        values = [int(row["value"]) for row in csv.DictReader(file)]
    expected = {"count": len(values), "sum": sum(values), "max": max(values)}
    assert json.loads((workspace / "report.json").read_text()) == expected, "revised report differs"

    states = [(event["seq"], event["data"]["payload"]) for event in events
              if event.get("type") == "extension/record"
              and event["data"].get("namespace") == "dsh-task-supervisor"]
    assert states, "no Supervisor state in main Session"
    edited = [(seq, state) for seq, state in states if state.get("requirementsVersion", 0) >= 2]
    assert edited, "scripted objective revision was not recorded"
    edit_seq = edited[0][0]
    first_stage_passes = [(seq, state) for seq, state in states if seq < edit_seq
                          and state.get("requirementsVersion") == 1
                          and state.get("stageIndex", 0) >= 1
                          and state.get("lastReview", {}).get("verdict") == "pass"
                          and state.get("lastReview", {}).get("stageId") is not None]
    assert first_stage_passes, "objective revision did not follow the first passed stage"
    assert not any(seq < edit_seq and state.get("phase") == "complete" for seq, state in states), \
        "original objective completed before the revision"
    assert "max" in edited[0][1]["objective"], "revised objective omitted max"
    assert states[-1][1]["phase"] == "complete", "Supervisor did not complete"
    assert states[-1][1]["requirementsVersion"] >= 2, "completion used an old objective"
    assert any(seq > edit_seq and state.get("planVersion", 0) > edited[0][1].get("planVersion", 0)
               for seq, state in states), "no new plan after objective revision"

    calls = successful_calls(events)
    write_calls = [event for event, _ in calls if event["seq"] > edit_seq
                   and workspace_command(event, workspace, "analyze.mjs") is not None]
    assert write_calls, "no successful revised report generation call"
    final_write = max(event["seq"] for event in write_calls)
    verify_calls = [(event, result) for event, result in calls if event["seq"] > final_write
                    and (command := workspace_command(event, workspace, "verify.mjs")) is not None
                    and verified_output(result, command[1])]
    assert verify_calls, "no successful verifier call after the final report generation call"
    return {"passed": True, "expected": expected, "revisionSeq": edit_seq,
            "firstStagePassSeq": first_stage_passes[0][0],
            "finalWriteSeq": final_write, "verifySeq": verify_calls[0][0]["seq"]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "initial", "revision", "check"])
    parser.add_argument("case", choices=CASES)
    parser.add_argument("workspace", nargs="?", type=Path)
    parser.add_argument("session", nargs="?", type=Path)
    args = parser.parse_args()
    case = CASES[args.case]
    if args.action in {"initial", "revision"}:
        print(case["initialPrompt" if args.action == "initial" else "revisionPrompt"])
        return
    if args.workspace is None:
        parser.error("workspace is required")
    if args.action == "prepare":
        if args.workspace.exists():
            parser.error("workspace already exists")
        shutil.copytree(ROOT / "fixtures" / args.case, args.workspace)
        print(json.dumps({"workspace": str(args.workspace), "initialPrompt": case["initialPrompt"]}))
        return
    if args.session is None:
        parser.error("check requires the main Session log")
    try:
        result = check_revision(args.workspace, events_from(args.session))
    except (AssertionError, OSError, KeyError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        result = {"passed": False, "error": str(error)}
    print(json.dumps({"case": args.case, "session": str(args.session), **result}, ensure_ascii=False))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
