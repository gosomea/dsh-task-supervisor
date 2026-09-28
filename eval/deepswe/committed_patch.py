#!/usr/bin/env python3
"""Export only committed DeepSWE work; never submit the Agent's working tree."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def git(workspace, *args):
    return subprocess.check_output(['git', '-C', str(workspace), *args], timeout=30)


def extract(workspace, base, head=None):
    base = git(workspace, 'rev-parse', '--verify', base + '^{commit}').decode().strip()
    observed_head = git(workspace, 'rev-parse', '--verify', 'HEAD^{commit}').decode().strip()
    head = git(workspace, 'rev-parse', '--verify', (head or observed_head) + '^{commit}').decode().strip()
    subprocess.run(['git', '-C', str(workspace), 'merge-base', '--is-ancestor', base, head],
                   check=True, timeout=30, stdout=subprocess.DEVNULL)
    patch = git(workspace, '-c', 'diff.external=', 'diff', '--binary', '--full-index',
                '--no-ext-diff', '--no-textconv', base, head)
    status = git(workspace, 'status', '--porcelain=v1', '-z', '--untracked-files=all')
    receipt = {'baseCommit': base, 'headCommit': head, 'patchBytes': len(patch),
               'patchSha256': hashlib.sha256(patch).hexdigest(), 'source': 'committed-base-to-head',
               'workingTreeDirty': bool(status), 'workingTreeStatusSha256': hashlib.sha256(status).hexdigest(),
               'workingTreeSubmitted': False}
    receipt.update(observedHeadCommit=observed_head, headChangedSinceCutoff=observed_head != head)
    return patch, receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workspace', type=Path)
    parser.add_argument('base_commit')
    parser.add_argument('output_directory', type=Path)
    parser.add_argument('--head', help='Already recorded cutoff commit; current HEAD is diagnostic only')
    args = parser.parse_args()
    # Reserve before reading Git so a prior attempt cannot be silently overwritten.
    args.output_directory.mkdir(mode=0o700)
    patch, receipt = extract(args.workspace, args.base_commit, args.head)
    with (args.output_directory / 'model.patch').open('xb') as output:
        output.write(patch)
    with (args.output_directory / 'receipt.json').open('x') as output:
        json.dump(receipt, output, indent=2)
        output.write('\n')
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
