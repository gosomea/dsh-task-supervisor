# Independent verification development and validation

## Step 2

Snapshot and native check foundations are implemented; formal reviewer integration remains step 3. Snapshots include the working tree, uncommitted and untracked files, explicit exclusions (only `.git` by default), content hashes and mode. Bounded capture rejects unsupported/external links and special files, checks content before/after copying and retries capture changes at most twice. Baseline and check trees never share inodes.

The consumer uses native DSH sandbox and subprocess services with structured argv, private HOME/TMP/cache and a cleared environment. Strict verification permits writes only to the check directory, reads only declared runtime paths, and no network; missing affirmative full enforcement fails closed. Seatbelt has actual macOS evidence. Bubblewrap has profile tests but Linux runtime evidence remains pending. Landlock and Windows ACL reject the strict policy.

Check results separately record exit code, signal, timeout, cancellation, incomplete output and modifications of captured source files. Native managed ranges must reach quiescence before a result returns. Commands cannot write the directory holding their evidence. Source modifications invalidate acceptance of the original artifact.

Four snapshot cases and three actual native process cases pass. The latter exercise allowed copy writes, denied source reads/writes, denied local TCP, cleared environment, modified source despite exit zero and command timeout. Forty-three sandbox-local policy cases pass; the affected native packages compile and build.

An initial loader-read experiment left macOS processes waiting in kernel exit despite SIGKILL. Literal loader directory grants corrected startup and the subsequent seven cases settle; the earlier residue is not evidence of successful cleanup. Runtime startup is a deployment gate, not a profile-string assertion. The user deployment and frozen public evaluation were not replaced.

## Step 3

Pending: job binding, two-stage visibility, independent findings, per-criterion decisions, durable recovery and real-model validation.

## Plugin boundary correction (2026-09-28)

The user requested a plugin-first implementation. The sandbox evidence above comes from an isolated DSH source experiment: three native code files plus tests, documentation and generated catalog changes. User instances 59909 and 61454 and the frozen public comparison were not modified. Native commit `58153b7a78` is retained on a fork experimental branch and has not been merged upstream.

Production delivery moves to a plugin-owned check runtime, reusing existing native subprocess and Session services and removing the new sandbox-field dependency. Step 2 commit `e11a6e2` is experimental groundwork, not acceptance of an installable host-independent plugin. Step 3 code remains uncommitted. A scripted negative control independently executed the defective implementation before reading the main report and rejected it. Real-model validation reached host loading, a minimal request and planning, without approving node execution. Revalidate actual isolation and node review after migration.
