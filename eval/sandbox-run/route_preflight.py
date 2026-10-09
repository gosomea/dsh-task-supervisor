"""Real main/reviewer routing admission, separate from public test positions."""
import json
from pathlib import Path
import time
import shlex

from launch import select_model_patch
from records import exclusive_json
from runtime_rpc import RuntimeDshRpc


def run(runtime, *, image: str, tarball: Path, daily_patch: str,
        credential: bytes, out: Path, host_gateway: str) -> dict:
    exclusive_json(out / 'intent.json', {'kind': 'real-route-calibration', 'image': image,
        'publicTaskDelivered': False, 'executionApprovals': 0})
    box = runtime.create(image=image, snapshot_id=None, metadata={'role': 'route-calibration'},
        timeout_minutes=15, cpu='2', memory='8Gi', network_policy='allow')
    exclusive_json(out / 'started.json', {'sandboxId': box.id})
    rpc = None
    session_id = None
    try:
        runtime.write(box, '/workspace/README.md', b'Route calibration: this fixture contains a single static text file.\n')
        runtime.write(box, '/opt/eval/plugin.tgz', tarball.read_bytes())
        runtime.write(box, '/opt/eval/route-audit.mjs', Path(__file__).resolve().parents[1].joinpath('deepswe/model-route/route-audit.mjs').read_bytes())
        patch = select_model_patch(daily_patch, rewrite_proxy=True, workspace_write=True)
        patch += '\n- id: task-supervisor\n  config:\n    reviewVerification: independent\n    independentVerification:\n      storageRoot: /opt/eval/review-storage\n    executionApproval: manual\n'
        patch += '\n- insert:\n    - id: route-audit\n      name: /opt/eval/route-audit.mjs\n      config:\n        output: /opt/eval/route-audit.jsonl\n        endpoint: http://host.docker.internal:15721/tencent/v1/chat/completions\n'
        runtime.write(box, '/opt/eval/patch.yml', patch.encode())
        code, installation, error = runtime.exec(box,
            'DSH_HOME=/opt/eval/home DSH_TELEMETRY_DISABLED=1 dsh plugin --profile web add '
            '--config.strict-peer-dependencies=false /opt/eval/plugin.tgz', timeout_s=300)
        (out / 'installation.log').write_text(installation + error)
        if code != 0:
            raise RuntimeError('route calibration installation failed')
        runtime.write(box, '/opt/eval/home/.credentials.yaml', credential, mode=600)
        runtime.exec(box, 'cp /opt/eval/patch.yml /opt/eval/home/profiles/web/cordis.patch.yml')
        runtime.exec(box, "printf '%s\\n' " + shlex.quote(host_gateway + ' host.docker.internal') + ' >> /etc/hosts')
        runtime.exec(box, 'ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules /opt/eval/node_modules')
        runtime.exec(box, 'DSH_HOME=/opt/eval/home DSH_TELEMETRY_DISABLED=1 dsh web --port 3080 --no-open > /opt/eval/host.log 2>&1', background=True)
        rpc = RuntimeDshRpc(runtime, box, timeout=10)
        for attempt in range(60):
            try:
                rpc.list_sessions(); break
            except Exception:
                if attempt == 59:
                    raise RuntimeError('route calibration Host unavailable')
                time.sleep(1)
        workspace = rpc.create_workspace('/workspace')
        session = rpc.create_session(workspace['workspace']['workspaceId'])
        session_id = session['sessionId']
        exclusive_json(out / 'session.json', {'sessionId': session_id, 'cwd': '/workspace'})
        rpc.command(session_id, '/task Read README.md and plan a single read-only node that reports its exact content. '
            'Do not modify any files. This is a route calibration, not a public evaluation task.')
        path = '/api/task-supervisor?sessionId=' + session_id
        for attempt in range(90):
            state = rpc.http('GET', path)
            task = state.get('task')
            jobs = [job for job in state.get('reviewJobs', []) if task and job['taskId'] == task['id']]
            review = next((job for job in jobs if job.get('reviewerSessionId')), None)
            audit = [json.loads(line) for line in runtime.read(box, '/opt/eval/route-audit.jsonl').splitlines() if line]
            def completed(sid):
                selected = [row for row in audit if row.get('sessionId') == sid]
                return all(row.get('provider') == 'deepseek-codebuddy' and row.get('model') == 'deepseek-v4.1-flash' for row in selected) \
                    and any(row['type'] == 'http-response' and row.get('endpointMatched') is True and 200 <= row['statusCode'] < 300 for row in selected) \
                    and any(row['type'] == 'model-end' and row.get('exhausted') is True for row in selected) \
                    and any(row['type'] == 'model-finish' and row.get('finishKind') in ('stop', 'tool-calls') for row in selected)
            if review and completed(session_id) and completed(review['reviewerSessionId']):
                result = {'passed': True, 'mainSessionId': session_id, 'reviewerSessionId': review['reviewerSessionId'],
                    'reviewJobId': review['id'], 'reviewTaskId': review['taskId'],
                    'provider': 'deepseek-codebuddy', 'model': 'deepseek-v4.1-flash',
                    'successfulMainAndReviewerHttpObserved': True, 'executionApprovals': 0,
                    'publicTaskDelivered': False, 'observedRequests': sum(row['type'] == 'http-request' for row in audit)}
                break
            if task and task['phase'] == 'paused':
                raise RuntimeError('route calibration paused before proving both requests')
            if attempt == 89:
                raise RuntimeError('route calibration did not prove both requests within 450 seconds')
            time.sleep(5)
        exclusive_json(out / 'result.json', result)
        return result
    finally:
        if rpc and session_id:
            rpc.command(session_id, '/task pause')
        for name in ('host.log', 'route-audit.jsonl'):
            try:
                target = out / ('private-' + name)
                target.write_bytes(runtime.read(box, '/opt/eval/' + name)); target.chmod(0o600)
            except Exception:
                pass
        # Native Session files contain the durable request and review lineage.
        runtime.exec(box, 'tar -cf /opt/eval/session-evidence.tar -C /opt/eval/home sessions storages/session_projcache', timeout_s=30)
        evidence = out / 'private-session-evidence.tar'
        evidence.write_bytes(runtime.read(box, '/opt/eval/session-evidence.tar')); evidence.chmod(0o600)
        runtime.destroy(box)
        exclusive_json(out / 'cleanup.json', {'sandboxId': box.id, 'destroyed': True})
