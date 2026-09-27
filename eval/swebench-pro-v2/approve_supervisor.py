#!/usr/bin/env python3
"""Grant the single predeclared initial Supervisor plan approval."""

import argparse
import json
import time
from pathlib import Path

from web_rpc import WebRpc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("state", type=Path)
    parser.add_argument("receipt", type=Path)
    parser.add_argument("--host-log", type=Path, default=Path("/evalhome/run/host.log"))
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    if args.receipt.exists():
        parser.error(f"Refusing to approve twice: {args.receipt}")
    state = json.loads(args.state.read_text())
    if state["arm"] != "supervisor":
        parser.error("The run state is not a Supervisor arm")
    rpc = WebRpc(args.host_log, f"http://127.0.0.1:{args.port}")
    projection = Path("/evalhome/storages/session_projcache/sessions") / f"{state['sessionId']}.json"
    deadline = state["startedAtUnix"] + state["timeLimitSec"]
    while time.time() < deadline:
        # session/list deliberately returns only core projections. The plugin
        # projection is durable in the Host's per-Session projection cache.
        rows = json.loads(projection.read_text())["record"]["rows"] if projection.exists() else {}
        snapshot = rows.get("taskSupervisor", {}).get("val", {}).get("current")
        if snapshot is None:
            time.sleep(5)
            continue
        phase = snapshot["phase"]
        if phase == "awaiting-approval":
            result = rpc.command(state["sessionId"], "/task approve")["result"]
            if result["kind"] != "success":
                raise RuntimeError(f"Predeclared plan approval failed: {result}")
            receipt = {
                "sessionId": state["sessionId"],
                "taskId": snapshot["id"],
                "planRevision": snapshot.get("planVersion"),
                "approvedAtUnix": int(time.time()),
                "decision": "approve",
            }
            args.receipt.write_text(json.dumps(receipt, indent=2) + "\n")
            print(json.dumps(receipt))
            return
        if phase in ("complete", "cleared", "blocked"):
            raise RuntimeError(f"Task reached {phase} before initial plan approval")
        time.sleep(5)
    raise TimeoutError("No initial Supervisor plan reached the approval gate")


if __name__ == "__main__":
    main()
