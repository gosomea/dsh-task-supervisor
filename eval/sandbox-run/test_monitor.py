import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from monitor import Journal, applied_plan, fold, observe, parse_events, protocol_actions, renew
from instruction_identity import task_instruction_identity


def fixture():
    task = {'id': 'task-a', 'mainSessionId': 'session-a', 'revision': 5,
        'requirementsVersion': 1, 'planVersion': 1, 'enabled': True,
        'phase': 'awaiting-approval', 'objective': 'initial objective', 'everApproved': False}
    job = {'id': 'review-a', 'status': 'applied', 'kind': 'plan', 'stageId': 'plan',
        'mainSessionId': 'session-a', 'taskId': 'task-a', 'planVersion': 0,
        'input': {**task, 'planVersion': 0}, 'decision': {'verdict': 'pass'}}
    return {'task': task, 'jobs': {'review-a': job}, 'barriers': [], 'idle': True}


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.journal = Journal(self.directory.name)
        self.started = {'id': 'position', 'condition': 'supervisor-independent',
            'sessionId': 'session-a', 'deadlineAtUnix': 100}
        self.now = 10

    def clock(self):
        return self.now

    def test_applied_matching_plan_only(self):
        view = fixture()
        self.assertIsNotNone(applied_plan(view['task'], view['jobs'], 'session-a'))
        for key, value in (('status', 'submitted'), ('mainSessionId', 'other'),
                           ('taskId', 'old-task'), ('planVersion', -1), ('fault', {'code': 'stale'})):
            changed = copy.deepcopy(view); changed['jobs']['review-a'][key] = value
            self.assertIsNone(applied_plan(changed['task'], changed['jobs'], 'session-a'))
        view['jobs']['review-a']['input']['requirementsVersion'] = 0
        self.assertIsNone(applied_plan(view['task'], view['jobs'], 'session-a'))

    def test_approval_waits_for_native_main_round_to_stop(self):
        view, sent = fixture(), []
        view['idle'] = False
        protocol_actions(self.journal, self.started, view, sent.append, clock=self.clock)
        self.assertEqual(sent, [])
        self.assertIsNone(self.journal.read('actions/initial-approval-intent.json'))
        view['idle'] = True
        protocol_actions(self.journal, self.started, view, sent.append, clock=self.clock)
        self.assertEqual(len(sent), 1)

    def test_native_command_trim_binds_original_instruction_and_approves_once(self):
        view, sent = fixture(), []
        started = {**self.started, **task_instruction_identity(view['task']['objective'] + '\n')}
        for _ in range(2):
            protocol_actions(self.journal, started, view, sent.append, clock=self.clock)
        self.assertEqual(len(sent), 1)
        binding = self.journal.read('task-binding.json')
        self.assertEqual(binding['instructionSha256'], started['instructionSha256'])
        self.assertEqual(binding['objectiveSha256'], started['taskObjectiveSha256'])

    def test_native_command_trim_does_not_accept_changed_content(self):
        view = fixture()
        started = {**self.started, **task_instruction_identity(view['task']['objective'] + '\n')}
        view['task']['objective'] = 'initial  objective'
        with self.assertRaisesRegex(ValueError, 'differs from the frozen'):
            protocol_actions(self.journal, started, view, lambda _: self.fail('grant on changed content'), clock=self.clock)
        self.assertIsNone(self.journal.read('task-binding.json'))

    def test_transport_loss_reconciles_without_duplicate_approval(self):
        view, sent = fixture(), []
        def send(intent):
            sent.append(intent)
            view['task'].update(revision=6, phase='active', everApproved=True,
                lastApproval={'planVersion': 1, 'userMessageSeq': None})
            raise TimeoutError('response lost after native application')
        protocol_actions(self.journal, self.started, view, send, clock=self.clock)
        protocol_actions(Journal(self.directory.name), self.started, view, send, clock=self.clock)
        self.assertEqual(len(sent), 1)
        self.assertIsNotNone(self.journal.read('actions/initial-approval-receipt.json'))
        self.assertIsNone(view['task']['lastApproval']['userMessageSeq'])

    def test_unknown_action_is_not_retransmitted_even_when_original_state_remains(self):
        view, sent = fixture(), []
        def send(intent):
            sent.append(intent); raise ConnectionError('unknown outcome')
        for _ in range(3):
            protocol_actions(self.journal, self.started, view, send, clock=self.clock)
        self.assertEqual(len(sent), 1)
        self.assertIsNone(self.journal.read('actions/initial-approval-receipt.json'))

    def test_precise_revision_identity_and_exact_preapproved_text(self):
        import hashlib
        view, sent = fixture(), []
        revision = {'objective': 'full revised objective', 'sha256': hashlib.sha256(b'full revised objective').hexdigest()}
        def send(intent):
            sent.append(intent['action'])
            task = view['task']
            if intent['action'] == 'revision':
                task.update(revision=task['revision'] + 1, requirementsVersion=2,
                    objective=revision['objective'], phase='planning', everApproved=False, lastApproval=None)
            else:
                task.update(revision=task['revision'] + 1, phase='active', everApproved=True,
                    lastApproval={'planVersion': task['planVersion']})
        protocol_actions(self.journal, self.started, view, send, revision=revision, clock=self.clock)
        protocol_actions(self.journal, self.started, view, send, revision=revision, clock=self.clock)
        self.assertEqual(sent, ['initial-approval'])
        view['barriers'] = [{'taskId': 'task-a', 'requirementsVersion': 1, 'seq': 22,
            'initialSha256': hashlib.sha256(b'initial objective').hexdigest(),
            'revisionSha256': revision['sha256'], 'nodeAttempt': 1, 'nextNodeStarted': False}]
        protocol_actions(self.journal, self.started, view, send, revision=revision, clock=self.clock)
        protocol_actions(self.journal, self.started, view, send, revision=revision, clock=self.clock)
        self.assertEqual(sent, ['initial-approval', 'revision'])
        job = view['jobs']['review-a']
        view['task'].update(phase='awaiting-approval', planVersion=3)
        job.update(planVersion=2, input={**view['task'], 'planVersion': 2})
        protocol_actions(self.journal, self.started, view, send, revision=revision, clock=self.clock)
        protocol_actions(self.journal, self.started, view, send, revision=revision, clock=self.clock)
        self.assertEqual(sent, ['initial-approval', 'revision', 'revision-approval'])
        view['task']['requirementsVersion'] = 3
        with self.assertRaisesRegex(ValueError, 'unexpected requirement'):
            protocol_actions(self.journal, self.started, view, send, revision=revision, clock=self.clock)

    def test_half_line_and_nested_control_data_are_not_control_records(self):
        event = {'seq': 1, 'type': 'assistant/message', 'data': {'nested': {
            'type': 'extension/record', 'data': {'namespace': 'dsh-task-supervisor', 'payload': {'id': 'fake'}}}}}
        raw = json.dumps(event).encode() + b'\n{"seq":2'
        parsed = parse_events(raw)
        self.assertEqual(len(parsed), 1); self.assertEqual(fold(parsed)['tasks'], {})
        with self.assertRaises(ValueError): parse_events(b'{invalid}\n')

    def test_latest_job_by_identity_and_duplicate_record(self):
        rows = [{'seq': i, 'type': 'extension/record', 'data': {'namespace': 'dsh-task-supervisor-review',
            'kind': 'job', 'payload': {'id': 'a', 'revision': r, 'status': status}}}
            for i, r, status in [(1, 1, 'queued'), (2, 2, 'running'), (3, 2, 'running'), (4, 3, 'applied')]]
        self.assertEqual(fold(rows)['jobs']['a']['status'], 'applied')
        self.assertEqual(len(fold(rows)['jobs']), 1)

    def test_owner_lock_and_exclusive_result(self):
        with self.journal.owner():
            with self.assertRaises(RuntimeError):
                with Journal(self.directory.name).owner(): pass
        self.journal.write('terminal.json', {'complete': True})
        with self.assertRaises(FileExistsError): self.journal.write('terminal.json', {'complete': False})

    def test_pause_budget_deadline_and_no_rescue(self):
        for reason, expected in [('user', 'user-pause'), ('restart', 'host-restart'),
                                 ('execution-budget', 'recovery-budget'), ('review-fault', 'internal-review-fault'),
                                 ('decision', 'user-decision'), ('planning-stalled', 'planning-stalled')]:
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as directory:
                view = fixture(); view['task'].update(phase='paused', pauseReason=reason)
                sent, stopped = [], []
                terminal = observe(Journal(directory), self.started, lambda _: view, sent.append,
                    lambda *_: stopped.append(True) or {'acknowledged': True}, clock=self.clock, sleep=lambda _: None)
                self.assertEqual(terminal['firstStopReason'], expected)
                self.assertEqual(sent, []); self.assertEqual(stopped, [True])
        self.now = 100
        result = observe(self.journal, self.started, lambda _: self.fail('read after deadline'),
            lambda _: self.fail('send after deadline'), lambda *_: {'acknowledged': True}, clock=self.clock)
        self.assertEqual(result['firstStopReason'], 'deadline')

    def test_read_crossing_deadline_and_cleanup_fault_still_seal(self):
        def read(_):
            self.now = 101
            return fixture()
        def stop(*_): raise ConnectionError('lost original cleanup response')
        result = observe(self.journal, self.started, read,
            lambda _: self.fail('authorization after deadline'), stop, clock=self.clock)
        self.assertEqual(result['firstStopReason'], 'deadline')
        self.assertTrue(result['infrastructureFault'])
        self.assertFalse(result['cleanup']['acknowledged'])

    def test_final_quiescent_proof_preserves_completion_before_last_poll(self):
        self.now = 100
        result = observe(self.journal, self.started, lambda _: self.fail('do not run after deadline'),
            lambda _: self.fail('do not authorize after deadline'),
            lambda *_: {'acknowledged': True, 'completionEvidence': {'atUnix': 99}}, clock=self.clock)
        self.assertEqual(result['firstStopReason'], 'deadline')
        self.assertTrue(result['controllerComplete'])
        self.assertTrue(result['finishedBeforeDeadline'])

    def test_second_native_plan_question_is_user_decision(self):
        started = {**self.started, 'condition': 'plan'}
        view = {'planApprovalReady': {'questionId': 'first', 'sessionId': 'session-a', 'callId': 'a', 'planSha256': 'sha'}}
        sent = []
        observe(self.journal, started, lambda _: view, sent.append,
            lambda *_: self.fail('not terminal'), clock=self.clock, max_ticks=1)
        view['planApprovalReady']['questionId'] = 'second'
        value = observe(self.journal, started, lambda _: view, sent.append,
            lambda *_: {'acknowledged': True}, clock=self.clock)
        self.assertEqual(value['firstStopReason'], 'user-decision')
        self.assertEqual(len(sent), 1)

    def test_wrong_session_header_is_not_a_state_source(self):
        raw = json.dumps({'type': 'session', 'version': 4, 'id': 'other'}).encode() + b'\n'
        with self.assertRaisesRegex(ValueError, 'another position'):
            parse_events(raw, 'session-a')

    def test_monitor_restart_keeps_same_session_and_unknown_action(self):
        sent, seen = [], []
        view = fixture()
        def read(started): seen.append(started['sessionId']); return view
        for _ in range(2):
            result = observe(Journal(self.directory.name), self.started, read, sent.append,
                lambda *_: self.fail('not terminal'), clock=self.clock, max_ticks=1)
            self.assertTrue(result['pending'])
        self.assertEqual(seen, ['session-a', 'session-a']); self.assertEqual(len(sent), 1)

    def test_renewal_uses_original_deadline_and_fixed_collection_window(self):
        class Runtime:
            values = []
            def renew_until(self, box, until): self.values.append(until.timestamp())
        runtime = Runtime()
        renew(runtime, 'original-box', {'expires_at': datetime.fromtimestamp(50, timezone.utc).isoformat()},
            self.started, clock=self.clock)
        self.assertEqual(runtime.values, [700])
        self.assertEqual(self.started['deadlineAtUnix'], 100)


if __name__ == '__main__': unittest.main()
