# Task supervision in native modes

## Summary

Supervisor creates and manages Tasks in native DSH modes without adding mode-picker entries. Standard, PTC, minimal and cordis retain their configuration. This page describes development source; npm 0.1.1 still uses dedicated presets and does not include this change.

## Create a task

Run `/task <objective>` to create and start planning, even after an ordinary Session has started. Bare `/task` persists an entry waiting for the next human message, creating before that message's first model request; it does not start an empty task. `/task off` cancels entry. An unfinished task keeps its identity and execution state on bare `/task`; `/task status` always inspects. `/task new <objective>` remains an alias. Alternatively, explicitly ask the main Agent to create a Task. The Agent reads the latest human message seq with `task_status`, then calls `task_create`. The tool binds that real message, retains original requirements and returns the actual Task ID. Plugin messages, invented sequences and stale human messages cannot authorize creation. Repeating the same source and objective creates no duplicate; changed requirements use the formal edit path.

Creation does not approve implementation. The main Agent inspects the workspace, submits Task criteria and a DAG, and waits for approval after independent plan review passes. Ordinary questions do not automatically create Tasks; Todo, planning skills, native Goal and Plan do not establish a Task either. The sidebar shows supervision as not enabled when no Task exists; main Agent answers keep native rendering.

## Goal, Plan and continuation

Native Goal, Plan and Todo tools remain available. While a Task is retained, Supervisor uses the optional public GoalService.disarm to remove process-local Goal continuation authority, preserving its objective, phase, revision and durable history; creation, resumption and activation recheck ownership. Missing Goal service does not block Supervisor. Plan does not create another supervision workflow.

Task approval and completion remain subject to their own protocol. Native Plan approval cannot approve a Task; native Goal completion cannot complete one. Native Goal cannot automatically advance while the Task is paused, reviewing, disabled or complete. `/task clear` releases ownership without resuming Goal; a later explicit native Goal resume grants its continuation authority again. Log-reviewed Tasks acquire no independent artifact verification capability from this integration.

## Recovery and compatibility

Admission attaches to the Agent scope without changing a started Session's preset. After Supervisor hot unload, the retained gate denies steps and tools for the controlled Agent; reloading requires manual Task continuation. Cold restart with the plugin restores the Task disarmed until explicit resumption.

Cold startup without the plugin has no such gate. The current public Host offers no generic admission API requiring a plugin persistently for a Session; its native preset still loads, so this must not be claimed as supervised recovery. Old dedicated-preset Sessions from 0.1.1 can be restored with explicit `legacyPresets: true`, which registers the old modes; default operation registers none and rewrites no logs. Private 0.1.0 extension logs still use their original Host.

## Validation

Controller regressions cover natural-language creation, duplicate calls, original-message binding, native Goal/Plan coexistence, pause and completion authority, hot unload, restart and native configuration preservation. See the [validation record](native-task-checks.json) for real-model and official-installation evidence; [command-entry checks](task-entry-checks.json) cover the direct and bare command workflow. This change modifies no DSH main loop, native sandbox or daily user profile and establishes no long-horizon advantage.

[简体中文](native-task.zh.md)
