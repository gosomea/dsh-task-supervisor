#!/usr/bin/env python3
"""Run or reconcile one release-admitted DeepSWE position (never retry Agent)."""
import argparse
import json
from pathlib import Path
import subprocess
import time

from control_flow import Journal, begin, exclusive_json, supervise
from control_rpc import WebRpc
from launch_host import arm_watchdog, launch, owned, quiesce


def validate_position(spec, instruction, protocol):
    """Bind an actual invocation to the frozen paired task and execution inputs."""
    import hashlib
    row = next((row for row in protocol['order'] if row['id'] == spec['id']), None)
    if row is None or any(spec.get(key) != row[key] for key in ('condition', 'taskId', 'repeat')):
        raise ValueError('Invocation differs from the admitted paired position')
    task = next(task for task in protocol['tasks'] if task['id'] == row['taskId'])
    comparisons = {'baseCommit': task['baseCommit'], 'imageDigest': task['imageDigest'],
                   'deadlineSec': task['agentTimeoutSec'], 'mainCpus': task['mainCpus'],
                   'mainMemoryMiB': task['mainMemoryMiB']}
    if any(spec.get(key) != value for key, value in comparisons.items()):
        raise ValueError('Invocation changes the frozen task environment or deadline')
    if hashlib.sha256(instruction.encode()).hexdigest() != task['instructionSha256']:
        raise ValueError('Delivered official instruction differs from frozen bytes')
    roots = {key: Path(value).resolve() for key, value in spec['release']['roots'].items()}
    runtime = Path(spec['runtime']).resolve()
    if runtime / 'dsh-source' != roots['runtime'] or runtime / 'node24-linux-amd64' != roots['node']             or runtime / 'plugin-source' != roots['plugin'] or Path(spec['runner']).resolve() != Path(__file__).resolve().parent:
        raise ValueError('Executed runtime paths differ from frozen inventory')
    if roots['runner'] != Path(__file__).resolve().parent and roots['runner'] not in Path(__file__).resolve().parents:
        raise ValueError('Executing adapter is outside frozen runner inventory')
    template = Path(spec['template']).resolve()
    if template != roots['profile'] / spec['condition']:
        raise ValueError('Condition template differs from frozen profile root')
    # Every launch parameter, including overlays, mounts and network policy,
    # must have been fixed before the release inventory was fingerprinted.
    position_file = roots['profile'] / 'positions' / (spec['id'] + '.json')
    if json.loads(position_file.read_text()) != spec:
        raise ValueError('Actual launch options differ from the frozen position specification')
    if spec.get('formal') is not True or not spec.get('netctlImage') or spec.get('cwd', '/app') != '/app':
        raise ValueError('Formal namespace, network and task location were not admitted')
    from position_inputs import assert_position_inputs
    assert_position_inputs(spec, protocol, __file__)


def run_position(spec, instruction, root, *, allow_smoke=False):
    """Execute a predeclared position; unresolved starts reuse original evidence."""
    journal = Journal(root)
    if not allow_smoke:
        from freeze_release import require_frozen_release
        protocol = require_frozen_release(spec['release'])
        validate_position(spec, instruction, protocol)
    if journal.read('terminal.json') is not None:
        return journal.read('terminal.json')
    receipt = journal.read('launch-receipt.json')
    if receipt is None:
        if journal.read('launch-intent.json') is not None:
            raise RuntimeError('uncertain launch: reconcile owned container without relaunch')
        journal.write('launch-intent.json', spec)
        receipt = launch(spec)
        journal.write('launch-receipt.json', receipt)
    owned(receipt['dockerContext'], receipt['container'], receipt['lease'])
    home = Path(receipt['home'])
    rpc = WebRpc(home / 'run/host.log', f'http://127.0.0.1:{receipt["port"]}', startup_port=receipt.get('internalPort'))
    plan_process = None
    def before_delivery(started):
        nonlocal plan_process
        arm_watchdog(receipt, started)
        if spec['condition'] != 'plan':
            return
        plan_config = {**spec['planClient'], 'journal': str(journal.root),
                       'hostLog': str(home / 'run/host.log'), 'port': receipt['port'],
                       'sessionId': started['sessionId'], 'sessionTitle': started['sessionTitle'],
                       'deadlineAtUnix': started['deadlineAtUnix']}
        path = journal.root / 'plan-client-config.json'
        exclusive_json(path, plan_config)
        with (journal.root / 'plan-client.log').open('x') as log:
            plan_process = subprocess.Popen([spec['hostNode'], str(Path(__file__).with_name('approve_plan.mjs')), str(path)],
                                            stdout=log, stderr=log, start_new_session=True)
        journal.write('plan-client-process.json', {'pid': plan_process.pid, 'atUnix': time.time()})
        deadline = min(started['deadlineAtUnix'], time.time() + 60)
        while time.time() < deadline:
            if journal.read('plan-client-ready.json'):
                return
            if plan_process.poll() is not None:
                raise RuntimeError('native Plan question transport exited before model delivery')
            time.sleep(0.5)
        raise TimeoutError('native Plan question transport was not ready')
    try:
        started = journal.read('started.json')
        if started is None:
            with journal.controller():
                started = begin(rpc, journal, spec['condition'], instruction, spec['baseCommit'], spec['id'],
                                deadline_sec=spec.get('deadlineSec', 10800), cwd=spec.get('cwd', '/app'), before_delivery=before_delivery)
        elif spec['condition'] == 'plan' and not journal.read('approval-receipt.json'):
            # Browser state/remote event may be uncertain. Never synthesize a
            # second approval or restart a lost native question transport.
            if not journal.read('plan-client-process.json'):
                raise RuntimeError('original Plan question transport needs reconciliation')
        def read_projection(session_id):
            path = home / 'storages/session_projcache/sessions' / (session_id + '.json')
            if not path.exists():
                # Projection cache writes behind. Let the caller wait without
                # manufacturing a terminal/idle transition before its first row.
                return {'record': {'rows': {}}}
            return json.loads(path.read_text())
        def stop(current, last):
            try:
                return quiesce(receipt, current, journal.root / 'submission')
            except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
                journal.write('quiescence-error.json', {'errorType': type(error).__name__, 'atUnix': time.time()})
                return {'acknowledged': False}
        return supervise(rpc, journal, read_projection, stop)
    finally:
        if plan_process is not None:
            import os
            import signal
            if plan_process.poll() is None:
                os.killpg(plan_process.pid, signal.SIGTERM)
                try:
                    plan_process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(plan_process.pid, signal.SIGKILL)
                    plan_process.wait(timeout=10)


def finalize_position(spec, root):
    """Grade a quiescent committed submission and seal one immutable position."""
    from grade import run_grade
    from metrics import collect, read_home
    if spec.get('formal'):
        from freeze_release import require_frozen_release
        protocol = require_frozen_release(spec['release'])
        instruction = (Path(spec['dataset']) / 'tasks' / spec['taskId'] / 'instruction.md').read_text()
        validate_position(spec, instruction, protocol)
    journal = Journal(root)
    previous = journal.read('result.json')
    if previous is not None:
        validate_result_identity(previous, spec)
        return previous
    terminal = journal.read('terminal.json')
    started = journal.read('started.json')
    if terminal is None:
        raise RuntimeError('Execution is not sealed; reconcile original controller')
    grade = journal.read('grade/grade-result.json')
    if grade is None and terminal['cleanupAcknowledged'] and terminal.get('submissionDir'):
        if (journal.root / 'grade').exists():
            raise RuntimeError('Original grader outcome is uncertain; reconcile its existing evidence without relaunch')
        grade = run_grade(Path(spec['dataset']), spec['taskId'], Path(terminal['submissionDir']),
            journal.root / 'grade', Path(spec['pierBin']), spec['dockerContext'], spec['imageDigest'])
    elif grade is None:
        grade = {'reward': None, 'fault': {'code': 'execution-not-quiescent-or-submission-missing'}}
    metrics = journal.read('metrics.json')
    if metrics is None:
        try:
            sessions, projections, hashes = read_home(Path(spec['home']))
            metrics = collect(sessions, projections, terminal['mainSessionId'])
            import importlib.util
            audit_path = Path(spec['release']['roots']['reviewAudit']).resolve(strict=True)
            loader = importlib.util.spec_from_file_location('review_audit', audit_path)
            audit = importlib.util.module_from_spec(loader)
            loader.loader.exec_module(audit)
            review = audit.summarize(sessions[terminal['mainSessionId']])
            metrics.update(reviewWaitMs=review['reviewWaitMs'], repairTurns=review['repairTurns'],
                           internalReviewFaults=review['faultsByCode'], reviewAudit=review,
                           evidence=hashes, humanInterventions=terminal['approvalCount'])
        except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
            metrics = {'allSessionTokens': None, 'tokenCoverageComplete': False,
                       'fault': {'errorType': type(error).__name__}}
        journal.write('metrics.json', metrics)
    route = journal.read('route.json')
    if route is None:
        route = collect_route(spec, terminal)
        journal.write('route.json', route)
    terminal = {**terminal, 'elapsedSec': terminal['endedAtUnix'] - started['startedAtUnix'],
                'deadlineSec': started['timeLimitSec']}
    result = {'schemaVersion': 1, 'id': spec['id'], 'taskId': spec['taskId'], 'repeat': spec['repeat'],
              'condition': spec['condition'], 'started': True,
              'delivered': journal.read('start-receipt.json') is not None,
              'terminal': terminal, 'grade': grade, 'metrics': metrics, 'route': route}
    return journal.write('result.json', result)


def validate_result_identity(result, spec):
    """A sealed record must match the whole paired position identity."""
    if any(result.get(key) != spec.get(key) for key in ('id', 'taskId', 'condition', 'repeat')):
        raise ValueError('Existing result belongs to another paired position')


def collect_route(spec, terminal):
    """Read retained HTTP observations only; never issue model requests."""
    import hashlib
    from metrics import read_home
    from model_route import inspect_chain
    try:
        audit_path = Path(spec['home']) / 'run/model-route-audit.jsonl'
        audit_bytes = audit_path.read_bytes()
        audit = [json.loads(line) for line in audit_bytes.decode().splitlines() if line]
        sessions, _, hashes = read_home(Path(spec['home']))
        route = inspect_chain(terminal['mainSessionId'], sessions, audit, spec['condition'])
        summaries = [route['main'], *route['reviewers'], *route['additionalSessions']]
        if not any(row['actualHttpRequests'] for row in summaries):
            route.update(routesMatched=None, protocolDeviation=None,
                         fault={'errorType': 'MissingHttpRouteObservation'})
        route.update(schemaVersion=1, kind='actual-model-route-chain', runKind='formal-model-attempt',
                     benchmarkModelAttempts=1, auditSha256=hashlib.sha256(audit_bytes).hexdigest(), evidence=hashes)
        return route
    except (OSError, ValueError, KeyError, TypeError) as error:
        return {'schemaVersion': 1, 'kind': 'actual-model-route-chain', 'routesMatched': None,
                'protocolDeviation': None, 'fault': {'errorType': type(error).__name__}}


def run_batch(manifest):
    """Use one batch lease and the admitted order; never replace missing attempts."""
    from freeze_release import require_frozen_release
    protocol = require_frozen_release(manifest['release'])
    rows = manifest['positions']
    if [row['id'] for row in rows] != [row['id'] for row in protocol['order']]:
        raise ValueError('Batch invocation changes the frozen order or denominator')
    root = Path(manifest['root'])
    batch = Journal(root)
    with batch.controller():
        for spec in rows:
            if spec['release'] != manifest['release']:
                raise ValueError('Position uses another release')
            position_root = root / 'attempts' / spec['id']
            journal = Journal(position_root)
            result = journal.read('result.json')
            if result is not None:
                validate_result_identity(result, spec)
                continue
            instruction_path = Path(spec['dataset']) / 'tasks' / spec['taskId'] / 'instruction.md'
            instruction = instruction_path.read_text()
            # An interrupted invocation reads the same started Session. It does
            # not rerun the Agent, grant another approval or allocate a new home.
            run_position(spec, instruction, position_root)
            finalize_position(spec, position_root)
        return batch.write('batch-result.json', {'schemaVersion': 1, 'planned': len(rows),
            'sealedIds': [row['id'] for row in rows], 'automaticAgentReruns': 0,
            'automaticInfrastructureReplacements': 0})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('spec', type=Path)
    parser.add_argument('instruction', type=Path, nargs='?')
    parser.add_argument('root', type=Path, nargs='?')
    parser.add_argument('--batch', action='store_true')
    parser.add_argument('--smoke', action='store_true', help='Non-candidate gate only, excluded from 16 positions')
    args = parser.parse_args()
    if args.batch:
        if args.smoke: parser.error('Formal batch cannot bypass release admission')
        print(json.dumps(run_batch(json.loads(args.spec.read_text()))))
    else:
        if args.instruction is None or args.root is None: parser.error('Position needs instruction and root')
        print(json.dumps(run_position(json.loads(args.spec.read_text()), args.instruction.read_text(), args.root,
                                      allow_smoke=args.smoke)))


if __name__ == '__main__':
    main()
