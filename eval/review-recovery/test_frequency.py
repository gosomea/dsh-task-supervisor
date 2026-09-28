"""P2 admission and ordering regressions; never launch models or Docker."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("frequency", Path(__file__).with_name("run_frequency.py"))
frequency = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frequency)


class FrequencyTest(unittest.TestCase):
    def test_paired_schedule_has_exactly_one_of_each_condition(self):
        protocol = json.loads(Path(__file__).with_name("frequency-p2-protocol.json").read_text())
        rows = frequency.paired_order(protocol)
        self.assertEqual(len(rows), 60)
        self.assertEqual(rows, frequency.paired_order(protocol))
        for offset in range(0, 60, 5):
            group = rows[offset:offset + 5]
            self.assertEqual(len({(r["taskId"], r["repeat"]) for r in group}), 1)
            self.assertEqual(len({r["condition"] for r in group}), 5)
            self.assertEqual([r["rank"] for r in group], sorted(r["rank"] for r in group))

    def test_native_terminal_is_read_instead_of_cli_exit(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "monitor.log"
            path.write_text('diagnostic\n{"status":"running"}\n{"status":"time-limit","limitSec":3000}\n')
            self.assertEqual(frequency.parse_monitor(path)["status"], "time-limit")

    def test_cli_success_cannot_mask_verifier_exception(self):
        with tempfile.TemporaryDirectory() as folder:
            job = Path(folder) / "job"; job.mkdir()
            (job / "result.json").write_text('{"stats":{"n_errored_trials":1}}')
            with patch.object(frequency, "read_trial", return_value=(1.0, None)):
                row = frequency.grade(Path(folder), job, Path(folder), "oracle", job / "log", {})
            self.assertIsNone(row["reward"])
            self.assertIsNotNone(row["infrastructureError"])

    def test_unscored_control_does_not_admit_model_attempt(self):
        with tempfile.TemporaryDirectory() as folder:
            from types import SimpleNamespace
            root = Path(folder)
            protocol = {"tasks": [{"id": "test"}]}
            row = {"taskId": "test", "repeat": 1, "arm": "goal", "condition": "goal"}
            with patch.object(frequency, "run", side_effect=AssertionError("no processes allowed")):
                result = frequency.attempt(SimpleNamespace(root=root), protocol, row, {"eligible": False}, {})
            self.assertEqual(result["status"], "ineligible")
            self.assertIsNone(result["primarySuccess"])

    def test_incomplete_attempt_refuses_duplicate_agent(self):
        with tempfile.TemporaryDirectory() as folder:
            from types import SimpleNamespace
            root = Path(folder)
            out = root / "attempts/p2-t1-r1-goal"; out.mkdir(parents=True)
            (out / "started.json").write_text('{}')
            row = {"taskId": "test", "repeat": 1, "arm": "goal", "condition": "goal"}
            with self.assertRaisesRegex(RuntimeError, "reconciliation"):
                frequency.attempt(SimpleNamespace(root=root), {"tasks": [{"id": "test"}]}, row, {"eligible": True}, {})


if __name__ == "__main__":
    unittest.main()
