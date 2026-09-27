#!/usr/bin/env python3
"""Observe one native workflow and enforce its frozen wall-clock limit."""

import argparse
import json
import subprocess
import time
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("state", type=Path)
    parser.add_argument("home", type=Path)
    parser.add_argument("container")
    parser.add_argument("--docker-context", default="colima-dsh-eval-rosetta")
    parser.add_argument("--approval-receipt", type=Path)
    args = parser.parse_args()
    state = json.loads(args.state.read_text())
    projection = args.home / "storages/session_projcache/sessions" / f"{state['sessionId']}.json"
    deadline = state["startedAtUnix"] + state["timeLimitSec"]
    last_report = 0
    while time.time() < deadline:
        if projection.exists():
            rows = json.loads(projection.read_text())["record"]["rows"]
            value = lambda key: rows.get(key, {}).get("val")
            stats = value("sessionStats") or {}
            idle = stats.get("openStep") is None and not stats.get("pendingCalls")
            answer = ((value("turnOutline") or {}).get("turns") or [{}])[-1].get("response", "")
            if state["arm"] == "goal":
                current = (value("goal") or {}).get("current") or {}
                phase = current.get("goal", {}).get("phase")
                finished = phase in ("complete", "blocked") and idle
            elif state["arm"] == "supervisor":
                current = (value("taskSupervisor") or {}).get("current") or {}
                phase = current.get("phase")
                finished = phase in ("complete", "blocked", "cleared") and idle
            else:
                plan = value("plan") or {}
                phase = "planning" if plan.get("active") else "executing-or-finished"
                approved = args.approval_receipt is not None and args.approval_receipt.exists()
                finished = approved and not plan.get("active") and stats.get("turns", 0) >= 2 and idle and bool(answer)
            if finished:
                print(json.dumps({"status": "finished", "phase": phase, "turns": stats.get("turns"),
                                  "steps": stats.get("steps"), "elapsedSec": int(time.time()) - state["startedAtUnix"]}))
                return 0
            if time.time() - last_report >= 60:
                print(json.dumps({"status": "running", "phase": phase, "turns": stats.get("turns"),
                                  "steps": stats.get("steps"), "elapsedSec": int(time.time()) - state["startedAtUnix"]}), flush=True)
                last_report = time.time()
        time.sleep(5)
    subprocess.run(["docker", "--context", args.docker_context, "stop", args.container], check=True,
                   stdout=subprocess.DEVNULL)
    print(json.dumps({"status": "time-limit", "limitSec": state["timeLimitSec"],
                      "container": args.container}))
    return 124


if __name__ == "__main__":
    raise SystemExit(main())
