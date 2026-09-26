#!/usr/bin/env python3
"""Check that the external scorer rejects a correct artifact without executed evidence."""

import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("long_horizon_eval", ROOT / "eval.py")
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def state(seq: int, revision: int, requirements: int, plan: int, phase: str,
          *, stage_pass: bool = False) -> dict:
    payload = {"objective": "count sum max", "revision": revision,
               "requirementsVersion": requirements, "planVersion": plan, "phase": phase}
    if stage_pass:
        payload.update({"stageIndex": 1, "lastReview": {"stageId": "stage-1", "verdict": "pass"}})
    return {"seq": seq, "type": "extension/record", "data": {"namespace": "dsh-task-supervisor",
            "payload": payload}}


def call(seq: int, call_id: str, command: str) -> dict:
    return {"seq": seq, "type": "tool/call", "data": {"callId": call_id, "name": "bash",
            "arguments": json.dumps({"command": command})}}


def result(seq: int, call_id: str, output: str, is_error: bool = False) -> dict:
    return {"seq": seq, "type": "tool/result", "data": {"message": {
        "isError": is_error, "source": {"callId": call_id},
        "content": [{"type": "text", "text": output}]}}}


class ScoreEvidenceTests(unittest.TestCase):
    def test_missing_and_failed_verifier_do_not_pass(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dsh-long-horizon-scorer-") as directory:
            workspace = Path(directory)
            shutil.copytree(ROOT / "fixtures/revision-and-evidence", workspace, dirs_exist_ok=True)
            (workspace / "analyze.mjs").write_text("// fixture\n")
            (workspace / "report.json").write_text('{"count":3,"sum":16,"max":8}\n')
            events = [state(1, 1, 1, 1, "active", stage_pass=True), state(5, 2, 2, 2, "planning"),
                      state(6, 3, 2, 3, "active"), call(7, "write", "node analyze.mjs"),
                      result(8, "write", "wrote report"), state(12, 4, 2, 3, "complete")]
            with self.assertRaisesRegex(AssertionError, "no successful verifier"):
                module.check_revision(workspace, events)
            events[5:5] = [call(9, "verify", "node verify.mjs"),
                           result(10, "verify", "verification failed", True)]
            with self.assertRaisesRegex(AssertionError, "no successful verifier"):
                module.check_revision(workspace, events)
            events[6] = result(10, "verify", "verification passed\nexit=0")
            self.assertTrue(module.check_revision(workspace, events)["passed"])
            events[5] = call(9, "verify", "cd /tmp/control && node verify.mjs")
            with self.assertRaisesRegex(AssertionError, "no successful verifier"):
                module.check_revision(workspace, events)
            events[5] = call(9, "verify", 'node verify.mjs; echo "exit=$?"')
            events[6] = result(10, "verify", "verification passed\nexit=1")
            with self.assertRaisesRegex(AssertionError, "no successful verifier"):
                module.check_revision(workspace, events)
            events[6] = result(10, "verify", "verification passed\nexit=0")
            early_revision = [state(1, 1, 1, 1, "active"), *events[1:]]
            with self.assertRaisesRegex(AssertionError, "did not follow the first passed stage"):
                module.check_revision(workspace, early_revision)
            completed_first = [events[0], state(3, 2, 1, 1, "complete"), *events[1:]]
            with self.assertRaisesRegex(AssertionError, "completed before the revision"):
                module.check_revision(workspace, completed_first)


if __name__ == "__main__":
    unittest.main()
