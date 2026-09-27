---
title: "V2 batch-one isolated validation"
description: "Observed language, chat/button approval, inline controls, and pause/resume behavior."
status: "verified"
date: "2026-09-27"
---

# V2 batch-one isolated validation

## Environment and scope

The SQLite registry from `dsh-plugin-isolated-test` was queried for `supervisor-user` and `supervisor-v2` first. The existing `supervisor-v2` deployment on port 59909 was reused, retaining the user's validation deployment on 31973. The original isolated home, DSH checkout, and separate plugin build copy were retained; no new Host deployment was created. TMP workspaces were bound through DSH `workspace/create` and `session/create`, then their cwd was checked in Session metadata. Case-to-Session mappings were saved in the registry.

The main Agent and reviewers actually used `deepseek-codebuddy/deepseek-v4.1-flash`, confirmed by the main Session model projection and review records. This follows the workstation skill's first CodeBuddy route; the current daily Host default was not changed. This run validates batch-one controls and UI, not long-horizon review quality, DAG scheduling, or parallel execution.

## Chinese chat approval and two-stage execution

Main Session: `session-67b9b2c0-8c59-4dcb-afeb-58cffd4cd286`. The objective was to create `greet.mjs` and `greet.test.mjs`, implement trimming, an empty-name default, and TypeError for non-strings, and run Node's built-in tests. The plan explicitly separated implementation and verification.

- A minimal Chinese request confirmed model connectivity before `/task new` was entered in the browser.
- The plan and independent plan review were Chinese. User message seq 48 contained only “批准”; `task_approve` ran inside the model turn. State persisted `lastApproval.planVersion=1` and `userMessageSeq=48`.
- With the right sidebar closed, the inline task panel exposed all stages, details, criteria, and pause/resume controls. Pausing during the second-stage review produced `paused`; manual resume triggered another review, ending at revision 14, `complete`, and 2/2 accepted stages.
- Final review was recorded at main Session seq 146, using independent review Session `task-review-57685a2c-5ed8-4025-a1ec-0a42a5f35cb6`. Main Agent submission and Supervisor conclusion had separate cards, with the current-task panel above the composer.
- An external rerun of `node --test greet.test.mjs` passed five tests with zero failures.

## Button approval and interruption notice

Main Session: `session-1bd863f2-dd19-45bf-bfcf-81438e64c563`. A separate clean TMP case directory used the same deployment. The objective was to create only `status.txt`, containing “隔离环境复用成功”.

- The inline “批准计划” button admitted execution.
- During review, the open sidebar and inline panel both offered pause and neither offered resume. After pausing, both offered resume.
- Resuming inline showed “审查尚未完成；恢复后请重新提交证据。” as the latest review notice, fixing the controller-generated English notice.
- Final state was revision 12, `complete`, with 1/1 accepted stage. An external check confirmed the directory contained only `status.txt` and its content was exactly “隔离环境复用成功”.

## Automated checks and fixes

All 34 tests passed, using real DSH services with scripted models for the control chain and covering client request ordering. Cases include direct-user provenance, exactly one continuation from approval inside a model turn, stale-action rejection, duplicate coalescing, and late detached reads not starting a second polling loop. Strict type checking and the isolated-copy build passed.

Browser validation found that the expanded panel shared a row with usage statistics. It now uses the native full-width `conversation.input.dock` slot with bounded expansion height. Sidebar and inline surfaces retain one shared store; collapsing the panel leaves model reports visible. Raw model reasoning can still be English: the plugin constrains user-facing reports and controller notices. This run does not validate every supported language.

[中文](v2-batch1-validation.zh.md)
