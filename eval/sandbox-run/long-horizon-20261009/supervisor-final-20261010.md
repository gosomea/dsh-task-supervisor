# Supervisor public-task evaluation: eight runs closed

## Scope and conclusion

Four DeepSWE holdouts with two repeats each: **all 8/8 original Supervisor positions are sealed**. The user then ended this batch at Supervisor completion and cancelled further Goal / Plan evaluation. The [scope closure](scope-closure-supervisor-only-20261010.json) retains the disposition of all original 24 positions: eight Supervisor runs, five earlier Plan runs, one started Goal cancelled by the user, and ten undelivered positions. The cancelled Goal was stopped, collected and its original sandbox destroyed; no official grading runs and it is not a product failure. Existing results are unchanged.

**This frozen version performs independent checks and retains recovery evidence, but does not reliably finish implementation, acceptance and whole-task completion.** Six runs received official scores: one reward=1 and five reward=0; two execution infrastructure failures retain reward=null. Strict success is **0/8**. These are observations on four tasks, not eight independent tasks. Goal / Plan pairing is incomplete, so this batch cannot establish that Supervisor is better or worse.

The [machine report](supervisor-final-20261010.json) binds results and costs to the [thirteenth formal-result snapshot](reports/20261010-102010Z/summary.json) and every original result.json hash. Reporting changes neither the frozen plugin, inputs, approval, absolute deadline, artifacts nor official scores.

## Results by task and repeat

Official grading accepts only the base..HEAD patch committed by the Agent. Uncommitted changes remain diagnostic; the evaluator does not commit them. Strict success also requires controller completion before the deadline, without execution, collection or grading anomalies.

| Task | r1 official reward / first stop | r2 official reward / first stop | Strict successes |
|---|---|---|---:|
| Geo | 0 / task deadline | 1 / recovery budget exhausted | 0/2 |
| Koota | 0 / internal review fault | 0 / internal review fault | 0/2 |
| Superjson | 0 / internal review fault | 0 / internal review fault | 0/2 |
| Updo | null / infrastructure failure | null / infrastructure failure | 0/2 |

Geo / r2's Agent-committed patch passed all 623 official tests, but the controller exhausted recovery during review of a new attempt and paused without whole-task acceptance. Official artifact correctness and controller completion remain separate; this trajectory alone does not establish an erroneous pause.

Two execution infrastructure failures and one additional collection-ownership failure affect three positions in total. The collection failure affected Superjson / r2, which was repaired and graded from the same original artifacts at reward=0. Anomaly and scored-position counts therefore overlap. Unscored positions cannot be converted to zero or removed from the denominator. One full reward in six actual grades is an observed 1/6 proportion, not the complete eight-run product success rate.

## What happened in the final position

Superjson / r1's first node, `core-modules`, recovered after one internal timeout under the same job, reviewer Session, requirement version, node attempt, evidence cutoff and snapshot. Earlier read qualification remained, the decision applied once, and the main Agent actually started `integration`; see the [recovery and handoff evidence](supervisor-superjson-recovery-applied-v10.json).

The second-node [review failure record](superjson-integration-review-failure-r1.json) shows that both attempts reached their own 600-second deadline. It accumulated twelve command checks, six durable independent findings and fourteen tool errors, and reached comparison, but never called `task_review_decision`; no decision was persisted or applied. Read qualification is compared by identity, total length and range coverage. All earlier eight file reads and nine check-output reads remain covered at recovery and the final state; appended ranges are not lost qualification.

One check changed the Vitest result cache inside its checking copy, and the existing evidence gate rejected its citation. Other errors include premature comparison access, incomplete artifact reading and parameter validation. The machine report retains error sequence numbers and hashes and marks errors without a reliable classification as unclassified. A changed checking copy does not itself establish a product defect; this batch did not weaken validation to obtain a pass.

After both node-review attempts exhausted their retry allowance, the Task paused. Two Task fault recoveries were confirmed, without additional approval or rescue. The Agent made no new commit, so the formal patch was empty. Independent official grading returned **reward=0, F2P 0/80, P2P 116/116**; uncommitted implementation did not enter this score.

## Independent checks and cost

Six positions actually executed independent command checks. Across eight runs there were **234 command checks, 74 durable independent check findings and 2,165 model requests**. Review tools account for 2,428 calls, with 3,172 total tool calls and 253 tool errors across all Sessions: about 76.5% of tool calls were review calls. Running checks, recording findings, submitting decisions and effective application remain separate counts.

Execution windows sum to about **11.45 hours**, including planning, implementation, review, retry and waiting across positions. This is not CPU time or proof of continuous main-Agent blocking. Records show eleven Task fault-retry reservations, one truncation-recovery reservation, 53 review-read failures and 29 exact repeated reads; reservations are not successful recoveries. Human rescue was zero for every position; original submissions and protocol approvals are separately counted as fourteen actions.

All-Session token totals remain null because some requests lack usage. Reported lower bounds are uncached-input **6,711,976**, output **4,627,749**, cache-read **153,876,093**, and cache-write **0**. Accumulated cache reads across requests are not a single context length. Additional checking CPU time is also null. Actual logs record zero context compactions; a long time limit is not evidence of a long trajectory or compression behavior.

Four distinct tasks do not establish population performance. Repeats are correlated, so this report does not calculate confidence intervals as if eight runs were independent. Condition pairing is incomplete; condition differences and superiority metrics remain null. False acceptance, false pause and corrective benefit also remain null without blind or causal human labels. The mechanical count of announced completion followed by official failure is zero; this does not establish the absence of other mistakes.

## Confirmed repair priorities

These are subsequent development items and were not implemented inside this frozen batch.

1. **Continuation after planning revision.** Geo / r1's applied `revise` left the plan version unchanged, while the subsequent gate required a new version. Planning stopped until the absolute deadline. Validate pass, revise and needs-user according to their own semantics; revision feedback must not create execution permission.
2. **Decision submission, persistence and application.** Koota / r2 returned recorded:true without a durable decision. Reproduce the race between the review deadline and record flushing, define the acknowledgement precisely, and apply a valid submission at most once. An acknowledgement alone must not release downstream work.
3. **Evidence-protocol convergence.** Koota / r1 and both Superjson runs exhausted review time. Reduce repeated evidence retrieval, provide precise phase, field and qualification errors, and test same-job correction with positive and negative fixtures. Retain two-phase isolation and bounded recovery; do not gain passes by extending deadlines or weakening acceptance.
4. **Delivery state and cost visibility.** Distinguish implemented, committed, reviewed and whole-task complete. Show remaining requirements, stop reasons and recovery allowance. Official grading requires committed patches; this evaluator did not commit on the Agent's behalf.

The [seven-run interim analysis](supervisor-interim-20261010.md) retains earlier captures and specific incident links. The [final failure evidence](superjson-integration-review-failure-r1.json) adds a case where read qualification survived but the reviewer never completed a decision. Storage sampling and collection-ownership fixes are runner repairs, not plugin capability improvements.

## Closure and retained environment

The original serial batch controller and its Goal monitor are stopped. Public Session cancellation and Host exit allowed quiescent collection of the cancelled position; its original sandbox is destroyed. The [resource audit](resources-closed-supervisor-only-20261010.json) confirms destruction of original sandboxes for all fourteen started positions, with no remaining running gateway containers or owned storage volumes. All Supervisor positions retain original artifacts, log hashes and official results. Do not resume delivery with the original 24-position script or automatically rerun cancelled or undelivered positions.

The frozen package, protocol, original order, runner repair versions and private evidence remain in the registered environment; daily port 3080 is unchanged. This batch publishes no npm version. Future execution requires new authorization and a separate batch; delivered or diagnosed tasks cannot be relabelled as unseen.

## Dev Note

This page only explains sealed results and the user-reduced scope. It authorizes neither subsequent repairs nor additional evaluation.
