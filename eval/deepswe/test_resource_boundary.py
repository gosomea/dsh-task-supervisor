"""Unconfirmed cleanup cannot leak resources into the next paired attempt."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from control_flow import Journal
from resource_boundary import digest, require_resource_boundary
from run_pilot import run_batch

class ResourceBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.journal = Journal(self.temp.name)
        self.result = {'id': 'one', 'taskId': 'task', 'condition': 'goal', 'repeat': 1,
                       'terminal': {'cleanupAcknowledged': False, 'nativeFinished': False}, 'grade': {'reward': None}}
        self.journal.write('result.json', self.result)
        self.journal.write('started.json', {'sessionId': 'session'})
        self.journal.write('launch-receipt.json', {'containerId': 'main-id', 'lease': 'lease', 'dockerContext': 'dedicated'})
        self.inventory = {'kind': 'deepswe-stopped-lease-inventory', 'sessionId': 'session',
                          'lease': 'lease', 'dockerContext': 'dedicated', 'daemonReachable': True,
                          'leaseInventoryComplete': True, 'containers': [{'id': 'main-id', 'lease': 'lease',
                          'running': False, 'disposition': 'exited', 'restartPolicy': 'no'}]}

    def reconcile(self):
        self.journal.write('resource-inventory.json', self.inventory)
        self.journal.write('resource-reconciliation.json', {
            'kind': 'deepswe-resource-reconciliation',
            'originalResultSha256': digest(self.journal.root / 'result.json'),
            'originalLaunchReceiptSha256': digest(self.journal.root / 'launch-receipt.json'),
            'originalStartedSha256': digest(self.journal.root / 'started.json'),
            'inventorySha256': digest(self.journal.root / 'resource-inventory.json')})

    def test_cleanup_ack_needs_no_supplement(self):
        require_resource_boundary(self.journal, {'terminal': {'cleanupAcknowledged': True}})

    def test_missing_resource_proof_blocks_allocation(self):
        with self.assertRaisesRegex(RuntimeError, 'resource exit is unconfirmed'):
            require_resource_boundary(self.journal, self.result)

    def test_reconciliation_preserves_original_failure_and_grade(self):
        original = (self.journal.root / 'result.json').read_bytes(); self.reconcile()
        require_resource_boundary(self.journal, self.result)
        self.assertEqual((self.journal.root / 'result.json').read_bytes(), original)
        self.assertFalse(self.journal.read('result.json')['terminal']['cleanupAcknowledged'])
        self.assertIsNone(self.journal.read('result.json')['grade']['reward'])

    def test_modified_original_or_inventory_is_rejected(self):
        self.reconcile(); path = self.journal.root / 'resource-inventory.json'
        path.write_text(json.dumps({**self.inventory, 'daemonReachable': False}))
        with self.assertRaisesRegex(ValueError, 'missing or changed'):
            require_resource_boundary(self.journal, self.result)

    def test_running_restartable_foreign_or_missing_actor_is_rejected(self):
        for mutation in ({'running': True}, {'restartPolicy': 'always'}, {'lease': 'foreign'}, {'id': 'other'}):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as root:
                journal = Journal(root)
                for name in ('result.json', 'launch-receipt.json', 'started.json'):journal.write(name, self.journal.read(name))
                inventory = {**self.inventory, 'containers': [{**self.inventory['containers'][0], **mutation}]}
                journal.write('resource-inventory.json', inventory)
                journal.write('resource-reconciliation.json', {'kind': 'deepswe-resource-reconciliation',
                    **{field: digest(journal.root / name) for field, name in
                       (('originalResultSha256', 'result.json'), ('originalLaunchReceiptSha256', 'launch-receipt.json'),
                        ('originalStartedSha256', 'started.json'), ('inventorySha256', 'resource-inventory.json'))}})
                with self.assertRaises(ValueError):require_resource_boundary(journal, self.result)

    def test_independent_admin_and_check_inventory_are_required(self):
        gateway = self.journal.root / 'gateway'; gateway.mkdir()
        (gateway / 'arm-receipt.json').write_text(json.dumps({'lease': 'lease', 'sessionId': 'session', 'containerId': 'admin-id'}))
        receipt = self.journal.read('launch-receipt.json')
        (self.journal.root / 'launch-receipt.json').write_text(json.dumps({**receipt, 'independentGateway': {'root': str(gateway)}}))
        self.inventory.update(ledgerInventoryComplete=True, checkContainerIds=['check-id']); self.reconcile()
        with self.assertRaises(ValueError):require_resource_boundary(self.journal, self.result)

    def test_empty_declared_checks_cannot_hide_actual_private_ledger_check(self):
        gateway=self.journal.root/'gateway';gateway.mkdir()
        (gateway/'arm-receipt.json').write_text(json.dumps({'lease':'lease','sessionId':'session','containerId':'admin-id'}))
        receipt=self.journal.read('launch-receipt.json')
        receipt['independentGateway']={'root':str(gateway),'imageDigest':'image',
                                      'volumes':{'private':{'name':'volume','path':'/volume'}}}
        (self.journal.root/'launch-receipt.json').write_text(json.dumps(receipt))
        self.inventory['containers'].append({'id':'admin-id','lease':'lease','running':False,
                                             'disposition':'exited','restartPolicy':'no'})
        ledger={'volumeName':'volume','volumePath':'/volume','lease':'lease','adminContainerId':'admin-id',
                'administratorStopped':True,'complete':True,'rows':[{'id':'check','snapshotId':'snapshot',
                'record':{'name':'dsh-review-check','snapshotId':'snapshot','image':'image',
                          'endpoint':'unix:///var/run/docker.sock'}}]}
        self.journal.write('private-ledger-readback.json',ledger)
        self.inventory.update(ledgerInventoryComplete=True,checkContainerIds=[],
                              ledgerReadbackSha256=digest(self.journal.root/'private-ledger-readback.json'))
        self.reconcile()
        with self.assertRaisesRegex(ValueError,'actual private ledger check'):
            require_resource_boundary(self.journal,self.result)

    def daemon_fixture(self, mutate=None):
        config = b'fixed fixture config'
        for name in ('vm-config-before.yaml', 'vm-config-after.yaml'):(self.journal.root/name).write_bytes(config)
        cfg = digest(self.journal.root/'vm-config-before.yaml')
        receipt = self.journal.read('launch-receipt.json');receipt['container']='main'
        (self.journal.root/'launch-receipt.json').write_text(json.dumps(receipt))
        fault={'kind':'formal-dedicated-vm-fault','dockerContext':'dedicated','vmName':'colima-fixture',
               'cliListedRunningButVzReportedError':True}
        recovery={'kind':'deepswe-vm-resource-reconciliation','dockerContext':'dedicated','profile':'fixture',
                  'profileConfigUnchanged':True,'profileConfigSha256':cfg,'priorHostAgentPid':1,'currentHostAgentPid':2,
                  'agentRestarted':False,'officialGradeSupplemented':False,'modelRequestsByRecovery':0,'approvals':0,'rescuePrompts':0}
        daemon=[{'Id':'foreign','State':{'Status':'exited','Running':False,'Restarting':False,'Paused':False,'Pid':0},
                 'HostConfig':{'RestartPolicy':{'Name':'no'}}}]
        before={'owned':[{'id':'main-id','name':'main','labels':{'dsh.deepswe.attempt':'lease'},
                         'state':{'Running':False,'Pid':0},'restartPolicy':{'Name':'no'}}], 'foreign':[{'id':'foreign'}]}
        files={'vm-fault.json':fault,'vm-recovery.json':recovery,'vm-stop.json':{'exitCode':0,'exactVm':'colima-fixture'},
               'vm-start.json':{'exitCode':0,'exactProfile':'fixture','hardwareOverrides':[]},
               'daemon-inspect.json':daemon,'owned-before-removal.json':before}
        if mutate:mutate(files)
        for name,value in files.items():self.journal.write(name,value)
        (self.journal.root/'daemon-container-ids.txt').write_text('foreign\n')
        self.inventory.update(kind='deepswe-daemon-wide-stopped-inventory',profileConfigSha256=cfg,
                              priorLedgerFullTreeCoverageConfirmed=False)
        for field,name in (('vmFaultSha256','vm-fault.json'),('vmRecoverySha256','vm-recovery.json'),
                ('vmStopSha256','vm-stop.json'),('vmStartSha256','vm-start.json'),('daemonIdsSha256','daemon-container-ids.txt'),
                ('daemonInspectSha256','daemon-inspect.json'),('beforeRemovalSha256','owned-before-removal.json')):
            self.inventory[field]=digest(self.journal.root/name)
        self.reconcile()

    def test_entire_stopped_daemon_can_reconcile_without_claiming_lost_ledger(self):
        self.daemon_fixture();require_resource_boundary(self.journal,self.result)
        self.assertFalse(self.journal.read('result.json')['terminal']['cleanupAcknowledged'])
        self.assertFalse(self.journal.read('resource-inventory.json')['priorLedgerFullTreeCoverageConfirmed'])

    def test_daemon_recovery_rejects_active_actor_or_failed_vm_stop(self):
        self.daemon_fixture(lambda files:files['daemon-inspect.json'][0]['State'].update(Running=True))
        with self.assertRaisesRegex(ValueError,'daemon actor'):require_resource_boundary(self.journal,self.result)

    def test_daemon_recovery_requires_successful_exact_namespace_stop(self):
        self.daemon_fixture(lambda files:files['vm-stop.json'].update(exitCode=None))
        with self.assertRaisesRegex(ValueError,'namespace stop'):require_resource_boundary(self.journal,self.result)

    def test_daemon_inspection_cannot_omit_a_listed_container(self):
        self.daemon_fixture(lambda files:files['daemon-inspect.json'].clear())
        with self.assertRaisesRegex(ValueError,'complete ID listing'):require_resource_boundary(self.journal,self.result)

    def test_unchanged_vm_configuration_needs_actual_bytes(self):
        self.daemon_fixture();(self.journal.root/'vm-config-after.yaml').write_text('changed')
        with self.assertRaisesRegex(ValueError,'configuration bytes'):require_resource_boundary(self.journal,self.result)

    def test_batch_stops_after_new_unclean_result_before_next_agent(self):
        rows = [{'id': name, 'taskId': 'task', 'condition': 'goal', 'repeat': repeat}
                for repeat, name in enumerate(('one', 'two'), 1)]
        dataset = self.journal.root / 'dataset'; (dataset / 'tasks/task').mkdir(parents=True)
        (dataset / 'tasks/task/instruction.md').write_text('fixture'); release = {'fixture': True}
        specs = [{**row, 'release': release, 'dataset': str(dataset)} for row in rows]
        def finalize(spec, root):return Journal(root).write('result.json', {**spec, 'terminal': {'cleanupAcknowledged': False}})
        with patch('freeze_release.require_frozen_release', return_value={'order': rows}), \
                patch('run_pilot.run_position') as run, patch('run_pilot.finalize_position', side_effect=finalize):
            with self.assertRaisesRegex(RuntimeError, 'resource exit is unconfirmed'):
                run_batch({'release': release, 'positions': specs, 'root': str(self.journal.root / 'batch')})
            self.assertEqual(run.call_count, 1)
            self.assertFalse((self.journal.root / 'batch/attempts/two').exists())

    def test_restart_cannot_skip_old_unclean_result(self):
        spec = {**{k: self.result[k] for k in ('id', 'taskId', 'condition', 'repeat')}, 'release': {'fixture': True}}
        batch = self.journal.root / 'batch'; Journal(batch / 'attempts/one').write('result.json', self.result)
        with patch('freeze_release.require_frozen_release', return_value={'order': [spec]}), patch('run_pilot.run_position') as run:
            with self.assertRaisesRegex(RuntimeError, 'resource exit is unconfirmed'):
                run_batch({'release': spec['release'], 'positions': [spec], 'root': str(batch)})
            run.assert_not_called()

if __name__ == '__main__':unittest.main()
