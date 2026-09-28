# Independent verification development and validation

## Step 2

Snapshot and native check foundations are implemented; formal reviewer integration remains step 3. Snapshots include the working tree, uncommitted and untracked files, explicit exclusions (only `.git` by default), content hashes and mode. Bounded capture rejects unsupported/external links and special files, checks content before/after copying and retries capture changes at most twice. Baseline and check trees never share inodes.

The consumer uses native DSH sandbox and subprocess services with structured argv, private HOME/TMP/cache and a cleared environment. Strict verification permits writes only to the check directory, reads only declared runtime paths, and no network; missing affirmative full enforcement fails closed. Seatbelt has actual macOS evidence. Bubblewrap has profile tests but Linux runtime evidence remains pending. Landlock and Windows ACL reject the strict policy.

Check results separately record exit code, signal, timeout, cancellation, incomplete output and modifications of captured source files. Native managed ranges must reach quiescence before a result returns. Commands cannot write the directory holding their evidence. Source modifications invalidate acceptance of the original artifact.

Four snapshot cases and three actual native process cases pass. The latter exercise allowed copy writes, denied source reads/writes, denied local TCP, cleared environment, modified source despite exit zero and command timeout. Forty-three sandbox-local policy cases pass; the affected native packages compile and build.

An initial loader-read experiment left macOS processes waiting in kernel exit despite SIGKILL. Literal loader directory grants corrected startup and the subsequent seven cases settle; the earlier residue is not evidence of successful cleanup. Runtime startup is a deployment gate, not a profile-string assertion. The user deployment and frozen public evaluation were not replaced.

## Step 3

Pending: job binding, two-stage visibility, independent findings, per-criterion decisions, durable recovery and real-model validation.
