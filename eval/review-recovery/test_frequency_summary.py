"""Protect denominator and uncertainty reporting without model/Host access."""
import json
from pathlib import Path
import tempfile
import unittest
from summarize_frequency import summarize, cluster_interval


class SummaryTest(unittest.TestCase):
    def test_unknown_grade_and_unadmitted_error_are_not_model_failures(self):
        protocol = {"plannedAttempts": 4, "repeats": 2, "tasks": [{"id": "t1"}, {"id": "t2"}], "conditions": [{"id": "goal"}]}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "controls.json").write_text(json.dumps([{"taskId": "t1", "eligible": True}, {"taskId": "t2", "eligible": False}]))
            cases = [
                {"taskId": "t1", "repeat": 1, "admitted": True, "primarySuccess": None, "status": "grading-infrastructure-error"},
                {"taskId": "t1", "repeat": 2, "admitted": False, "primarySuccess": None, "status": "attempt-error"},
                {"taskId": "t2", "repeat": 1, "primarySuccess": None, "status": "ineligible"},
            ]
            for i, row in enumerate(cases):
                row.update(name=f"r{i}", condition="goal")
                p = root / "attempts" / row["name"]; p.mkdir(parents=True)
                (p / "result.json").write_text(json.dumps(row))
            result = summarize(root, protocol)["conditions"]["goal"]
            self.assertEqual(result["admitted"], 1)
            self.assertEqual(result["unknownPrimary"], 1)
            self.assertEqual(result["knownFailures"], 0)
            self.assertEqual(result["eligibleSlots"], 2)
            self.assertIsNone(result["primarySuccessRate"])
            self.assertEqual(result["admittedSuccessRateBounds"], [0, 1])
            self.assertIsNone(result["reviewWaitMsMeasured"])

    def test_cluster_interval_is_deterministic_and_degenerate_for_equal_tasks(self):
        self.assertIsNone(cluster_interval([1]))
        self.assertEqual(cluster_interval([1, 1, 1, 1]), [1, 1])
        self.assertEqual(cluster_interval([0, 1, 0, 1]), cluster_interval([0, 1, 0, 1]))


if __name__ == "__main__":
    unittest.main()
