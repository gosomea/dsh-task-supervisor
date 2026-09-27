#!/usr/bin/env python3
"""Preserve one DSH attempt alongside its independent Harbor patch grade."""

import argparse
import hashlib
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("state", type=Path)
    parser.add_argument("home", type=Path)
    parser.add_argument("patch", type=Path)
    parser.add_argument("grade_job", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--approval-receipt", type=Path)
    parser.add_argument("--kind", choices=("public-benchmark-calibration", "public-benchmark-frozen-p1"),
                        default="public-benchmark-calibration")
    args = parser.parse_args()
    if args.output.exists():
        parser.error(f"Refusing to overwrite result: {args.output}")

    state = json.loads(args.state.read_text())
    projection_path = args.home / "storages/session_projcache/sessions" / f"{state['sessionId']}.json"
    rows = json.loads(projection_path.read_text())["record"]["rows"]
    value = lambda key: rows.get(key, {}).get("val")
    stats = value("sessionStats") or {}
    tokens = (value("tokenUsage") or {}).get("totals", {})
    turns = (value("turnOutline") or {}).get("turns", [])
    final_answer = turns[-1].get("response", "") if turns else ""
    grade = json.loads((args.grade_job / "result.json").read_text())
    evals = grade.get("stats", {}).get("evals", {})
    if len(evals) != 1:
        raise ValueError(f"Expected exactly one Harbor evaluation, got {len(evals)}")
    eval_result = next(iter(evals.values()))
    rewards = eval_result.get("reward_stats", {}).get("reward", {})
    if grade.get("n_total_trials") != 1 or sum(len(items) for items in rewards.values()) != 1:
        raise ValueError("The Harbor job must contain exactly one scored trial")
    reward = float(next(iter(rewards)))
    if eval_result.get("n_errors") or grade["stats"].get("n_errored_trials"):
        raise ValueError("Harbor verifier error; the attempt is not scoreable")
    patch = args.patch.read_bytes()
    receipt = json.loads(args.approval_receipt.read_text()) if args.approval_receipt else None
    native = {}
    if state["arm"] == "goal":
        current = (value("goal") or {}).get("current") or {}
        native = {
            "phase": current.get("goal", {}).get("phase"),
            "roundsStarted": current.get("roundsStarted"),
            "updatedAtUnixMs": current.get("updatedAt"),
        }
    elif state["arm"] == "plan":
        native = {"plan": value("plan")}
    else:
        native = {"taskSupervisor": value("taskSupervisor")}

    result = {
        "schemaVersion": 1,
        "kind": args.kind,
        "officialLeaderboardSubmission": False,
        "taskId": state["taskId"],
        "arm": state["arm"],
        "sessionId": state["sessionId"],
        "startedAtUnix": state["startedAtUnix"],
        "timeLimitSec": state["timeLimitSec"],
        "modelSelection": state["modelSelection"],
        "agentPreset": state["agentPreset"],
        "permissionPreset": state["permissionPreset"],
        "baseCommit": state["baseCommit"],
        "nativeState": native,
        "mainSession": {
            "turns": stats.get("turns"),
            "steps": stats.get("steps"),
            "llmMs": stats.get("llmMs"),
            "toolMs": stats.get("toolMs"),
            "tokens": tokens,
            "finalAnswer": final_answer,
        },
        "approvalReceipt": receipt,
        "patch": {"sha256": hashlib.sha256(patch).hexdigest(), "bytes": len(patch)},
        "externalGrade": {
            "harborJob": str(args.grade_job),
            "reward": reward,
            "errors": eval_result.get("n_errors"),
        },
    }
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"arm": state["arm"], "reward": reward, "output": str(args.output)}))


if __name__ == "__main__":
    main()
