#!/usr/bin/env python3
"""Score native Goal/Plan product arms without reading Supervisor state."""

import argparse
import csv
import hashlib
import json
from pathlib import Path

from eval import ROOT, events_from, successful_calls, verified_output, workspace_command


def revision_event(event: dict) -> bool:
    data = event.get("data", {})
    if event.get("type") == "command/run":
        return data.get("name") == "goal" and str(data.get("args", "")).strip().startswith("edit Updated full objective:")
    if event.get("type") == "user/message":
        return any(isinstance(block, dict) and block.get("type") == "text"
                   and block.get("text", "").startswith("Updated full objective:")
                   for block in data.get("content", []))
    return False


def check(workspace: Path, events: list[dict], revised: bool) -> dict:
    source = ROOT / "fixtures/revision-and-evidence"
    for name in ("data.csv", "verify.mjs"):
        assert hashlib.sha256((workspace / name).read_bytes()).digest() == hashlib.sha256((source / name).read_bytes()).digest(), f"{name} changed"
    assert (workspace / "analyze.mjs").is_file(), "analyze.mjs missing"
    with (source / "data.csv").open(newline="") as file:
        values = [int(row["value"]) for row in csv.DictReader(file)]
    expected = {"count": len(values), "sum": sum(values)}
    if revised:
        expected["max"] = max(values)
    assert json.loads((workspace / "report.json").read_text()) == expected, "report differs"

    revisions = [event["seq"] for event in events if revision_event(event)]
    calls = successful_calls(events)
    if revised:
        assert revisions, "revision was not sent"
        # A finished initial run cannot be treated as an in-flight requirement change.
        # This also catches clients that accept text during a turn but enqueue it only
        # after the model has already completed the original objective.
        completed_before_edit = [event["seq"] for event in events
                                 if event.get("type") == "tool/call"
                                 and event["seq"] < revisions[0]
                                 and event.get("data", {}).get("name") in {"update_goal", "present"}]
        completed_before_edit += [call["seq"] for call, result in calls if call["seq"] < revisions[0]
                                  and (command := workspace_command(call, workspace, "verify.mjs")) is not None
                                  and verified_output(result, command[1])]
        assert not completed_before_edit, "revision arrived after initial completion"
    else:
        assert not revisions, "revision was sent in an initial-only run"
    after = revisions[0] if revisions else 0
    writes = [call["seq"] for call, _ in calls if call["seq"] > after
              and workspace_command(call, workspace, "analyze.mjs") is not None]
    assert writes, "no successful report generation after objective version"
    final_write = max(writes)
    verifies = [call["seq"] for call, result in calls if call["seq"] > final_write
                and (command := workspace_command(call, workspace, "verify.mjs")) is not None
                and verified_output(result, command[1])]
    assert verifies, "no successful verifier call after final report generation"
    return {"passed": True, "expected": expected, "revisionSeq": revisions[0] if revisions else None,
            "finalWriteSeq": final_write, "verifySeq": verifies[0]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("version", choices=["initial", "revised"])
    parser.add_argument("workspace", type=Path)
    parser.add_argument("session", type=Path)
    args = parser.parse_args()
    try:
        result = check(args.workspace, events_from(args.session), args.version == "revised")
    except (AssertionError, OSError, KeyError, ValueError) as error:
        result = {"passed": False, "error": str(error)}
    print(json.dumps({"version": args.version, "session": str(args.session), **result}, ensure_ascii=False))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
