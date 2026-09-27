#!/usr/bin/env python3
"""Start one isolated DSH workflow against a public task instruction."""

import argparse
import json
import subprocess
import time
from pathlib import Path

from web_rpc import WebRpc

MODEL_PROVIDER = "deepseek-codebuddy"
MODEL_ID = "deepseek-v4.1-flash"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("arm", choices=("goal", "plan", "supervisor"))
    parser.add_argument("task_id")
    parser.add_argument("instruction", type=Path)
    parser.add_argument("state", type=Path)
    parser.add_argument("--host-log", type=Path, default=Path("/evalhome/run/host.log"))
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    if args.state.exists():
        parser.error(f"Refusing to replace run state: {args.state}")

    baseline_untracked = subprocess.check_output([
        "git", "ls-files", "--others", "--exclude-standard", "-z",
    ], cwd="/app").decode("utf-8", "surrogateescape").split("\0")
    baseline_untracked = sorted(path for path in baseline_untracked if path)
    base_commit = subprocess.check_output([
        "git", "rev-parse", "HEAD",
    ], cwd="/app", text=True).strip()

    rpc = WebRpc(args.host_log, f"http://127.0.0.1:{args.port}")
    workspace = rpc.call("workspace/create", {"path": "/app"})["workspace"]
    session_id = rpc.call("session/create", {
        "workspaceId": workspace["workspaceId"],
        "agentPreset": "standard",
    })["sessionId"]
    title = f"Eval {args.arm} {args.task_id.split('__')[-1][:12]}"
    rpc.call("session/rename", {"sessionId": session_id, "title": title})
    selected = rpc.call("session/selectModel", {
        "sessionId": session_id,
        "title": title,
        "provider": MODEL_PROVIDER,
        "model": MODEL_ID,
    })["selected"]
    permission = rpc.command(session_id, "/permission danger-full-access")["result"]
    if permission["kind"] != "success":
        raise RuntimeError(f"Container permission setup failed: {permission}")
    instruction = args.instruction.read_text()
    if args.arm == "plan":
        command = rpc.command(session_id, "/plan")
        if command["result"]["kind"] != "success":
            raise RuntimeError(f"Plan entry failed: {command['result']}")
        admitted = rpc.prompt(session_id, instruction)
    else:
        prefix = "/goal " if args.arm == "goal" else "/task new "
        command = rpc.command(session_id, prefix + instruction)
        admitted = None
    if command["result"]["kind"] != "success":
        raise RuntimeError(f"{args.arm} entry failed: {command['result']}")
    if admitted is not None and not admitted.get("accepted"):
        raise RuntimeError(f"Plan prompt was not admitted: {admitted}")

    state = {
        "taskId": args.task_id,
        "arm": args.arm,
        "sessionId": session_id,
        "workspaceId": workspace["workspaceId"],
        "startedAtUnix": int(time.time()),
        "timeLimitSec": 3000,
        "modelSelection": selected,
        "agentPreset": "standard",
        "permissionPreset": "danger-full-access",
        "baselineUntracked": baseline_untracked,
        "baseCommit": base_commit,
        "startCommand": "/plan" if args.arm == "plan" else prefix.strip(),
    }
    args.state.write_text(json.dumps(state, indent=2) + "\n")
    print(json.dumps({"arm": args.arm, "sessionId": session_id, "startedAtUnix": state["startedAtUnix"]}))


if __name__ == "__main__":
    main()
