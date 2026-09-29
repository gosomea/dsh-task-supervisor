"""Meaningful deadline, uncertain delivery, and native-state regressions."""
import tempfile
import json
import os
import subprocess
from pathlib import Path
import unittest
from unittest.mock import patch

from control_flow import Journal, MODEL, approve_supervisor, begin, controller_overlay, exclusive_json, observe, supervise
from run_pilot import collect_route, finalize_position, run_batch, validate_result_identity
from launch_host import launch


class Rpc:
    def __init__(self):
        self.commands = []
        self.prompts = []
        self.running = False
    def call(self, method, request=None):
        if method == 'workspace/create': return {'workspace': {'workspaceId': 'workspace'}}
        if method == 'session/create': return {'sessionId': 'session'}
        if method == 'session/selectModel': return {'selected': MODEL}
        if method == 'session/list': return {'items': [{'sessionId': 'session', 'cwd': '/app', 'running': self.running}]}
        return {}
    def command(self, session, line):
        self.commands.append(line)
        return {'result': {'kind': 'success'}}
    def prompt(self, session, text, **kwargs):
        self.prompts.append(text)
        return {'accepted': True}


def document(task):
    return {'record': {'rows': {'taskSupervisor': {'val': {'current': task, 'reviewJobs': []}},
                               'sessionStats': {'val': {'openStep': None, 'pendingCalls': []}}}}}


class ControlFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.journal = Journal(self.temp.name)
        self.rpc = Rpc()

    def started(self, condition='supervisor-log', deadline=10):
        return self.journal.write('started.json', {'schemaVersion': 1, 'id': 'fixture', 'condition': condition,
            'sessionId': 'session', 'startedAtUnix': 0, 'deadlineAtUnix': deadline, 'timeLimitSec': deadline})

    def test_admission_is_recorded_before_send_and_cannot_be_repeated(self):
        original = self.rpc.command
        def command(session, line):
            if line.startswith('/task new'):
                self.assertIsNotNone(self.journal.read('started.json'))
                self.assertIsNotNone(self.journal.read('start-intent.json'))
            return original(session, line)
        self.rpc.command = command
        begin(self.rpc, self.journal, 'supervisor-log', 'small smoke', 'base', 'fixture', clock=lambda: 2)
        with self.assertRaises(RuntimeError):
            begin(self.rpc, self.journal, 'supervisor-log', 'small smoke', 'base', 'fixture')
        self.assertEqual(sum(line.startswith('/task new') for line in self.rpc.commands), 1)
        self.assertEqual(self.journal.read('started.json')['deadlineAtUnix'], 10802)

    def test_uncertain_approval_never_resends(self):
        started = self.started()
        observation = {'taskPhase': 'awaiting-approval', 'everApproved': False, 'taskId': 'task', 'planVersion': 1}
        def failed(*args): raise TimeoutError('transport outcome unknown')
        self.rpc.command = failed
        with self.assertRaises(TimeoutError):
            approve_supervisor(self.rpc, self.journal, started, observation, clock=lambda: 1)
        self.assertIsNotNone(self.journal.read('approval-intent.json'))
        self.assertIsNone(self.journal.read('approval-receipt.json'))
        self.assertFalse(approve_supervisor(self.rpc, self.journal, started, observation, clock=lambda: 2))

    def test_single_initial_approval_only(self):
        started = self.started()
        observation = {'taskPhase': 'awaiting-approval', 'everApproved': False, 'taskId': 'task', 'planVersion': 1}
        self.assertTrue(approve_supervisor(self.rpc, self.journal, started, observation, clock=lambda: 1))
        self.assertFalse(approve_supervisor(self.rpc, self.journal, started, observation, clock=lambda: 2))
        self.assertEqual(self.rpc.commands, ['/task approve'])

    def test_deadline_never_approves(self):
        started = self.started(deadline=2)
        observation = {'taskPhase': 'awaiting-approval', 'everApproved': False, 'taskId': 'task', 'planVersion': 1}
        self.assertFalse(approve_supervisor(self.rpc, self.journal, started, observation, clock=lambda: 2))
        self.assertEqual(self.rpc.commands, [])

    def test_pause_waits_until_deadline_without_rescue(self):
        self.started()
        now = [1]
        task = {'id': 'task', 'phase': 'paused', 'pauseReason': 'review-fault', 'enabled': True, 'reviewFault': {'kind': 'timeout'}}
        terminal = supervise(self.rpc, self.journal, lambda _: document(task),
            lambda *_: {'acknowledged': True}, clock=lambda: now[0], sleep=lambda value: now.__setitem__(0, now[0]+value), poll_sec=3)
        self.assertEqual(terminal['status'], 'deadline')
        self.assertFalse(terminal['nativeFinished'])
        self.assertEqual(terminal['firstPause']['status'], 'internal-fault')
        self.assertEqual(now[0], 10)
        self.assertEqual(self.rpc.commands, [])
        self.assertEqual(self.rpc.prompts, [])

    def test_terminal_is_immutable_and_reconcile_does_not_quiesce_twice(self):
        self.started()
        task = {'id': 'task', 'phase': 'complete', 'enabled': True}
        terminal = supervise(self.rpc, self.journal, lambda _: document(task),
                             lambda *_: {'acknowledged': True}, clock=lambda: 1)
        self.assertTrue(terminal['nativeFinished'])
        def forbidden(*_): self.fail('sealed result must not run anything')
        self.assertEqual(supervise(self.rpc, self.journal, forbidden, forbidden), terminal)
        with self.assertRaises(FileExistsError): self.journal.write('terminal.json', {})

    def test_complete_needs_native_idle(self):
        values = {'goal': {'current': {'goal': {'phase': 'complete'}}}, 'sessionStats': {}}
        self.assertEqual(observe('goal', values, True, True)['status'], 'running')
        self.assertTrue(observe('goal', values, False, True)['nativeFinished'])

    def test_blocked_cleared_and_off_are_never_completion(self):
        values = {'goal': {'current': {'goal': {'phase': 'blocked'}}}}
        result = observe('goal', values, False, True)
        self.assertEqual(result['status'], 'native-blocked')
        self.assertFalse(result['nativeFinished'])
        for task in ({'phase': 'cleared'}, {'phase': 'active', 'enabled': False}):
            result = observe('supervisor-log', {'taskSupervisor': {'current': task}}, False, True)
            self.assertFalse(result['nativeFinished'])

    def test_foreign_continuation_owner_fails_closed(self):
        result = observe('supervisor-log', {'goal': {'current': {'goal': {'phase': 'active'}}},
            'taskSupervisor': {'current': {'phase': 'active', 'enabled': True}}}, False, True)
        self.assertEqual(result['status'], 'controller-conflict')
        self.assertFalse(result['nativeFinished'])

    def test_cleanup_failure_is_infrastructure_even_after_complete(self):
        self.started()
        terminal = supervise(self.rpc, self.journal,
            lambda _: document({'phase': 'complete', 'enabled': True}),
            lambda *_: {'acknowledged': False}, clock=lambda: 1)
        self.assertEqual(terminal['status'], 'infrastructure-fault')
        self.assertEqual(terminal['executionStatus'], 'native-complete')
        self.assertTrue(terminal['nativeFinished'])
        self.assertFalse(terminal['cleanupAcknowledged'])

    def test_profile_composition_disables_foreign_owners(self):
        self.assertNotIn('id: goal\n', controller_overlay('goal'))
        self.assertIn('id: plan-mode\n', controller_overlay('goal'))
        self.assertIn('id: goal-round-driver\n', controller_overlay('plan'))
        self.assertNotIn('id: plan-mode\n', controller_overlay('plan'))
        for condition in ('supervisor-log', 'supervisor-independent'):
            text = controller_overlay(condition)
            self.assertIn('id: goal-round-driver\n', text)
            self.assertIn('id: plan-mode\n', text)

    def test_second_controller_cannot_acquire_attempt(self):
        with self.journal.controller():
            with self.assertRaises(RuntimeError):
                with Journal(self.temp.name).controller(): pass

    def test_goal_command_is_the_single_native_initial_authorization(self):
        begin(self.rpc, self.journal, 'goal', 'small smoke', 'base', 'fixture', clock=lambda: 1)
        self.assertEqual(self.journal.read('approval-receipt.json')['transport'], 'native-goal-command')
        self.assertEqual(sum(line.startswith('/goal ') for line in self.rpc.commands), 1)

    def test_record_is_complete_before_atomic_publication_and_never_replaced(self):
        destination = self.journal.root / 'record.json'
        original_link = os.link
        def publish(source, target):
            self.assertFalse(destination.exists())
            self.assertEqual(json.loads(Path(source).read_text()), {'payload': 'complete'})
            original_link(source, target)
        with patch('control_flow.os.link', side_effect=publish):
            exclusive_json(destination, {'payload': 'complete'})
        self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            exclusive_json(destination, {'payload': 'replacement'})
        self.assertEqual(json.loads(destination.read_text()), {'payload': 'complete'})
        self.assertEqual(list(self.journal.root.glob('.record.json.*')), [])

    def test_sealed_identity_checks_every_paired_field(self):
        spec = {'id': 'one', 'taskId': 'task', 'condition': 'goal', 'repeat': 1}
        validate_result_identity(spec, spec)
        for key in spec:
            with self.assertRaises(ValueError):
                validate_result_identity({**spec, key: 'foreign'}, spec)

    def test_route_evidence_missing_is_unknown_not_a_protocol_violation(self):
        route = collect_route({'home': self.temp.name, 'condition': 'goal'}, {'mainSessionId': 'session'})
        self.assertIsNone(route['routesMatched'])
        self.assertIsNone(route['protocolDeviation'])
        self.assertEqual(route['fault']['errorType'], 'FileNotFoundError')

    def test_provider_failure_on_matching_route_is_not_protocol_deviation(self):
        audit = self.journal.root / 'run/model-route-audit.jsonl'
        audit.parent.mkdir()
        audit.write_text(json.dumps({'type': 'http-response', 'statusCode': 502}) + '\n')
        summary = {'actualHttpRequests': 1, 'modelRequests': 1}
        chain = {'main': summary, 'reviewers': [], 'additionalSessions': [],
                 'routesMatched': True, 'protocolDeviation': False, 'passed': False}
        with patch('metrics.read_home', return_value=({'session': []}, {}, [])), \
                patch('model_route.inspect_chain', return_value=chain):
            route = collect_route({'home': self.temp.name, 'condition': 'goal'}, {'mainSessionId': 'session'})
        self.assertTrue(route['routesMatched'])
        self.assertFalse(route['protocolDeviation'])
        self.assertFalse(route['passed'])

    def test_uncertain_grader_never_relaunches_or_seals_result(self):
        self.journal.write('started.json', {'startedAtUnix': 0, 'timeLimitSec': 10})
        self.journal.write('terminal.json', {'cleanupAcknowledged': True, 'submissionDir': '/submission'})
        (self.journal.root / 'grade').mkdir()
        self.journal.write('grade/started.json', {'taskId': 'task'})
        spec = {'id': 'fixture', 'taskId': 'task', 'condition': 'goal', 'repeat': 1}
        with patch('grade.run_grade') as grade:
            with self.assertRaisesRegex(RuntimeError, 'Original grader outcome is uncertain'):
                finalize_position(spec, self.journal.root)
            grade.assert_not_called()
        self.assertIsNone(self.journal.read('result.json'))

    def test_formal_mutable_network_helper_rejected_before_allocating_home(self):
        home = self.journal.root / 'new-home'
        spec = {'home': str(home), 'runtime': self.temp.name, 'template': self.temp.name,
                'condition': 'goal', 'imageDigest': 'sha256:' + 'a' * 64,
                'formal': True, 'netctlImage': 'alpine:latest', 'storageMiB': 20480,
                'storageEnforcement': 'official-docker-metadata-only'}
        with self.assertRaisesRegex(ValueError, 'immutable image digest'):
            launch(spec)
        self.assertFalse(home.exists())

    def test_formal_storage_semantics_cannot_silently_change(self):
        home = self.journal.root / 'new-home'
        spec = {'home': str(home), 'runtime': self.temp.name, 'template': self.temp.name,
                'condition': 'goal', 'imageDigest': 'sha256:' + 'a' * 64,
                'formal': True, 'netctlImage': 'sha256:' + 'b' * 64, 'storageMiB': 20480}
        with self.assertRaisesRegex(ValueError, 'storage metadata'):
            launch(spec)
        self.assertFalse(home.exists())

    def test_network_helper_overrides_inherited_shell_entrypoint(self):
        home = self.journal.root / 'network-home'
        template = self.journal.root / 'template'
        (template / 'profiles/eval-baseline').mkdir(parents=True)
        (template / '.credentials.yaml').write_text('{}')
        helper = 'sha256:' + 'b' * 64
        lease = 'network-fixture'
        spec = {'home': str(home), 'runtime': self.temp.name, 'template': str(template),
                'condition': 'goal', 'imageDigest': 'sha256:' + 'a' * 64,
                'formal': True, 'netctlImage': helper, 'port': 36200, 'lease': lease,
                'storageMiB': 20480, 'storageEnforcement': 'official-docker-metadata-only'}
        shell_checks = []
        def image_runtime(_context, *args, **kwargs):
            if args[0] == 'run' and '--name' in args:
                (home / 'run/host.log').write_text('ready ?token=fixture')
                return 'container-id'
            if args[0] == 'inspect':
                return json.dumps([{'Id': 'container-id', 'Name': '/dsh-deepswe-' + lease[:12],
                    'Config': {'Labels': {'dsh.deepswe.attempt': lease}}}])
            if args[0] == 'exec' and 'getent' in args:
                return '192.0.2.1 STREAM host.docker.internal'
            if args[0] == 'run' and helper in args:
                # Docker appends command arguments to the image's inherited ENTRYPOINT.
                entrypoint = args[args.index('--entrypoint') + 1] if '--entrypoint' in args else '/bin/sh'
                command = [entrypoint, *args[args.index(helper) + 1:]]
                # Parse without executing firewall commands or touching host networking.
                check = subprocess.run([command[0], '-n', *command[1:]], capture_output=True)
                self.assertEqual(check.returncode, 0, check.stderr.decode(errors='replace'))
                shell_checks.append(command)
            return ''
        with patch('launch_host.docker', side_effect=image_runtime), \
                patch('launch_host.controller_overlay', return_value=''), \
                patch('launch_host.prepare_gateway', return_value=(None, '', [])):
            receipt = launch(spec)
        self.assertTrue(receipt['networkSealed'])
        self.assertEqual(len(shell_checks), 1)

    def test_batch_position_layout_is_read_by_summary_without_a_host(self):
        from summarize_pilot import summarize
        dataset = self.journal.root / 'dataset'
        task = dataset / 'tasks/fixture'
        task.mkdir(parents=True)
        (task / 'instruction.md').write_text('non-model fixture')
        identity = {'id': 'fixture-r1-goal', 'taskId': 'fixture', 'condition': 'goal', 'repeat': 1}
        release = {'fixture': 'not-real-admission'}
        spec = {**identity, 'dataset': str(dataset), 'release': release}
        protocol = {'plannedAttempts': 1, 'conditions': ['goal'], 'repeats': 1,
                    'tasks': [{'id': 'fixture'}], 'order': [identity]}
        root = self.journal.root / 'batch'
        def run(spec, instruction, position_root):
            self.assertEqual(position_root, root / 'attempts' / identity['id'])
            Journal(position_root).write('started.json', {'fixture': True})
        def finalize(spec, position_root):
            return Journal(position_root).write('result.json', {**identity,
                'terminal': {'nativeFinished': True, 'finishedBeforeDeadline': True, 'cleanupAcknowledged': True},
                'grade': {'reward': 1, 'fault': None},
                'route': {'routesMatched': True, 'protocolDeviation': False}})
        with patch('freeze_release.require_frozen_release', return_value=protocol), \
                patch('run_pilot.run_position', side_effect=run), \
                patch('run_pilot.finalize_position', side_effect=finalize):
            run_batch({'release': release, 'positions': [spec], 'root': str(root)})
        report = summarize(root, protocol)
        self.assertEqual((report['planned'], report['started'], report['sealed']), (1, 1, 1))
        self.assertEqual(report['conditions']['goal']['primarySuccesses'], 1)
        self.assertFalse((root / identity['id']).exists())


if __name__ == '__main__': unittest.main()
