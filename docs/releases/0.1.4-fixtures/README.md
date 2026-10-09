# Development fixture adapters

The static, calculation and deliberately incorrect-sum cases are development regressions, not public benchmark items. Both runners use one initial approval per task, a fixed 900-second deadline and no rescue prompts. They create TMP workspaces and bind native Sessions programmatically. Independent mode replaces result.sum with 23 only after the first Task is sealed and before creating the second Task.

Run the adapters only against dedicated registered official DSH homes with the frozen plugin and daily model composition. Supply a local deployments.json with each adapter name and its authenticated startup-log path. Do not commit that file, credentials, cookies, startup logs or *.private.json. The registry script path in these recorded adapters is environment-specific; adapt it when reproducing elsewhere. The adapters are acceptance harnesses, not supported public CLI commands.

The archived execution collector originally read request metadata at data.config. These copies use data.header.config; 0.1.4-checks.json supplements the immutable original results from their native events. No model execution was repeated to repair metrics. In-turn argument correction and controller extra correction Turns are distinct counters.

Matched rows use local deterministic artifact/content reward. The wrong-sum row has reward 1 only when it remains incomplete/paused with unchanged files; that is successful rejection, not a completed Task or a blindly labelled false-acceptance rate. Reported token totals use primary-Session per-Task deltas plus all bound reviewer Sessions, including cached input.
