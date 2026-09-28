"""Join native HTTP observations with durable main/reviewer Session records."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
from metrics import read_home

PROVIDER = "deepseek-codebuddy"
MODEL = "deepseek-v4.1-flash"


def compare_daily_route(daily_config, isolated_config):
    """Check only the documented host-to-Docker endpoint mapping and first model."""
    daily = daily_config["providers"][PROVIDER]
    isolated = isolated_config["providers"][PROVIDER]
    source = urlsplit(daily["baseURL"])
    target = urlsplit(isolated["baseURL"])
    equivalent = (source.hostname in ("127.0.0.1", "localhost")
                  and target.hostname == "host.docker.internal"
                  and source.scheme == target.scheme == "http" and source.port == target.port
                  and source.path.rstrip("/") == target.path.rstrip("/")
                  and not source.query and not target.query and not source.username and not target.username)
    model_fields = ("id", "contextWindow", "maxTokens", "input")
    models_equal = all(daily["models"][0].get(field) == isolated["models"][0].get(field) for field in model_fields)
    return {"provider": PROVIDER, "model": daily["models"][0]["id"],
            "dailyEffectiveRouteMatched": equivalent and daily.get("api") == isolated.get("api") == "openai-completions"
                and daily.get("apiKeyEnv") == isolated.get("apiKeyEnv") == "DEEPSEEK_CODEBUDY_API_KEY"
                and models_equal and daily["models"][0]["id"] == MODEL,
            "endpointMapping": "daily-loopback-to-docker-host; same scheme, port and provider path"}


def summarize_session(session_id, records, audit):
    """Count completed native streams, matched HTTP responses and durable answers."""
    calls = {}
    for row in audit:
        if row.get("sessionId") == session_id:
            calls.setdefault(row["callId"], []).append(row)
    successful = []
    for call_id, rows in calls.items():
        finishes = [row for row in rows if row["type"] == "model-finish"]
        responses = [row for row in rows if row["type"] == "http-response"]
        ends = [row for row in rows if row["type"] == "model-end"]
        if (all(row.get("provider") == PROVIDER and row.get("model") == MODEL for row in rows)
                and any(row.get("finishKind") in ("stop", "tool-calls") for row in finishes)
                and any(row.get("endpointMatched") is True and 200 <= row.get("statusCode", 0) < 300 for row in responses)
                and any(row.get("exhausted") is True for row in ends)
                and not any(row["type"] in ("model-error", "http-error") for row in rows)):
            successful.append(call_id)
    answers = [row for row in records if row.get("type") == "assistant/message"
               and row.get("data", {}).get("interrupted") is not True
               and row.get("data", {}).get("message", {}).get("source", {}).get("provider") == PROVIDER
               and row.get("data", {}).get("message", {}).get("source", {}).get("model") == MODEL]
    mismatches = sum(row.get("provider") != PROVIDER or row.get("model") != MODEL
                     or row["type"] in ("http-request", "http-response") and row.get("endpointMatched") is not True
                     for rows in calls.values() for row in rows)
    usage = [row["data"]["usage"] for row in records if row.get("type") == "assistant/message"
             and isinstance(row.get("data", {}).get("usage"), dict)]
    samples = []
    for call_id in successful[:3]:
        response = next(row for row in calls[call_id] if row["type"] == "http-response" and row.get("endpointMatched") is True
                        and 200 <= row.get("statusCode", 0) < 300)
        samples.append({"localCallIdSha256": hashlib.sha256(call_id.encode()).hexdigest(),
                        "localHttpIdSha256": hashlib.sha256(str(response.get("httpId", "")).encode()).hexdigest(),
                        "endpointSha256": response.get("endpointSha256"),
                        "providerRequestIds": response.get("providerRequestIds", []), "statusCode": response["statusCode"]})
    observed = [row for rows in calls.values() for row in rows]
    http_requests = sum(row["type"] == "http-request" for row in observed)
    return {"sessionId": session_id, "modelRequests": len(calls), "successfulRequests": len(successful),
            "routeMismatchCount": mismatches, "durableAssistantCount": len(answers), "usage": usage,
            "successfulRequestEvidence": samples,
            "actualHttpRequests": http_requests,
            "routesMatched": bool(http_requests and not mismatches),
            "allObservedIntended": bool(calls and http_requests and not mismatches),
            "protocolDeviation": mismatches > 0,
            "routeStatus": "mismatch" if mismatches else "matched" if http_requests else "unverified",
            "httpStatusCounts": dict(Counter(str(row["statusCode"]) for row in observed if row["type"] == "http-response")),
            "finishKindCounts": dict(Counter(row["finishKind"] for row in observed if row["type"] == "model-finish")),
            "transportErrorTypeCounts": dict(Counter(row["errorType"] for row in observed if row["type"] == "http-error")),
            "successfulRequestAndDurableAnswer": bool(successful and answers and not mismatches)}


def inspect_chain(main_id, sessions, audit, condition="supervisor-log"):
    """Only accept reviewers named by this main Session's durable review jobs."""
    main = sessions[main_id]
    jobs = {}
    for row in main:
        if row.get("type") == "extension/record" and row.get("data", {}).get("namespace") == "dsh-task-supervisor-review":
            job = row["data"]["payload"]
            if job.get("mainSessionId") != main_id:
                raise ValueError("Review record belongs to another main Session")
            jobs[job["id"]] = job
    reviewers = []
    for job in jobs.values():
        reviewer_id = job.get("reviewerSessionId")
        if not reviewer_id or reviewer_id not in sessions:
            continue
        child = sessions[reviewer_id]
        summary = summarize_session(reviewer_id, child, audit)
        header = next((row for row in child if row.get("type") == "session"), {})
        decision_seq = (job.get("decision") or {}).get("decisionSeq")
        decision = next((row for row in child if row.get("seq") == decision_seq), {})
        message = decision.get("data", {}).get("message", {})
        call_id = message.get("source", {}).get("callId")
        decision_call = next((row for row in child if row.get("type") == "tool/call"
                             and row.get("data", {}).get("callId") == call_id
                             and row.get("seq", -1) < decision_seq), {}) if decision_seq is not None else {}
        summary.update({"jobId": job["id"], "kind": job["kind"], "cutoff": job["cutoff"],
                        "jobStatus": job["status"], "parentMatched": header.get("parentSession") == main_id
                            and header.get("origin") == "subagent",
                        "decisionRecorded": job.get("status") in ("submitted", "applied") and decision.get("type") == "tool/result"
                            and decision_call.get("data", {}).get("name") == "task_review_decision"
                            and message.get("isError") is False,
                        "independent": "verification" in job,
                        "successfulIndependentChecks": sum(check.get("exitCode") == 0 and not check.get("timedOut")
                            and not check.get("cancelled") for check in job.get("verification", {}).get("checks", []))})
        reviewers.append(summary)
    main_summary = summarize_session(main_id, main, audit)
    valid = [row for row in reviewers if row["successfulRequestAndDurableAnswer"] and row["parentMatched"] and row["decisionRecorded"]]
    family = {main_id}
    while True:
        children = {session_id for session_id, records in sessions.items() if records and records[0].get("origin") == "subagent"
                    and records[0].get("parentSession") in family}
        if children.issubset(family):
            break
        family.update(children)
    reviewer_ids = {row["sessionId"] for row in reviewers}
    additional = [summarize_session(session_id, sessions[session_id], audit) for session_id in sorted(family - reviewer_ids - {main_id})]
    all_summaries = [main_summary, *reviewers, *additional]
    return {"main": main_summary, "reviewers": reviewers,
            "additionalSessions": additional,
            "routesMatched": all(row["routesMatched"] for row in all_summaries if row["modelRequests"] > 0) and main_summary["routesMatched"],
            "allObservedIntended": all(row["allObservedIntended"] for row in all_summaries if row["modelRequests"] > 0) and main_summary["allObservedIntended"],
            "protocolDeviation": any(row["protocolDeviation"] for row in all_summaries),
            "decisionVerified": bool(valid),
            "stageReviewVerified": any(row["kind"] == "stage" for row in valid),
            "completionReviewVerified": any(row["kind"] == "completion" for row in valid),
            "independentCheckVerified": any(row["independent"] and row["successfulIndependentChecks"] > 0 for row in valid),
            "condition": condition,
            "passed": main_summary["successfulRequestAndDurableAnswer"] and not any(row["protocolDeviation"] for row in all_summaries)
                and (bool(valid) if condition.startswith("supervisor-") else True)}


def build_gate(chains, daily, evidence):
    """Require both real Supervisor modes, including stage and completion decisions."""
    expected = {"supervisor-log", "supervisor-independent"}
    complete = set(chains) == expected
    values = list(chains.values())
    checks = {
        "mainSuccessfulRequest": complete and all(row["main"]["successfulRequestAndDurableAnswer"] for row in values),
        "reviewerSuccessfulRequest": complete and all(any(review["successfulRequestAndDurableAnswer"]
            for review in row["reviewers"]) for row in values),
        "dailyEffectiveRouteMatched": daily.get("dailyEffectiveRouteMatched") is True,
        "supervisorBothModes": complete and all(row["stageReviewVerified"] and row["completionReviewVerified"] for row in values),
        "actualHttpEndpointMatched": complete and all(row["routesMatched"] and row["allObservedIntended"] for row in values),
        "durableLineageMatched": complete and all(any(review["parentMatched"] and review["successfulRequestAndDurableAnswer"]
            for review in row["reviewers"]) for row in values),
        "independentReviewerCheckExecuted": complete and chains["supervisor-independent"]["independentCheckVerified"],
    }
    return {"schemaVersion": 1, "kind": "model-route-gate", "passed": all(checks.values()), "checks": checks,
            "benchmarkModelAttempts": 0, "smokeConditions": sorted(chains), "evidence": evidence}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("home", type=Path)
    parser.add_argument("main_session_id")
    parser.add_argument("audit", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--kind", choices=("gate-calibration", "formal-model-attempt"), default="gate-calibration")
    parser.add_argument("--condition", choices=("goal", "plan", "supervisor-log", "supervisor-independent"), default="supervisor-log")
    args = parser.parse_args()
    sessions, _, hashes = read_home(args.home)
    audit = [json.loads(line) for line in args.audit.read_text().splitlines() if line]
    result = inspect_chain(args.main_session_id, sessions, audit, args.condition)
    result.update({"schemaVersion": 1, "kind": "actual-model-route-chain", "runKind": args.kind, "evidence": hashes,
                   "auditSha256": hashlib.sha256(args.audit.read_bytes()).hexdigest(),
                   "benchmarkModelAttempts": 1 if args.kind == "formal-model-attempt" else 0})
    with args.output.open("x") as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
        file.write("\n")
    print(json.dumps({"passed": result["passed"], "mainSessionId": args.main_session_id, "reviewerCount": len(result["reviewers"])}))


if __name__ == "__main__":
    main()
