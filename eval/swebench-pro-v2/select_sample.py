#!/usr/bin/env python3
"""Freeze a reproducible, one-task-per-repository P1 integration sample."""

import argparse
import hashlib
import json
import subprocess
import tomllib
from pathlib import Path

DATASET_COMMIT = "66f92766bba642462d4bbe5479e83f91f9211862"
SEED = "dsh-task-supervisor-swebench-pro-v2-p1-20260928"
CALIBRATION_IDS = {
    "instance_NodeBB__NodeBB-00c70ce7b0541cfc94afe567921d7668cdc8f4ac-vnan",
    "instance_flipt-io__flipt-02e21636c58e86c51119b63e0fb5ca7b813b07b1",
}


def git(checkout: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(checkout), *args], text=True).strip()


def rank(value: str) -> str:
    return hashlib.sha256(f"{SEED}/{value}".encode()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("checkout", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error(f"Refusing to replace frozen sample: {args.output}")
    commit = git(args.checkout, "rev-parse", "HEAD")
    if commit != DATASET_COMMIT:
        parser.error(f"Dataset commit mismatch: {commit}")

    groups: dict[str, list[str]] = {}
    for task_id in git(args.checkout, "ls-tree", "-d", "--name-only", "HEAD:v2/tasks").splitlines():
        if task_id in CALIBRATION_IDS:
            continue
        repo = task_id.removeprefix("instance_").split("__", 1)[0]
        groups.setdefault(repo, []).append(task_id)

    repos = sorted(groups, key=lambda repo: rank(f"repo/{repo}"))[:6]
    tasks = []
    for repo in repos:
        task_id = min(groups[repo], key=lambda item: rank(f"task/{item}"))
        prefix = f"v2/tasks/{task_id}"
        meta = tomllib.loads(git(args.checkout, "show", f"HEAD:{prefix}/task.toml"))["metadata"]
        instruction = subprocess.check_output([
            "git", "-C", str(args.checkout), "show", f"HEAD:{prefix}/instruction.md",
        ])
        tasks.append({
            "id": task_id,
            "repository": repo,
            "difficulty": meta.get("difficulty"),
            "category": meta.get("category"),
            "instructionSha256": hashlib.sha256(instruction).hexdigest(),
            "controlStatus": "pending",
        })

    data = {
        "dataset": "SWE-bench Pro V2",
        "datasetCommit": DATASET_COMMIT,
        "seed": SEED,
        "selection": "SHA-256 rank: six repositories, then one non-calibration task per repository",
        "calibrationExcluded": sorted(CALIBRATION_IDS),
        "tasks": tasks,
    }
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"Frozen {len(tasks)} tasks in {args.output}")


if __name__ == "__main__":
    main()
