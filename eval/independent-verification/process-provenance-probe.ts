/** Keyless profile fixture for the built administrator provenance API; never loads Agent/model plugins. */
import { randomUUID } from 'node:crypto'
import { cp, link, mkdir, open, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { WorldBinding } from '../../src/provenance-schema.ts'
import type { PausedWorldPolicy } from '../../src/provenance-docker.ts'
import { captureSnapshot } from '../../src/artifact-snapshot.ts'

export const name = 'process-provenance-native-probe'
export const inject = ['subprocess']
export interface Config {
  policy: Omit<PausedWorldPolicy, 'acquire' | 'now'>
  world: WorldBinding
  privateRoot: string
  controlRoot: string
  output: string
  builtEntry: string
  gitExecutable: string
  imageManifest: string
  foreign: { id: string; name: string; ownerLabel: { name: string; value: string } }
  extraWriter: { name: string; ownerLabel: { name: string; value: string } }
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
/** Atomic publication, with no overwrite of a prior attempt. */
async function publish(path: string, value: unknown) {
  const temp = path + '.' + randomUUID() + '.tmp', file = await open(temp, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync() } finally { await file.close() }
  try { await link(temp, path) } finally { await rm(temp, { force: true }) }
}
async function ownerActive(config: Config, deadline: string) {
  const state = JSON.parse(await readFile(join(config.controlRoot, 'owner-state.json'), 'utf8')) as { lease: string; active: boolean; atUnixMs: number }
  return state.lease === config.world.lease && state.active && Date.now() - state.atUnixMs < 2000 && Date.now() < Date.parse(deadline)
}
async function runProbe(ctx: Context, config: Config, signal: AbortSignal) {
  const api = await import(config.builtEntry) as typeof import('../../src/process-provenance.ts') & typeof import('../../src/provenance-docker.ts')
  if (typeof api.withPausedWorld !== 'function' || typeof api.analyzeGitCapture !== 'function') throw new Error('built administrator API entry is incomplete')
  const result: Record<string, unknown> = { schemaVersion: 1, kind: 'native-process-provenance-keyless', modelRequests: 0,
    imageManifest: config.imageManifest, imageConfigId: config.world.image, mainContainerId: config.world.containerId,
    adminContainerId: config.policy.admin.containerId, checks: {}, observations: [], limitations: [
      'Dedicated operator-controlled daemon lease; not a claim against arbitrary VM root or daemon administrators.',
      'Counter stability is a fixture observation, not a production barrier; the native Docker paused state is independently verified.',
      'Git analysis proves this captured metadata/baseline relation; binding authorization remains a trusted-caller duty.',
      'No model, process execution receipt, production task registration or formal candidate was exercised.'] }
  const checks = result.checks as Record<string, boolean>, observations = result.observations as unknown[]
  let acquired = 0, released = 0
  const policy: PausedWorldPolicy = { ...config.policy, async acquire(world) {
    if (!await ownerActive(config, world.deadlineAt)) throw new Error('external deployment owner is inactive')
    acquired++
    return { active: () => ownerActive(config, world.deadlineAt), async release() { released++ },
      withCutoffAuthority: (bounded, operation) => cutoffAuthority(world, bounded, operation) }
  } }
  async function docker(args: string[]) {
    const handle = ctx.subprocess.spawn({ argv: [policy.dockerExecutable, '--host', policy.endpoint, ...args], cwd: '/',
      env: { ...Object.fromEntries(Object.keys(process.env).map(key => [key, undefined])), HOME: '/', PATH: '', DOCKER_CONFIG: '/nonexistent-probe-config' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), graceMs: 1000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 65536 } } })
    try {
      const outcome = await handle.done, stdout = handle.collected.stdout!.readFrom(0), stderr = handle.collected.stderr!.readFrom(0)
      if (outcome.exitCode !== 0 || outcome.signal || stdout.lossy || stderr.lossy) throw new Error(`probe Docker ${args[0]} failed (${outcome.exitCode ?? outcome.signal})`)
      return stdout.text.trim()
    } finally { handle.terminate(); if (!await handle.waitForExit(AbortSignal.timeout(6000))) throw new Error('probe native Docker range is not quiescent') }
  }
  const inspect = async (id: string) => (JSON.parse(await docker(['inspect', '--type', 'container', id])) as { Id: string; Name: string; State: { Running: boolean; Paused: boolean }; Config: { Labels: Record<string, string> } }[])[0]!
  const count = async () => Number(await readFile(join(policy.workspace.adminPath, '.writer-counter'), 'utf8'))
  async function growing(after: number) {
    const end = Date.now() + 5000
    while (Date.now() < end) { signal.throwIfAborted(); const current = await count(); if (current > after) return current; await delay(25) }
    throw new Error('detached writer did not advance within its readiness bound')
  }
  async function reject(work: () => Promise<unknown>, expected: string) {
    try { await work() } catch (error) { observations.push({ rejected: String(error).slice(0, 1024) }); if (String(error).includes(expected)) return; throw error }
    throw new Error('negative case unexpectedly produced an admissible boundary')
  }
  async function cutoffAuthority(world: Readonly<WorldBinding>, bounded: AbortSignal, operation: () => Promise<void>) {
    const id = randomUUID(), request = { id, worldId: world.id, lease: world.lease, containerId: world.containerId, ownerLabel: world.ownerLabel }
    await publish(join(config.controlRoot, `cutoff-grant-request-${id}.json`), request)
    const response = join(config.controlRoot, `cutoff-grant-response-${id}.json`)
    let grant: { id: string; granted: boolean } | undefined
    while (!grant) {
      bounded.throwIfAborted()
      try { grant = JSON.parse(await readFile(response, 'utf8')) as typeof grant }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; await delay(20) }
    }
    if (grant.id !== id || !grant.granted) throw new Error('unauthorized external cutoff grant')
    try { await operation() }
    finally { await publish(join(config.controlRoot, `cutoff-grant-complete-${id}.json`), { id, operationReturned: true }) }
  }
  let extra: string | undefined
  try {
    const before = await growing(await count()), foreignBefore = await inspect(config.foreign.id)
    checks.detachedWriterActive = before > 0
    const captured = await api.withPausedWorld(ctx, policy, config.world, signal, async ({ path }, bounded) => {
      const first = await count(); await delay(250); const second = await count()
      checks.pausedWriterFrozen = first === second
      if (!checks.pausedWriterFrozen) throw new Error('detached writer advanced while the main world was paused')
      const root = join(config.privateRoot, 'captures', randomUUID()); await mkdir(root, { recursive: true, mode: 0o700 })
      const git = join(root, 'git'), snapshots = join(root, 'snapshots'), analysis = join(root, 'analysis')
      await mkdir(snapshots); await mkdir(analysis); await cp(join(path, '.git'), git, { recursive: true, dereference: false })
      const snapshot = await captureSnapshot(path, snapshots, { files: 10000, bytes: 64 * 1024 * 1024, excluded: ['.git'] }, bounded)
      const facts = await api.analyzeGitCapture(ctx, { adminOwnedGitDir: git, privateStorageRoot: analysis, gitExecutable: config.gitExecutable, snapshot }, bounded)
      checks.gitHead = facts.head !== null
      checks.gitStaged = facts.staged.map(item => item.path).join(',') === 'staged.txt'
      checks.gitDirty = facts.worktree.some(item => item.path === 'dirty.txt')
      checks.gitUntracked = facts.untracked.includes('untracked.txt') && facts.untracked.includes('.writer-counter')
      checks.gitNotClean = facts.wholeWorkspaceClean === false && !facts.headMatchesCapturedArtifacts
      checks.privateAnalysisCleaned = (await readdir(analysis)).length === 0
      observations.push({ snapshotId: snapshot.id, artifactDigest: snapshot.digest, facts, pausedCounter: second })
      return second
    })
    checks.pauseBoundaryReleased = captured.boundary.released
    checks.writerResumed = await growing(captured.value) > captured.value
    await reject(() => api.withPausedWorld(ctx, policy, { ...config.world, ownerLabel: { ...config.world.ownerLabel, value: 'wrong-owner' } }, signal, async () => 'unexpected'), 'container owner')
    checks.wrongOwnerRejected = !(await inspect(config.world.containerId)).State.Paused
    extra = await docker(['create', '--name', config.extraWriter.name, '--label', `${config.extraWriter.ownerLabel.name}=${config.extraWriter.ownerLabel.value}`,
      '--network', 'none', '--cpus', '0.1', '--memory', '128m', '--mount', `type=volume,source=${policy.workspace.volumeName},target=/extra`,
      '--entrypoint', '/bin/sleep', config.imageManifest, '120'])
    await publish(join(config.controlRoot, 'extra-created.json'), { id: extra, name: config.extraWriter.name, ownerLabel: config.extraWriter.ownerLabel })
    await docker(['start', extra])
    await reject(() => api.withPausedWorld(ctx, policy, config.world, signal, async () => 'unexpected'), 'additional writable')
    checks.additionalWriterRejected = !(await inspect(config.world.containerId)).State.Paused
    await docker(['rm', '-f', extra]); extra = undefined
    await reject(() => api.withPausedWorld(ctx, policy, config.world, signal, async () => { throw new Error('intentional capture callback failure') }), 'intentional capture callback failure')
    const resumed = await inspect(config.world.containerId)
    checks.callbackFailureUnpaused = resumed.State.Running && !resumed.State.Paused
    checks.callbackFailureWriterResumed = await growing(await count()) > 0
    let unauthorizedCalled = false
    await reject(() => cutoffAuthority({ ...config.world, containerId: config.foreign.id }, signal,
      async () => { unauthorizedCalled = true }), 'unauthorized')
    checks.foreignCutoffGrantDenied = !unauthorizedCalled
    const expiring = { ...config.world, deadlineAt: new Date(Date.now() + 10000).toISOString() }
    await publish(join(config.controlRoot, 'deadline-request.json'), { containerId: expiring.containerId, deadlineAt: expiring.deadlineAt, ownerLabel: expiring.ownerLabel })
    await reject(() => api.withPausedWorld(ctx, policy, expiring, signal, async (_source, bounded) => {
      await publish(join(config.controlRoot, 'deadline-callback.json'), { paused: true, at: new Date().toISOString(), counter: await count() })
      await new Promise<never>((_resolve, reject) => bounded.addEventListener('abort', () => reject(new Error('expected capture deadline')), { once: true }))
    }), 'deadline')
    const stopped = await inspect(config.world.containerId), first = await count(); await delay(250); const last = await count()
    checks.deadlineExactMainStopped = !stopped.State.Running
    checks.deadlineDetachedWriterStopped = first === last
    const foreignAfter = await inspect(config.foreign.id)
    checks.foreignUntouched = foreignBefore.Id === foreignAfter.Id && foreignAfter.Name === '/' + config.foreign.name
      && foreignAfter.Config.Labels[config.foreign.ownerLabel.name] === config.foreign.ownerLabel.value
      && foreignAfter.State.Running && !foreignAfter.State.Paused
    checks.externalLeaseReleased = acquired === released
    observations.push({ boundary: captured.boundary, acquired, released, stoppedCounter: last })
  } catch (error) { result.fault = { errorType: error instanceof Error ? error.name : 'unknown', message: String(error).slice(0, 2048) } }
  finally {
    if (extra) {
      const row = await inspect(extra)
      if (row.Id !== extra || row.Config.Labels[config.extraWriter.ownerLabel.name] !== config.extraWriter.ownerLabel.value) throw new Error('extra writer cleanup identity differs')
      await docker(['rm', '-f', extra])
    }
  }
  result.passed = !result.fault && Object.values(checks).every(value => value) && Object.keys(checks).length >= 17
  await publish(config.output, result)
  return result.passed === true
}

export function apply(ctx: Context, config: Config) {
  ctx.effect(async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('native provenance probe overall deadline')), 120000)
    let rangesConfirmed: boolean | null = null
    try { if (await runProbe(ctx, config, controller.signal)) rangesConfirmed = true }
    catch (error) { await publish(config.output, { schemaVersion: 1, kind: 'native-process-provenance-keyless', modelRequests: 0, passed: false, fault: { errorType: error instanceof Error ? error.name : 'unknown', message: String(error).slice(0, 2048) } }) }
    finally { clearTimeout(timer); await publish(join(config.controlRoot, 'probe-settled.json'), { probeReturned: true, nativeRangesSettled: rangesConfirmed, at: new Date().toISOString() }) }
    return () => controller.abort(new Error('native provenance probe disposed'))
  })
}
