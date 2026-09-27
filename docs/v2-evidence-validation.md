---
title: "V2 provenance and evidence-read validation"
description: "Criterion origins, pageable review evidence, and unrelated-fixture scope regression."
status: "verified"
date: "2026-09-27"
---

# V2 provenance and evidence-read validation

## Delivered scope

The first batch-two change adds criterion provenance and evidence pagination. Each newly submitted criterion requires provenance: a user requirement (current objective or direct user message), a project constraint (an applicable rule in a successful tool result), or an implementation choice (with a necessity explanation). The Host validates origin type and seq; independent plan review checks whether the content supports the criterion and whether the project rule applies. Existing fixtures and optional enhancements must not automatically become task requirements.

Record version 4 reads versions 1–3. Missing legacy provenance is not invented as a user requirement: details show an unattributed historical criterion, and review reconstructs its basis from original records. Conversation and sidebar display the same criterion provenance.

`read_task_evidence` returns summaries with `totalChars`, `truncated`, and `nextOffset`; `read_task_text` retrieves already-seen event text, `read_task_call` pages arguments, and `read_task_context` pages the fixed objective, criteria, stages, report, and prior failures. Each text page contains at most 6,000 UTF-16 units. Redaction happens before slicing; follow returned offsets. All event reads remain inside the review-start Session cutoff; guessed seqs do not grant access.

These tools recover text stored in the Session. They cannot recover output omitted by the original tool. Non-text blocks expose only their type; this change does not supply image pixels. Review instructions require an explicit inability-to-verify finding when required visual evidence is unavailable, rather than a claim of visual inspection.

## Automated validation

37 tests, strict type checking, and the isolated-copy build passed. Added tests using real DSH services and a scripted model cover reading failure text beyond a tool-result summary, finding an objective constraint beyond 6,500 characters, rejecting text access before its containing page, rejecting reads beyond the cutoff, and distinguishing direct user sources from tool sources. Pagination tests reconstruct all stored redacted text without leaking credentials at page boundaries. Old records remain readable; new plans cannot omit provenance.

## Real-model regression

Reused registered deployment `supervisor-v2` (59909), binding a TMP case workspace and Session `session-ec88515c-f276-4322-8b7a-bd2e5a4ebc46` as `provenance-regression`. The workspace contains historical `data.csv`, `verify.mjs`, and README; the new task only creates a Chinese `greeting.txt`, reads it back, and reports in Chinese. The original 31973 user deployment is retained.

Plan, stage, and completion reviews passed; final state is revision 8, `complete`, 1/1. The plan explicitly excludes historical fixtures from the new task and does not require a CSV report. Independent workspace checks found exactly the expected 21-byte UTF-8 `greeting.txt`, no other added file, and unchanged SHA-256 hashes for all three fixtures. Final reviewer Session: `task-review-39b39317-39b7-4e3b-acb5-43681d3c6042`; main Session review tool result: seq 115. The reviewer used `deepseek-codebuddy/deepseek-v4.1-flash`; the main UI and durable requests use the same route.

Browser inspection confirmed expandable provenance labels, separate Chinese main-Agent and Supervisor cards, and a completed inline task disclosure. This verifies a small scope regression and evidence-read capability, not long-horizon drift rates or superiority over Goal/Plan.

[简体中文](v2-evidence-validation.zh.md)
