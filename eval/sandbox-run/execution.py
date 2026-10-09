"""Frozen worker admission, delivery, reconnect and collection through public DSH.

No dynamically chosen runtime, second supervisor model, or rescue prompt.
Model delivery is distinct from preparation so every gate can fail keylessly.
"""
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import re
from pathlib import Path
import shlex
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

from gateway import prepare_gateway, stop_gateway
from launch import select_model_patch
from monitor import Journal, fold, observe, parse_events, renew
from runtime import SandboxRef
from runtime_rpc import RuntimeDshRpc
from native_fault import native_request_fault

sys.path.append(str(Path(__file__).resolve().parents[1] / 'deepswe'))
from control_flow import controller_overlay, observe as native_observe, projection_values
from native_stop import goal_stop_evidence, plan_stop_evidence

MODEL = {'provider': 'deepseek-codebuddy', 'model': 'deepseek-v4.1-flash'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def append_patches(text, patches):
    """Append flow mapping entries to DSH's single YAML patch sequence."""
    return text.rstrip() + '\n' + ''.join('- ' + json.dumps(item) + '\n' for item in patches)


def native_overlay(runtime, box, condition):
    # Use the declaration shipped in the frozen image, including child plugin
    # rows; disabling the global Goal service alone leaves preset dependencies.
    content = runtime.read(box, '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/'
        '@deepseek-ai/dsh-web-app/presets/standard.patch.yml')
    with tempfile.TemporaryDirectory() as root:
        path = Path(root) / 'standard.patch.yml'; path.write_bytes(content)
        return controller_overlay(condition, path), hashlib.sha256(content).hexdigest()


def validate_spec(spec):
    if spec.get('schemaVersion') != 1 or spec['condition'] not in ('goal', 'plan', 'supervisor-independent'):
        raise ValueError('unknown frozen run specification')
    for path_key, hash_key in (('tarball', 'tarballSha256'), ('modelPatch', 'modelPatchSha256'),
                               ('protocolControls', 'protocolControlsSha256'), ('routeAudit', 'routeAuditSha256')):
        if digest(spec[path_key]) != spec[hash_key]:
            raise ValueError(path_key + ' differs from frozen bytes')
    if not re.fullmatch(r'(?:[^@\s]+@)?sha256:[a-f0-9]{64}', spec['image']) or spec['deadlineSec'] <= 0 or not spec.get('snapshotId'):
        raise ValueError('frozen image, baseline and positive deadline required')
    if hashlib.sha256(spec['instruction'].encode()).hexdigest() != spec['instructionSha256']:
        raise ValueError('instruction changed')
    registry = spec.get('bootstrapRegistryIpv4')
    if registry is not None:
        if not isinstance(registry, list) or not 1 <= len(registry) <= 8:
            raise ValueError('invalid frozen registry IPv4 list')
        for address in registry:
            if str(ipaddress.IPv4Address(address)) != address:
                raise ValueError('invalid frozen registry IPv4 address')
    if spec.get('formal') and spec.get('revision'):
        raise ValueError('formal positions cannot contain requirement revisions')
    if spec.get('formal') and (not spec.get('nativePresetSha256') or
            (spec['condition'] != 'supervisor-independent' and not spec.get('nativeControllerSha256'))):
        raise ValueError('formal native controller and preset admission hashes required')


def checked(runtime, box, command, timeout=30):
    code, output, error = runtime.exec(box, command, timeout_s=timeout)
    if code != 0:
        # Raw provider/bootstrap output stays private; do not expose auth URLs.
        raise RuntimeError('sandbox preparation command failed with exit ' + str(code))
    return output


def bind_registry(runtime, box, spec):
    """Use a verified frozen bootstrap address without altering native policy."""
    if spec.get('bootstrapRegistryIpv4'):
        address = str(ipaddress.IPv4Address(spec['bootstrapRegistryIpv4'][0]))
        checked(runtime, box, "printf '%s\\n' " + shlex.quote(address + ' registry.npmjs.org') + ' >> /etc/hosts')


def prepare(runtime, spec, journal):
    """Restore original keyless baseline before credentials or model delivery."""
    validate_spec(spec)
    original = journal.read('prepared.json')
    if original:
        if original['specSha256'] != hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest():
            raise ValueError('cannot change original position specification')
        box = runtime.connect(original['sandboxId'])
        return box, RuntimeDshRpc(runtime, box), original
    if journal.read('prepare-intent.json'):
        raise RuntimeError('uncertain preparation: reconcile original resource; no new sandbox')
    journal.write('prepare-intent.json', {'specSha256': hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest(),
        'source': 'evaluation-protocol', 'modelRequests': 0, 'id': spec['id']})
    gateway = None
    if spec['condition'] == 'supervisor-independent':
        # Lease maximum covers bootstrap, the fixed original task and collection.
        lease_end = datetime.fromtimestamp(time.time() + spec['deadlineSec'] + 1800, timezone.utc).isoformat()
        gateway = prepare_gateway(context=spec['dockerContext'], admin_image=spec['adminImage'],
            check_image=spec['checkImage'], tarball=Path(spec['tarball']), root=journal.root / 'gateway',
            deadline_at=lease_end, platform=spec.get('adminPlatform', 'linux/arm64'))
    try:
        box = runtime.create(image=None, snapshot_id=spec['snapshotId'], metadata={'role': 'long-horizon-worker', 'position': spec['id']},
            network_policy='allow', timeout_minutes=60, cpu=str(spec['mainCpus']),
            memory=str(spec['mainMemoryMiB']) + 'Mi', platform=spec.get('platform'),
            volumes=gateway['workerVolumes'] if gateway else None)
    except Exception as error:
        journal.write('prepare-fault.json', {'errorType': type(error).__name__, 'modelRequests': 0,
            'stage': 'sandbox-create', 'automaticRelaunchAllowed': False})
        if gateway: stop_gateway(gateway, root=journal.root / 'gateway')
        raise
    journal.write('sandbox-created.json', {'sandboxId': box.id, 'id': spec['id'], 'gateway': gateway})
    try:
        for name, sha in spec.get('baselineFiles', {}).items():
            if hashlib.sha256(runtime.read(box, spec['cwd'] + '/' + name)).hexdigest() != sha:
                raise ValueError('baseline input differs: ' + name)
        if spec.get('baseCommit'):
            baseline = checked(runtime, box, 'git -C ' + shlex.quote(spec['cwd']) + ' rev-parse HEAD').strip()
            if baseline != spec['baseCommit'] or checked(runtime, box, 'git -C ' + shlex.quote(spec['cwd']) + ' status --porcelain').strip():
                raise ValueError('restored repository baseline is not clean')
        for filename, path in (('plugin.tgz', spec['tarball']), ('protocol-controls.mjs', spec['protocolControls']), ('route-audit.mjs', spec['routeAudit'])):
            runtime.write(box, '/opt/eval/' + filename, Path(path).read_bytes())
        for filename in ('loopback_relay.py', 'export_state.py'):
            runtime.write(box, '/opt/eval/' + filename, Path(__file__).with_name(filename).read_bytes())
        bind_registry(runtime, box, spec)
        checked(runtime, box, 'mkdir -p /opt/eval/home && ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules /opt/eval/node_modules')
        install = ('add --config.strict-peer-dependencies=false /opt/eval/plugin.tgz'
                   if spec['condition'] == 'supervisor-independent' else 'list')
        checked(runtime, box, 'DSH_HOME=/opt/eval/home dsh plugin --profile web ' + install, 300)
        # Runtime installation is complete. Start one immutable budget window
        # before Host boot; model/approval/review time can never exceed it.
        window_started = time.time()
        deadline_at = window_started + spec['deadlineSec']
        patch = select_model_patch(Path(spec['modelPatch']).read_text(), rewrite_proxy=True, workspace_write=True)
        overlay, preset_hash = native_overlay(runtime, box, spec['condition'])
        if spec.get('nativePresetSha256') and spec['nativePresetSha256'] != preset_hash:
            raise ValueError('shipped native preset differs from frozen admission')
        controller_hash = None
        if spec['condition'] in ('goal', 'plan'):
            package = 'goal-round-driver' if spec['condition'] == 'goal' else 'plan-mode'
            source = runtime.read(box, '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/'
                                  '@deepseek-ai/dsh-' + package + '/lib/index.js')
            controller_hash = hashlib.sha256(source).hexdigest()
            if spec.get('nativeControllerSha256') and controller_hash != spec['nativeControllerSha256']:
                raise ValueError('native controller differs from frozen admission')
        patch += '\n' + overlay
        patch = append_patches(patch, [{'insert': [
            {'id': 'eval-protocol', 'name': '/opt/eval/protocol-controls.mjs', 'config': {
                'condition': spec['condition'], 'initialSha256': spec['instructionSha256'], 'revision': spec.get('revision'),
                'injectStageTimeout': spec.get('injectStageTimeout', False)}},
            {'id': 'route-audit', 'name': '/opt/eval/route-audit.mjs', 'config': {
                'output': '/opt/eval/route-audit.jsonl', 'endpoint': 'http://host.docker.internal:15721/tencent/v1/chat/completions'}}]}])
        if gateway:
            patch = append_patches(patch, [{'id': 'task-supervisor', 'config': {
                'reviewVerification': 'independent', 'executionApproval': 'manual',
                'longHorizon': {'taskDeadlineMs': spec['deadlineSec'] * 1000,
                    'outerDeadlineAt': datetime.fromtimestamp(deadline_at, timezone.utc).isoformat().replace('+00:00', 'Z')},
                'reviewDeadlineMs': spec.get('reviewDeadlineMs', 600000),
                'independentVerification': {**gateway['verification'],
                    'deadlineMs': spec.get('reviewDeadlineMs', 600000)}}}])
        runtime.write(box, '/opt/eval/home/profiles/web/cordis.patch.yml', patch.encode())
        # Copy only the route credential selected by the caller; never all daily secrets.
        runtime.write(box, '/opt/eval/home/.credentials.yaml', Path(spec['credential']).read_bytes(), mode=600)
        checked(runtime, box, "printf '%s\\n' " + shlex.quote(spec['hostGateway'] + ' host.docker.internal') + ' >> /etc/hosts')
        checked(runtime, box, 'node --version && dsh --version && bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp -- true')
        command = ('DSH_HOME=/opt/eval/home DSH_TELEMETRY_DISABLED=1 dsh web --host 127.0.0.1 --port 3080 --no-open '
            '> /opt/eval/host.log 2>&1 & host=$!; printf "%s\\n" "$host" > /opt/eval/host.pid; '
            'wait "$host"; printf "exited\\n" > /opt/eval/host.exited')
        runtime.exec(box, command, timeout_s=None, background=True)
        runtime.exec(box, 'python3 /opt/eval/loopback_relay.py > /opt/eval/relay.log 2>&1', timeout_s=None, background=True)
        rpc = RuntimeDshRpc(runtime, box, timeout=10)
        for attempt in range(60):
            try: rpc.list_sessions(); break
            except Exception:
                if attempt == 59: raise RuntimeError('DSH bootstrap unavailable')
                time.sleep(1)
        ready = journal.write('prepared.json', {'specSha256': hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest(),
            'sandboxId': box.id, 'image': spec['image'], 'snapshotId': spec['snapshotId'], 'gateway': gateway,
            'condition': spec['condition'], 'modelRequests': 0, 'cwd': spec['cwd'],
            'windowStartedAtUnix': window_started, 'deadlineAtUnix': deadline_at,
            'budgetIncludesHostBootstrap': True, 'nativePresetSha256': preset_hash,
            'nativeControllerSha256': controller_hash})
        runtime.detach(box)
        # Reconnect is read-only ownership; prepare must not kill a live worker on exit.
        box = runtime.connect(ready['sandboxId'])
        return box, RuntimeDshRpc(runtime, box), ready
    except Exception as error:
        journal.write('prepare-fault.json', {'errorType': type(error).__name__, 'sandboxId': box.id,
            'modelRequests': 0, 'automaticRelaunchAllowed': False})
        try:
            private = journal.root / 'private-bootstrap.log'
            private.write_bytes(runtime.read(box, '/opt/eval/host.log')); private.chmod(0o600)
        except Exception: pass
        runtime.destroy(box)
        if gateway: stop_gateway(gateway, root=journal.root / 'gateway')
        raise


def deliver(runtime, box, rpc, spec, journal):
    started = journal.read('started.json')
    if started: return started
    if journal.read('delivery-intent.json'):
        raise RuntimeError('original delivery uncertain; do not redeliver')
    workspace = rpc.create_workspace(spec['cwd'])['workspace']
    session = rpc.create_session(workspace['workspaceId'], 'standard')
    sid = session['sessionId']
    row = next(row for row in rpc.list_sessions()['items'] if row['sessionId'] == sid)
    if row.get('cwd') != spec['cwd']: raise ValueError('Session bound to wrong workspace')
    selected = rpc.call('session/selectModel', {'request': {'sessionId': sid, **MODEL}})['selected']
    if any(selected.get(key) != value for key, value in MODEL.items()): raise ValueError('model route selection differs')
    rpc.command(sid, '/eval-protocol ' + json.dumps({'action': 'bind', 'actionId': str(uuid.uuid4())}))
    if spec['condition'] == 'plan': rpc.command(sid, '/plan')
    now = time.time()
    ready = journal.read('prepared.json')
    if now >= ready['deadlineAtUnix']: raise TimeoutError('original budget expired before delivery')
    started = journal.write('started.json', {'schemaVersion': 1, 'id': spec['id'], 'condition': spec['condition'],
        'sessionId': sid, 'workspaceId': workspace['workspaceId'], 'cwd': spec['cwd'],
        'sandboxId': box.id, 'startedAtUnix': ready['windowStartedAtUnix'], 'deliveredAtUnix': now,
        'deadlineAtUnix': ready['deadlineAtUnix'], 'budgetIncludesHostBootstrap': True,
        'instructionSha256': spec['instructionSha256'], 'modelSelection': selected,
        'baseCommit': spec.get('baseCommit'), 'automaticAgentReruns': 0})
    journal.write('delivery-intent.json', {**started, 'source': 'evaluation-protocol'})
    try:
        if spec['condition'] == 'plan':
            value = rpc.call('session/prompt', {'request': {'requestId': str(uuid.uuid4()), 'sessionId': sid,
                'mode': 'queue', 'content': [{'type': 'text', 'text': spec['instruction']}]}})
            if not value.get('accepted'): raise RuntimeError('native prompt rejected')
        else:
            prefix = '/goal ' if spec['condition'] == 'goal' else '/task '
            rpc.command(sid, prefix + spec['instruction'])
        journal.write('delivery-receipt.json', {'sessionId': sid, 'atUnix': time.time(), 'source': 'evaluation-protocol'})
        if spec['condition'] == 'goal': journal.write('actions/initial-approval-receipt.json', {
            'source': 'evaluation-protocol', 'transport': 'native-goal-command', 'sessionId': sid, 'atUnix': now})
    except Exception as error:
        journal.write('delivery-transport-fault.json', {'errorType': type(error).__name__, 'resultUnknown': True,
            'sessionId': sid, 'redeliveryAllowed': False})
    return started


def read_view(runtime, box, rpc, started, spec, gateway=None):
    target = '/opt/eval/observation.json'
    checked(runtime, box, 'python3 /opt/eval/export_state.py ' + shlex.quote(started['sessionId']) + ' ' + target)
    raw = json.loads(runtime.read(box, target))
    events = parse_events(raw['events'].encode(), started['sessionId']); folded = fold(events)
    listed = rpc.list_sessions()['items']
    session = next(item for item in listed if item['sessionId'] == started['sessionId'])
    values = projection_values(raw['projection']) if raw['projection'] else {}
    stats = values.get('sessionStats') or {}
    idle = not session['running'] and stats.get('openStep') is None and not stats.get('pendingCalls')
    pending = [row for row in folded['questions'].values() if row['status'] == 'open'
        and row['mainSessionId'] == started['sessionId']]
    decisions = [row for row in pending if row['kind'] != 'native-plan-approval']
    if spec['condition'] == 'supervisor-independent':
        live = rpc.http('GET', '/api/task-supervisor?sessionId=' + started['sessionId'])
        task = live.get('task')
        view = {'task': task, 'jobs': folded['jobs'], 'barriers': folded['barriers'], 'idle': idle,
            'budget': live.get('executionBudget'), 'hostExited': raw['hostExited']}
        view['questions'] = decisions
        if task and folded['tasks'].get(task['id']) != task:
            # Flush follows the public update; reread next tick before any grant.
            view['jobs'] = {}
        return with_resources(view, box.id, spec, gateway)
    approved = spec['condition'] == 'goal' or not (values.get('plan') or {}).get('active')
    proof = None
    if idle:
        # The executed native package hash is frozen by prepare's image, not a
        # mutable source checkout. These read-only predicates require exact logs.
        if spec['condition'] == 'goal': proof = goal_stop_evidence(events, values, spec.get('nativeControllerSha256', ''))
        else: proof = plan_stop_evidence(events, values, spec.get('nativeControllerSha256', ''))
    state = native_observe(spec['condition'], values, session['running'], approved, proof)
    terminals = {'native-complete': 'controller-complete', 'native-blocked': 'native-blocked',
        'native-stopped': 'native-stop', 'controller-conflict': 'controller-conflict', 'controller-off': 'controller-off'}
    plan = next((row for row in pending if row['kind'] == 'native-plan-approval'), None)
    grants = [event['data']['payload'] for event in events if event['type'] == 'extension/record'
        and event.get('data', {}).get('namespace') == 'dsh-long-horizon-eval'
        and event['data'].get('kind') == 'native-plan-grant']
    return with_resources({'task': None, 'idle': idle, 'hostExited': raw['hostExited'], 'nativeTerminal': terminals.get(state['status']),
        'nativeState': state, 'questions': decisions,
        'nativeRequestFault': native_request_fault(events, values, spec['condition'],
            spec.get('nativeControllerSha256', '')) if idle else None,
        'planApprovalReady': {'sessionId': started['sessionId'], 'questionId': plan['id'],
            'callId': plan['callId'], 'planSha256': plan['planSha256']} if plan else None,
        'nativePlanGrant': grants[-1] if grants else None, 'nativePlanApplied': approved}, box.id, spec)


def with_resources(view, sandbox_id, spec, gateway=None):
    if not spec.get('storageLimitBytes'): return view
    name = 'sandbox-' + sandbox_id
    prefix = ['docker', '--context', spec['dockerContext']]
    raw = subprocess.check_output(prefix + ['inspect', '--size', '--format',
        '{{json .SizeRw}}', name], timeout=30)
    size = json.loads(raw)
    if type(size) is not int or size < 0: raise ValueError('writable-layer size unavailable')
    stats = json.loads(subprocess.check_output(prefix + ['stats', '--no-stream', '--format', '{{json .}}', name], timeout=30))
    view.update(storageExceeded=size > spec['storageLimitBytes'], resources={
        'mainWritableBytes': size, 'mainStorageLimitBytes': spec['storageLimitBytes'],
        'storageEnforcement': 'sampled-writable-layer-stop-not-hard-quota',
        'sampleIntervalSec': 60, 'mainCpuPercent': stats['CPUPerc'], 'mainMemoryUsage': stats['MemUsage'],
        'independentCheckLimits': {'cpus': 2, 'memoryMiB': 8192} if spec['condition'] == 'supervisor-independent' else None,
        'administratorLimits': {'cpus': 1, 'memoryMiB': 1024} if spec['condition'] == 'supervisor-independent' else None})
    if gateway and spec.get('checkStorageLimitBytes'):
        row = json.loads(subprocess.check_output(prefix + ['inspect', gateway['adminId']], timeout=30))[0]
        if row['Id'] != gateway['adminId'] or row['Config'].get('Labels', {}).get('dsh.long-horizon.lease') != gateway['lease']:
            raise ValueError('foreign gateway resource observation')
        usage = subprocess.check_output(prefix + ['exec', gateway['adminId'], 'du', '-sb',
            gateway['volumes']['client']['path'], gateway['volumes']['private']['path']], timeout=30).decode()
        total = sum(int(line.split()[0]) for line in usage.splitlines())
        view['resources'].update(privateCheckStorageBytes=total, checkStorageLimitBytes=spec['checkStorageLimitBytes'])
        view['storageExceeded'] |= total > spec['checkStorageLimitBytes']
    return view


def quiesce(runtime, box, rpc, started, spec, journal):
    prior = journal.read('quiescence.json')
    if prior: return prior
    failed = []
    try:
        if spec['condition'] == 'supervisor-independent':
            # A deadline-expired Task still admits off; cancellation is explicit.
            state = rpc.http('GET', '/api/task-supervisor?sessionId=' + started['sessionId'])
            task = state.get('task')
            if task and task['phase'] not in ('complete', 'cleared') and task.get('enabled'):
                rpc.command(started['sessionId'], f'/task off {task["id"]} {task["revision"]}')
        rpc.call('session/cancel', {'request': {'sessionId': started['sessionId']}})
        end = time.monotonic() + 45
        while time.monotonic() < end:
            rows = rpc.list_sessions()['items']
            owned = [row for row in rows if row['sessionId'] == started['sessionId'] or row.get('parentSession') == started['sessionId']]
            if not any(row['running'] for row in owned): break
            time.sleep(.5)
        else: failed.append('native-agents-not-quiescent')
    except Exception as error: failed.append(type(error).__name__)
    # Native Host shutdown invokes plugin disposal and joins owned checks.
    try:
        checked(runtime, box, 'kill -TERM "$(cat /opt/eval/host.pid)"')
        for attempt in range(60):
            code, _, _ = runtime.exec(box, 'kill -0 "$(cat /opt/eval/host.pid)" 2>/dev/null', timeout_s=5)
            if code != 0: break
            time.sleep(.5)
        else: failed.append('host-disposal-not-quiescent')
    except Exception as error: failed.append(type(error).__name__)
    ready = journal.read('prepared.json')
    if ready and ready.get('gateway'):
        try: stop_gateway(ready['gateway'], root=journal.root / 'gateway')
        except Exception as error: failed.append(type(error).__name__)
    completion = None
    try:
        # Host is stopped: a final log read cannot cause a model request or
        # continue execution beyond the deadline.
        target = '/opt/eval/final-observation.json'
        checked(runtime, box, 'python3 /opt/eval/export_state.py ' + shlex.quote(started['sessionId']) + ' ' + target)
        raw = json.loads(runtime.read(box, target))
        from completion import completion_evidence
        completion = completion_evidence(parse_events(raw['events'].encode(), started['sessionId']),
            projection_values(raw['projection']) if raw['projection'] else {}, started)
    except Exception as error: failed.append('final-evidence:' + type(error).__name__)
    return journal.write('quiescence.json', {'acknowledged': not failed, 'faults': failed,
        'sessionId': started['sessionId'], 'sandboxId': box.id, 'atUnix': time.time(),
        'completionEvidence': completion})


def watch(runtime, spec, journal, *, max_ticks=None):
    ready, started = journal.read('prepared.json'), journal.read('started.json')
    if not ready or not started: raise RuntimeError('no original prepared Session to observe')
    box = runtime.connect(ready['sandboxId']); rpc = RuntimeDshRpc(runtime, box)
    def send(action):
        payload = {**action, 'action': 'native-plan-approval'} if spec['condition'] == 'plan' else action
        return rpc.command(started['sessionId'], '/eval-protocol ' + json.dumps(payload))
    return observe(journal, started, lambda _: read_view(runtime, box, rpc, started, spec, ready.get('gateway')), send,
        lambda *_: quiesce(runtime, box, rpc, started, spec, journal), revision=spec.get('revision'),
        keepalive=lambda: renew(runtime, box, runtime.info(box), started), max_ticks=max_ticks)
