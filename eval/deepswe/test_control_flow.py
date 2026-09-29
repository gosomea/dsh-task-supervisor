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

    def test_plan_stop_seals_once_without_approval_or_delivery(self):
        from test_native_stop import plan_fixture
        from native_stop import plan_stop_evidence
        events, values = plan_fixture()
        self.started('plan')
        projection = {'record': {'rows': {k: {'val': v} for k, v in values.items()}}}
        with patch('run_pilot.quiesce', return_value={'acknowledged': True}) as cleanup:
            terminal = supervise(self.rpc, self.journal, lambda _: projection, cleanup,
                clock=lambda: 3, sleep=lambda _: self.fail('Stopped Plan cannot wait out deadline'),
                read_native_stop=lambda _, state: plan_stop_evidence(events, state, 'b' * 64),
                approve_plan=lambda *_: self.fail('Stopped Plan cannot be approved'))
            self.assertEqual(terminal['status'], 'native-stopped')
            self.assertFalse(terminal['nativeFinished'])
            self.assertEqual(terminal['approvalCount'], 0)
            cleanup.assert_called_once()
            supervise(self.rpc, self.journal, lambda _: projection, cleanup, clock=lambda: 4)
            cleanup.assert_called_once()
        self.assertEqual(self.rpc.commands, [])
        self.assertEqual(self.rpc.prompts, [])

    def test_plan_resume_during_evidence_read_discards_old_stop(self):
        from test_native_stop import plan_fixture
        from native_stop import plan_stop_evidence
        import copy
        events, values = plan_fixture()
        self.started('plan')
        state = copy.deepcopy(values)
        def projection(_):
            return {'record': {'rows': {k: {'val': v} for k, v in state.items()}}}
        def evidence(_, old):
            result = plan_stop_evidence(events, old, 'b' * 64)
            self.rpc.running = True
            state['inbox']['next-turn'] = [{}]
            return result
        clock = [1]
        result = supervise(self.rpc, self.journal, projection, lambda *_: {'acknowledged': True},
            clock=lambda: clock[0], sleep=lambda _: clock.__setitem__(0, 10), read_native_stop=evidence)
        self.assertEqual(result['status'], 'deadline')
        self.assertIsNone(result['nativeStop'])

    def test_legacy_plan_observer_does_not_enable_new_stop_policy(self):
        from test_native_stop import plan_fixture
        _, values = plan_fixture()
        self.started('plan')
        projection = {'record': {'rows': {k: {'val': v} for k, v in values.items()}}}
        clock = [1]
        result = supervise(self.rpc, self.journal, lambda _: projection, lambda *_: {'acknowledged': True},
            clock=lambda: clock[0], sleep=lambda _: clock.__setitem__(0, 10))
        self.assertEqual(result['status'], 'deadline')
        self.assertIsNone(result['nativeStop'])

    def test_resumed_plan_attaches_reader_only_for_explicit_new_policy(self):
        from run_pilot import run_position
        self.started('plan')
        self.journal.write('launch-receipt.json', {'dockerContext': 'fixture', 'container': 'owned',
            'lease': 'lease', 'containerId': 'exact-id', 'home': self.temp.name, 'port': 1234})
        self.journal.write('plan-client-process.json', {'pid': 42})
        legacy = {'nativeGoalStop': True, 'goalDriverSha256': 'a' * 64,
                  'pauseDisposition': 'seal-without-rescue'}
        enabled = {**legacy, 'nativePlanStop': True, 'planModeSha256': 'b' * 64}
        for policy in (legacy, enabled):
            with self.subTest(policy=policy), patch('native_stop.admitted_goal_driver', return_value='a' * 64), \
                    patch('native_stop.admitted_plan_mode', return_value='b' * 64) as source, \
                    patch('native_stop.read_plan_stop', return_value={'proof': True}) as reader, \
                    patch('run_pilot.owned'), patch('run_pilot.WebRpc', return_value=self.rpc), \
                    patch('run_pilot.launch') as launch, patch('run_pilot.supervise') as monitor:
                def inspect_reader(*args, **kwargs):
                    callback = kwargs['read_native_stop']
                    if policy is legacy:
                        self.assertIsNone(callback)
                    else:
                        self.assertEqual(callback('session', {'plan': {}}), {'proof': True})
                    return {'status': 'fixture'}
                monitor.side_effect = inspect_reader
                run_position({'release': {'controlTerminationPolicy': policy}, 'runtime': 'fixture',
                              'condition': 'plan'}, '', self.journal.root, allow_smoke=True)
                launch.assert_not_called()
                if policy is legacy:
                    source.assert_not_called()
                    reader.assert_not_called()
                else:
                    source.assert_called_once()
                    reader.assert_called_once_with(Path(self.temp.name), 'session', {'plan': {}}, 'b' * 64)
        self.assertEqual(self.rpc.commands, [])
        self.assertEqual(self.rpc.prompts, [])

    def test_terminal_published_before_lock_prevents_second_cleanup(self):
        from contextlib import contextmanager
        self.started('goal')
        terminal = {'status': 'native-stopped'}
        @contextmanager
        def acquired():
            self.journal.write('terminal.json', terminal)
            yield
        with patch.object(self.journal, 'controller', acquired), patch('run_pilot.quiesce') as cleanup:
            result = supervise(self.rpc, self.journal, lambda _: {}, cleanup)
        self.assertEqual(result, terminal)
        cleanup.assert_not_called()

    def test_evidence_reader_cannot_seal_work_that_resumed_while_reading(self):
        from native_stop import goal_stop_evidence
        from test_native_stop import fixture
        import copy
        self.started('goal')
        events, values = fixture()
        state = copy.deepcopy(values)
        clock = [1]
        reads = []
        def projection(_):
            reads.append(1)
            return {'record': {'rows': {k: {'val': v} for k, v in state.items()}}}
        def evidence(_, old):
            proof = goal_stop_evidence(events, old, 'a' * 64)
            self.rpc.running = True
            state['inbox']['next-turn'] = [{}]
            return proof
        def sleep(_):
            clock[0] = 10
        result = supervise(self.rpc, self.journal, projection, lambda *_: {'acknowledged': True},
                           clock=lambda: clock[0], sleep=sleep, read_native_stop=evidence)
        self.assertEqual(result['status'], 'deadline')
        self.assertEqual(len(reads), 2)
        self.assertIsNone(result['nativeStop'])

    def test_resumed_policy_admission_failure_cleans_exact_owner_without_delivery(self):
        from run_pilot import run_position
        self.started('goal')
        self.journal.write('launch-receipt.json', {'dockerContext': 'fixture', 'container': 'owned',
                            'lease': 'lease', 'containerId': 'exact-id'})
        policy = {'nativeGoalStop': True, 'goalDriverSha256': 'a' * 64,
                  'pauseDisposition': 'seal-without-rescue'}
        with patch('native_stop.admitted_goal_driver', side_effect=ValueError('changed')), \
                patch('run_pilot.owned') as owner, patch('run_pilot.quiesce', return_value={'acknowledged': True}) as cleanup, \
                patch('run_pilot.launch') as launch:
            result = run_position({'release': {'controlTerminationPolicy': policy}, 'runtime': 'fixture'},
                                  '', self.journal.root, allow_smoke=True)
        owner.assert_called_once_with('fixture', 'owned', 'lease', 'exact-id')
        cleanup.assert_called_once()
        launch.assert_not_called()
        self.assertEqual(result['executionStatus'], 'observer-admission-fault')
        self.assertFalse(result['nativeFinished'])
        self.assertEqual(self.rpc.commands, [])

    def test_sealed_attempt_does_not_require_new_policy_admission(self):
        from run_pilot import run_position
        terminal = self.journal.write('terminal.json', {'status': 'native-stopped'})
        self.assertEqual(run_position({}, '', self.journal.root), terminal)

    def test_execution_versions_distinguish_original_launch_and_new_observer(self):
        from run_pilot import execution_versions
        self.journal.write('launch-intent.json', {'release': {'runner': 'v4'}})
        evidence = execution_versions({'release': {'runner': 'v5'}}, self.journal)
        self.assertTrue(evidence['controlProtocolDeviation'])
        versions = evidence['executionVersions']
        self.assertNotEqual(versions['launchReleaseSha256'], versions['observerReleaseSha256'])

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

    def test_admitted_pause_policy_seals_failure_without_rescue_or_full_wait(self):
        self.started()
        task = {'id': 'task', 'phase': 'paused', 'pauseReason': 'review-fault', 'enabled': True}
        def no_wait(_): self.fail('A manual-only pause must not consume the remaining task window')
        terminal = supervise(self.rpc, self.journal, lambda _: document(task),
            lambda *_: {'acknowledged': True}, clock=lambda: 1, sleep=no_wait, stop_on_pause=True)
        self.assertEqual(terminal['status'], 'manual-intervention-required')
        self.assertFalse(terminal['nativeFinished'])
        self.assertEqual(terminal['firstPause']['status'], 'internal-fault')
        self.assertEqual(terminal['endedAtUnix'], 1)
        self.assertEqual(self.rpc.commands, [])
        self.assertEqual(self.rpc.prompts, [])

    def test_native_goal_stop_seals_original_attempt_once_without_rescue(self):
        from test_native_stop import fixture
        from native_stop import goal_stop_evidence
        events, values = fixture()
        self.started(condition='goal')
        document = {'record': {'rows': {key: {'val': value} for key, value in values.items()}}}
        cleanups = []
        def cleanup(*_):
            cleanups.append(True)
            return {'acknowledged': True}
        terminal = supervise(self.rpc, self.journal, lambda _: document, cleanup, clock=lambda: 3,
            read_native_stop=lambda _, state: goal_stop_evidence(events, state, 'a' * 64),
            sleep=lambda _: self.fail('Native disarm must not wait for the deadline'))
        self.assertEqual(terminal['status'], 'native-stopped')
        self.assertFalse(terminal['nativeFinished'])
        self.assertEqual(terminal['nativeStop']['seq'], 2)
        self.assertEqual(len(cleanups), 1)
        supervise(self.rpc, self.journal, lambda _: document, cleanup, clock=lambda: 4)
        self.assertEqual(len(cleanups), 1)
        self.assertEqual(self.rpc.commands, [])
        self.assertEqual(self.rpc.prompts, [])

    def test_admitted_pause_policy_waits_for_active_turn_to_settle(self):
        self.started()
        self.rpc.running = True
        now = [1]
        task = {'id': 'task', 'phase': 'paused', 'enabled': True}
        def settle(delay):
            now[0] += delay
            self.rpc.running = False
        terminal = supervise(self.rpc, self.journal, lambda _: document(task),
            lambda *_: {'acknowledged': True}, clock=lambda: now[0], sleep=settle, stop_on_pause=True)
        self.assertEqual(terminal['status'], 'manual-intervention-required')
        self.assertEqual(now[0], 3)
        self.assertEqual(self.rpc.commands, [])

    def test_invalid_stop_policy_rejected_before_host_launch(self):
        from run_pilot import run_position
        spec = {'release': {'controlTerminationPolicy': {'nativeGoalStop': 'typo'}}}
        with patch('run_pilot.launch') as launch_host:
            with self.assertRaisesRegex(ValueError, 'termination policy'):
                run_position(spec, 'fixture', self.journal.root / 'policy', allow_smoke=True)
            launch_host.assert_not_called()

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
