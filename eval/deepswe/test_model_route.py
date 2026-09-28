"""False-positive guards for actual model route admission."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from model_route import build_gate, compare_daily_route, inspect_chain, summarize_session
from model_route import read_home


def audit(session_id, finish="stop", endpoint=True):
    common = {"sessionId": session_id, "callId": session_id + "-call", "provider": "deepseek-codebuddy", "model": "deepseek-v4.1-flash"}
    return [{**common, "type": "model-start"}, {**common, "type": "http-response", "endpointMatched": endpoint, "statusCode": 200},
            {**common, "type": "model-finish", "finishKind": finish}, {**common, "type": "model-end", "exhausted": True}]


def answer():
    return {"type": "assistant/message", "data": {"message": {"source": {"provider": "deepseek-codebuddy", "model": "deepseek-v4.1-flash"}}}}


def fixture():
    child = [{"type": "session", "id": "review", "parentSession": "main", "origin": "subagent"}, answer(),
             {"type": "tool/call", "seq": 5, "data": {"callId": "decision", "name": "task_review_decision"}},
             {"type": "tool/result", "seq": 6, "data": {"message": {"source": {"callId": "decision"}, "isError": False}}}]
    job = {"id": "job", "mainSessionId": "main", "reviewerSessionId": "review", "kind": "plan", "cutoff": 10,
           "status": "applied", "decision": {"decisionSeq": 6}}
    main = [answer(), {"type": "extension/record", "data": {"namespace": "dsh-task-supervisor-review", "payload": job}}]
    return {"main": main, "review": child}, audit("main") + audit("review")


class ActualRouteTests(unittest.TestCase):
    def test_newest_numeric_generation_and_duplicate_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            first = home / "sessions" / "main"
            first.mkdir(parents=True)
            def write(path, session_id):
                data = json.dumps({"type": "session", "id": session_id}).encode() + b"\n"
                subprocess.run(["zstd", "-q", "-o", str(path)], input=data, check=True, timeout=10)
            write(first / "session.v9.jsonl.zstd", "obsolete")
            write(first / "session.v10.jsonl.zstd", "current")
            sessions, _, hashes = read_home(home)
            self.assertEqual(set(sessions), {"current"})
            self.assertEqual(hashes[0]["relativePath"], "sessions/main/session.v10.jsonl.zstd")
            second = home / "sessions" / "duplicate"
            second.mkdir()
            write(second / "session.v4.jsonl.zstd", "current")
            with self.assertRaisesRegex(ValueError, "Duplicate native Session identity"):
                read_home(home)

    def test_explicit_daily_to_container_mapping(self):
        config = {"providers": {"deepseek-codebuddy": {"baseURL": "http://127.0.0.1:15721/tencent/v1", "api": "openai-completions",
                   "apiKeyEnv": "DEEPSEEK_CODEBUDY_API_KEY", "models": [{"id": "deepseek-v4.1-flash", "maxTokens": 32000}]}}}
        target = copy.deepcopy(config)
        target["providers"]["deepseek-codebuddy"]["baseURL"] = "http://host.docker.internal:15721/tencent/v1"
        self.assertTrue(compare_daily_route(config, target)["dailyEffectiveRouteMatched"])
        target["providers"]["deepseek-codebuddy"]["baseURL"] = "http://host.docker.internal:15721/v1"
        self.assertFalse(compare_daily_route(config, target)["dailyEffectiveRouteMatched"])

    def test_complete_native_chain(self):
        sessions, rows = fixture()
        self.assertTrue(inspect_chain("main", sessions, rows)["passed"])

    def test_native_baselines_need_no_reviewer(self):
        for condition in ("goal", "plan"):
            self.assertTrue(inspect_chain("main", {"main": [answer()]}, audit("main"), condition)["passed"])
        self.assertFalse(inspect_chain("main", {"main": [answer()]}, audit("main"), "supervisor-log")["passed"])

    def test_plan_only_and_missing_second_mode_do_not_admit(self):
        sessions, rows = fixture()
        chain = inspect_chain("main", sessions, rows)
        daily = {"dailyEffectiveRouteMatched": True}
        self.assertFalse(build_gate({"supervisor-log": chain}, daily, [])["passed"])
        gate = build_gate({"supervisor-log": chain, "supervisor-independent": chain}, daily, [])
        self.assertFalse(gate["passed"])
        self.assertFalse(gate["checks"]["supervisorBothModes"])
        self.assertFalse(gate["checks"]["independentReviewerCheckExecuted"])

    def test_http_200_is_not_successful_generation(self):
        for finish in ("error", "aborted", "max-tokens"):
            self.assertFalse(summarize_session("main", [answer()], audit("main", finish))["successfulRequestAndDurableAnswer"])

    def test_provider_failure_is_not_route_deviation(self):
        rows = audit("main", "error")
        rows[1]["statusCode"] = 502
        rows[1]["type"] = "http-response"
        rows.insert(1, {**rows[0], "type": "http-request", "endpointMatched": True})
        report = summarize_session("main", [], rows)
        self.assertTrue(report["routesMatched"])
        self.assertFalse(report["protocolDeviation"])
        self.assertFalse(report["successfulRequestAndDurableAnswer"])

    def test_failed_wrong_model_request_is_still_detected(self):
        good = audit("main")
        failed = audit("main", "error")
        for row in failed:
            row["callId"] = "bad-call"
            row["model"] = "wrong-model"
        report = summarize_session("main", [answer()], good + failed)
        self.assertTrue(report["protocolDeviation"])
        self.assertFalse(report["successfulRequestAndDurableAnswer"])

    def test_wrong_endpoint_and_selected_only_are_rejected(self):
        self.assertFalse(summarize_session("main", [answer()], audit("main", endpoint=False))["successfulRequestAndDurableAnswer"])
        self.assertFalse(summarize_session("main", [answer()], [])["successfulRequestAndDurableAnswer"])

    def test_unrelated_reviewer_does_not_count(self):
        sessions, rows = fixture()
        sessions["review"][0]["parentSession"] = "other"
        self.assertFalse(inspect_chain("main", sessions, rows)["passed"])

    def test_failed_or_unbound_decision_is_rejected(self):
        sessions, rows = fixture()
        for mutation in ("failed", "wrong-call"):
            changed = copy.deepcopy(sessions)
            if mutation == "failed":
                changed["review"][-1]["data"]["message"]["isError"] = True
            else:
                changed["review"][-2]["data"]["name"] = "read_task_evidence"
            self.assertFalse(inspect_chain("main", changed, rows)["passed"])


if __name__ == "__main__":
    unittest.main()
