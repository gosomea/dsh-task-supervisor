#!/usr/bin/env python3
"""Grade a sealed committed submission once through the official separate verifier."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tomllib

from prepare_grade import prepare
from read_control import read_control


def write_new(path, value):
    with path.open('x') as out:
        json.dump(value, out, indent=2)
        out.write('\n')


def docker(context, *args):
    return subprocess.check_output(['docker', '--context', context, *args], timeout=30)


def verify_image(context, tag, digest):
    if not re.fullmatch('sha256:[a-f0-9]{64}', digest):
        raise ValueError('An immutable image digest is required')
    row = json.loads(docker(context, 'image', 'inspect', tag))[0]
    if row['Id'] != digest or not any(d.endswith('@' + digest) for d in row['RepoDigests']):
        raise ValueError('Official image tag no longer matches the frozen digest')
    return {'imageDigest': digest, 'architecture': row['Architecture']}


def stop_group(process):
    """Reap an owned new-session leader and kill any remaining descendants."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        # A stalled leader is handled by the same final group kill below.
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=10)


def run_grade(dataset, task_id, submission_dir, run_dir, pier_bin, docker_context, image_digest):
    """Reserve a grade position before launching; existing positions never relaunch."""
    dataset, submission_dir, run_dir, pier_bin = map(Path, (dataset, submission_dir, run_dir, pier_bin))
    if not re.fullmatch('[a-z0-9-]+', task_id):
        raise ValueError('Invalid task ID')
    official = dataset / 'tasks' / task_id
    meta = tomllib.loads((official / 'task.toml').read_text())
    image = verify_image(docker_context, meta['environment']['docker_image'], image_digest)
    endpoint = docker(docker_context, 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', docker_context).decode().strip()
    if not endpoint.startswith('unix://'):
        raise ValueError('The dedicated local Docker context is required')
    run_dir.mkdir(mode=0o700)
    started = {'schemaVersion': 1, 'kind': 'deepswe-official-grading-start',
               'taskId': task_id, 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'modelRequests': 0, 'automaticRetries': 0, **image}
    write_new(run_dir / 'started.json', started)
    carrier = prepare(official, submission_dir, run_dir / 'task')
    config = {'job_name': 'official', 'jobs_dir': str(run_dir / 'jobs'),
              'n_attempts': 1, 'n_concurrent_trials': 1, 'timeout_multiplier': 1.0,
              'retry': {'max_retries': 0}, 'agents': [{'name': 'oracle'}],
              'environment': {'type': 'docker', 'delete': True},
              'tasks': [{'path': str(run_dir / 'task')}]}
    write_new(run_dir / 'config.json', config)
    env = os.environ.copy()
    env['DOCKER_HOST'] = endpoint
    env.pop('DOCKER_CONTEXT', None)
    # These are carrier/build plus official verifier budgets, not an extension
    # of the original Agent deadline. Preserve official task timeouts unchanged.
    outer_timeout = meta['agent']['timeout_sec'] + meta['verifier']['timeout_sec'] + 2 * meta['environment']['build_timeout_sec'] + 300
    timeout = False
    cleanup_fault = None
    with (run_dir / 'pier.log').open('x') as log, (run_dir / 'docker-events.jsonl').open('x') as events:
        observer = subprocess.Popen(['docker', '--context', docker_context, 'events', '--format', '{{json .}}'],
                                    stdout=events, stderr=subprocess.DEVNULL)
        try:
            process = subprocess.Popen([str(pier_bin), 'run', '--config', str(run_dir / 'config.json')],
                                       env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            write_new(run_dir / 'process.json', {'pid': process.pid, 'command': [str(pier_bin), 'run', '--config', str(run_dir / 'config.json')],
                'observerPid': observer.pid, 'observerCommand': ['docker', '--context', docker_context, 'events', '--format', '{{json .}}'],
                'observerOutput': str(run_dir / 'docker-events.jsonl'),
                'deadlineAtUnix': __import__('time').time() + outer_timeout})
            exit_code = process.wait(timeout=outer_timeout)
        except subprocess.TimeoutExpired:
            timeout, exit_code = True, None
            stop_group(process)
        finally:
            try:
                cleanup_owned_projects(run_dir, docker_context)
            except Exception as error:
                cleanup_fault = type(error).__name__
                write_new(run_dir / 'cleanup-fault.json', {'errorType': cleanup_fault})
            finally:
                observer.terminate()
                try:
                    observer.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    observer.kill()
                    observer.wait(timeout=10)
    write_new(run_dir / 'process-finished.json', {'timeout': timeout, 'exitCode': exit_code})
    result = reconcile(run_dir, timeout=timeout, exit_code=exit_code)
    try:
        result.update(environment_evidence(run_dir, docker_context))
    except Exception as error:
        result.update(cleanupConfirmed=False, separateEnvironmentObserved=False,
                      environmentObservationErrorType=type(error).__name__)
    if cleanup_fault:
        result.update(cleanupConfirmed=False, cleanupErrorType=cleanup_fault)
    if not result['cleanupConfirmed'] or not result['separateEnvironmentObserved']:
        result.update(reward=None, scored=False, fault='independent-grader-environment-unconfirmed')
    result['officialFilesSha256'] = carrier['officialFilesSha256']
    result['submission'] = carrier['submission']
    result.update(image)
    write_new(run_dir / 'grade-result.json', result)
    return result


def resume_grade(run_dir, context):
    """Seal only a finished original verifier; never relaunch its carrier."""
    run_dir = Path(run_dir)
    if (run_dir / 'grade-result.json').exists():
        return json.loads((run_dir / 'grade-result.json').read_text())
    started = json.loads((run_dir / 'started.json').read_text())
    process_path = run_dir / 'process.json'
    if process_path.exists():
        process = json.loads(process_path.read_text())
        command = subprocess.run(['ps', '-p', str(process['pid']), '-o', 'command='], capture_output=True, text=True).stdout.strip()
        if command and str(run_dir / 'config.json') in command:
            raise RuntimeError('original grader still running; reconnect without relaunch')
    trials = list((run_dir / 'jobs' / 'official').glob('*/result.json'))
    if len(trials) != 1:
        raise RuntimeError('original grader outcome unknown; retain position without relaunch')
    if process_path.exists():
        stop_original_observer(process)
    cleanup_owned_projects(run_dir, context)
    finished = json.loads((run_dir / 'process-finished.json').read_text()) if (run_dir / 'process-finished.json').exists() else {}
    result = reconcile(run_dir, timeout=finished.get('timeout', False), exit_code=finished.get('exitCode'))
    result.update(environment_evidence(run_dir, context))
    carrier = json.loads((run_dir / 'task.manifest.json').read_text())
    if carrier['taskId'] != started['taskId']: raise ValueError('original grader task identity differs')
    from prepare_grade import official_files, sha
    if official_files(run_dir / 'task') != carrier['officialFilesSha256'] \
            or sha(run_dir / 'task/solution/solve.sh') != carrier['carrierSha256'] \
            or sha(run_dir / 'task/solution/model.patch') != carrier['submission']['patchSha256']:
        raise ValueError('original verifier or submitted patch changed; no regrade')
    result.update(officialFilesSha256=carrier['officialFilesSha256'], submission=carrier['submission'],
                  imageDigest=started['imageDigest'], architecture=started['architecture'],
                  reconciledOriginalVerifier=True)
    if not result['cleanupConfirmed'] or not result['separateEnvironmentObserved']:
        result.update(reward=None, scored=False, fault='independent-grader-environment-unconfirmed')
    write_new(run_dir / 'grade-result.json', result)
    return result


def stop_original_observer(identity):
    """A reused PID is not ownership; verify argv and the original open log."""
    if not identity.get('observerCommand') or not identity.get('observerOutput'): return
    pid = identity['observerPid']
    command = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout.strip()
    if not command: return
    if command != ' '.join(identity['observerCommand']):
        raise RuntimeError('observer PID identity changed; refusing termination')
    files = subprocess.run(['lsof', '-a', '-p', str(pid), '-d', '1', '-Fn'], capture_output=True, text=True).stdout.splitlines()
    if 'n' + str(Path(identity['observerOutput']).resolve()) not in files:
        raise RuntimeError('observer output identity changed; refusing termination')
    os.kill(pid, signal.SIGTERM)


def cleanup_owned_projects(run_dir, context):
    """Remove only Compose projects named by this reserved grader's trial configs."""
    for path in (run_dir / 'jobs' / 'official').glob('*/config.json'):
        config = json.loads(path.read_text())
        if Path(config['task']['path']).resolve() != (run_dir / 'task').resolve():
            raise ValueError('Refusing cleanup for an unrelated trial')
        project = re.sub(r'[^a-z0-9_-]', '-', config['trial_name'].lower())
        for name in (project, project + '__verifier__trial'):
            ids = docker(context, 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + name).decode().split()
            for container_id in ids:
                row = json.loads(docker(context, 'inspect', container_id))[0]
                if row['Config']['Labels'].get('com.docker.compose.project') != name:
                    raise ValueError('Grader container identity changed')
                docker(context, 'rm', '-f', container_id)


def environment_evidence(run_dir, context):
    trials = list((run_dir / 'jobs' / 'official').glob('*/result.json'))
    if len(trials) != 1:
        return {'cleanupConfirmed': False, 'separateEnvironmentObserved': False}
    trial = json.loads(trials[0].read_text())
    project = re.sub(r'[^a-z0-9_-]', '-', trial['trial_name'].lower())
    ids = {'carrier': set(), 'verifier': set()}
    for line in (run_dir / 'docker-events.jsonl').read_text().splitlines():
        event = json.loads(line)
        if event.get('Type') != 'container':
            continue
        attrs = event.get('Actor', {}).get('Attributes', {})
        actual = attrs.get('com.docker.compose.project')
        key = 'carrier' if actual == project else 'verifier' if actual == project + '__verifier__trial' else None
        if key and event.get('Action') == 'start':
            ids[key].add(event['Actor']['ID'])
    observed = len(ids['carrier']) == 1 and len(ids['verifier']) == 1 and ids['carrier'].isdisjoint(ids['verifier'])
    # Query only these exact owned Compose projects, never a global prune.
    remaining = [docker(context, 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + name).strip()
                 for name in (project, project + '__verifier__trial')]
    return {'cleanupConfirmed': not any(remaining), 'separateEnvironmentObserved': observed,
            'carrierContainerCount': len(ids['carrier']), 'verifierContainerCount': len(ids['verifier'])}


def reconcile(run_dir, *, timeout=False, exit_code=None):
    """Read an existing position without rerunning its patch carrier or verifier."""
    run_dir = Path(run_dir)
    started = json.loads((run_dir / 'started.json').read_text())
    read = read_control(run_dir / 'jobs' / 'official')
    fault = 'grader-process-timeout' if timeout else read['fault']
    if exit_code not in (None, 0) and fault is None:
        fault = 'grader-process-failure'
    result = {'schemaVersion': 1, 'kind': 'deepswe-official-grading-result',
              'taskId': started['taskId'], 'modelRequests': 0,
              'independentVerifier': True, 'automaticRetries': 0,
              'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'reward': None if fault else read['reward'], 'scored': read['scored'] and fault is None,
              'fault': fault, 'tests': read['tests'], 'execution': read.get('execution'),
              'F2P': read.get('F2P'), 'P2P': read.get('P2P'),
              'evidenceSha256': read['evidenceSha256'], 'processExitCode': exit_code,
              'cleanupConfirmed': False}
    # Separate verifier evidence must name distinct Agent and verifier sessions.
    trials = list((run_dir / 'jobs' / 'official').glob('*/result.json'))
    if len(trials) == 1:
        trial = json.loads(trials[0].read_text())
        result['officialEnvironmentMode'] = 'separate'
        result['verifierDuration'] = trial.get('verifier')
        result['trialId'] = trial.get('id')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path)
    parser.add_argument('task_id')
    parser.add_argument('submission', type=Path)
    parser.add_argument('run_dir', type=Path)
    parser.add_argument('--pier-bin', type=Path, required=True)
    parser.add_argument('--context', required=True)
    parser.add_argument('--image-digest', required=True)
    args = parser.parse_args()
    print(json.dumps(run_grade(args.dataset, args.task_id, args.submission, args.run_dir,
                              args.pier_bin, args.context, args.image_digest), indent=2))


if __name__ == '__main__':
    main()
