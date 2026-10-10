"""Collect a stopped original worker; never commit or rerun its Agent."""
import hashlib
import json
from pathlib import Path
import re
import shlex
import sys
import tarfile

from execution import checked
from runtime import SandboxRef

EXPORT = r'''
import json,os,pathlib,subprocess,sys,tarfile,hashlib
root=pathlib.Path(sys.argv[1]); base=sys.argv[2]; out=pathlib.Path('/opt/eval/collection');out.mkdir(exist_ok=True)
if (out/'ready.json').exists():sys.exit(0)
def git(*args):return subprocess.check_output(['git','-C',str(root),*args])
if base:
 head=git('rev-parse','HEAD').decode().strip()
 (out/'model.patch').write_bytes(git('diff','--binary',base,head))
 (out/'uncommitted.patch').write_bytes(git('diff','--binary','HEAD'))
 names=git('ls-files','--cached','--others','--exclude-standard','-z').decode().split('\0')
 (out/'submission.json').write_text(json.dumps({'baseCommit':base,'headCommit':head,'workingTreeSubmitted':False,
   'source':'committed-base-to-head','patchBytes':(out/'model.patch').stat().st_size,
   'gitStatus':git('status','--porcelain').decode(),'patchSha256':__import__('hashlib').sha256((out/'model.patch').read_bytes()).hexdigest()}))
else:names=[str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()]
with tarfile.open(out/'workspace.tar','w') as archive:
 for name in sorted(set(names)):
  if not name:continue
  p=root/name
  if p.is_file() and not p.is_symlink():archive.add(p,arcname=name,recursive=False)
home=pathlib.Path('/opt/eval/home')
with tarfile.open(out/'session-evidence.tar','w') as archive:
 for relative in ('sessions','storages/session_projcache'):
  p=home/relative
  if p.exists():archive.add(p,arcname=relative)
 (pathlib.Path('/opt/eval/route-audit.jsonl')).exists() and archive.add('/opt/eval/route-audit.jsonl',arcname='route-audit.jsonl')
files=['workspace.tar','session-evidence.tar']+(['model.patch','uncommitted.patch','submission.json'] if base else [])
manifest={name:hashlib.sha256((out/name).read_bytes()).hexdigest() for name in files}
with (out/'ready.json').open('x') as stream:json.dump(manifest,stream)
'''


def collect(runtime, spec, journal):
    previous = journal.read('collection.json')
    if previous:
        destroy_original(runtime, journal, previous['sandboxId'])
        collect_check_storage(journal)
        seal_collection(journal, previous)
        return previous
    terminal, ready = journal.read('terminal.json'), journal.read('prepared.json')
    if not terminal or not terminal['cleanup']['acknowledged']:
        raise RuntimeError('original execution is not quiescent; no artifact export')
    intent = journal.read('collection-intent.json')
    identity = {'sandboxId': ready['sandboxId'], 'sessionId': terminal['sessionId']}
    if intent and intent != identity: raise ValueError('collection identity changed')
    if not intent: journal.write('collection-intent.json', identity)
    box = runtime.connect(ready['sandboxId'])
    runtime.write(box, '/opt/eval/export_collection.py', EXPORT.encode())
    checked(runtime, box, 'python3 /opt/eval/export_collection.py ' + shlex.quote(spec['cwd']) + ' ' + shlex.quote(spec.get('baseCommit') or ''), 60)
    root = journal.root / 'collection'; root.mkdir(mode=0o700, exist_ok=True)
    files = ['workspace.tar', 'session-evidence.tar']
    if spec.get('baseCommit'): files += ['model.patch', 'uncommitted.patch', 'submission.json']
    hashes = json.loads(runtime.read(box, '/opt/eval/collection/ready.json'))
    if set(hashes) != set(files): raise ValueError('original archive manifest differs')
    for name in files:
        path = root / name
        if path.exists():
            if hashlib.sha256(path.read_bytes()).hexdigest() != hashes[name]:
                raise ValueError('partial collection bytes differ; no overwrite')
            continue
        data = runtime.read(box, '/opt/eval/collection/' + name)
        if hashlib.sha256(data).hexdigest() != hashes[name]: raise ValueError('archive transfer hash differs')
        import os, tempfile
        fd, temporary = tempfile.mkstemp(prefix='transfer-', dir=root)
        try:
            with os.fdopen(fd, 'wb') as stream: stream.write(data); stream.flush(); os.fsync(stream.fileno())
            os.link(temporary, path)
        finally: os.unlink(temporary)
    for archive, destination in [('workspace.tar', 'workspace'), ('session-evidence.tar', 'home')]:
        if not (root / destination).exists():
            import os, tempfile
            temporary = Path(tempfile.mkdtemp(prefix='extract-', dir=root))
            with tarfile.open(root / archive) as source: source.extractall(temporary, filter='data')
            os.rename(temporary, root / destination)
    if spec.get('baseCommit'):
        submission = root / 'submission'; submission.mkdir(exist_ok=True)
        for name in ('model.patch', 'submission.json'):
            copy_new(submission / name, (root / name).read_bytes())
        copy_new(submission / 'receipt.json', (root / 'submission.json').read_bytes())
    result = journal.write('collection.json', {'sessionId': terminal['sessionId'], 'sandboxId': box.id,
        'filesSha256': hashes, 'workingTreeSubmitted': False, 'home': str(root / 'home'),
        'workspace': str(root / 'workspace'), 'submission': str(root / 'submission') if spec.get('baseCommit') else None})
    destroy_original(runtime, journal, box.id)
    collect_check_storage(journal)
    seal_collection(journal, result)
    return result


def seal_collection(journal, collection):
    if not journal.read('collection-complete.json'):
        journal.write('collection-complete.json', {'sandboxId': collection['sandboxId'],
            'sessionId': collection['sessionId'], 'artifactsAndOwnedCheckStorageCollected': True})


def collect_check_storage(journal):
    ready = journal.read('prepared.json')
    if ready and ready.get('gateway'):
        from gateway import archive_storage, stop_gateway
        from preparation_identity import prepared_gateway_root
        root = prepared_gateway_root(ready, journal)
        stop_gateway(ready['gateway'], root=root)
        archive_storage(ready['gateway'], root=root)


def collection_recovery(journal):
    """Bind a post-execution repair to the original bytes, without new authority."""
    value = journal.read('collection-reconciliation.json')
    if value is None:
        return None
    from preparation_identity import file_digest, prepared_gateway_root
    ready = journal.read('prepared.json')
    root = prepared_gateway_root(ready, journal)
    expected = {'schemaVersion': 1, 'kind': 'recovered-gateway-collection-ownership',
        'source': 'evaluation-protocol-runner-repair', 'modelRequests': 0,
        'agentReruns': 0, 'authorizationActions': 0, 'gatewayLease': ready['gateway']['lease'],
        'gatewayRoot': str(root), 'originalExecutionStopped': True}
    anchors = {name: file_digest(journal.root / name) for name in
        ('started.json', 'prepared.json', 'terminal.json', 'collection.json', 'sandbox-destroyed.json')}
    started, terminal, collection, destroyed = (journal.read(name) for name in
        ('started.json', 'terminal.json', 'collection.json', 'sandbox-destroyed.json'))
    if (any(value.get(key) != item for key, item in expected.items())
            or value.get('originalRecordsSha256') != anchors
            or not re.fullmatch('[a-f0-9]{64}', value.get('faultEvidenceSha256', ''))
            or not terminal.get('cleanup', {}).get('acknowledged') or not destroyed.get('destroyed')
            or any(row.get('sandboxId') != ready['sandboxId'] for row in (collection, destroyed))
            or any(row.get('sessionId') != started['sessionId'] for row in (terminal, collection))):
        raise RuntimeError('collection reconciliation differs from the original position')
    return {**expected, 'originalRecordsSha256': anchors,
        'faultEvidenceSha256': value['faultEvidenceSha256'],
        'reconciliationSha256': file_digest(journal.root / 'collection-reconciliation.json')}


def copy_new(path, data):
    if path.exists():
        if path.read_bytes() != data: raise ValueError('sealed submission differs')
        return
    with path.open('xb') as stream: stream.write(data)


def destroy_original(runtime, journal, sandbox_id):
    if journal.read('sandbox-destroyed.json'): return
    from opensandbox.exceptions import SandboxApiException
    absent = False
    try:
        runtime.connect(sandbox_id)
        runtime.destroy(SandboxRef(sandbox_id))
    except SandboxApiException as error:
        # An exact lifecycle 404 confirms an earlier destroy; transport errors
        # cannot establish absence and must keep the original identity pending.
        if error.status_code != 404: raise
        absent = True
    journal.write('sandbox-destroyed.json', {'sandboxId': sandbox_id, 'destroyed': True,
        'reconciledLifecycleNotFound': absent})


def grade(spec, journal):
    previous = journal.read('result.json')
    if previous: return previous
    if not journal.read('collection-complete.json'):
        raise RuntimeError('original resource collection is not complete')
    terminal, collection, started = journal.read('terminal.json'), journal.read('collection.json'), journal.read('started.json')
    if not terminal or not collection: raise RuntimeError('execution and collection not sealed')
    recovery = collection_recovery(journal)
    sys.path.append(str(Path(__file__).resolve().parents[1] / 'deepswe'))
    from metrics import collect as metrics_collect, read_home
    sessions, projections, hashes = read_home(Path(collection['home']))
    metrics = metrics_collect(sessions, projections, started['sessionId'])
    metrics.update(execution_metrics(sessions, started, terminal, journal))
    if not journal.read('metrics.json'): journal.write('metrics.json', metrics)
    official = journal.read('grade/grade-result.json')
    if terminal['infrastructureFault']:
        official = {'reward': None, 'fault': None, 'skipped': 'execution-infrastructure-fault',
            'officialPublicScore': False, 'reason': terminal.get('faultCode', terminal['firstStopReason'])}
    elif spec.get('formal'):
        from grade import run_grade, resume_grade
        if official is None:
            if (journal.root / 'grade').exists():
                official = resume_grade(journal.root / 'grade', spec['dockerContext'])
            else:
                official = run_grade(Path(spec['dataset']), spec['taskId'], Path(collection['submission']),
                    journal.root / 'grade', Path(spec['pierBin']), spec['dockerContext'], spec['officialImageDigest'])
    else:
        official = development_grade(spec, journal, collection, sessions)
    reward = official.get('reward')
    strict = terminal['controllerComplete'] and terminal['finishedBeforeDeadline'] and reward == 1 \
        and not terminal['infrastructureFault'] and not recovery and not official.get('fault')
    return journal.write('result.json', {'schemaVersion': 1, 'id': started['id'],
        'condition': started['condition'], 'taskId': spec.get('taskId') or spec.get('case'),
        'repeat': spec.get('repeat'), 'formal': spec.get('formal', False), 'terminal': terminal,
        'reward': reward, 'strictSuccess': strict, 'gradingFault': official.get('fault'),
        'officialGrade': official, 'metrics': metrics, 'artifactHashes': collection['filesSha256'],
        'collectionInfrastructureFault': recovery is not None, 'collectionRecovery': recovery,
        'announcedCompleteOfficialFailed': terminal['controllerComplete'] and reward == 0,
        'falseAcceptanceRate': None, 'falsePauseRate': None, 'correctionBenefit': None})


def execution_metrics(sessions, started, terminal, journal):
    from monitor import fold
    from session_records import control_event
    linked = {started['sessionId']}
    while True:
        following = {sid for sid, events in sessions.items() if events and events[0].get('parentSession') in linked}
        if following <= linked: break
        linked |= following
    events = [event for sid in linked for event in sessions[sid]]
    controls = fold([control_event(event) for event in sessions[started['sessionId']][1:]])
    jobs = list(controls['jobs'].values())
    budgets = list(controls['budgets'].values())
    actions = [action for budget in budgets for action in budget.get('actions', [])]
    faults = [fault for job in jobs for fault in (job.get('recovery') or {}).get('failures', [])]
    reads, failed_reads = 0, 0
    for sid in linked - {started['sessionId']}:
        calls = {event['data']['callId']: event['data']['name'] for event in sessions[sid]
            if event.get('type') == 'tool/call'}
        reads += sum(name.startswith(('read_', 'inspect_')) for name in calls.values())
        for event in sessions[sid]:
            message = event.get('data', {}).get('message', {})
            if event.get('type') == 'tool/result' and calls.get(message.get('toolCallId'), '').startswith(('read_', 'inspect_')):
                failed_reads += int(message.get('isError', False))
    return {'requestCount': sum(event.get('type') in ('step/start', 'llm/retry-started') for event in events),
        'toolCallsAllSessions': sum(event.get('type') == 'tool/call' for event in events),
        'contextCompactions': sum(event.get('type') == 'compaction/end' for event in events),
        'contextCompactionAttempts': sum(event.get('type') == 'compaction/start' for event in events),
        'reviewReads': reads, 'reviewReadFailures': failed_reads,
        'reviewProtocolSubmissions': sum((job.get('recovery') or {}).get('protocolRepairs', 0) for job in jobs),
        'reviewFaultHistoryCount': len(faults),
        'taskFaultRetryReservations': sum(action.get('kind') == 'review-fault' for action in actions),
        'taskTruncationReservations': sum(action.get('kind') == 'truncation' for action in actions),
        'wholeElapsedSec': max(0, terminal['atUnix'] - started['startedAtUnix']),
        **protocol_action_metrics(journal),
        'humanRescueActions': 0}


def protocol_action_metrics(journal):
    receipts = [json.loads(path.read_text()) for path in (journal.root / 'actions').glob('*-receipt.json')]
    # /goal is both the original submission and execution authorization. Count
    # its single operation once, while preserving separate approval counters.
    explicit = sum(row.get('transport') != 'native-goal-command' for row in receipts)
    delivered = journal.read('delivery-receipt.json') is not None
    return {'protocolControlReceipts': len(receipts),
        'protocolInstructionSubmissions': 1 if delivered else None,
        'protocolUserActions': explicit + 1 if delivered else None}


def development_grade(spec, journal, collection, sessions):
    """External fixture assertions; never shipped into model or check images."""
    import importlib.util
    path = Path(__file__).resolve().parents[1] / 'long-horizon-dev-v1/eval.py'
    module = importlib.util.spec_from_file_location('development_verifier', path)
    verifier = importlib.util.module_from_spec(module); module.loader.exec_module(verifier)
    events = sessions[journal.read('started.json')['sessionId']]
    try:
        if spec.get('revision'):
            checks = verifier.check_revision(Path(collection['workspace']), events, execution_workspace=Path(spec['cwd']))
        else:
            # Fault fixture has explicit frozen static/data requirements. Its
            # artifacts are scored outside the execution and review directory.
            actual = json.loads((Path(collection['workspace']) / 'report.json').read_text())
            if actual != spec['expectedReport']: raise AssertionError('report differs from frozen input calculation')
            checks = {'passed': True, 'expected': spec['expectedReport']}
            if spec.get('injectStageTimeout'):
                checks.update(check_fault_recovery(events, sessions))
        return {'reward': 1, 'fault': None, 'independentFixtureVerifier': True, 'checks': checks,
                'officialPublicScore': False, 'faultInjection': spec.get('injectStageTimeout', False)}
    except (AssertionError, OSError, ValueError, KeyError) as error:
        return {'reward': 0, 'fault': None, 'independentFixtureVerifier': True,
            'checks': {'passed': False, 'errorType': type(error).__name__, 'reason': str(error)[:1000]}, 'officialPublicScore': False}


def check_fault_recovery(events, sessions):
    from session_records import control_event
    controls = [control_event(event) for event in events]
    injected = [event for event in controls if event.get('type') == 'extension/record'
        and event['data'].get('namespace') == 'dsh-long-horizon-eval'
        and event['data'].get('kind') == 'fault-injection']
    assert len(injected) == 1, 'fault injection was not applied exactly once'
    identity = injected[0]['data']['payload']
    versions = [event['data']['payload'] for event in controls if event.get('type') == 'extension/record'
        and event['data'].get('namespace') == 'dsh-task-supervisor-review'
        and event['data']['payload'].get('id') == identity['jobId']]
    assert versions, 'injected original review missing'
    final = versions[-1]
    assert all(job['reviewerSessionId'] == identity['reviewerSessionId'] and job['cutoff'] == identity['cutoff']
        for job in versions if job.get('reviewerSessionId')), 'recovery changed bound Session or cutoff'
    assert all(job['verification']['snapshot']['id'] == identity['snapshotId']
        for job in versions if job.get('verification')), 'recovery changed captured snapshot'
    recovery = final['recovery']
    assert recovery['consumed'] == 1 and len(recovery['failures']) == 1, 'fault retry count differs'
    assert recovery['failures'][0]['fault']['code'] == 'timeout', 'not a controlled review deadline'
    assert final['status'] == 'applied' and final['decision']['verdict'] == 'pass', 'recovered review did not apply'
    reviewer = sessions[identity['reviewerSessionId']]
    read = next(event for event in reviewer if event.get('seq') == identity['successfulReadSeq'])
    assert read['type'] == 'tool/result' and not read['data']['message']['isError'], 'injection did not follow a real read'
    states = [event['data']['payload'] for event in controls if event.get('type') == 'extension/record'
        and event['data'].get('namespace') == 'dsh-task-supervisor']
    passed = [next((run['status'] == 'passed' for run in state.get('nodeRuns', []) if run['id'] == final['stageId']), False) for state in states]
    assert sum(current and not prior for prior, current in zip([False] + passed, passed)) == 1, 'node verdict applied more than once'
    assert states[-1]['phase'] == 'complete', 'recovery did not finish Task'
    before = next((job.get('verification') for job in reversed(versions) if job['status'] == 'failed'), None)
    assert before, 'failed attempt evidence missing'
    assert before.get('readFiles') or before.get('readChecks'), 'injection did not exercise acquired evidence recovery'
    after = final['verification']
    for entry in before.get('readFiles', []):
        recovered = next((row for row in after['readFiles'] if row['path'] == entry['path']), None)
        assert recovered and all(any(a <= start and b >= end for a, b in recovered['ranges'])
            for start, end in entry['ranges']), 'pre-retry artifact read qualification lost'
    return {'injected': True, 'sameJobAndSession': True, 'sameCutoffAndSnapshot': True,
        'retryCount': 1, 'nodeAppliedOnce': True, 'preRetryReadQualificationsPreserved': True,
        'jobId': identity['jobId'], 'reviewerSessionId': identity['reviewerSessionId']}
