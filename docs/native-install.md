# Standard DSH installation and validation

## Summary

`0.1.1` uses public DSH persistent Inbox events and Agent presets without private Host event or reader extensions. Installation was verified with official npm `@deepseek-ai/dsh@0.2.0-rc.2`, Node 24.19.0 and macOS; kernel source tests use unmodified `0.1.7-alpha.2` source. Earlier versions and other platforms remain unverified.

## Install and start

With official DSH, its Web profile and working model configuration, run:

```sh
dsh plugin --profile web add dsh-task-supervisor@0.1.1
dsh web
```

Run `/task new <objective>` in a blank Session before its first model turn, or select `Supervisor · Standard mode` before discussing requirements. The plugin preserves base preset configuration and derives its Supervisor variant. A started ordinary Session cannot change its native mode: create a new one. A supervised Session can start successive tasks while retaining history. Closing Supervisor does not change the Session preset; use a new ordinary-mode Session for native Goal/Plan.

Log review is the default; after plan review passes, `/task approve` or the approval button admits execution. Independent artifact checks still require storageRoot and necessary execution capabilities described in [implementation status](implementation.md#independent-artifact-checks-and-two-stage-review). A separate review Session does not prove independent product execution.

Installation may warn about missing profile peers. Official DSH module fallback supplies the shared native SDK; actual Host loading and a real task passed. Do not manually install a different version of core components into the profile. Restart the Host after editing the base preset to generate a new Supervisor composition.

## Persistence and execution admission

The controller inserts a plugin-attributed internal record into native Inbox and cancels delivery in the same synchronous call. Two native events retain its complete payload; the projection normalizes them in a read-only view. They never enter model messages, alter human answers or interrupt tool-call/result adjacency. Records have no `ignorable` flag and retain original sequences and timestamps.

Supervisor mode disables native Goal/Plan workflow rows only in its own preset; ordinary modes retain them. The durable native preset identity rejects cold restore when the plugin is missing. On hot unload, the scope gate retained by the current Agent denies its next step and tool execution. Reinstallation and restart retain tasks but still require manual continuation.

## Validation evidence

The [machine check record](native-install-checks.json) stores package digests, reviewer identities, native record counts and all reported Session tokens. Raw logs, authentication URLs, cookies and credentials remain in the registered isolated environment outside Git.

| Layer | Result |
| --- | --- |
| Kernel source | 23 files, 347 passed; 13 skipped and not claimed as executed. |
| Types and build | Strict Host/Client typechecks, build and 11-file package inspection passed. |
| Evaluation readers | 159 DeepSWE adapter tests and 14 review-summary tests passed; old results remain unchanged. |
| Official installation | Native `dsh plugin --profile web add` installed the tarball without changes to Host/Client, native sandbox or main loop. |
| Real model | Main Agent and three reviewer Sessions used CodeBuddy `deepseek-v4.1-flash`, with request records and actual responses. |
| Complete task | Read two numbers, approved once, passed node and completion reviews, and reported sum 20 in Chinese; input.txt content and the single-file inventory remained unchanged. |
| Same Session and restart | The next task paused and retained paused/armed=false after restart; prior completion and review history remained readable. |
| Missing-plugin gate | Restoring the original Session without the plugin returned native `agent-preset/not-found`; reinstalling restored it without automatic execution. |
| Web rendering | Client build and state API passed; browser tooling was blocked by the client, so rendering and button acceptance remain unverified. |

An initial development probe found that directly inserting `user/message` broke tool-call/result adjacency and received provider 400. That failed Session is retained and excluded from passes. Synchronous Inbox insertion/cancellation passed the strict pairing regression and a clean real task.

## Migration boundary

Private 0.1.0 `extension/record` logs still require their original Host; the plugin's legacy fold reader cannot extend the official decoder. This release migrates or rewrites no old log: start a fresh 0.1.1 Session. Old deployments and running user tasks were not replaced.

This validates standard installation, native persistence and control flow for one log-mode read-only task. It adds no independent browser, does not repair automatic check-directory recovery and provides no long-horizon benchmark or superiority claim over Goal/Plan.

[简体中文](native-install.zh.md)
