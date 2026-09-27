#!/usr/bin/env python3
"""Stage an Agent patch for an unchanged public Harbor verifier."""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

SOLVE = """#!/bin/bash
set -euo pipefail
cd /app 2>/dev/null || cd /testbed 2>/dev/null || exit 1
if [ -s /solution/agent_patch.diff ]; then
  git apply --verbose /solution/agent_patch.diff
fi
"""


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("official_task", type=Path)
    parser.add_argument("agent_patch", type=Path)
    parser.add_argument("staged_task", type=Path)
    args = parser.parse_args()
    if args.staged_task.exists():
        parser.error(f"Refusing to replace staged task: {args.staged_task}")
    if not args.official_task.is_dir() or not args.agent_patch.is_file():
        parser.error("Official task directory and Agent patch must exist")

    args.staged_task.mkdir(parents=True)
    for name in ("task.toml", "instruction.md"):
        shutil.copy2(args.official_task / name, args.staged_task / name)
    for name in ("environment", "tests"):
        shutil.copytree(args.official_task / name, args.staged_task / name)
    solution = args.staged_task / "solution"
    solution.mkdir()
    solve = solution / "solve.sh"
    solve.write_text(SOLVE)
    solve.chmod(0o755)
    shutil.copy2(args.agent_patch, solution / "agent_patch.diff")

    verified = []
    for path in sorted(args.staged_task.rglob("*")):
        if not path.is_file() or "solution" in path.relative_to(args.staged_task).parts:
            continue
        relative = path.relative_to(args.staged_task)
        original = args.official_task / relative
        if digest(path) != digest(original):
            raise RuntimeError(f"Official task material differs: {relative}")
        verified.append(str(relative))
    record = {
        "officialTask": args.official_task.name,
        "verifiedOfficialFiles": verified,
        "agentPatchSha256": digest(args.agent_patch),
        "stagedTask": str(args.staged_task),
        "solutionChanged": True,
    }
    args.staged_task.with_suffix(".manifest.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"verifiedOfficialFiles": len(verified), "patchSha256": record["agentPatchSha256"]}))


if __name__ == "__main__":
    main()
