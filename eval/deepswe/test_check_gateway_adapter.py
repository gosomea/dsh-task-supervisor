"""Task cutoff, private gateway ownership and truthful cleanup acknowledgements."""
import datetime
import json
from pathlib import Path
import socket
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from check_gateway_adapter import LABEL, LEDGER_READER, VOLUME_LABEL, arm, clean_checks, prepare
from control_flow import Journal
from launch_host import launch, owned as owns_task, quiesce
from run_pilot import run_position


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dsh-gateway-', dir='/tmp')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.spec = {'condition': 'supervisor-independent', 'home': str(self.root / 'task-home'),
            'runtime': str(self.root / 'runtime'), 'dockerContext': 'isolated', 'imageDigest': 'sha256:' + 'a' * 64,
            'supervisorConfig': {'reviewerModel': {'provider': 'daily', 'model': 'selected'},
                'reviewRepairAttempts': 1, 'reviewDeadlineMs': 600000, 'progressReviewMode': 'configured',
                'observationToolCalls': 48, 'observationIntervalMs': 600000,
                'observationConsecutiveErrors': 3, 'maxAutomaticRoundsWithoutReport': 6},
            'independentChecks': {'maxFiles': 100000, 'maxBytes': 1024 ** 3,
                'runtimeLinkTargets': [], 'commandDeadlineMs': 1800000,
                'commandOutputBytes': 1024 ** 2, 'deadlineMs': 1800000, 'pids': 256}}
        self.calls = []
        self.lease = '11111111-1111-1111-1111-111111111111'
        def docker(context, *args, **kwargs):
            self.calls.append(args)
            if args[:2] == ('volume', 'inspect'):
                name = args[2]
                return json.dumps([{'Name': name, 'Labels': {VOLUME_LABEL: self.lease},
                    'Mountpoint': '/var/lib/docker/volumes/' + name + '/_data'}])
            return ''
        self.prepare_docker = docker
        self.receipt, _, self.mounts = prepare(self.spec, self.lease, docker)
        self.started = {'deadlineAtUnix': 150.25, 'sessionId': 'session', 'cwd': '/app'}
        Path(self.receipt['root'], 'arm-receipt.json').write_text(json.dumps({**self.started,
            'lease': self.lease, 'containerId': 'admin-id'}))

    def row(self, suffix='1', removed=True):
        identity = '00000000-0000-0000-0000-' + suffix.zfill(12)
        name = 'dsh-review-' + identity
        return {'id': identity, 'snapshotId': 'snapshot-' + suffix,
            'record': {'name': name, 'snapshotId': 'snapshot-' + suffix,
                'image': self.spec['imageDigest'], 'endpoint': 'unix:///var/run/docker.sock'},
            'removed': {'name': name, 'removed': True} if removed else None}

    def daemon(self, check_rows=(), foreign=()):
        containers = {row['record']['name']: ('check-' + row['id'], row['snapshotId']) for row in check_rows}
        self.removed = []
        def docker(context, *args, **kwargs):
            self.calls.append(args)
            if args[:2] == ('container', 'ls'):
                selector = args[-1]
                if selector.startswith('name=^/'):
                    name = selector[7:-1]
                    if name == self.receipt['adminContainer']: return 'admin-id'
                    return containers.get(name, ('', ''))[0]
                return ''
            if args[0] == 'inspect':
                if '--format' in args: return 'false'
                if args[1] == 'admin-id':
                    return json.dumps([{'Id': 'admin-id', 'Name': '/' + self.receipt['adminContainer'], 'Config': {'Labels': {LABEL: self.lease}}}])
                name = next(name for name, value in containers.items() if value[0] == args[1])
                return json.dumps([{'Name': '/' + name, 'Config': {'Labels': {'dsh.supervisor.snapshot':
                    'foreign' if name in foreign else containers[name][1]}}}])
            if args[0] == 'rm':
                self.removed.append(args[-1])
                containers.pop(next(name for name, value in containers.items() if value[0] == args[-1]))
            return ''
        return docker

    def test_task_configuration_preserved_and_private_volume_not_exposed(self):
        task = json.loads(Path(self.receipt['taskPatch']).read_text())[0]['config']
        for key, value in self.spec['supervisorConfig'].items(): self.assertEqual(task[key], value)
        self.assertEqual(task['independentVerification']['maxFiles'], 100000)
        self.assertEqual(task['independentVerification']['maxBytes'], 1024 ** 3)
        self.assertTrue(any('source=' + self.receipt['volumes']['client']['name'] in m for m in self.mounts))
        self.assertFalse(any(self.receipt['volumes']['private']['name'] in m or 'admin-home' in m or 'docker.sock' in m for m in self.mounts))
        self.assertFalse(Path(self.receipt['adminHome'], '.credentials.yaml').exists())

    def test_partial_storage_failure_retains_exact_owned_recovery_intent(self):
        spec = {**self.spec, 'home': str(self.root / 'other-home')}
        def failed(context, *args):
            if args[:2] == ('volume', 'create') and '-private-' in args[-1]:
                raise subprocess.CalledProcessError(1, 'volume-create')
            return self.prepare_docker(context, *args)
        with self.assertRaises(subprocess.CalledProcessError): prepare(spec, self.lease, failed)
        root = self.root / 'other-home-checks'
        intent = json.loads((root / 'prepare-intent.json').read_text())
        fault = json.loads((root / 'prepare-fault.json').read_text())
        self.assertEqual(set(intent['plannedVolumes']), {'client', 'private'})
        self.assertEqual(intent['plannedVolumes']['private'], 'dsh-check-private-' + self.lease)
        self.assertEqual(set(fault['observedVolumes']), {'client'})
        self.assertFalse(fault['retryAllowed'])

    @unittest.skipUnless(shutil.which('node'), 'Native ledger reader requires Host Node')
    def test_native_reader_exports_metadata_and_rejects_redirected_private_tree(self):
        private = self.root / 'private'; private.mkdir()
        tree = private / 'review-owned'; tree.mkdir()
        snapshot = '11111111-1111-1111-1111-111111111111'
        row = self.row(); row['record']['snapshotId'] = snapshot
        (private / ('snapshot-' + snapshot + '.json')).write_text(json.dumps({'id': snapshot, 'root': str(tree)}))
        (tree / ('container-' + row['id'] + '.json')).write_text(json.dumps(row['record']))
        (tree / ('removed-' + row['id'] + '.json')).write_text(json.dumps(row['removed']))
        (tree / 'private-artifact.txt').write_text('must never cross metadata channel')
        result = subprocess.run([shutil.which('node'), '-e', LEDGER_READER, str(private)], capture_output=True, text=True, check=True)
        parsed = json.loads(result.stdout)
        self.assertEqual(parsed[0]['id'], row['id']); self.assertTrue(parsed[0]['removed']['removed'])
        self.assertNotIn('must never cross', result.stdout)
        for f in tree.iterdir(): f.unlink()
        tree.rmdir(); tree.symlink_to(self.root)
        result = subprocess.run([shutil.which('node'), '-e', LEDGER_READER, str(private)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)

    def test_config_restatement_cannot_fall_back_to_plugin_defaults(self):
        spec = {**self.spec, 'home': str(self.root / 'other-home'),
            'supervisorConfig': {'reviewerModel': {'provider': 'daily', 'model': 'selected'}}}
        with self.assertRaises(ValueError): prepare(spec, self.lease, Mock())
        self.assertFalse((self.root / 'other-home-checks').exists())

    def test_admin_deadline_exactly_task_deadline_and_no_model_credentials(self):
        Path(self.receipt['root'], 'arm-receipt.json').unlink()
        channel = socket.socket(socket.AF_UNIX); self.addCleanup(channel.close)
        channel.bind(str(Path(self.receipt['channel']) / 'check.sock'))
        def docker(context, *args):
            self.calls.append(args)
            if args[0] == 'run': return 'admin-id'
            return json.dumps([{'Id': 'admin-id', 'State': {'Running': True}, 'Config': {'Labels': {LABEL: self.lease}}}])
        result = arm(self.receipt, self.started, docker, clock=lambda: 100)
        self.assertEqual(result['deadlineAtUnix'], 150.25)
        config = json.loads(Path(self.receipt['adminHome'], 'profiles/check-gateway/cordis.patch.yml').read_text())[0]['insert'][1]['config']
        self.assertEqual(datetime.datetime.fromisoformat(config['deadlineAt']).timestamp(), 150.25)
        launch = next(call for call in self.calls if call[0] == 'run')
        self.assertIn('-di', launch)
        self.assertIn('none', launch)
        self.assertFalse(any('.credentials' in str(value) or 'API_KEY' in str(value) for value in launch))
        with self.assertRaises(RuntimeError): arm(self.receipt, self.started, docker, clock=lambda: 100)

    def test_native_records_plus_exact_daemon_absence_acknowledge(self):
        with patch('check_gateway_adapter.ledger_rows', return_value=[self.row()]):
            result = clean_checks(self.receipt, self.started, self.daemon())
        self.assertTrue(result['acknowledged']); self.assertTrue(result['nativeRemovalAcknowledged'])
        self.assertTrue(result['adminStopped']); self.assertEqual(result['fallbackRemoved'], [])

    def test_missing_record_is_not_invented_from_absence(self):
        clock = iter((0, 46))
        with patch('check_gateway_adapter.ledger_rows', return_value=[self.row(removed=False)]):
            result = clean_checks(self.receipt, self.started, self.daemon(), clock=lambda: next(clock))
        self.assertFalse(result['acknowledged']); self.assertTrue(result['adminStopped'])

    def test_unacknowledged_arm_still_stops_admin_and_never_claims_cleanup(self):
        Path(self.receipt['root'], 'admin-created.json').write_text(json.dumps({'lease': self.lease,
            'adminContainer': self.receipt['adminContainer'], 'containerId': 'admin-id'}))
        Path(self.receipt['root'], 'arm-receipt.json').unlink()
        with patch('check_gateway_adapter.ledger_rows', return_value=[]):
            result = clean_checks(self.receipt, self.started, self.daemon())
        self.assertFalse(result['acknowledged']); self.assertTrue(result['adminStopped'])
        self.assertEqual(result['faultType'], 'RuntimeError')

    def test_foreign_first_check_does_not_skip_owned_second_cleanup(self):
        foreign, owned = self.row('1', False), self.row('2', False)
        clock = iter((0, 46))
        with patch('check_gateway_adapter.ledger_rows', return_value=[foreign, owned]):
            result = clean_checks(self.receipt, self.started,
                self.daemon([foreign, owned], foreign=[foreign['record']['name']]), clock=lambda: next(clock))
        self.assertFalse(result['acknowledged'])
        self.assertEqual(self.removed, ['check-' + owned['id']])
        self.assertTrue(result['checkFaults']); self.assertTrue(result['adminStopped'])

    def test_late_ledger_after_admin_stop_is_cleaned_but_not_native_ack(self):
        late = self.row('3', False)
        with patch('check_gateway_adapter.ledger_rows', side_effect=[[], [late]]):
            result = clean_checks(self.receipt, self.started, self.daemon([late]))
        self.assertFalse(result['acknowledged']); self.assertEqual(self.removed, ['check-' + late['id']])

    def test_export_failure_still_closes_task_and_gateway(self):
        home = self.root / 'quiesce-home'; (home / 'run').mkdir(parents=True)
        (home / 'run/cutoff-result.json').write_text(json.dumps({'acknowledged': True, 'sessionId': 'session',
            'cutoffHeadCommit': 'a' * 40}))
        receipt = {'home': str(home), 'dockerContext': 'isolated', 'container': 'task',
            'lease': self.lease, 'containerId': 'task-id', 'independentGateway': self.receipt}
        started = {**self.started, 'baseCommit': 'b' * 40}
        def docker(context, *args, **kwargs):
            if args[0] == 'exec': raise subprocess.CalledProcessError(1, 'export')
            if args[0] == 'inspect': return 'false'
            return ''
        with patch('launch_host.owned'), patch('launch_host.docker', side_effect=docker), \
                patch('launch_host.clean_checks', return_value={'acknowledged': True}) as clean:
            with self.assertRaises(subprocess.CalledProcessError): quiesce(receipt, started, home / 'submission')
        clean.assert_called_once()

    def test_before_delivery_fault_closes_actors_and_blocks_redelivery(self):
        journal_root = self.root / 'attempt'
        home = self.root / 'host-home'; (home / 'run').mkdir(parents=True)
        receipt = {'home': str(home), 'dockerContext': 'isolated', 'container': 'task',
            'lease': self.lease, 'port': 12345, 'containerId': 'task-id'}
        spec = {'condition': 'supervisor-independent', 'id': 'fixture', 'baseCommit': 'a' * 40}
        def begin(rpc, journal, *args, before_delivery, **kwargs):
            journal.write('started.json', self.started)
            before_delivery(self.started)
        with patch('run_pilot.launch', return_value=receipt), patch('run_pilot.owned'), \
                patch('run_pilot.WebRpc'), patch('run_pilot.begin', side_effect=begin), \
                patch('run_pilot.arm_watchdog', side_effect=TimeoutError('arm failed')), \
                patch('run_pilot.abort_before_delivery', return_value={'cleanupAcknowledged': False}) as close:
            with self.assertRaises(TimeoutError): run_position(spec, 'unused', journal_root, allow_smoke=True)
            close.assert_called_once()
            with self.assertRaisesRegex(RuntimeError, 'no redelivery'): run_position(spec, 'unused', journal_root, allow_smoke=True)
        fault = Journal(journal_root).read('pre-delivery-fault.json')
        self.assertFalse(fault['delivered']); self.assertFalse(fault['retryAllowed'])

    def test_admin_replacement_with_same_name_and_lease_is_not_stopped(self):
        original = self.daemon()
        def replacement(context, *args, **kwargs):
            if args[0] == 'inspect' and '--format' not in args:
                row = json.loads(original(context, *args, **kwargs)); row[0]['Id'] = 'replacement-id'
                return json.dumps(row)
            return original(context, *args, **kwargs)
        with patch('check_gateway_adapter.ledger_rows', return_value=[]):
            result = clean_checks(self.receipt, self.started, replacement)
        self.assertFalse(result['acknowledged'])
        self.assertFalse(any(call[0] == 'stop' for call in self.calls))

    def test_task_replacement_with_same_name_and_lease_is_not_owned(self):
        row = {'Id': 'replacement-id', 'Name': '/task', 'Config': {'Labels': {LABEL: self.lease}}}
        with patch('launch_host.docker', return_value=json.dumps([row])):
            with self.assertRaises(RuntimeError): owns_task('isolated', 'task', self.lease, 'original-id')

    def test_launch_dns_failure_stops_exact_created_task_preserving_error(self):
        template = self.root / 'template'; (template / 'profiles/eval-baseline').mkdir(parents=True)
        (template / '.credentials.yaml').write_text('fixture only')
        runner = self.root / 'runner'; runner.mkdir()
        spec = {**self.spec, 'condition': 'goal', 'home': str(self.root / 'dns-home'),
            'template': str(template), 'runner': str(runner), 'port': 23456,
            'lease': self.lease, 'netctlImage': 'sha256:' + 'b' * 64}
        calls = []
        error = subprocess.CalledProcessError(1, 'getent')
        def docker(context, *args, **kwargs):
            calls.append(args)
            if args[0] == 'run': return 'created-id'
            if args[0] == 'exec': raise error
            if args[0] == 'inspect':
                if '--format' in args: return 'false'
                return json.dumps([{'Id': 'created-id', 'Name': '/dsh-deepswe-' + self.lease[:12], 'Config': {'Labels': {LABEL: self.lease}}}])
            return ''
        with patch('launch_host.docker', side_effect=docker), patch('launch_host.controller_overlay', return_value='[]\n'):
            with self.assertRaises(subprocess.CalledProcessError) as raised: launch(spec)
        self.assertIs(raised.exception, error)
        self.assertIn(('stop', '-t', '5', 'created-id'), calls)
        fault = json.loads(Path(spec['home'], 'run/launch-fault.json').read_text())
        self.assertEqual(fault['errorType'], 'CalledProcessError'); self.assertFalse(fault['retryAllowed'])
        self.assertTrue(fault['cleanup']['taskStopped'])

    def test_rpc_constructor_failure_closes_task_and_blocks_redelivery(self):
        root = self.root / 'rpc-attempt'; home = self.root / 'rpc-home'; home.mkdir()
        receipt = {'home': str(home), 'dockerContext': 'isolated', 'container': 'task',
            'lease': self.lease, 'port': 12345, 'containerId': 'task-id'}
        spec = {'condition': 'goal', 'id': 'fixture', 'baseCommit': 'a' * 40}
        error = ValueError('invalid startup transport')
        with patch('run_pilot.launch', return_value=receipt), patch('run_pilot.owned'), \
                patch('run_pilot.WebRpc', side_effect=error), \
                patch('run_pilot.abort_before_delivery', return_value={'taskStopped': True}) as close:
            with self.assertRaises(ValueError) as raised: run_position(spec, 'unused', root, allow_smoke=True)
            self.assertIs(raised.exception, error); close.assert_called_once()
            with self.assertRaisesRegex(RuntimeError, 'no redelivery'): run_position(spec, 'unused', root, allow_smoke=True)
        self.assertEqual(Journal(root).read('pre-delivery-fault.json')['stage'], 'rpc-initialization')

    def test_session_admission_rpc_failure_before_watchdog_stops_host(self):
        root = self.root / 'admission-attempt'; home = self.root / 'admission-home'; home.mkdir()
        receipt = {'home': str(home), 'dockerContext': 'isolated', 'container': 'task',
            'lease': self.lease, 'port': 12345, 'containerId': 'task-id'}
        spec = {'condition': 'goal', 'id': 'fixture', 'baseCommit': 'a' * 40}
        error = OSError('workspace/create failed')
        with patch('run_pilot.launch', return_value=receipt), patch('run_pilot.owned'), patch('run_pilot.WebRpc'), \
                patch('run_pilot.begin', side_effect=error), \
                patch('run_pilot.abort_before_delivery', return_value={'taskStopped': True}) as close:
            with self.assertRaises(OSError) as raised: run_position(spec, 'unused', root, allow_smoke=True)
            self.assertIs(raised.exception, error); close.assert_called_once_with(receipt, None)
            with self.assertRaisesRegex(RuntimeError, 'no redelivery'): run_position(spec, 'unused', root, allow_smoke=True)
        fault = Journal(root).read('pre-delivery-fault.json')
        self.assertFalse(fault['delivered']); self.assertFalse(fault['deliveryUncertain'])

    def test_uncertain_start_delivery_is_retained_and_never_reissued(self):
        root = self.root / 'uncertain-attempt'; home = self.root / 'uncertain-home'; home.mkdir()
        receipt = {'home': str(home), 'dockerContext': 'isolated', 'container': 'task',
            'lease': self.lease, 'port': 12345, 'containerId': 'task-id'}
        spec = {'condition': 'goal', 'id': 'fixture', 'baseCommit': 'a' * 40}
        def failed_begin(rpc, journal, *args, **kwargs):
            journal.write('started.json', self.started)
            journal.write('start-intent.json', {'requestId': 'original'})
            raise TimeoutError('start outcome unknown')
        with patch('run_pilot.launch', return_value=receipt), patch('run_pilot.owned'), patch('run_pilot.WebRpc'), \
                patch('run_pilot.begin', side_effect=failed_begin), \
                patch('run_pilot.abort_before_delivery', return_value={'taskStopped': True}) as close:
            with self.assertRaises(TimeoutError): run_position(spec, 'unused', root, allow_smoke=True)
            close.assert_called_once()
            with self.assertRaisesRegex(RuntimeError, 'no redelivery'): run_position(spec, 'unused', root, allow_smoke=True)
        fault = Journal(root).read('pre-delivery-fault.json')
        self.assertIsNone(fault['delivered']); self.assertTrue(fault['deliveryUncertain'])
        self.assertEqual(Journal(root).read('start-intent.json'), {'requestId': 'original'})

    def test_empty_gateway_dns_is_explicit_fault_and_still_closes_host(self):
        template = self.root / 'empty-template'; (template / 'profiles/eval-baseline').mkdir(parents=True)
        (template / '.credentials.yaml').write_text('fixture only')
        runner = self.root / 'empty-runner'; runner.mkdir()
        spec = {**self.spec, 'condition': 'goal', 'home': str(self.root / 'empty-home'),
            'template': str(template), 'runner': str(runner), 'port': 23456,
            'lease': self.lease, 'netctlImage': 'sha256:' + 'b' * 64}
        calls = []
        def docker(context, *args, **kwargs):
            calls.append(args)
            if args[0] == 'run': return 'created-id'
            if args[0] == 'inspect':
                if '--format' in args: return 'false'
                return json.dumps([{'Id': 'created-id', 'Name': '/dsh-deepswe-' + self.lease[:12], 'Config': {'Labels': {LABEL: self.lease}}}])
            return ''
        with patch('launch_host.docker', side_effect=docker), patch('launch_host.controller_overlay', return_value='[]\n'):
            with self.assertRaisesRegex(RuntimeError, 'DNS returned no address'): launch(spec)
        self.assertIn(('stop', '-t', '5', 'created-id'), calls)
        self.assertEqual(json.loads(Path(spec['home'], 'run/launch-fault.json').read_text())['errorType'], 'RuntimeError')


if __name__ == '__main__': unittest.main()
