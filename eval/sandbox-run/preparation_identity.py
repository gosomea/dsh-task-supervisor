"""Bound OpenSandbox labels and an explicit, keyless rejection reconciliation."""
import hashlib
import json
import re


def position_label(position):
    if not isinstance(position, str) or not position:
        raise ValueError('position identity required')
    if re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,61}[A-Za-z0-9])?', position):
        return position
    return 'lh-' + hashlib.sha256(position.encode()).hexdigest()[:60]


def file_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepared_gateway_root(ready, journal):
    recovery = ready.get('preparationRecovery')
    if not recovery:
        return journal.root / 'gateway'
    child = journal.root / 'preparation-recovery' / file_digest(journal.root / 'preparation-reconciliation.json')
    if recovery.get('attemptDirectory') != str(child):
        raise RuntimeError('recovered preparation directory differs')
    original = json.loads((child / 'prepared.json').read_text())
    if any(original.get(key) != ready.get(key) for key in ('specSha256', 'sandboxId', 'gateway')):
        raise RuntimeError('recovered gateway or worker ownership differs')
    return child / 'gateway'


def metadata_recovery_journal(spec, journal):
    """No implicit retry of a create request whose allocation is unknown."""
    receipt = journal.read('preparation-reconciliation.json')
    intent, fault = journal.read('prepare-intent.json'), journal.read('prepare-fault.json')
    spec_sha = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
    if not receipt or not intent or not fault:
        raise RuntimeError('uncertain preparation: reconcile original resource; no new sandbox')
    expected = {
        'schemaVersion': 1, 'id': spec['id'], 'specSha256': spec_sha,
        'intentSha256': file_digest(journal.root / 'prepare-intent.json'),
        'faultSha256': file_digest(journal.root / 'prepare-fault.json'),
        'errorCode': 'SANDBOX::INVALID_METADATA_LABEL', 'httpStatus': 400,
        'source': 'evaluation-protocol-runner-repair', 'modelRequests': 0,
        'originalAllocationAbsent': True, 'positionLabel': position_label(spec['id']),
    }
    if (any(receipt.get(k) != v for k, v in expected.items())
            or intent.get('specSha256') != spec_sha or intent.get('id') != spec['id']
            or intent.get('modelRequests') != 0
            or fault.get('errorType') != 'SandboxApiException'
            or fault.get('stage') != 'sandbox-create' or fault.get('modelRequests') != 0
            or fault.get('sandboxId') or position_label(spec['id']) == spec['id']
            or not re.fullmatch('[a-f0-9]{64}', receipt.get('rejectionEvidenceSha256', ''))):
        raise RuntimeError('preparation reconciliation identity or rejection differs')
    if any((journal.root / name).exists() for name in
           ('sandbox-created.json', 'delivery-intent.json', 'started.json', 'terminal.json', 'result.json')):
        raise RuntimeError('original allocation or delivery exists; no preparation retry')
    if spec['condition'] == 'supervisor-independent':
        gateway = journal.root / 'gateway'
        created = json.loads((gateway / 'gateway-created.json').read_text())
        cleanup = json.loads((gateway / 'gateway-cleanup.json').read_text())
        quiet = json.loads((gateway / 'check-quiescence.json').read_text())
        if (cleanup.get('lease') != created.get('lease') or cleanup.get('adminRemoved') is not True
                or quiet.get('lease') != created.get('lease') or quiet.get('acknowledged') is not True
                or quiet.get('faults') != [] or receipt.get('gatewayCleanupSha256') != file_digest(gateway / 'gateway-cleanup.json')
                or receipt.get('checkQuiescenceSha256') != file_digest(gateway / 'check-quiescence.json')):
            raise RuntimeError('original gateway cleanup is not confirmed')
    # This child has its own immutable intent. A second failure or lost response
    # cannot recursively use the parent's receipt to allocate another worker.
    return type(journal)(journal.root / 'preparation-recovery' / file_digest(journal.root / 'preparation-reconciliation.json'))
