/** Native sandbox/subprocess consumer for one captured check directory. */
import { randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-sandbox'
import { classifyRunnerFailure } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { changedArtifacts, reviewPath, within, type ArtifactSnapshot } from './artifact-snapshot.ts'

export interface CheckPolicy { commandMs: number; outputBytes: number; graceMs: number; readRoots: string[]; path: string }
import { checkResultSchema, type CheckResult } from './verification-schema.ts'
export type { CheckResult } from './verification-schema.ts'

/** Fully specify check limits before accepting any model tool call. */
export function checkPolicy(input: Partial<CheckPolicy> = {}): CheckPolicy {
  const result = { commandMs: 300000, outputBytes: 1024 * 1024, graceMs: 2000, readRoots: [], path: process.env.PATH ?? '', ...input }
  for (const [name, value] of Object.entries({ commandMs: result.commandMs, outputBytes: result.outputBytes, graceMs: result.graceMs })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > (name === 'outputBytes' ? 16 * 1024 * 1024 : 3600000)) throw new TypeError(`invalid check ${name}`)
  }
  if (result.readRoots.some(path => !isAbsolute(path) || path === '/')) throw new TypeError('check readRoots require restricted absolute paths')
  return result
}

/** Scrub every ambient variable, including non-credential names carrying user paths or proxy configuration. */
export function checkEnvironment(snapshot: ArtifactSnapshot, policy: CheckPolicy): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]))
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'NODE_USE_ENV_PROXY', 'NODE_OPTIONS', 'PYTHONPATH']) env[key] = undefined
  return { ...env, PATH: policy.path, HOME: join(snapshot.check, 'home'), TMPDIR: join(snapshot.check, 'tmp'), TMP: join(snapshot.check, 'tmp'), TEMP: join(snapshot.check, 'tmp'),
    XDG_CACHE_HOME: join(snapshot.check, 'home', '.cache'), XDG_CONFIG_HOME: join(snapshot.check, 'home', '.config'),
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1', OPENSSL_CONF: '/dev/null', PYTHONDONTWRITEBYTECODE: '1', npm_config_cache: join(snapshot.check, 'home', '.npm') }
}

/** Run structured argv in the copy and join the native process range before returning or cancelling. */
export async function runCheck(ctx: Context, snapshot: ArtifactSnapshot, sessionId: SessionId, argv: string[], cwd: string,
  policy: CheckPolicy, signal: AbortSignal): Promise<CheckResult> {
  signal.throwIfAborted()
  if (!argv.length || argv.some(arg => arg.includes('\0'))) throw new TypeError('check argv must contain a program and valid arguments')
  const subprocess = ctx.get('subprocess'), sandbox = ctx.get('sandbox')
  if (!subprocess || !sandbox) throw new Error('CHECK_INFRASTRUCTURE: native subprocess and verification sandbox are required')
  const workingDirectory = await reviewPath(snapshot.check, cwd)
  if (!(await lstat(workingDirectory)).isDirectory()) throw new Error('CHECK_CWD: directory required')
  const env = checkEnvironment(snapshot, policy)
  const program = await subprocess.resolveExecutable(argv[0]!, { PATH: policy.path }, signal)
  const readRoots = [...new Set(await Promise.all(policy.readRoots.map(path => realpath(path))))]
  if (!within(snapshot.check, program) && !readRoots.some(root => within(root, program))) throw new Error(`CHECK_RUNTIME: executable is outside declared runtime roots: ${program}`)
  if (readRoots.some(root => within(root, snapshot.workspace) || within(snapshot.workspace, root) || within(root, snapshot.root))) throw new Error('CHECK_RUNTIME: runtime roots must not expose the source workspace or snapshot baseline')
  const timer = AbortSignal.timeout(policy.commandMs), combined = AbortSignal.any([signal, timer])
  const confined = await sandbox.confine([program, ...argv.slice(1)], { mode: 'workspace-write', workspaceRoot: snapshot.check,
    sessionId, verification: { readRoots } }, combined)
  if (confined.enforcement !== 'full' || confined.verificationEnforced !== true) throw new Error('CHECK_INFRASTRUCTURE: backend did not enforce verification restrictions')
  const id = randomUUID(), startedAt = new Date().toISOString()
  const handle = subprocess.spawn({ argv: confined.argv, cwd: workingDirectory, env, signal: combined, graceMs: policy.graceMs,
    stdio: { stdin: 'ignore', stdout: { maxBytes: policy.outputBytes }, stderr: { maxBytes: policy.outputBytes } } })
  let outcome
  try { outcome = await handle.done }
  finally {
    handle.terminate()
    if (!await handle.waitForExit(AbortSignal.timeout(policy.graceMs * 3))) throw new Error('CHECK_INFRASTRUCTURE: native process range did not reach quiescence')
  }
  const stdout = handle.collected.stdout!.readFrom(0), stderr = handle.collected.stderr!.readFrom(0)
  const failure = classifyRunnerFailure(outcome.exitCode, stderr.text, confined.runnerFailureRules)
  if (failure) throw new Error(`CHECK_INFRASTRUCTURE: ${failure.detail}`)
  const result: CheckResult = { id, snapshotId: snapshot.id, argv: [program, ...argv.slice(1)], cwd, startedAt,
    finishedAt: new Date().toISOString(), ...outcome, timedOut: timer.aborted, cancelled: signal.aborted,
    stdout: stdout.text, stderr: stderr.text, outputIncomplete: stdout.lossy || stderr.lossy, changed: await changedArtifacts(snapshot) }
  await writeFile(join(snapshot.root, `check-${id}.json`), JSON.stringify(result), { flag: 'wx', mode: 0o600 })
  return result
}

/** Read a host-owned check record; command processes cannot write this evidence directory. */
export async function readCheck(snapshot: ArtifactSnapshot, id: string): Promise<CheckResult> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('invalid check evidence id')
  return checkResultSchema.parse(JSON.parse(await readFile(join(snapshot.root, `check-${id}.json`), 'utf8')))
}
