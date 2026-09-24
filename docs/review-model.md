# Reviewer model selection

**Status: confirmed product direction with implementation details pending.** Review follows the main Agent's model selection by default; users may instead select a reviewer model from the providers and models configured in the active DSH profile. This page owns selection, effective timing, and recovery records; [Supervisor Session](session-runtime.md) owns task recovery.

## Selection interface

Supervisor settings offer “Follow main Agent” and “Select model,” defaulting to the former. Explicit selection reuses DSH provider groups, model directories, and the chosen model's supported reasoning efforts. Supervisor stores the policy and necessary provider, model, and reasoningEffort IDs; it does not maintain another API key, base URL, model account, or model-name registry.

The default policy belongs to the Supervisor plugin's settings in the active DSH profile and is saved through DSH configuration editing. The first version does not add per-task model overrides, limiting recovery precedence. This setting changes neither the main Agent's current model nor DSH's global default; DSH continues to own providers, credentials, and invocation.

## Verified DSH behavior

| Entry point | Existing behavior | Integration consequence |
| --- | --- | --- |
| [agent-default-model](../../../deepseek-harness/packages/core/agent-default-model/src/index.ts) | Owns the profile-configured default provider, model, and effort selection. | Defaults must not override an existing session selection. |
| [Session model selection](../../../deepseek-harness/packages/api/session-controller/src/model-selection-projection.ts) | Distinguishes a pending selection from the last request's model. | Follow mode must see a model switched before its first request. |
| [Default child inheritance](../../../deepseek-harness/packages/subagent/subagent/src/child-agent.ts) | Prefers the main session's latest request header, falling back to creation options before the first request. | The experiment confirms it does not independently read pending `model/selection`; omitting an override is not equivalent to following current selection. |
| [Native model-selection UI](../../../deepseek-harness/packages/client/ui-model-selection/README.md) | Shares provider groups and model directories, uses supported effort levels, and validates routing separately from advisory catalog membership. | Reuse directory and selection components rather than model lists; a missing catalog row does not alone invalidate an existing route. |
| [Session selection command](../../../deepseek-harness/packages/api/session-controller/src/commands.ts) | Changes the session model and attempts to save the DSH default. | Reviewer settings cannot call this write operation directly without also changing the main model or default. |

## Resolving follow mode

Resolve the main Agent's effective selection once before dispatching each new review job. Prefer a host-provided session-selection reader whose semantics give pending human selection precedence over the last request; without either, respect the Agent's explicit creation route before the host default. Omitted effort preserves model-default behavior rather than carrying an old model's effort into a new route.

The full pending/lastUsed fold currently belongs to API Session Controller, while the public child-inheritance helper reads the last request header. Validate a host-neutral public effective-selection reader for the first version, extracting the existing fold into a general model-selection module if necessary. Do not reach into a private Web Controller object or maintain another model-selection state machine. This public reader remains an integration item to validate.

Validate provider, model, and effort through the DSH LLM service, then pass the resolved values as explicit review-Agent options. This reuses DSH routing while eliminating ambiguity if the main model changes during dispatch. Model selection does not copy the main Agent's write tools, permissions, or full context; the reviewer retains its restricted evidence tools.

## Effective timing

| Situation | Rule |
| --- | --- |
| New review in follow mode | Capture the main Agent's effective selection at dispatch. |
| New review with explicit selection | Resolve the fixed route in current Supervisor profile settings. |
| Main selection or Supervisor settings change during review | Keep the running review's captured route; the next new review uses the new choice. |
| Transient retry within the same job | Keep the original route and effort by default, recording a new attempt ID; never silently switch models. |
| User explicitly requests review with a new model | Cancel or supersede the old job and create a new one with the same task/evidence validation. |
| Restart with a complete review result | Reconcile from the saved result rather than calling the current model to rewrite it. |
| Restart with an interrupted job | Reconcile the old attempt after manual resume; a retry retains its recorded route, while a newly requested review resolves current policy under a new identity. |
| Unroutable model, missing credentials, or invalid effort | Show the concrete error and leave required review unresolved; do not switch to follow mode, change provider, or treat it as a pass. |

A model switch alone does not change the task objective or approved criteria. New results from another model still require task-revision, cutoff, and artifact-identity checks. Model-based final acceptance follows this policy by default; deterministic acceptance commands need no model selection.

## Durable records

Each review records policy kind and revision, selection source, the main-session evidence cursor at resolution, concrete provider/model/effort, job and attempt identities, and actual child request-header references. Retain requested configuration separately from adapter-resolved configuration. Display names are UI labels rather than stable identities; a profile name identifies local configuration but cannot alone establish reproducibility.

Never store credential values. Record reported token usage and mark absent values unavailable. A provider can update the implementation behind a model ID, so retain available provider-version or response metadata without claiming bitwise replay from a model name alone.

## Acceptance

Cover inheritance after a main request, defaults before a first request, a switched-but-unused pending model, explicit selection, effort changes, profile edits, selection during review, pinned-route retries, restart, and explicit invalid-route failure. Assert that changing the reviewer setting leaves the main Agent and global default unchanged.

Controlled evaluation still records each arm's actual model configuration. If the user selects a stronger reviewer, match that resource in the Team baseline or report a separate allocation experiment; the product setting does not change the comparison rules in [evaluation design](evaluation.md).
