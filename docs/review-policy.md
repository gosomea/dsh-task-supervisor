# Review and intervention proposal

**Status: design proposal.** This document owns review timing, evidence access, and intervention semantics. The plugin has not implemented them yet.

## Summary

The supervisor checks whether the main agent is still pursuing the user's task and whether its completion claim is supported. Each issue category has a configurable response tier. The reviewer must cite session evidence before it can interrupt work.

## When review runs

| Checkpoint | Purpose |
| --- | --- |
| Before a tool action | A light check for an obvious, imminent policy match; do not run a full independent review on every tool call. |
| End of an execution round | A fresh independent reviewer checks progress, deviations, and the proposed next step. |
| Milestone or early stagnation signal | A deeper review checks the effective plan and whether another approach is needed. |
| Completion request | An independent evaluator inspects the evidence and workspace acceptance result before the controller finishes the task. |

The controller may call a specialist reviewer for a narrow issue. Its findings join the same decision record; a specialist does not acquire separate authority to continue or pause the task.

## Issue categories and tiers

| Category | Question the reviewer checks |
| --- | --- |
| Objective or constraint drift | Does the next action still serve the user's current instructions in the bound session? |
| Stagnation or repeated attempts | Is the agent repeating an approach without useful new evidence or progress? |
| Unsupported completion | Does the completion request lack required acceptance evidence or leave explicit constraints unmet? |
| High-impact actions and side effects | Does a proposed action have consequences that require a stronger check under the configured policy? |

Each category can use one of three tiers: **record only**, **automatic reminder**, or **pause for user decision**. A configured severity rule may raise the tier for a specific finding. A pause requires concrete evidence: cited event IDs, the current instruction or plan version, the questioned action, and the likely consequence. A finding without enough evidence is recorded for a later check rather than promoted to a pause.

At the reminder tier, the controller delivers the finding to the main agent and records that delivery so it can be replayed. The agent then chooses how to revise its plan or action. At the pause tier, the user can continue the original action, accept the reviewer's advice, or stop the action. Accepting advice cancels the pending original action and returns control to the main agent to replan. It does not let the reviewer edit the workspace.

The user can configure a pause timeout. The agreed default is to continue the original action when that timeout expires and record that the timeout caused automatic continuation. The exact duration and tier defaults per category remain open. This timeout rule does not replace DSH tool permissions, sandbox checks, or any separate approval required by the host.

## Evidence access

The reviewer reads a plugin-provided view of the bound main session, beginning with the last completed round. It can request earlier pages and expand selected redacted messages, tool arguments, or tool results. Later reviews use an incremental cursor. The tool reports stable event references and round boundaries, so a finding can be checked against the original record. It must not accept a caller-supplied arbitrary session ID or grant write access to the main session.

The final evaluator also reads the workspace result. If acceptance commands are needed, it runs them in an isolated copy and reports the command, observed result, and limitations to the controller. It does not treat the main agent's summary as sufficient evidence by itself.

## Decision record

Every review checkpoint records its input cursor, findings, tier, controller decision, and any delivered reminder or user choice. Pending actions and timeouts need durable identities so replay does not apply a choice twice. A host restart reconstructs this record and waits for manual resume, as specified by [architecture](architecture.md).

## Dev Note

Open policy decisions: exact category defaults, severity thresholds, pause duration, reminder wording, model invocation budget, false-positive suppression, race ordering between a pending tool action and a user reply, and the DSH transport for a pause decision. Validate redaction and event-reference behavior against DSH session storage before fixing the read-tool schema.
