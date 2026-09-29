import copy
import hashlib
from pathlib import Path
import tempfile
import unittest

from control_flow import observe
from native_stop import admitted_goal_driver, admitted_plan_mode, goal_stop_evidence, plan_stop_evidence


def fixture():
    goal = {'id': 'goal', 'revision': 1, 'phase': 'active'}
    events = [{'type': 'goal/change', 'seq': 1, 'data': {'goal': dict(goal)}},
              {'type': 'turn/end', 'seq': 2, 'time': 2000,
               'data': {'turn': 1, 'reason': {'kind': 'max-tokens'}}}]
    values = {'goal': {'current': {'goal': goal}},
              'sessionStats': {'lastTurn': 1, 'openStep': None, 'pendingCalls': {}},
              'turnBoundary': {'lastTurn': 1, 'openTurnStartSeq': None},
              'inbox': {'next-turn': [], 'next-step': []}}
    return events, values


def plan_fixture(active=True):
    events, values = fixture()
    del values['goal']
    values['plan'] = {'active': active, 'wanted': None, 'running': None}
    events[0] = {'type': 'plan/mode', 'seq': 1, 'data': {'active': active}}
    return events, values


class NativeStopTests(unittest.TestCase):
    def test_unsubmitted_plan_cannot_wait_out_an_ended_turn(self):
        events, values = plan_fixture()
        evidence = plan_stop_evidence(events, values, 'b' * 64)
        result = observe('plan', values, False, False, evidence)
        self.assertEqual(result['status'], 'native-stopped')
        self.assertFalse(result['nativeFinished'])
        self.assertTrue(evidence['planModeActive'])
        self.assertEqual(evidence['planModeSeq'], 1)
        self.assertEqual(observe('plan', values, True, False, evidence)['status'], 'running')

    def test_approved_plan_truncated_response_is_not_completion(self):
        events, values = plan_fixture(False)
        values['turnOutline'] = {'turns': [{'response': 'unfinished response'}]}
        evidence = plan_stop_evidence(events, values, 'b' * 64)
        self.assertEqual(observe('plan', values, False, True, evidence)['status'], 'native-stopped')
        self.assertEqual(observe('plan', values, False, True)['status'], 'native-complete')

    def test_pending_modes_questions_queues_and_changed_plan_prevent_stop(self):
        events, values = plan_fixture()
        mutations = [('plan', 'pending', True), ('plan', 'wanted', False), ('plan', 'running', {}),
                     ('plan', 'active', False), ('sessionStats', 'openStep', {}),
                     ('sessionStats', 'pendingCalls', {'question': {}}),
                     ('turnBoundary', 'openTurnStartSeq', 1), ('sessionStats', 'lastTurn', 2),
                     ('inbox', 'next-turn', [{}]), ('inbox', 'next-step', [{}])]
        for row, key, value in mutations:
            with self.subTest(row=row, key=key):
                changed = copy.deepcopy(values)
                changed[row][key] = value
                self.assertIsNone(plan_stop_evidence(events, changed, 'b' * 64))
        self.assertIsNone(plan_stop_evidence(events[1:], values, 'b' * 64))
        self.assertIsNone(plan_stop_evidence(events + [{'type': 'user/message'}], values, 'b' * 64))
        changed = copy.deepcopy(events)
        changed[-1]['data']['reason']['kind'] = 'complete'
        self.assertIsNone(plan_stop_evidence(changed, values, 'b' * 64))

    def test_plan_source_policy_requires_actual_frozen_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            runtime = Path(root)
            path = runtime / 'dsh-source/packages/plan/plan-mode/src/index.ts'
            path.parent.mkdir(parents=True)
            path.write_text('owned Plan fixture')
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(admitted_plan_mode(runtime, {'planModeSha256': sha}), sha)
            with self.assertRaises(ValueError):
                admitted_plan_mode(runtime, {'planModeSha256': 'a' * 64})
            with self.assertRaises(ValueError):
                admitted_plan_mode(runtime, {})

    def test_current_max_token_stop_is_not_running_or_success(self):
        events, values = fixture()
        evidence = goal_stop_evidence(events, values, 'a' * 64)
        self.assertEqual(evidence['nativeStoppedAtUnix'], 2)
        self.assertEqual(evidence['activationObservation'], 'source-policy-inference-not-persisted-state')
        result = observe('goal', values, False, True, evidence)
        self.assertEqual(result['status'], 'native-stopped')
        self.assertFalse(result['nativeFinished'])
        self.assertEqual(observe('goal', values, True, True, evidence)['status'], 'running')

    def test_active_tools_open_turn_and_queued_work_prevent_stop(self):
        events, values = fixture()
        mutations = [('sessionStats', 'openStep', 12), ('sessionStats', 'pendingCalls', {'call': {}}),
                     ('turnBoundary', 'openTurnStartSeq', 3), ('inbox', 'next-turn', [{}]),
                     ('inbox', 'next-step', [{}])]
        for row, key, value in mutations:
            with self.subTest(row=row, key=key):
                changed = copy.deepcopy(values)
                changed[row][key] = value
                self.assertIsNone(goal_stop_evidence(events, changed, 'a' * 64))

    def test_missing_or_stale_projection_and_resumed_goal_prevent_stop(self):
        events, values = fixture()
        for row, key, value in [('sessionStats', 'lastTurn', 2), ('turnBoundary', 'lastTurn', 2)]:
            changed = copy.deepcopy(values)
            changed[row][key] = value
            self.assertIsNone(goal_stop_evidence(events, changed, 'a' * 64))
        changed = copy.deepcopy(values)
        del changed['inbox']
        self.assertIsNone(goal_stop_evidence(events, changed, 'a' * 64))
        changed = copy.deepcopy(values)
        changed['goal']['current']['goal']['revision'] = 2
        self.assertIsNone(goal_stop_evidence(events, changed, 'a' * 64))

    def test_later_events_or_other_end_reasons_cannot_reuse_old_stop(self):
        events, values = fixture()
        for kind in ('complete', 'aborted', 'error'):
            changed = copy.deepcopy(events)
            changed[-1]['data']['reason']['kind'] = kind
            self.assertIsNone(goal_stop_evidence(changed, values, 'a' * 64))
        for kind in ('turn/start', 'user/message', 'goal/change'):
            self.assertIsNone(goal_stop_evidence(events + [{'type': kind, 'seq': 3}], values, 'a' * 64))

    def test_driver_policy_must_match_runtime_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            runtime = Path(root)
            path = runtime / 'dsh-source/packages/goal/goal-round-driver/src/index.ts'
            path.parent.mkdir(parents=True)
            path.write_text('owned fixture')
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(admitted_goal_driver(runtime, {'goalDriverSha256': sha}), sha)
            with self.assertRaises(ValueError):
                admitted_goal_driver(runtime, {'goalDriverSha256': 'a' * 64})
            with self.assertRaises(ValueError):
                admitted_goal_driver(runtime, {})


if __name__ == '__main__':
    unittest.main()
