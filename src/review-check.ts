/** Plugin-owned Docker confinement with native DSH subprocess ownership. */
import { randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, writeFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { changedArtifacts, reviewPath, type ArtifactSnapshot } from './artifact-snapshot.ts'
import { checkResultSchema, type CheckResult } from './verification-schema.ts'
export type { CheckResult } from './verification-schema.ts'

export interface ContainerPolicy { context: string; image: string; cpus: number; memoryMiB: number; pids: number }
export interface CheckPolicy { commandMs: number; outputBytes: number; graceMs: number; container: ContainerPolicy; path: string }

/** Require an administrator-selected local context and immutable image, with bounded resources. */
export function checkPolicy(input: Partial<CheckPolicy> & { container: ContainerPolicy }): CheckPolicy {
  const result = { commandMs: 300000, outputBytes: 1024 * 1024, graceMs: 2000, path: process.env.PATH ?? '', ...input }
  for (const [name, value] of Object.entries({ commandMs: result.commandMs, outputBytes: result.outputBytes, graceMs: result.graceMs })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > (name === 'outputBytes' ? 16 * 1024 * 1024 : 3600000)) throw new TypeError(`invalid check ${name}`)
  }
  const { context, image, cpus, memoryMiB, pids } = result.container
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(context) || !/^(?:sha256:[a-f0-9]{64}|[^\s]+@sha256:[a-f0-9]{64})$/.test(image) || image.startsWith('-')) throw new TypeError('check container requires a local Docker context and immutable image digest')
  if (!Number.isFinite(cpus) || cpus <= 0 || cpus > 16 || !Number.isSafeInteger(memoryMiB) || memoryMiB < 64 || memoryMiB > 16384 || !Number.isSafeInteger(pids) || pids < 8 || pids > 1024) throw new TypeError('invalid check container resource limits')
  return result
}

/** Remove all ambient command variables; Docker control metadata is never forwarded into the container. */
export function checkEnvironment(snapshot: ArtifactSnapshot, policy: CheckPolicy): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]))
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'NODE_USE_ENV_PROXY', 'NODE_OPTIONS', 'PYTHONPATH']) env[key] = undefined
  return { ...env, PATH: policy.path, HOME: join(snapshot.check, 'home'), TMPDIR: join(snapshot.check, 'tmp'), TMP: join(snapshot.check, 'tmp'), TEMP: join(snapshot.check, 'tmp'),
    DOCKER_CONFIG: process.env.DOCKER_CONFIG ?? join(homedir(), '.docker'), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }
}

/** Observe the exact native managed range even when cancellation arrives before done. */
async function managed(ctx: Context, argv: string[], cwd: string, env: NodeJS.ProcessEnv, policy: CheckPolicy, signal: AbortSignal) {
  signal.throwIfAborted()
  const subprocess = ctx.get('subprocess')
  if (!subprocess) throw new Error('CHECK_INFRASTRUCTURE: native subprocess is required')
  const handle = subprocess.spawn({ argv, cwd, env, signal, graceMs: policy.graceMs,
    stdio: { stdin: 'ignore', stdout: { maxBytes: policy.outputBytes }, stderr: { maxBytes: policy.outputBytes } } })
  try {
    let outcome
    try { outcome = await Promise.race([handle.done, new Promise<never>((_resolve, reject) => {
      const abort = () => reject(signal.reason)
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
      void handle.done.finally(() => signal.removeEventListener('abort', abort)).catch(() => {})
    })]) } catch (error) {
      if (!signal.aborted) throw error
      handle.terminate()
      if (!await handle.waitForExit(AbortSignal.timeout(policy.graceMs * 3))) throw new Error('CHECK_INFRASTRUCTURE: native process range did not reach quiescence')
      outcome = await handle.done
    }
    return { ...outcome, stdout: handle.collected.stdout!.readFrom(0), stderr: handle.collected.stderr!.readFrom(0) }
  } finally {
    handle.terminate()
    if (!await handle.waitForExit(AbortSignal.timeout(policy.graceMs * 3))) throw new Error('CHECK_INFRASTRUCTURE: native process range did not reach quiescence')
  }
}

/** Remove only this snapshot's uniquely named container; daemon resources outlive the Docker CLI. */
async function removeOwned(ctx: Context, prefix: string[], name: string, snapshot: ArtifactSnapshot, env: NodeJS.ProcessEnv, policy: CheckPolicy) {
  const signal = AbortSignal.timeout(15000)
  const found = await managed(ctx, [...prefix, 'container', 'ls', '-aq', '--no-trunc', '--filter', `name=^/${name}$`], snapshot.check, env, policy, signal)
  if (found.exitCode !== 0 || found.stdout.lossy || found.stderr.lossy) throw new Error('CHECK_INFRASTRUCTURE: cannot observe owned container cleanup')
  const id = found.stdout.text.trim()
  if (!id) return
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('CHECK_INFRASTRUCTURE: ambiguous container identity')
  const inspected = await managed(ctx, [...prefix, 'inspect', id], snapshot.check, env, policy, signal)
  if (inspected.exitCode !== 0 || inspected.stdout.lossy) throw new Error('CHECK_INFRASTRUCTURE: container ownership cannot be verified')
  const rows = JSON.parse(inspected.stdout.text) as { Name: string; Config: { Labels: Record<string, string> } }[]
  if (rows.length !== 1 || rows[0]!.Name !== `/${name}` || rows[0]!.Config.Labels['dsh.supervisor.snapshot'] !== snapshot.id) throw new Error('CHECK_INFRASTRUCTURE: container ownership mismatch; refusing removal')
  const removed = await managed(ctx, [...prefix, 'rm', '-f', id], snapshot.check, env, policy, signal)
  if (removed.exitCode !== 0) throw new Error('CHECK_INFRASTRUCTURE: owned container did not reach quiescence')
  const remaining = await managed(ctx, [...prefix, 'container', 'ls', '-aq', '--filter', `id=${id}`], snapshot.check, env, policy, signal)
  if (remaining.exitCode !== 0 || remaining.stdout.lossy || remaining.stdout.text.trim()) throw new Error('CHECK_INFRASTRUCTURE: owned container removal is unconfirmed')
}

/** Recover interrupted daemon resources before reusing a review snapshot; never remove by a guessed task name. */
export async function recoverCheckContainers(ctx: Context, snapshot: ArtifactSnapshot, policy: CheckPolicy, signal: AbortSignal): Promise<void> {
  const pending = (await readdir(snapshot.root)).filter(name => /^container-[a-f0-9-]{36}\.json$/.test(name))
  const env = checkEnvironment(snapshot, policy)
  for (const file of pending) {
    signal.throwIfAborted()
    const id = file.slice(10, -5)
    try { await lstat(join(snapshot.root, `removed-${id}.json`)); continue } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
    const record = JSON.parse(await readFile(join(snapshot.root, file), 'utf8')) as { name: string; endpoint: string; snapshotId: string }
    if (record.snapshotId !== snapshot.id || record.name !== `dsh-review-${id}` || !record.endpoint.startsWith('unix:///') || record.endpoint.includes('\0')) throw new Error('CHECK_INFRASTRUCTURE: invalid interrupted container identity')
    const subprocess = ctx.get('subprocess')
    if (!subprocess) throw new Error('CHECK_INFRASTRUCTURE: native subprocess is required')
    const docker = await subprocess.resolveExecutable('docker', { PATH: policy.path }, signal)
    await removeOwned(ctx, [docker, '--host', record.endpoint], record.name, snapshot, env, policy)
    await writeFile(join(snapshot.root, `removed-${id}.json`), JSON.stringify({ name: record.name, removed: true, recovery: true }), { flag: 'wx', mode: 0o600 })
  }
}

/** Run only the check mount, in an immutable runtime image, with no host network or Docker socket. */
export async function runCheck(ctx: Context, snapshot: ArtifactSnapshot, sessionId: SessionId, argv: string[], cwd: string,
  policy: CheckPolicy, signal: AbortSignal): Promise<CheckResult> {
  signal.throwIfAborted()
  if (!argv.length || argv.some(arg => arg.includes('\0')) || argv[0]!.startsWith('-')) throw new TypeError('check argv must contain a program and valid arguments')
  const subprocess = ctx.get('subprocess')
  if (!subprocess) throw new Error('CHECK_INFRASTRUCTURE: native subprocess is required')
  const workingDirectory = await reviewPath(snapshot.check, cwd)
  if (!(await lstat(workingDirectory)).isDirectory()) throw new Error('CHECK_CWD: directory required')
  const env = checkEnvironment(snapshot, policy), docker = await subprocess.resolveExecutable('docker', { PATH: policy.path }, signal)
  const timer = AbortSignal.timeout(policy.commandMs), combined = AbortSignal.any([signal, timer])
  const context = await managed(ctx, [docker, 'context', 'inspect', policy.container.context], snapshot.check, env, policy, combined)
  if (context.exitCode !== 0 || context.stdout.lossy) throw new Error('CHECK_INFRASTRUCTURE: Docker context unavailable')
  const contexts = JSON.parse(context.stdout.text) as { Endpoints: { docker: { Host: string } } }[]
  const endpoint = contexts.length === 1 ? contexts[0]!.Endpoints.docker.Host : ''
  if (!endpoint.startsWith('unix:///') || endpoint.includes('\0')) throw new Error('CHECK_INFRASTRUCTURE: host-backed snapshots require a local Unix Docker endpoint')
  const prefix = [docker, '--host', endpoint], id = randomUUID(), name = `dsh-review-${id}`, startedAt = new Date().toISOString()
  // This durable identity allows a cancelled/restarted review to trace its exact daemon resource.
  await writeFile(join(snapshot.root, `container-${id}.json`), JSON.stringify({ name, endpoint, image: policy.container.image, snapshotId: snapshot.id, sessionId }), { flag: 'wx', mode: 0o600 })
  let outcome: Awaited<ReturnType<typeof managed>> | undefined, state: { ExitCode: number; OOMKilled: boolean; Error: string } | undefined
  try {
    const check = await realpath(snapshot.check)
    if (check.includes(',') || check.includes('\n')) throw new Error('CHECK_INFRASTRUCTURE: unsupported bind mount path')
    const uid = process.getuid?.() ?? 1000, gid = process.getgid?.() ?? 1000
    const created = await managed(ctx, [...prefix, 'create', '--name', name, '--label', `dsh.supervisor.snapshot=${snapshot.id}`, '--pull', 'never',
      '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', String(policy.container.pids),
      '--cpus', String(policy.container.cpus), '--memory', `${policy.container.memoryMiB}m`, '--memory-swap', `${policy.container.memoryMiB}m`,
      '--user', `${uid}:${gid}`, '--mount', `type=bind,source=${check},target=/check`, '--workdir', `/check/${relative(snapshot.check, workingDirectory).split(sep).join('/')}`,
      '--env', 'HOME=/check/home', '--env', 'TMPDIR=/check/tmp', '--env', 'TMP=/check/tmp', '--env', 'TEMP=/check/tmp', '--env', 'XDG_CACHE_HOME=/check/home/.cache', '--env', 'XDG_CONFIG_HOME=/check/home/.config', '--env', 'npm_config_cache=/check/home/.npm', '--env', 'PYTHONDONTWRITEBYTECODE=1',
      '--env', 'OPENSSL_CONF=/dev/null', '--env', 'NO_COLOR=1', '--entrypoint', '/usr/bin/timeout', policy.container.image,
      '--signal=TERM', '--kill-after=2s', `${Math.max(0.001, policy.commandMs / 1000)}s`, ...argv], snapshot.check, env, policy, combined)
    if (created.exitCode !== 0 || created.stdout.lossy) throw new Error(`CHECK_INFRASTRUCTURE: container creation failed: ${created.stderr.text}`)
    outcome = await managed(ctx, [...prefix, 'start', '-a', name], snapshot.check, env, policy, combined)
    const inspection = await managed(ctx, [...prefix, 'inspect', '--format', '{{json .State}}', name], snapshot.check, env, policy, combined)
    if (inspection.exitCode !== 0 || inspection.stdout.lossy) throw new Error('CHECK_INFRASTRUCTURE: command outcome unavailable')
    state = JSON.parse(inspection.stdout.text) as typeof state
    if (!state || state.Error || state.OOMKilled || [125, 126, 127].includes(state.ExitCode)) throw new Error(`CHECK_INFRASTRUCTURE: runtime failed: ${state?.Error || (state?.OOMKilled ? 'out of memory' : state?.ExitCode)}`)
  } catch (error) {
    if (!combined.aborted) throw error
  } finally {
    await removeOwned(ctx, prefix, name, snapshot, env, policy)
    await writeFile(join(snapshot.root, `removed-${id}.json`), JSON.stringify({ name, removed: true }), { flag: 'wx', mode: 0o600 })
  }
  const result: CheckResult = { id, snapshotId: snapshot.id, argv, cwd, startedAt, finishedAt: new Date().toISOString(),
    runtime: { kind: 'docker', context: policy.container.context, image: policy.container.image, containerName: name },
    exitCode: state?.ExitCode ?? null, signal: null, timedOut: timer.aborted || state?.ExitCode === 124, cancelled: signal.aborted,
    stdout: outcome?.stdout.text ?? '', stderr: outcome?.stderr.text ?? '', outputIncomplete: !outcome || outcome.stdout.lossy || outcome.stderr.lossy, changed: await changedArtifacts(snapshot) }
  await writeFile(join(snapshot.root, `check-${id}.json`), JSON.stringify(result), { flag: 'wx', mode: 0o600 })
  return result
}

/** Read a host-owned check record; command processes cannot write this evidence directory. */
export async function readCheck(snapshot: ArtifactSnapshot, id: string): Promise<CheckResult> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('invalid check evidence id')
  return checkResultSchema.parse(JSON.parse(await readFile(join(snapshot.root, `check-${id}.json`), 'utf8')))
}
