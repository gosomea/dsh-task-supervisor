#!/usr/bin/env python3
"""Capture one Agent's complete code patch relative to the official base."""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def git(workspace: Path, *args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=workspace)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("state", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--workspace", type=Path, default=Path("/app"))
    args = parser.parse_args()
    if args.output.exists():
        parser.error(f"Refusing to replace patch: {args.output}")

    state = json.loads(args.state.read_text())
    base = state["baseCommit"]
    git(args.workspace, "cat-file", "-e", f"{base}^{{commit}}")
    untracked = git(args.workspace, "ls-files", "--others", "--exclude-standard", "-z")
    current = {path for path in untracked.decode("utf-8", "surrogateescape").split("\0") if path}
    new_paths = sorted(current - set(state["baselineUntracked"]))
    if new_paths:
        subprocess.run(["git", "add", "-N", "--", *new_paths], cwd=args.workspace, check=True)

    patch = git(args.workspace, "diff", "--binary", base, "--")
    args.output.write_bytes(patch)
    changed = git(args.workspace, "diff", "--name-only", "-z", base, "--")
    changed_paths = [path for path in changed.decode("utf-8", "surrogateescape").split("\0") if path]
    record = {
        "taskId": state["taskId"],
        "arm": state["arm"],
        "sessionId": state["sessionId"],
        "baseCommit": base,
        "patchSha256": hashlib.sha256(patch).hexdigest(),
        "patchBytes": len(patch),
        "changedPaths": changed_paths,
        "newUntrackedPaths": new_paths,
    }
    args.output.with_suffix(args.output.suffix + ".json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"patchBytes": len(patch), "changedPaths": len(changed_paths)}))


if __name__ == "__main__":
    main()
