"""Require resource exit evidence before a batch can allocate another attempt."""
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_resource_boundary(journal, result):
    """Supplement a failed cleanup without changing its result or grade."""
    if (result.get('terminal') or {}).get('cleanupAcknowledged') is True:
        return
    record = journal.read('resource-reconciliation.json')
    if not isinstance(record, dict) or record.get('kind') != 'deepswe-resource-reconciliation':
        raise RuntimeError('Previous attempt resource exit is unconfirmed; reconcile its original lease before continuing')
    for field, name in (('originalResultSha256', 'result.json'),
                        ('originalLaunchReceiptSha256', 'launch-receipt.json'),
                        ('originalStartedSha256', 'started.json')):
        path = journal.root / name
        if not path.is_file() or record.get(field) != digest(path):
            raise ValueError('Resource reconciliation differs from original attempt evidence')
    receipt, started = journal.read('launch-receipt.json'), journal.read('started.json')
    evidence = journal.root / 'resource-inventory.json'
    if not evidence.is_file() or record.get('inventorySha256') != digest(evidence):
        raise ValueError('Resource inventory is missing or changed')
    inventory = json.loads(evidence.read_text())
    if (inventory.get('kind') not in ('deepswe-stopped-lease-inventory', 'deepswe-daemon-wide-stopped-inventory')
            or inventory.get('lease') != receipt['lease']
            or inventory.get('dockerContext') != receipt['dockerContext']
            or inventory.get('sessionId') != started['sessionId']
            or inventory.get('daemonReachable') is not True
            or inventory.get('leaseInventoryComplete') is not True):
        raise ValueError('Resource inventory is not a complete observation of the original lease')
    if inventory['kind'] == 'deepswe-daemon-wide-stopped-inventory':
        require_daemon_recovery(journal, inventory, receipt)
        return
    required = {receipt['containerId']}
    gateway = receipt.get('independentGateway')
    if gateway:
        arm = json.loads((Path(gateway['root']) / 'arm-receipt.json').read_text())
        if arm['lease'] != receipt['lease'] or arm['sessionId'] != started['sessionId']:
            raise ValueError('Administrator identity is not bound to the original attempt')
        required.add(arm['containerId'])
        checks = inventory.get('checkContainerIds')
        if inventory.get('ledgerInventoryComplete') is not True or not isinstance(checks, list):
            raise ValueError('Independent check resource inventory is incomplete')
        ledger = bound_json(journal, inventory, 'ledgerReadbackSha256', 'private-ledger-readback.json')
        volume = gateway['volumes']['private']
        if (ledger.get('volumeName') != volume['name'] or ledger.get('volumePath') != volume['path']
                or ledger.get('lease') != receipt['lease'] or ledger.get('adminContainerId') != arm['containerId']
                or ledger.get('administratorStopped') is not True or ledger.get('complete') is not True
                or not isinstance(ledger.get('rows'), list)):
            raise ValueError('Private ledger readback is incomplete or belongs to another owner')
        observed_checks = []
        for check in ledger['rows']:
            metadata = check['record']
            name = 'dsh-review-' + check['id']
            if (metadata.get('name') != name or metadata.get('snapshotId') != check['snapshotId']
                    or metadata.get('image') != gateway['imageDigest']
                    or metadata.get('endpoint') != 'unix:///var/run/docker.sock'):
                raise ValueError('Check ledger identity differs from its original snapshot')
            found = [row for row in inventory.get('containers', []) if row.get('name') == name]
            if len(found) != 1 or found[0].get('snapshotId') != check['snapshotId']:
                raise ValueError('Resource inventory omits an actual private ledger check')
            observed_checks.append(found[0]['id'])
        if sorted(checks) != sorted(observed_checks):
            raise ValueError('Declared check IDs differ from the actual private ledger')
        required.update(checks)
    observations = inventory.get('containers')
    if not isinstance(observations, list) or not observations:
        raise ValueError('Stopped actor observations are missing')
    ids = [row.get('id') for row in observations]
    if len(set(ids)) != len(ids) or not required.issubset(ids):
        raise ValueError('Resource inventory omits or duplicates an original actor')
    for row in observations:
        if (not isinstance(row.get('id'), str) or row.get('lease') != receipt['lease']
                or row.get('running') is not False
                or row.get('disposition') not in ('exited', 'absent')
                or (row['disposition'] == 'exited' and row.get('restartPolicy') != 'no')):
            raise ValueError('An original actor is running, may restart, or has uncertain ownership')


def bound_json(journal, inventory, field, name):
    path = journal.root / name
    if not path.is_file() or inventory.get(field) != digest(path):
        raise ValueError('Bound resource evidence is missing or changed: ' + name)
    return json.loads(path.read_text())


def require_daemon_recovery(journal, inventory, receipt):
    """An entire stopped daemon is a resource proof, not a lost-ledger replacement."""
    fault = bound_json(journal, inventory, 'vmFaultSha256', 'vm-fault.json')
    recovery = bound_json(journal, inventory, 'vmRecoverySha256', 'vm-recovery.json')
    if (fault.get('kind') != 'formal-dedicated-vm-fault'
            or fault.get('dockerContext') != receipt['dockerContext']
            or fault.get('cliListedRunningButVzReportedError') is not True
            or recovery.get('kind') not in ('deepswe-vm-resource-reconciliation', 'formal-v5-vm-recovery-resource-reconciliation')
            or recovery.get('dockerContext') != receipt['dockerContext']
            or recovery.get('profileConfigUnchanged') is not True
            or recovery.get('profileConfigSha256') != inventory.get('profileConfigSha256')
            or not inventory.get('profileConfigSha256')
            or type(recovery.get('priorHostAgentPid')) is not int
            or type(recovery.get('currentHostAgentPid')) is not int
            or recovery['priorHostAgentPid'] == recovery['currentHostAgentPid']
            or recovery.get('agentRestarted') is not False
            or recovery.get('officialGradeSupplemented') is not False
            or inventory.get('priorLedgerFullTreeCoverageConfirmed') is not False):
        raise ValueError('Original VM failure and fresh unchanged namespace are not evidenced')
    stop = bound_json(journal, inventory, 'vmStopSha256', 'vm-stop.json')
    start = bound_json(journal, inventory, 'vmStartSha256', 'vm-start.json')
    if (stop.get('exitCode') != 0 or stop.get('exactVm') != fault.get('vmName')
            or fault.get('vmName') != 'colima-' + recovery.get('profile', '')
            or start.get('exitCode') != 0 or start.get('exactProfile') != recovery.get('profile')
            or start.get('hardwareOverrides') not in ([], False)
            or any(recovery.get(key) != 0 for key in ('modelRequestsByRecovery', 'approvals', 'rescuePrompts'))):
        raise ValueError('Exact VM namespace stop and unchanged restart are not evidenced')
    for name in ('vm-config-before.yaml', 'vm-config-after.yaml'):
        path = journal.root / name
        if not path.is_file() or digest(path) != inventory['profileConfigSha256']:
            raise ValueError('VM configuration bytes changed during recovery')
    ids_path = journal.root / 'daemon-container-ids.txt'
    if not ids_path.is_file() or inventory.get('daemonIdsSha256') != digest(ids_path):
        raise ValueError('Entire daemon container listing is missing or changed')
    ids = ids_path.read_text().split()
    inspected = bound_json(journal, inventory, 'daemonInspectSha256', 'daemon-inspect.json')
    if (not isinstance(inspected, list) or len(set(ids)) != len(ids)
            or len(inspected) != len(ids) or {row.get('Id') for row in inspected} != set(ids)):
        raise ValueError('Daemon inspect does not cover the complete ID listing')
    for row in inspected:
        state = row.get('State') or {}
        if (state.get('Status') != 'exited' or state.get('Restarting') is not False
                or state.get('Running') is not False or state.get('Pid') != 0
                or state.get('Paused') is not False
                or (row.get('HostConfig') or {}).get('RestartPolicy', {}).get('Name') != 'no'):
            raise ValueError('A daemon actor is active, paused, or may restart')
    # Original actors may be absent; any retained originals must keep their
    # exact identity/owner. Inspecting only this lease would miss orphan checks.
    originals = {receipt['containerId']: receipt['container']}
    gateway = receipt.get('independentGateway')
    if gateway:
        arm = json.loads((Path(gateway['root']) / 'arm-receipt.json').read_text())
        if arm['lease'] != receipt['lease'] or arm['sessionId'] != inventory['sessionId']:
            raise ValueError('Original administrator identity is not bound')
        originals[arm['containerId']] = gateway['adminContainer']
    for row in inspected:
        if row['Id'] in originals and (row.get('Name') != '/' + originals[row['Id']]
                or (row.get('Config') or {}).get('Labels', {}).get('dsh.deepswe.attempt') != receipt['lease']):
            raise ValueError('Original actor identity changed during recovery')
    before = bound_json(journal, inventory, 'beforeRemovalSha256', 'owned-before-removal.json')
    if {row.get('id') for row in before.get('owned', [])} != set(originals):
        raise ValueError('Original actors are missing from recovery ownership evidence')
    for row in before['owned']:
        state = row.get('state') or {}
        if (row.get('name') != originals[row['id']]
                or (row.get('labels') or {}).get('dsh.deepswe.attempt') != receipt['lease']
                or state.get('Running') is not False or state.get('Pid') != 0
                or (row.get('restartPolicy') or {}).get('Name') != 'no'):
            raise ValueError('Original actor exit/ownership was not observed before removal')
    foreign = [row.get('id') for row in before.get('foreign', [])]
    if len(set(foreign)) != len(foreign) or set(foreign) != set(ids) - set(originals):
        raise ValueError('Foreign daemon actor inventory changed during reconciliation')
