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
    return [{**common, "type": "model-start"}, {**common, "type": "http-request", "endpointMatched": endpoint},
            {**common, "type": "http-response", "endpointMatched": endpoint, "statusCode": 200},
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


def independent_fixture():
    sessions, rows = fixture()
    job = sessions["main"][-1]["data"]["payload"]
    job.update({"kind": "stage", "status": "failed", "fault": {"code": "internal-timeout"}, "attempt": 2, "repairLimit": 1,
                "verification": {"snapshot": {"id": "snapshot"}, "checks": [{"id": "check", "snapshotId": "snapshot", "exitCode": 0,
                    "signal": None, "timedOut": False, "cancelled": False, "outputIncomplete": False, "changed": []}]}})
    sessions["review"].extend([
        {"type": "tool/call", "seq": 8, "data": {"callId": "check-call", "name": "run_review_check"}},
        {"type": "tool/result", "seq": 9, "data": {"message": {"source": {"callId": "check-call"}, "isError": False,
            "content": [{"type": "text", "text": json.dumps({"id": "check", "snapshotId": "snapshot", "exitCode": 0})}]}}},
    ])
    return sessions, rows


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
        independent = inspect_chain("main", sessions, rows, "supervisor-independent")
        gate = build_gate({"supervisor-log": chain, "supervisor-independent": independent}, daily, [])
        self.assertFalse(gate["passed"])
        self.assertTrue(gate["checks"]["supervisorBothModes"])
        self.assertFalse(gate["checks"]["independentReviewerCheckExecuted"])
        self.assertFalse(build_gate({"supervisor-log": chain, "supervisor-independent": chain}, daily, [])["checks"]["supervisorBothModes"])

    def test_http_200_is_not_successful_generation(self):
        for finish in ("error", "aborted", "max-tokens"):
            self.assertFalse(summarize_session("main", [answer()], audit("main", finish))["successfulRequestAndDurableAnswer"])

    def test_provider_failure_is_not_route_deviation(self):
        rows = audit("main", "error")
        next(row for row in rows if row["type"] == "http-response")["statusCode"] = 502
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

    def test_failed_or_unbound_decision_is_not_a_route_failure(self):
        sessions, rows = fixture()
        for mutation in ("failed", "wrong-call"):
            changed = copy.deepcopy(sessions)
            if mutation == "failed":
                changed["review"][-1]["data"]["message"]["isError"] = True
            else:
                changed["review"][-2]["data"]["name"] = "read_task_evidence"
            report = inspect_chain("main", changed, rows)
            self.assertTrue(report["passed"])
            self.assertFalse(report["decisionVerified"])

    def test_correct_routes_with_review_timeout_admit_instrumentation_not_performance(self):
        log_sessions, log_rows = fixture()
        sessions, rows = independent_fixture()
        chain = inspect_chain("main", sessions, rows, "supervisor-independent")
        self.assertTrue(chain["independentCheckVerified"])
        self.assertFalse(chain["stageReviewVerified"])
        self.assertFalse(chain["completionReviewVerified"])
        gate = build_gate({"supervisor-log": inspect_chain("main", log_sessions, log_rows), "supervisor-independent": chain},
                          {"dailyEffectiveRouteMatched": True}, [])
        self.assertTrue(gate["passed"])
        self.assertTrue(gate["checks"]["supervisorBothModes"])
        performance = gate["performanceEvidence"]["supervisor-independent"]
        self.assertFalse(performance["decisionVerified"])
        self.assertEqual(performance["reviewJobs"][0]["faultCode"], "internal-timeout")
        self.assertEqual(performance["reviewJobs"][0]["status"], "failed")
        self.assertEqual(performance["reviewJobs"][0]["protocolRecoveryCount"], 1)
        self.assertEqual(performance["reviewJobs"][0]["repairLimit"], 1)

    def test_independent_instrumentation_needs_actual_model_check_not_only_metadata(self):
        log_sessions, log_rows = fixture()
        for mutation in ("missing-tool", "failed-result", "foreign-snapshot", "incomplete", "modified"):
            sessions, rows = independent_fixture()
            if mutation == "missing-tool":
                sessions["review"][-2]["data"]["name"] = "read_task_evidence"
            elif mutation == "failed-result":
                sessions["review"][-1]["data"]["message"]["isError"] = True
            else:
                check = sessions["main"][-1]["data"]["payload"]["verification"]["checks"][0]
                if mutation == "foreign-snapshot":
                    check["snapshotId"] = "foreign"
                elif mutation == "incomplete":
                    check["outputIncomplete"] = True
                else:
                    check["changed"] = ["tree"]
            chain = inspect_chain("main", sessions, rows, "supervisor-independent")
            gate = build_gate({"supervisor-log": inspect_chain("main", log_sessions, log_rows), "supervisor-independent": chain},
                              {"dailyEffectiveRouteMatched": True}, [])
            self.assertFalse(gate["passed"], mutation)
            self.assertFalse(gate["checks"]["independentReviewerCheckExecuted"], mutation)

    def test_no_actual_request_foreign_lineage_or_endpoint_mismatch_do_not_admit(self):
        log_sessions, log_rows = fixture()
        for mutation in ("no-request", "foreign-lineage", "wrong-endpoint"):
            sessions, rows = independent_fixture()
            if mutation == "no-request":
                rows = [row for row in rows if row["type"] != "http-request"]
            elif mutation == "foreign-lineage":
                sessions["review"][0]["parentSession"] = "foreign"
            else:
                for row in rows:
                    if row["sessionId"] == "review" and row["type"] in ("http-request", "http-response"):
                        row["endpointMatched"] = False
            chain = inspect_chain("main", sessions, rows, "supervisor-independent")
            gate = build_gate({"supervisor-log": inspect_chain("main", log_sessions, log_rows), "supervisor-independent": chain},
                              {"dailyEffectiveRouteMatched": True}, [])
            self.assertFalse(gate["passed"], mutation)

    def test_observed_response_without_request_is_not_success(self):
        rows = [row for row in audit("main") if row["type"] != "http-request"]
        self.assertFalse(summarize_session("main", [answer()], rows)["successfulRequestAndDurableAnswer"])


if __name__ == "__main__":
    unittest.main()
