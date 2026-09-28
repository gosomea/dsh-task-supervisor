#!/usr/bin/env python3
"""Fix metadata-only pilot selection; runtime admission is a separate operation."""
import argparse
import hashlib
import json
import re
from pathlib import Path
import subprocess
import tomllib

SEED = 'dsh-independent-deepswe-pilot-v1'
LANGUAGES = ('go', 'typescript')
# Published FrontierHarness examples are calibration/exposure exclusions, not outcomes.
EXCLUDED = frozenset({
    'anko-typed-variable-bindings', 'arktype-json-schema-refs-dependencies',
    'expr-try-catch-errors', 'fastapi-deprecation-response-headers',
    'httpx-multipart-response-parsing', 'katex-multicolumn-array-spans',
    'meriyah-explicit-resource-declarations', 'python-statemachine-state-data-scoping',
    'scc-bounded-memory-spilling',
})
CONDITIONS = ('goal', 'plan', 'supervisor-log', 'supervisor-independent')


def git(checkout, *args):
    return subprocess.check_output(['git', '-C', str(checkout), *args])


def select(checkout, expected_commit):
    commit = git(checkout, 'rev-parse', 'HEAD').decode().strip()
    if commit != expected_commit:
        raise ValueError('Dataset HEAD differs from the requested immutable revision')
    if git(checkout, 'status', '--porcelain').strip():
        raise ValueError('Dataset checkout must be clean')
    ids = git(checkout, 'ls-tree', '-d', '--name-only', 'HEAD:tasks').decode().splitlines()
    candidates = []
    for tid in sorted(set(ids) - EXCLUDED):
        meta_bytes = git(checkout, 'show', f'HEAD:tasks/{tid}/task.toml')
        meta = tomllib.loads(meta_bytes.decode())
        if meta['metadata']['language'] not in LANGUAGES:
            continue
        candidates.append((tid, meta, meta_bytes))
    tasks = []
    for language in LANGUAGES:
        eligible = [row for row in candidates if row[1]['metadata']['language'] == language]
        if not eligible:
            raise ValueError(f'No unexposed {language} candidates')
        tid, meta, meta_bytes = min(eligible, key=lambda row: hashlib.sha256(
            f'{SEED}/task/{row[0]}'.encode()).hexdigest())
        if meta['verifier']['environment_mode'] != 'separate':
            raise ValueError('Pilot requires an official separate verifier')
        tasks.append({
            'id': tid, 'language': language, 'repository': meta['metadata']['repository_url'],
            'baseCommit': meta['metadata']['base_commit_hash'],
            'instructionSha256': hashlib.sha256(git(checkout, 'show', f'HEAD:tasks/{tid}/instruction.md')).hexdigest(),
            'taskMetadataSha256': hashlib.sha256(meta_bytes).hexdigest(),
            'image': meta['environment']['docker_image'], 'imageDigest': None,
            'agentTimeoutSec': meta['agent']['timeout_sec'],
            'verifierTimeoutSec': meta['verifier']['timeout_sec'],
            'mainCpus': meta['environment']['cpus'],
            'mainMemoryMiB': meta['environment']['memory_mb'],
            'storageMiB': meta['environment']['storage_mb'],
        })
    attempts = [{'id': f'{task["id"]}-r{repeat}-{condition}', 'taskId': task['id'],
                 'repeat': repeat, 'condition': condition}
                for task in tasks for repeat in (1, 2) for condition in CONDITIONS]
    attempts.sort(key=lambda row: hashlib.sha256(
        f'{SEED}/order/{row["id"]}'.encode()).hexdigest())
    return {
        'schemaVersion': 1, 'id': SEED, 'kind': 'integration-pilot-sample',
        'status': 'sample-fixed-before-model-delivery; runtime-not-admitted',
        'dataset': 'DeepSWE v1.1', 'datasetCommit': commit,
        'selection': 'Minimum SHA-256(seed/task/id) per Go/TypeScript stratum using metadata only',
        'excludedTaskIds': sorted(EXCLUDED), 'tasks': tasks,
        'conditions': list(CONDITIONS), 'repeats': 2, 'plannedAttempts': len(attempts),
        'orderSeed': SEED, 'order': attempts,
        'model': {'provider': 'deepseek-codebuddy', 'model': 'deepseek-v4.1-flash'},
        'initialApprovalCount': 1, 'additionalRescueCount': 0,
        'automaticAgentReruns': 0, 'automaticInfrastructureReplacements': 0,
        'deadline': 'Official per-task agent timeout x1, including approvals, reviews and continuation',
        'submission': 'Official committed binary patch from baseCommit to HEAD; uncommitted work is diagnosed separately, not silently committed by the evaluator',
        'reviewResources': 'Task-compatible immutable image, same configured CPU/memory per check; extra checker compute reported separately',
        'reviewFrequency': {'rounds': 6, 'toolCalls': 48, 'elapsedMs': 600000, 'consecutiveErrors': 3},
        'primarySuccess': 'Native controller finished before deadline AND official independent reward=1 AND no grading/infrastructure error',
        'metrics': ['completeDenominator', 'officialReward', 'nativeFinished', 'primarySuccess',
                    'falseCompletion', 'taskDeadline', 'internalReviewFault', 'infrastructureFault',
                    'allSessionTokens', 'reviewAndCommandWait', 'protocolRepair', 'humanInterventions',
                    'independentEvidenceCoverage', 'pairedTaskRepeatOutcomes'],
        'unlabelledMetrics': {'falsePauseRate': None, 'correctionBenefit': None},
        'release': None, 'modelAdmitted': False, 'modelRequests': 0,
        'admissionRequirements': [
            'Control-task oracle=1/nop=0 using official grading, including a live background-service control',
            'Candidate-specific official empty/reference controls in separate verifier environments',
            'Full candidate artifact capture and native check execution in the actual deployment topology',
            'Native background/timeout/cancellation/resource cleanup and unchanged primary tool surface',
            'Daily effective model parity for main/reviewer; one initial approval and no rescue',
            'Pinned runner/runtime/plugin/profile/image digests and sufficient isolated resources',
        ],
        'claims': 'Engineering integration pilot; 16 attempts are not evidence of superiority over Goal/Plan/Team',
    }


def sample_sha256(protocol):
    """Bind a release to candidate metadata/order, excluding separately pinned runtime fields."""
    candidate = json.loads(json.dumps(protocol))
    candidate['release'] = None
    candidate['modelAdmitted'] = False
    for task in candidate['tasks']:
        task['imageDigest'] = None
    return hashlib.sha256(json.dumps(candidate, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode()).hexdigest()


def require_admission(protocol, expected_sample_sha256):
    """Deny model delivery until a distinct validated release accompanies the sample."""
    if protocol.get('modelAdmitted') is not True or not isinstance(protocol.get('release'), dict):
        raise ValueError('Runtime and controls are not admitted; model delivery is forbidden')
    if protocol.get('plannedAttempts') != len(protocol.get('order', [])):
        raise ValueError('Attempt denominator differs from order')
    if sample_sha256(protocol) != expected_sample_sha256:
        raise ValueError('Sample metadata or order differs from the immutable selection')
    tasks = protocol['tasks']
    if len(tasks) != 2 or len({task['id'] for task in tasks}) != 2 \
            or {task['language'] for task in tasks} != set(LANGUAGES) \
            or protocol['conditions'] != list(CONDITIONS) or protocol['repeats'] != 2:
        raise ValueError('Pilot strata or conditions differ from the paired design')
    matrix = {(task['id'], repeat, condition)
              for task in tasks for repeat in (1, 2) for condition in CONDITIONS}
    rows = protocol['order']
    if len(rows) != len(matrix) or {(r['taskId'], r['repeat'], r['condition']) for r in rows} != matrix \
            or any(r['id'] != f"{r['taskId']}-r{r['repeat']}-{r['condition']}" for r in rows):
        raise ValueError('Attempt matrix is incomplete or duplicated')
    release = protocol['release']
    if release.get('sampleSha256') != expected_sample_sha256:
        raise ValueError('Release is not bound to the immutable sample')
    for name in ('runnerSha256', 'runtimeSha256', 'pluginSha256', 'profileSha256'):
        if not isinstance(release.get(name), str) or not re.fullmatch('[a-f0-9]{64}', release[name]):
            raise ValueError(f'Release is missing immutable {name}')
    gates = release.get('gates', {})
    if not isinstance(gates, dict) or any(gates.get(requirement) is not True
                                       for requirement in protocol['admissionRequirements']):
        raise ValueError('Every admission requirement needs an explicit successful gate')
    if any(not isinstance(task.get('imageDigest'), str) or not re.fullmatch(
            'sha256:[a-f0-9]{64}', task['imageDigest']) for task in protocol['tasks']):
        raise ValueError('Candidate images are not pinned')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkout', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    protocol = select(args.checkout, args.commit)
    with args.output.open('x') as output:
        json.dump(protocol, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print(json.dumps({'tasks': [t['id'] for t in protocol['tasks']],
                      'planned': protocol['plannedAttempts'], 'modelAdmitted': False}))


if __name__ == '__main__':
    main()
