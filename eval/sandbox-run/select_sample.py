"""Select metadata-only holdouts before admission or any model delivery."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tomllib

from records import exclusive_json

SEED = 'dsh-opensandbox-long-horizon-v1'
CONDITIONS = ('goal', 'plan', 'supervisor-independent')
EXCLUDED = frozenset({
    'anko-typed-variable-bindings', 'arktype-json-schema-refs-dependencies',
    'expr-try-catch-errors', 'fastapi-deprecation-response-headers',
    'httpx-multipart-response-parsing', 'katex-multicolumn-array-spans',
    'meriyah-explicit-resource-declarations', 'python-statemachine-state-data-scoping',
    'scc-bounded-memory-spilling', 'helm-array-merge-strategies', 'kea-atomic-signal-selectors',
})


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def select(root: Path, commit: str, exposed: set[str]) -> dict:
    if git(root, 'rev-parse', 'HEAD').decode().strip() != commit or git(root, 'status', '--porcelain').strip():
        raise ValueError('dataset must match the clean frozen commit')
    excluded = EXCLUDED | exposed
    candidates = {language: [] for language in ('go', 'typescript')}
    for identity in git(root, 'ls-tree', '-d', '--name-only', 'HEAD:tasks').decode().splitlines():
        if identity in excluded:
            continue
        raw = git(root, 'show', f'HEAD:tasks/{identity}/task.toml')
        meta = tomllib.loads(raw.decode())
        language = meta['metadata']['language']
        if language not in candidates:
            continue
        candidates[language].append({
            'id': identity, 'language': language,
            'rank': hashlib.sha256(f'{SEED}/task/{identity}'.encode()).hexdigest(),
            'baseCommit': meta['metadata']['base_commit_hash'],
            'instructionSha256': hashlib.sha256(git(root, 'show', f'HEAD:tasks/{identity}/instruction.md')).hexdigest(),
            'taskMetadataSha256': hashlib.sha256(raw).hexdigest(),
            'image': meta['environment']['docker_image'],
            'agentTimeoutSec': meta['agent']['timeout_sec'],
            'verifierTimeoutSec': meta['verifier']['timeout_sec'],
            'mainCpus': meta['environment']['cpus'],
            'mainMemoryMiB': meta['environment']['memory_mb'],
            'storageMiB': meta['environment']['storage_mb'],
            'verifierEnvironmentMode': meta['verifier']['environment_mode'],
        })
    for rows in candidates.values():
        rows.sort(key=lambda row: row['rank'])
        if len(rows) < 2:
            raise ValueError('insufficient unexposed candidates')
    return {'schemaVersion': 1, 'seed': SEED, 'datasetCommit': commit,
            'excludedTaskIds': sorted(excluded), 'candidates': candidates,
            'selectedTaskIds': [row['id'] for rows in candidates.values() for row in rows[:2]],
            'replacementRule': 'advance within the frozen stratum only before model delivery; retain admission fault',
            'modelAdmitted': False, 'modelRequests': 0}


def order(tasks: list[str]) -> list[dict]:
    if len(tasks) != 4 or len(set(tasks)) != 4:
        raise ValueError('four distinct admitted holdouts required')
    rows = [{'id': f'{task}-r{repeat}-{condition}', 'taskId': task,
             'repeat': repeat, 'condition': condition}
            for task in tasks for repeat in (1, 2) for condition in CONDITIONS]
    return sorted(rows, key=lambda row: hashlib.sha256(f'{SEED}/order/{row["id"]}'.encode()).hexdigest())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--exposure-list', type=Path, required=True)
    args = parser.parse_args()
    result = select(args.dataset, args.commit, set(json.loads(args.exposure_list.read_text())))
    exclusive_json(args.output, result)
    print(json.dumps({'selected': result['selectedTaskIds'], 'modelAdmitted': False}))
