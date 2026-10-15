# Team compatibility patch validation

Validated on 2026-10-15. This record covers the isolated 0.1.5 patch, based on published 0.1.4. [Machine evidence](checks.json) binds source, packages and Session identities.

## Result

The real-model Task completed with three fresh reviewers: plan, stage and completion each passed on attempt 1, with no initialization fault or automatic fault retry. Each child retained one Supervisor descriptor and received no Team identity prompt. The result was {"sum":12}; input.json remained unchanged.

| Gate | Observed result |
| --- | --- |
| Published-baseline source tests | 241 passed; 1 configured Docker fixture skipped. |
| Current Team composition | 9 passed, including five review kinds across resubmission, cold recovery, incompatible identity and expired-job refusal. |
| Strict types | Host and client passed against the 0.1.7-alpha.2 source baseline. |
| Presentation rules | 21 passed, included in the source-test count; unknown origin, automatic retry policy and expired deadline are distinguished. |
| Package | Build, exported entries, file contents and normal CLI installation passed. |
| Official DSH 0.2.0-rc.2 | Final tarball loads and serves live Supervisor status; zero model requests. |
| Real model | Main and reviewers used deepseek-codebuddy/deepseek-v4.1-flash under the current Team composition. |
| Final package reload | The completed Task and three applied decisions load without another model request. |

## Review durations

| Review | Wall seconds | Configured budget seconds | Attempt |
| --- | --- | --- | --- |
| plan | 40.503 | 600 | 1 |
| stage | 75.931 | 600 | 1 |
| completion | 139.182 | 600 | 1 |

These measurements establish this lifecycle regression only; they do not establish performance gains or benchmark success rates. One actual initial approval used the supported control API; an earlier raw prompt string did not execute the slash command.

## Package binding and limits

The real-model run used package SHA256 91e04a79e3d550967a4153303078a0d2bf0f04492f28ceee28dc2e4342054208. The final package SHA256 is a23850888df25a3b93134780e8a2aa1d5fe423e2c46e88199be724cb20672b41. Every Host .mjs module is byte-identical between them; the final client adds the expired-deadline explanation. The final tarball was installed and reloaded separately; its cold replay is not described as another model run.

Current experimental-host runtime composition passed. Its whole-checkout type probe did not pass: built declarations differ from source, and a source-only attempt reaches existing vendor diagnostics. The baseline strict checks above remain distinct. No daily served artifacts were rebuilt.

Browser interaction was not verified because local Chrome debugging permission was unavailable. Presentation logic and the built client were checked; no browser screenshot or GIF is claimed.

## Delivery and isolation

The daily 3080 process and its original 0.1.4 installation were preserved. The canonical dirty checkout, continuous-execution branch, frozen packages and historical evaluation results were not edited.

The 0.1.5 tarball is prepared but not published: npm whoami returned ENEEDAUTH. Publishing requires the user to complete npm login. Installing the patch into the daily profile and reloading an active Host are separate operations; this validation did not perform them.
