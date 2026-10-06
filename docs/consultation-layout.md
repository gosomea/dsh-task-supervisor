# Supervisor conversation layout

[简体中文](consultation-layout.zh.md)

## Layout

The outer Supervisor tab provides the title. Its inner header contains Chat / Details, a short status and the native overflow menu. History and help open on demand; plan and requirement versions belong to Details. Permanent introductions, discussion targets, input modes and compaction instructions no longer occupy transcript space.

Draft cards use the native turn-tail slot and paired successful `supervisor_update_draft` or `supervisor_create_draft` results. Creation checks the current authoritative draft identity and version. Older cards cannot create a newer proposal. Open questions and another unfinished task still prevent creation. The header retains only a one-line link to the current draft.

## One conversation

Questions leave task state unchanged. Broad objectives can form a draft. `/task <objective>` and explicit creation directives reach the main controller. The current draft can be created by its button or an explicit subsequent request. Complete revised requirements use the existing edit flow and invalidate approval as before.

Ambiguous continuation messages, historical records, tool results and the Supervisor's own response do not authorize creation. Completed-task repair still requires clicking the impact confirmation. Main-Agent answers and native reasoning/tool disclosures are unchanged.

## Changed legacy behavior

Historical `input-mode` records remain readable but `direct` no longer changes subsequent message meaning. Legacy `consult-mode` requests to enable `direct` return a clear error; `discussion` remains compatible. Existing task, draft, review, compaction and repair records are not rewritten.

## Validation

Focused tests cover explicit actions versus questions, non-authorizing legacy direct records, paired draft results, rejected and malformed results, and revisions within a turn. Host checks cover real-model draft persistence, read-only questions, explicit creation and initial approval. Browser checks cover the menu, native turn cards, requirement expansion and creation.

See [machine evidence](consultation-layout-checks.json). This change does not alter independent review policy or continuation frequency.
