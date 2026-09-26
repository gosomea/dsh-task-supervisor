#!/usr/bin/env python3
"""Score a fixed reliability case from artifacts and the durable main Session."""

import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CASES = {case["id"]: case for case in json.loads((ROOT / "dataset.json").read_text())["cases"]}
WRITE_TOOLS = {"write", "edit", "apply_patch", "multi_edit"}
WRITE_SYNTAX = re.compile(r"write_text|writeFile|writeFileSync|open\([^)]*,\s*['\"](?:w|a|x)|\b(?:tee|touch|cp|mv)\s|(?<![<>])>{1,2}(?![>])", re.I)


def events_from(path: Path) -> list[dict]:
    if path.suffix == ".zstd":
        result = subprocess.run(["zstd", "-dc", str(path)], capture_output=True, check=True, timeout=30)
        lines = result.stdout.splitlines()
    else:
        lines = path.read_bytes().splitlines()
    return [json.loads(line) for line in lines]


def approval(events: list[dict]) -> tuple[int, dict]:
    for event in events:
        if event.get("type") != "extension/record":
            continue
        data = event["data"]
        if data.get("namespace") != "dsh-task-supervisor":
            continue
        state = data.get("payload", {})
        if state.get("phase") == "active" and state.get("approvedPlanVersion") is not None:
            return event["seq"], state
    raise AssertionError("no approved Supervisor plan in main Session")


def check_separate_turns(workspace: Path, events: list[dict]) -> dict:
    source = ROOT / "fixtures/separate-turns/input.csv"
    assert hashlib.sha256((workspace / "input.csv").read_bytes()).digest() == hashlib.sha256(source.read_bytes()).digest(), "input.csv changed"
    with source.open(newline="") as file:
        rows = list(csv.DictReader(file))
    expected = {"count": len(rows), "sum": sum(int(row["value"]) for row in rows)}
    assert json.loads((workspace / "off-report.json").read_text()) == expected, "off-report.json differs"
    approval_seq, plan = approval(events)
    assert len(plan["stages"]) == 1, "approved plan has more than one stage"

    calls = {event["data"]["callId"]: event for event in events if event.get("type") == "tool/call"}
    successful = set()
    for event in events:
        if event.get("type") == "tool/result" and event["data"]["message"].get("isError") is False:
            successful.add(event["data"]["message"]["source"]["callId"])
    turns = {}
    for event in events:
        if event.get("seq", -1) <= approval_seq:
            continue
        if event.get("type") == "turn/end":
            turns[event["data"]["turn"]] = event["data"]["reason"]["kind"]

    reads = []
    writes = []
    for call_id, event in calls.items():
        if event["seq"] <= approval_seq or call_id not in successful:
            continue
        data = event["data"]
        turn = data["turn"]
        name = data["name"]
        arguments = data.get("arguments", "")
        if "input.csv" in arguments and name in {"read", "bash", "run_code"}:
            reads.append((turn, event["seq"]))
        if name in WRITE_TOOLS or (name in {"bash", "run_code"} and WRITE_SYNTAX.search(arguments)):
            writes.append((turn, event["seq"], "off-report.json" in arguments))
    assert reads, "no successful post-approval read of input.csv in Session"
    assert writes, "no successful post-approval write operation in Session"
    first_read_only = next((turn for turn in sorted(turns) if turns[turn] == "completed"
                            and any(read_turn == turn for read_turn, _ in reads)
                            and not any(write_turn == turn for write_turn, _, _ in writes)), None)
    assert first_read_only is not None, "no completed read-only model turn after approval"
    assert not any(write_turn <= first_read_only for write_turn, _, _ in writes), "write preceded the completed read-only turn"
    report_writes = [(turn, seq) for turn, seq, names_report in writes if names_report]
    assert report_writes and min(turn for turn, _ in report_writes) > first_read_only, "report was not written in a later turn"
    return {"passed": True, "readOnlyTurn": first_read_only, "reportWriteTurn": min(turn for turn, _ in report_writes)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "check", "prompt"])
    parser.add_argument("case", choices=CASES)
    parser.add_argument("workspace", nargs="?", type=Path)
    parser.add_argument("session", nargs="?", type=Path)
    args = parser.parse_args()
    if args.action == "prompt":
        print(CASES[args.case]["prompt"])
        return
    if args.workspace is None:
        parser.error("workspace is required")
    if args.action == "prepare":
        if args.workspace.exists():
            parser.error("workspace already exists")
        shutil.copytree(ROOT / "fixtures" / args.case, args.workspace)
        print(json.dumps({"case": args.case, "workspace": str(args.workspace), "prompt": CASES[args.case]["prompt"]}))
        return
    if args.session is None:
        parser.error("check requires a main Session log path")
    try:
        result = check_separate_turns(args.workspace, events_from(args.session))
    except (AssertionError, OSError, ValueError, KeyError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        result = {"passed": False, "error": str(error)}
    print(json.dumps({"case": args.case, "session": str(args.session), **result}, ensure_ascii=False))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
