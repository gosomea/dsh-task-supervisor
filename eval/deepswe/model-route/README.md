---
description: "Transparent HTTP observation, Session attribution and actual model-route admission."
kind: "scratch"
---

# Actual request routing

`route-audit.mjs` is an evaluation Cordis overlay used by admission smokes and the frozen formal batch of 16. It forwards the public `llm/stream` waterfall without changing request options or chunks, and associates native streams with Node `undici` HTTP diagnostics. It records Session identity, endpoint hashes and matches, response status and completion kind. It changes no DSH core code and adds no model-visible tools or messages. Request/response bodies, authentication URLs and raw headers are not saved. Provider `x-request-id` or `request-id` values are hashed when present; absent values remain an empty list. Locally generated call/HTTP IDs are not provider request IDs.

Each Host exclusively creates a new audit path. An existing path causes loading to fail. The administrator checks `config.endpoint` against the daily CodeBuddy chat-completions endpoint; this configuration stays outside Git. Daily comparison permits the explicit loopback-to-`host.docker.internal` mapping while requiring the same scheme, port, path, API, credential reference and first-model parameters. Both the observer and its actual endpoint configuration belong in the release inventory. Missing HTTP observations cannot be replaced by model-selection evidence.

`model_route.py` uses shared `metrics.read_home` to select the highest numeric Session generation in each directory and reject duplicate identities. Successful generation requires an actual HTTP request, matching-endpoint HTTP 2xx, normal `stop` or `tool-calls`, an exhausted stream and matching durable assistant provenance. A reviewer additionally needs a durable main-Session review job and matching parent. A successful `task_review_decision` tool result establishes a valid decision separately from route success. HTTP 200 alone, profile selection, unrelated subagents and natural-language approval are insufficient. The compatibility field `supervisorBothModes` checks actual main/reviewer requests and parentage in both modes. Independent mode additionally binds a model `run_review_check` call and successful result to a durable snapshot-check record. Review timeouts, missing decisions and absent completion reviews remain performance outcomes; they do not prevent correctly instrumented conditions from entering the formal comparison.

```sh
python3 -m unittest discover -s eval/deepswe -p test_model_route.py -v
node --test eval/deepswe/model-route/route-audit.test.mjs
python3 eval/deepswe/model_route.py PRIVATE_HOME MAIN_SESSION PRIVATE_AUDIT NEW_SAFE_OUTPUT
```

Formal positions use `--kind formal-model-attempt --condition CONDITION`. The default `gate-calibration` is excluded from the 16 positions. Goal/Plan require real primary requests; Supervisor conditions also record their genuine review chains. Each position exclusively writes its own posterior evidence. Failed requests without confirmed provider usage have unknown cost.

Python regressions reject route mismatch, wrong parents, missing actual HTTP requests and unbound independent checks. Failed decisions remain separate performance outcomes. The Node test uses a local HTTP server to prove diagnostic association, redaction and unchanged forwarding; it does not replace real requests. The controller owns delivery and the single initial authorization. Route inspection only reads existing evidence and sends no model request or rescue action.

The [first actual Linux chain](../model-route-gate-20260928-1.json) proves main and reviewer HTTP routing. Provider failures prevented a valid plan decision, and the old controller did not acknowledge complete cleanup. Full admission remains failed; stage/completion reviews and independent checks remain unverified. Provider 502/504 and missing decisions are runtime failures, not route deviations or reasons to remove a formal position.

After an authorized upstream retry, the new `control-supervisor-log-5` case completed main, plan, stage and completion review with 50 actual requests, all normal, and three durably applied decisions. The failed case is unchanged; see [admission record 2](../model-route-gate-20260928-2.json). The controller records one initial approval, no rescue, native completion and cleanup. Provider request IDs are retained only as hashes. The representative log chain passes; independent artifact checks remain unverified, the full two-mode gate stays false and formal delivery remains 0/16.
