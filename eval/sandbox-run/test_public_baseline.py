"""Admission waits include SDK latency and cannot renew their deadline."""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest
from unittest.mock import Mock, patch

from public_baseline import ADMISSION_DEADLINE_MS, admit, wait_probe_result


class Clock:
    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class AdmissionBudgetTests(unittest.TestCase):
    def test_large_capture_can_finish_after_previous_180_second_fixture_limit(self):
        clock = Clock()
        runtime = Mock()

        def poll(*args, **kwargs):
            clock.sleep(4)
            return (0 if clock.now >= 250 else 1, '', '')

        runtime.exec.side_effect = poll
        wait_probe_result(runtime, 'same-box', timeout_s=ADMISSION_DEADLINE_MS / 1000 + 45,
                          monotonic=clock.monotonic, sleep=clock.sleep)
        self.assertGreater(clock.now, 180)
        runtime.create.assert_not_called()

    def test_slow_observation_does_not_extend_budget_or_accept_late_result(self):
        clock = Clock()
        runtime = Mock()

        def poll(*args, **kwargs):
            clock.sleep(6)
            return (0, '', '')

        runtime.exec.side_effect = poll
        with self.assertRaises(TimeoutError):
            wait_probe_result(runtime, 'same-box', timeout_s=5,
                              monotonic=clock.monotonic, sleep=clock.sleep)
        runtime.exec.assert_called_once()
        self.assertEqual(runtime.exec.call_args.kwargs['timeout_s'], 5)

    def test_default_budget_is_recorded_before_any_resource_or_model_delivery(self):
        runtime = Mock()
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            tarball = root / 'immutable.tgz'
            tarball.write_bytes(b'package')
            with patch('public_baseline.prepare_gateway', side_effect=RuntimeError('controlled refusal')):
                with self.assertRaisesRegex(RuntimeError, 'controlled refusal'):
                    admit(runtime, candidate={'id': 'fixture', 'baseCommit': 'base'}, image='image',
                          tarball=tarball, probe=root/'probe', admin_image='admin', context='test', out=root/'receipt')
            intent = json.loads((root/'receipt/intent.json').read_text())
            self.assertEqual(intent['admissionDeadlineMs'], 600000)
            self.assertEqual(intent['modelRequests'], 0)
            runtime.create.assert_not_called()

    def test_unbounded_or_invalid_budget_is_rejected_before_intent(self):
        for value in [True, 0, -1, 600001, 600000.0]:
            with self.subTest(value=value), TemporaryDirectory() as temporary:
                root = Path(temporary)
                with self.assertRaises(ValueError):
                    admit(Mock(), candidate={}, image='image', tarball=root/'missing', probe=root/'probe',
                          admin_image='admin', context='test', out=root/'receipt', deadline_ms=value)
                self.assertFalse((root/'receipt').exists())


if __name__ == '__main__':
    unittest.main()
