# Isolated real-model smoke test: 2026-09-26

## Setup and model route

- Re-read the daily Web profile using the revised `dsh-plugin-isolated-test` model-selection rule. Both the main Agent and independent reviewer used the first model under `llm-pi-ai.providers.deepseek-codebuddy`: `deepseek-v4.1-flash`, through `openai-completions` at `http://127.0.0.1:15721/tencent/v1`, with credential reference `DEEPSEEK_CODEBUDY_API_KEY`.
- The daily Web process was PID 11374 with the default `~/.dsh` home. The test used a separate DSH source checkout, home `/tmp/dsh-task-supervisor-smoke.Fhxusi`, profile `supervisor-web-smoke`, port 31973, and disposable workspace `/tmp/dsh-supervisor-real-tasks-9q5wp4iu`. The plugin was installed through `plugin add link:<absolute path>`.
- Composed configuration and persisted model requests agreed on this route. A standalone connectivity Session received `READY` from the real model.

## Task results

| Task | Main Agent result | Reviewer result |
| --- | --- | --- |
| Read-only line count | Verified `task-1/items.txt` has three nonempty lines (`red`, `blue`, `green`) and did not change the file | Stage and final reviews passed; task `complete` |
| CSV sum and output file | Summed 3, 5, and 8 in `task-2/numbers.csv`; actual `task-2/total.txt` bytes were `16\n` | Stage and final reviews passed; task `complete` |
| Code repair and test | Changed `a - b` to `a + b` in `task-3/math.mjs`; an independent `node task-3/math.test.mjs` exited 0 | Replaced a pending three-stage plan with a one-stage plan before approval; stage and final reviews passed; task `complete` |

The isolated store contains three task main Sessions, one connectivity Session, one blank UI Session, and seven reviewer Sessions. Six reviewer Sessions requested `deepseek-codebuddy/deepseek-v4.1-flash` and finished normally. One initial reviewer failed before making a model request, as described below. Successful reviewer Sessions retained the main Session's `cwd` and `parentSession`.

## Defects found and fixed

1. The first reviewer child Session lacked `cwd`, so system-prompt assembly failed on `{{cwd}}`. The plugin now uses DSH `childSessionMeta` to inherit the working directory and related context. A reviewer failure also concludes the main turn, preventing repeated submissions while paused. After the fix, task one resumed manually and completed both reviews.
2. The first submitted plan could not be revised in `awaiting-approval`. On task three, the main Agent proposed three stages despite a one-stage instruction. The correction failed because `task_submit_plan` accepted only `planning`. The tool now accepts a replacement full plan while approval is pending, increments the plan version, and approval applies to the latest version. After an isolated Host restart, the main Agent submitted one-stage plan v2 and completed the task.

## Verification and cleanup

- Strict typecheck against the isolated DSH source, all 17 kernel tests, build, and `pnpm pack --dry-run --json` passed. The package list contained only declared code, configuration, metadata, and both READMEs.
- Browser interaction covered task creation, plan approval, stage review, final completion, the right-side Supervisor panel, and replacing a pending plan.
- The test Host and browser tab were closed, and the temporary copied credential was removed from the isolated home. Daily Web PID 11374 remained running. Daily Session files increased from 903 to 907, with additions/updates in other workspace buckets rather than the disposable test workspace; all test Sessions were in the isolated home. Concurrent activity changed the daily store, so byte-for-byte invariance cannot be claimed.
- Production-threshold progress reviews, long-running automatic continuation, `/task off`, fork, and crash restart were not each tested with a real-model Host. Kernel tests cover some state paths but do not substitute for those end-to-end checks.
