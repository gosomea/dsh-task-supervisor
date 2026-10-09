"""Model-free empty/reference controls with the unchanged official scorer."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib

sys.path.append(str(Path(__file__).resolve().parents[1] / 'deepswe'))
from grade import cleanup_owned_projects, environment_evidence, stop_group, verify_image
from read_control import read_control
from prepare_grade import official_files
from records import exclusive_json


def official_control(*, dataset: Path, task_id: str, agent: str, out: Path,
                     pier: Path, context: str, image_digest: str) -> dict:
    if agent not in ('oracle', 'nop'):
        raise ValueError('controls cannot start a model Agent')
    original = dataset / 'tasks' / task_id
    meta = tomllib.loads((original / 'task.toml').read_text())
    observed = verify_image(context, meta['environment']['docker_image'], image_digest)
    exclusive_json(out / 'started.json', {'taskId': task_id, 'agent': agent,
        'startedAt': datetime.now(timezone.utc).isoformat(), 'modelRequests': 0, **observed})
    shutil.copytree(original, out / 'task', symlinks=True)
    if official_files(original) != official_files(out / 'task'):
        raise ValueError('official control inputs changed')
    config = {'job_name': 'official', 'jobs_dir': str(out / 'jobs'), 'n_attempts': 1,
        'n_concurrent_trials': 1, 'timeout_multiplier': 1.0, 'retry': {'max_retries': 0},
        'agents': [{'name': agent}], 'environment': {'type': 'docker', 'delete': True},
        'tasks': [{'path': str(out / 'task')}]}
    exclusive_json(out / 'config.json', config)
    env = os.environ.copy()
    env['DOCKER_HOST'] = subprocess.check_output(['docker', '--context', context,
        'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', context], text=True).strip()
    env.pop('DOCKER_CONTEXT', None)
    timeout = meta['agent']['timeout_sec'] + meta['verifier']['timeout_sec'] + 2 * meta['environment']['build_timeout_sec'] + 300
    timed_out = False
    with (out / 'pier.log').open('x') as log, (out / 'docker-events.jsonl').open('x') as events:
        observer = subprocess.Popen(['docker', '--context', context, 'events', '--format', '{{json .}}'],
            stdout=events, stderr=subprocess.DEVNULL)
        try:
            process = subprocess.Popen([str(pier), 'run', '--config', str(out / 'config.json')],
                env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out, code = True, None
                stop_group(process)
        finally:
            cleanup_owned_projects(out, context)
            observer.terminate()
            observer.wait(timeout=10)
    read = read_control(out / 'jobs' / 'official')
    evidence = environment_evidence(out, context)
    result = {'taskId': task_id, 'agent': agent, 'modelRequests': 0, 'processExitCode': code,
        'timedOut': timed_out, **read, **evidence, **observed}
    result['passed'] = (code == 0 and not timed_out and read['scored'] and read['fault'] is None
        and read['reward'] == (1 if agent == 'oracle' else 0)
        and evidence['cleanupConfirmed'] and evidence['separateEnvironmentObserved'])
    exclusive_json(out / 'result.json', result)
    return result
