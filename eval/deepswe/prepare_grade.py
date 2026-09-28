#!/usr/bin/env python3
"""Prepare an unchanged official verifier with a committed-patch carrier."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tomllib


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def official_files(root):
    """Hash official verifier inputs, excluding the replaced oracle solution."""
    return {str(p.relative_to(root)): sha(p) for p in sorted(root.rglob('*'))
            if p.is_file() and p.relative_to(root).parts[0] != 'solution'}


def prepare(official_task, submission, staged_task):
    official_task, submission, staged_task = map(Path, (official_task, submission, staged_task))
    receipt = json.loads((submission / 'receipt.json').read_text())
    patch = submission / 'model.patch'
    meta = tomllib.loads((official_task / 'task.toml').read_text())
    base = meta['metadata']['base_commit_hash']
    if not re.fullmatch('[a-f0-9]{40}', base) or receipt.get('baseCommit') != base:
        raise ValueError('Submission base differs from official base')
    if receipt.get('source') != 'committed-base-to-head' or receipt.get('workingTreeSubmitted') is not False:
        raise ValueError('Only already committed Agent work may be submitted')
    if receipt.get('patchSha256') != sha(patch) or receipt.get('patchBytes') != patch.stat().st_size:
        raise ValueError('Submission patch differs from its receipt')
    if not re.fullmatch('[a-f0-9]{40}', receipt.get('headCommit', '')):
        raise ValueError('Submission lacks a committed HEAD')
    if meta['verifier']['environment_mode'] != 'separate':
        raise ValueError('Official verifier must use a separate environment')
    original = official_files(official_task)
    staged_task.mkdir(mode=0o700)
    for item in official_task.iterdir():
        if item.name == 'solution':
            continue
        if item.is_dir():
            shutil.copytree(item, staged_task / item.name, symlinks=True)
        else:
            shutil.copy2(item, staged_task / item.name)
    solution = staged_task / 'solution'
    solution.mkdir()
    shutil.copy2(patch, solution / 'model.patch')
    # Commit only the index populated by git apply, never Agent dirty work. The
    # official collector reads base..HEAD rather than an unstaged worktree diff.
    solve = solution / 'solve.sh'
    solve.write_text(f'''#!/bin/bash
set -euo pipefail
cd /app
git config --global --add safe.directory /app
test "$(git rev-parse HEAD)" = {base}
test -z "$(git status --porcelain --untracked-files=no)"
if [ -s /solution/model.patch ]; then
  git -c core.hooksPath=/dev/null apply --index --binary /solution/model.patch
  git -c core.hooksPath=/dev/null -c user.name=eval-carrier -c user.email=eval-carrier@local commit --quiet --no-gpg-sign -m 'Apply submitted committed Agent patch'
fi
''')
    solve.chmod(0o755)
    if official_files(staged_task) != original:
        raise ValueError('Staging changed official verifier material')
    result = {'schemaVersion': 1, 'kind': 'deepswe-committed-patch-carrier',
              'taskId': official_task.name, 'submission': receipt,
              'officialFilesSha256': original, 'carrierSha256': sha(solve),
              'officialVerifierUnchanged': True, 'independentVerifier': True,
              'carrierCommitOnly': True}
    with staged_task.with_suffix('.manifest.json').open('x') as out:
        json.dump(result, out, indent=2)
        out.write('\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('official_task', type=Path)
    parser.add_argument('submission', type=Path)
    parser.add_argument('staged_task', type=Path)
    args = parser.parse_args()
    result = prepare(args.official_task, args.submission, args.staged_task)
    print(json.dumps({'taskId': result['taskId'], 'patchSha256': result['submission']['patchSha256']}))


if __name__ == '__main__':
    main()
