#!/usr/bin/env python3
"""Fingerprint prepared P2 runtime copies before any follow-up model request."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def tree(path):
    entries = []
    for item in sorted(path.rglob("*")):
        relative = item.relative_to(path).as_posix()
        if ".git" in item.relative_to(path).parts:
            continue
        if item.is_symlink():
            entries.append([relative, "symlink", str(item.readlink())])
        elif item.is_file():
            entries.append([relative, "file", hashlib.sha256(item.read_bytes()).hexdigest()])
    digest = hashlib.sha256(json.dumps(entries, separators=(",", ":")).encode()).hexdigest()
    return {"sha256": digest, "entries": len(entries)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    root, repo = args.root.resolve(), args.repo.resolve()
    destination = root / "release.json"
    if destination.exists() or (root / "attempts").exists():
        parser.error("Cannot refreeze a release or a batch with model attempts")
    protocol = repo / "eval/review-recovery/frequency-p2-protocol.json"
    runner = root / "runner"
    shutil.copytree(repo / "eval", runner / "eval", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    source = root / "runtime/plugin-source/src"
    for item in (repo / "src").rglob("*"):
        if item.is_file():
            assert item.read_bytes() == (source / item.relative_to(repo / "src")).read_bytes(), str(item)
    result = {
        "schemaVersion": 1, "kind": "frozen-p2-release", "project": str(repo),
        "pluginCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
        "protocolSha256": hashlib.sha256(protocol.read_bytes()).hexdigest(),
        "pluginRuntime": tree(root / "runtime/plugin-source"),
        "hostRuntime": tree(root / "runtime/dsh-source"), "runner": tree(runner),
        "nodeSha256": hashlib.sha256((root / "runtime/node24-linux-amd64").read_bytes()).hexdigest(),
        "composition": {p.stem: hashlib.sha256(p.read_bytes()).hexdigest() for p in (root / "composition").glob("*.yml")},
        "profiles": {p.name: tree(p / "profiles") for p in (root / "templates").iterdir() if p.is_dir()},
        "model": {"provider": "deepseek-codebuddy", "model": "deepseek-v4.1-flash"},
        "modelParity": json.loads((root / "model-parity.json").read_text()),
        "infra": {"context": "colima-dsh-eval-rosetta", "cpus": 1, "memoryGiB": 4, "timeLimitSec": 3000},
        "gradingRetries": 0, "modelRetries": 0,
        "notes": ["Runtime and runner copies are independent; no mid-batch rebuilds.",
                  "Credentials remain private and are excluded from the published fingerprint.",
                  "Host snapshot is the existing Linux baseline; actual bytes are pinned rather than inferred from a Git label.",
                  "Preflight only created an empty Session and read /task; no model request or benchmark instruction."]}
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"release": str(destination), "pluginCommit": result["pluginCommit"], "runner": result["runner"]}))


if __name__ == "__main__":
    main()
