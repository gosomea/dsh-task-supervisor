# First prototype and Agent Team comparison

**Status: prototype design with a runnable vertical slice.** This page defines the first prototype and the competing Lead–Worker approach. The complete product and combined baseline remain untested; [implementation status](implementation.md) records the runnable slice and [kernel experiment results](host-spike.md) record the earlier persistence gap.

## The competing design is credible

A root Lead can plan, use a native Goal for continuation, delegate implementation to a Worker, inspect results, and request corrections. This can reproduce much of the desired user experience. The local [Agent Team service](../../../deepseek-harness/packages/experimental/agent-team/README.md) already has durable messages, a versioned task board, and recovery; persistence and multiple agents are not unique Supervisor advantages. Whether a combined Team, Goal, and Plan preset works end to end still requires composition testing.

Native Goal tools authorize task creation and control from direct-human turns on a live root; completion also accepts the matching native goal round. A child does not receive that authority merely by seeing the tools. Native Plan also restricts live owned children from opening the plan review. See [Goal authority](../../../deepseek-harness/packages/goal/tool-goal/src/authority.ts) and [Plan limitations](../../../deepseek-harness/packages/plan/plan-mode/README.md). A root Lead can use planning, then execute after approval; simultaneous availability does not mean planning and execution are the same phase.

## What Supervisor must add

| Concern | Lead–Worker baseline | Supervisor requirement |
| --- | --- | --- |
| Execution ownership | Lead delegates work and coordinates the Worker. | The user's main agent keeps its execution session; no additional project-manager Lead is required. |
| Review timing | Lead chooses when to inspect and request another review. | Controller enforces configured stage and watchdog checkpoints independently of the main agent's willingness to ask. |
| Completion | Model-owned task updates and native Goal completion follow their tool authority rules. | Main-agent completion is a request; only the controller can record completion after accepted evidence. |
| Evidence | Lead may inspect the shared workspace and available logs; worker summaries alone need not be sufficient. | Reviewer has explicit read access to the bounded execution log and cites an evidence cutoff and task version. |
| Recovery | Team already persists collaboration state; native Goal has its own continuation rules. | One controller consistently applies edit, close, stale-result rejection, manual resume, and review-recovery semantics. |
| Model judgment | Lead can make a good or bad judgment. | Reviewer can also make a good or bad judgment; mandatory review does not guarantee correct review. |

Supervisor is a task controller with model-assisted evaluation, not a general-purpose conversational manager. The controller owns state transitions and scheduling; the main agent owns implementation and plan proposals; the reviewer owns evidence-based recommendations. The reviewer cannot become a second implementer, create implementation workers, silently rewrite the user's objective, or schedule arbitrary work. It may use a DSH child-agent provider internally without turning the product into a team-management interface.

This distinction is an engineering contract, not a claim that a Team could never implement the same behavior. If a Team is given equivalent enforced checkpoints, acceptance authority, and recovery semantics, it has acquired similar supervisory machinery. The value hypothesis is that packaging those rules produces more reliable completion with less user coordination. Evaluation must be allowed to disprove that hypothesis.

## Prototype scope

Build one complete vertical slice: one supervised task, the existing main execution session, and one fresh reviewer job per checkpoint. This is a deliberate subset of the [bounded task-list design](task-lifecycle.md). Queue management for five tasks, specialist reviewers, a continuous reviewer session, import from native Goal or Plan, and combined Team execution can follow after the control loop works. Fork remains documented but is outside the first acceptance claim; the prototype must not silently rearm a fork.

The provisional user commands are `/task new`, `/task`, `/task edit`, `/task pause`, `/task resume`, `/task clear`, and `/task off`, plus a panel action to re-enable supervision. One initial plan-approval interaction covers entry into autonomous execution. A separate planning-only command is a later UI extension; the prototype still always produces and records the initial plan.

| Component | Minimum deliverable |
| --- | --- |
| Task state | Durable objective, constraints, acceptance criteria, plan stages, revision, status, evidence cutoff, and recoverable JSON snapshot. |
| Main-agent tools | Separate task-state read, plan submission, stage report, and completion-request operations; exact names and schemas follow a host spike. |
| Reviewer input | Current task and plan, bounded main-session log, references to artifacts, and paginated expansion of original evidence. |
| Reviewer output | Matching task revision and evidence cutoff, supported findings, and a pass, revise, or needs-user recommendation. |
| Continuation | One revision-checked next action admitted only after user input and required review have settled. |
| Independent acceptance | A controlled fixture's acceptance checks run against an isolated snapshot containing the actual task changes. |
| Right panel | Objective, current stage, execution status, last finding with evidence, next action, plan approval, pause, resume, and Close Supervisor. |

## Confirmed prototype details

The following choices are adopted for the prototype. Host validation remains required for each mechanism; do not describe these rules as enforced until their failure cases have been demonstrated. Retry and stagnation counts remain provisional configuration defaults.

| Detail | Prototype rule | Evidence needed |
| --- | --- | --- |
| Before initial approval | Allow repository inspection and plan submission; require host-enforced restrictions for workspace mutation, arbitrary shell execution, and delegation before approval. A prompt alone is insufficient. | An unapproved mutation is rejected, while inspection and plan submission work. |
| Task requirements | Give constraints and acceptance criteria stable IDs. Bind approval to the submitted plan and requirement version. Plans map stages to criteria; models cannot silently remove a criterion. | Plan revision preserves criteria or cites the user's instruction changing them. |
| Stage report | Report the stage ID, affected criteria, artifact or test evidence references, and remaining work. A report is a proposal until reviewed; stage count is not a progress score. | A stage without its required evidence remains unfinished. |
| New user input | Invalidate queued admission and stale review authority before handling newer input. Ordinary questions are not automatically rewritten as new objectives. | An edit wins over an old review; a status question does not create a new task. |
| Continuation delivery | Use a logged Supervisor message source; never impersonate direct human input. Passive context injection alone cannot wake an idle DSH agent. | A due continuation wakes exactly once; closing invalidates it before admission. |
| Reviewer lifetime | Bind observation hooks to the supervised main-agent identity. Exclude reviewer and evaluator jobs; one review per task revision and evidence cutoff. | A reviewer tool call never creates another review. |
| Review failure | Require normal completion and schema-valid output. Provisionally allow two bounded retries for transient call failure; then pause with a recovery reason. | Timeout, malformed output, and failed model calls cannot become pass decisions. |
| Artifact stability | Settle owned jobs before final snapshot. The fixture uses bounded foreground processes and no detached work. Snapshot task files and relevant data before acceptance. | No acceptance result is reused after relevant files change or while an owned writer remains active. |
| Visible state | Show planning, awaiting approval, executing, reviewing, paused, stopping, or finished with a reason. A closed panel is not a closed Supervisor. | The UI and replayed state explain why execution is currently stopped. |

The first reviewer uses a fresh session and follows the main Agent's effective model selection by default; users may also select a model configured in the active DSH profile. [Reviewer model policy](review-model.md) defines capture timing, pinned retries, and configuration ownership. Evidence access remains scoped to the bound task and main-session prefix. Token usage that the host cannot report is marked unavailable rather than recorded as zero.

## Stage evidence and correction

A stage proposal contains its objective, linked acceptance-criterion IDs, expected observable artifacts or checks, and prerequisites. The agent chooses the stage breakdown. Stages may be split or merged, but the approved criteria remain traceable. Store evidence as original event and artifact references; a summary saying tests passed is not a test result.

A corrective review names the unmet criterion, supporting evidence, and the next fact or repair needed. A passing executable check outweighs an unsupported contrary model claim about that same checked behavior; broader untested requirements still need evidence. Reviewer disagreements must identify a concrete remaining requirement, not a style preference. Two corrective continuations with the same issue and no new evidence provisionally trigger a stagnation decision and a manual pause. This counts failed correction cycles, not repeated tool names, and remains subject to calibration.

## Initial service fixture

The old website demonstrations are excluded from the prototype and its acceptance path. Create a small reproducible Python and SQLite service seed with working single-record create/read behavior, then ask the main agent to add batch import. This seed is a synthetic development fixture, not an already selected real repository or evidence of long-horizon capability.

| Public acceptance criterion | External verification |
| --- | --- |
| Valid batches are persisted and returned through the service interface. | Submit a batch, inspect responses, and read the stored records. |
| Invalid input rejects the entire batch without partial writes. | Include an invalid record mid-batch and compare database state before and after. |
| Retrying a batch with the same request key does not duplicate records; a different payload under that key is rejected. | Replay a request and submit a conflicting payload; verify row count and response semantics. |
| Existing single-record operations keep their documented behavior. | Run regression checks against the seeded public interface. |

Freeze exact request and response semantics when creating the fixture. Provide public requirements and representative runnable checks to the main agent and Supervisor. Keep separate external tests for final scoring, with no hidden extra requirements. Restore the same fixture for every arm. The acceptance script and reference result are maintained outside the candidate workspace; snapshot candidate code and relevant database artifacts before running them.

## Feasibility spike and implementation gates

The first spike must demonstrate three host capabilities: composing independent commands and model tools; pausing and resuming a main agent at a supported checkpoint while a separate reviewer reads its log; and persisting state that remains disarmed after restart. Include shutdown while a review is pending. A hook or type existing in source is not proof that the combined workflow works without reentrancy or deadlock.

If a required host capability is missing, record the precise missing operation and decide whether a minimal DSH extension is warranted. Do not silently turn Supervisor into a conversational Lead, run a separate untracked continuation loop, or weaken acceptance to get a demonstration working. Once these capabilities are verified, implement the fixture loop and thin panel; defer queueing, specialist reviewers, and the full benchmark until then.

## End-to-end demonstration

Use the batch-import service fixture above to exercise validation, persistence, and API response changes while preserving existing behavior. Allow the main agent to choose its own plan. The fixture supplies public acceptance requirements and separate evaluator checks; it does not prescribe a plan available only to Supervisor.

The demonstration must show a task created from `/task new`, one approved plan, actual implementation, an evidence-based review, at least one admitted continuation, and independently checked completion. Additional controlled runs exercise an omitted requirement, a stale review after a user edit, and closure or restart during pending work. Injected outputs may test control correctness but must be labelled; a demonstration of model review quality must use real reviewer output.

A main agent ending a reply without submitting a stage report does not complete the task. The controller reconciles its state and requests a checkpoint when due. A reviewer failure cannot be treated as a pass. A successful tool exit by itself cannot substitute for the task's acceptance criteria.

## Build order and acceptance

1. Verify a dedicated preset can compose task commands, model tools, read access, and the right panel without requiring Goal, Plan, or Team services. Verify supported host boundaries for idle continuation and cancellation.
2. Implement the event-backed task state, snapshot, edit and close handling. Use deterministic tests for duplicate admission, stale results, restart, and cancellation before invoking models.
3. Connect the main-agent plan and progress operations to a fresh reviewer with bounded log access. Preserve model-visible instructions in the session record.
4. Run the complete fixture through actual DSH model calls and isolated acceptance. Confirm manual resume and that Close Supervisor stops further owned work.
5. Run the same fixture through the strongest practical Lead–Worker baseline before expanding the UI or task capacity.

Prototype acceptance requires the full loop and reliable stopping, not benchmark superiority. The stage-checkpoint scenario must reject an unsupported completion request and later accept the corrected artifact. The edit scenario must reject an old reviewer decision. The close scenario must reject late continuations and timeout callbacks. The restart scenario must preserve state and remain idle until manual resume.

## Evaluation against a team

Add a root Lead plus one Worker, with native planning and Goal continuation on the Lead, as a required product baseline. Give the Lead an explicit instruction to verify work and correct it; provide equivalent access to task requirements, workspace artifacts, and execution evidence. Verify the combined preset and genuine task-control authority first. Do not intentionally use a summary-only or unprompted Lead to manufacture a weak baseline.

Use the same main model, task fixtures, permissions, and predeclared execution limits. Record all Lead, Worker, and reviewer work. If the reviewer uses a stronger model, either match that resource in the Team arm or report it as a separate model-allocation comparison. Count user decisions, unsupported completions, corrections, needless extra work, and final independent acceptance. If the Team matches outcomes with a simpler setup, narrow the product claim or reuse that mechanism instead of assuming the plugin is superior.

## Dev Note

The fixture contract needs executable tests; exact tool schemas, host checkpoint transport, and Team baseline composition still need implementation evidence. One active task is the prototype limit, while five unfinished tasks remains the full-design default. Neither limit establishes a performance advantage.
