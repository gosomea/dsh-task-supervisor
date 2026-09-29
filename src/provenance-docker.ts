/** Administrator-owned Docker capture barrier. It does not authenticate a model-world controller. */
import { realpath, lstat } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { worldBindingSchema, type WorldBinding } from './provenance-schema.ts'

export interface DockerPauseLease {
  /** Must observe the administrator's external deadline/cutoff owner, which remains live while the main world is paused. */
  active(): Promise<boolean>
  release(): Promise<void>
  /** Upgrade an owned lock, or reacquire after release, through the external cutoff registry. Reject superseded/foreign authority; never merely trust an active boolean. */
  withCutoffAuthority(signal: AbortSignal, operation: () => Promise<void>): Promise<void>
}
export interface PausedWorldPolicy {
  dockerExecutable: string
  endpoint: string
  daemonIdentity: string
  mainContainerName: string
  /** image and WorldBinding.image are Docker inspect.Image config IDs, not pull manifest digests. Deployment separately pins and verifies the manifest-to-config resolution. */
  admin: { containerId: string; name: string; image: string; ownerLabel: { name: string; value: string } }
  workspace: { identity: string; volumeName: string; mountpoint: string; ownerLabel: { name: string; value: string }; mainPath: string; adminPath: string }
  /** Own the exclusive daemon deployment lease shared with cutoff; forbid other containers and host writers from modifying the volume. An active bit alone does not prove that contract. */
  acquire(world: Readonly<WorldBinding>, signal: AbortSignal): Promise<DockerPauseLease>
  now?: () => number
}
export interface DockerCaptureBoundary {
  kind: 'docker-paused'; worldId: string; startedAt: string; finishedAt: string; released: true
}
export class UnsupportedWorldTopology extends Error {
  constructor(message: string) { super(`PROVENANCE_UNAVAILABLE: ${message}`); this.name = 'UnsupportedWorldTopology' }
}

interface Mount { Type: string; Name?: string; Source: string; Destination: string; RW: boolean }
interface Container { Id: string; Name: string; Image: string; Config: { Labels: Record<string, string> | null }; State: { Running: boolean; Paused: boolean }; Mounts: Mount[] }
const unavailable = (message: string): never => { throw new UnsupportedWorldTopology(message) }
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === '' || rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel) }
const validPath = (path: string) => isAbsolute(path) && path !== '/' && !path.includes('\0') && !path.includes('\n')

/** All privileged paths and identities come from administrator configuration, never model request fields. */
export async function withPausedWorld<T>(ctx: Context, policy: PausedWorldPolicy, binding: WorldBinding, signal: AbortSignal,
  capture: (source: { path: string; world: Readonly<WorldBinding> }, signal: AbortSignal) => Promise<T>): Promise<{ value: T; boundary: DockerCaptureBoundary }> {
  const world = worldBindingSchema.parse(binding), now = policy.now ?? Date.now
  const deadline = Date.parse(world.deadlineAt), workspace = policy.workspace
  if (!validPath(policy.dockerExecutable) || !/^unix:\/\/\/[^\0\n]+$/.test(policy.endpoint)
    || !validPath(workspace.mainPath) || !validPath(workspace.adminPath) || !validPath(workspace.mountpoint)
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]+$/.test(workspace.volumeName) || !/^[a-f0-9]{64}$/.test(policy.admin.containerId)
    || world.containerId === policy.admin.containerId || world.daemonIdentity !== policy.daemonIdentity
    || world.workspaceIdentity !== workspace.identity || world.cwd !== workspace.mainPath) unavailable('fixed administrator world/volume configuration does not match')
  if (deadline <= now()) unavailable('world lease has expired')
  signal.throwIfAborted()
  const worldSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadline - now()))])
  const subprocess = ctx.get('subprocess')
  if (!subprocess) throw new UnsupportedWorldTopology('native subprocess service is required')
  const docker = await subprocess.resolveExecutable(policy.dockerExecutable, {}, worldSignal)
  if (docker !== policy.dockerExecutable) unavailable('administrator Docker binary differs from the configured runtime')
  async function command(args: string[], commandSignal: AbortSignal) {
    const handle = subprocess!.spawn({ argv: [docker, '--host', policy.endpoint, ...args], cwd: '/',
      env: { ...Object.fromEntries(Object.keys(process.env).map(key => [key, undefined])), PATH: '', HOME: '/', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', DOCKER_CONFIG: '/nonexistent-provenance-config' },
      signal: AbortSignal.any([commandSignal, AbortSignal.timeout(15000)]), graceMs: 2000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 65536 } } })
    let failure: unknown, failed = false, text = ''
    try {
      const outcome = await handle.done, stdout = handle.collected.stdout!.readFrom(0), stderr = handle.collected.stderr!.readFrom(0)
      if (outcome.exitCode !== 0 || outcome.signal || stdout.lossy || stderr.lossy) throw new Error(`PROVENANCE_DOCKER: ${args[0]} did not produce a complete successful outcome`)
      text = stdout.text
    } catch (error) { failed = true; failure = error }
    finally {
      try {
        handle.terminate()
        if (!await handle.waitForExit(AbortSignal.timeout(6000))) throw new Error('PROVENANCE_QUIESCENCE: native Docker process range remains active')
      } catch (cleanup) {
        throw failed ? new AggregateError([failure, cleanup], 'Docker operation and native range cleanup failed') : cleanup
      }
    }
    if (failed) throw failure
    return text
  }
  async function inspect(id: string, s: AbortSignal): Promise<Container> {
    const rows = JSON.parse(await command(['inspect', '--type', 'container', id], s)) as Container[]
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.Id !== id) unavailable('exact container inspection differs')
    return rows[0]!
  }
  function identity(row: Container, id: string, name: string, image: string, label: { name: string; value: string }) {
    if (row.Id !== id || row.Name !== `/${name}` || row.Image !== image || row.Config?.Labels?.[label.name] !== label.value) unavailable('container owner, name, image or exact ID differs')
  }
  function volumeMount(row: Container, path: string, writable: boolean) {
    const overlapping = row.Mounts.filter(mount => inside(path, mount.Destination) || inside(mount.Destination, path))
    const mount = overlapping[0]
    if (overlapping.length !== 1 || !mount || mount.Type !== 'volume' || mount.Name !== workspace.volumeName
      || mount.Source !== workspace.mountpoint || mount.Destination !== path || mount.RW !== writable) unavailable('workspace must be one exact named-volume mount with no overlaps')
  }
  async function assertOnlyMainWriter(main: Container, admin: Container | undefined, s: AbortSignal) {
    // Enumerate all containers: a bind mount of the volume's daemon path need not match Docker's named-volume filter.
    const containers = (await command(['container', 'ls', '-aq', '--no-trunc'], s)).trim().split(/\s+/).filter(Boolean)
    for (const id of containers) {
      if (!/^[a-f0-9]{64}$/.test(id)) unavailable('ambiguous workspace writer identity')
      const row = id === main.Id ? main : id === admin?.Id ? admin : await inspect(id, s)
      if (row.Id !== main.Id && row.Mounts.some(mount => mount.RW && (inside(workspace.mountpoint, mount.Source) || inside(mount.Source, workspace.mountpoint)))) unavailable('workspace has an additional writable container mount')
    }
  }
  async function verify(s: AbortSignal) {
    const main = await inspect(world.containerId, s), admin = await inspect(policy.admin.containerId, s)
    identity(main, world.containerId, policy.mainContainerName, world.image, world.ownerLabel)
    identity(admin, policy.admin.containerId, policy.admin.name, policy.admin.image, policy.admin.ownerLabel)
    if (!main.State?.Running || !admin.State?.Running || admin.State.Paused) unavailable('main/admin must be running and the external administrator must remain unpaused')
    volumeMount(main, workspace.mainPath, true); volumeMount(admin, workspace.adminPath, false)
    const volumes = JSON.parse(await command(['volume', 'inspect', workspace.volumeName], s)) as { Name: string; Mountpoint: string; Labels: Record<string, string> | null }[]
    if (volumes.length !== 1 || volumes[0]?.Name !== workspace.volumeName || volumes[0].Mountpoint !== workspace.mountpoint
      || volumes[0].Labels?.[workspace.ownerLabel.name] !== workspace.ownerLabel.value) unavailable('workspace volume identity differs')
    await assertOnlyMainWriter(main, admin, s)
    if (await realpath(workspace.adminPath) !== workspace.adminPath || !(await lstat(workspace.adminPath)).isDirectory()) unavailable('administrator workspace source was redirected')
    return main
  }
  const lease = await policy.acquire(world, worldSignal)
  let attemptedPause = false, pauseConfirmed = false, startedAt = '', value!: T, failed = false, failure: unknown, released = false, cutoffConfirmed = false
  async function stopExpiredWorld(main: Container, cleanupSignal: AbortSignal) {
    identity(main, world.containerId, policy.mainContainerName, world.image, world.ownerLabel)
    await lease.withCutoffAuthority(cleanupSignal, async () => {
      const current = await inspect(world.containerId, cleanupSignal)
      identity(current, world.containerId, policy.mainContainerName, world.image, world.ownerLabel)
      if (current.State.Running) await command(['stop', '--time', '0', world.containerId], cleanupSignal)
      const stopped = await inspect(world.containerId, cleanupSignal)
      identity(stopped, world.containerId, policy.mainContainerName, world.image, world.ownerLabel)
      if (stopped.State.Running) throw new Error('PROVENANCE_QUIESCENCE: expired main world remains running')
      await assertOnlyMainWriter(stopped, undefined, cleanupSignal)
    })
    cutoffConfirmed = true
    released = false
    if (!failed) { failed = true; failure = new Error('PROVENANCE_EXPIRED: capture ended after owner cutoff') }
  }
  try {
    if (!await lease.active() || now() >= deadline) unavailable('external owner lease is no longer active')
    const main = await verify(worldSignal)
    if (main.State.Paused) unavailable('main world is already paused by another operation')
    worldSignal.throwIfAborted()
    if (!await lease.active() || now() >= deadline) unavailable('external owner expired before pause')
    attemptedPause = true
    await command(['pause', world.containerId], worldSignal)
    if (!(await verify(worldSignal)).State.Paused) unavailable('main world did not acknowledge the capture barrier')
    pauseConfirmed = true
    startedAt = new Date(now()).toISOString()
    if (!await lease.active() || now() >= deadline) unavailable('external owner expired before capture')
    const bounded = worldSignal
    value = await capture({ path: workspace.adminPath, world: Object.freeze({ ...world, ownerLabel: Object.freeze({ ...world.ownerLabel }) }) }, bounded)
    bounded.throwIfAborted()
    if (!(await verify(bounded)).State.Paused || !await lease.active() || now() >= deadline) unavailable('capture barrier or owner expired before publication')
  } catch (error) { failed = true; failure = error }
  finally {
    const cleanupFailures: unknown[] = []
    if (attemptedPause && !cutoffConfirmed) try {
      const cleanupSignal = AbortSignal.timeout(30000), main = await inspect(world.containerId, cleanupSignal)
      identity(main, world.containerId, policy.mainContainerName, world.image, world.ownerLabel)
      if (!await lease.active() || now() >= deadline) {
        // The independently owned cutoff wins; do not resume model work after expiry.
        await stopExpiredWorld(main, cleanupSignal)
      } else {
        if (!main.State.Paused && !pauseConfirmed && failed) {
          // A failed pause with no daemon effect owns no pause to release.
        } else {
          if (!main.State.Running || !main.State.Paused) unavailable('owned capture pause was lost before release')
          await command(['unpause', world.containerId], cleanupSignal)
          const resumed = await inspect(world.containerId, cleanupSignal)
          identity(resumed, world.containerId, policy.mainContainerName, world.image, world.ownerLabel)
          if (!resumed.State.Running || resumed.State.Paused) throw new Error('PROVENANCE_QUIESCENCE: owned pause release is unconfirmed')
          if (!await lease.active() || now() >= deadline) await stopExpiredWorld(resumed, cleanupSignal)
          else released = true
        }
      }
    } catch (error) { cleanupFailures.push(error) }
    try { await lease.release() } catch (error) { cleanupFailures.push(error) }
    // Release itself may cross cutoff. A renewed cutoff grant, not the released pause lock, owns any subsequent stop.
    if (attemptedPause && !cutoffConfirmed) try {
      if (!await lease.active() || now() >= deadline) {
        const cleanupSignal = AbortSignal.timeout(30000)
        await stopExpiredWorld(await inspect(world.containerId, cleanupSignal), cleanupSignal)
      }
    } catch (error) { cleanupFailures.push(error) }
    if (cleanupFailures.length) throw new AggregateError([...(failed ? [failure] : []), ...cleanupFailures], 'PROVENANCE_QUIESCENCE: capture/release failure; no boundary is admitted')
  }
  if (failed) throw failure
  if (!released) unavailable('capture did not finish within an acknowledged released boundary')
  const finished = now()
  if (finished >= deadline) {
    try {
      if (!cutoffConfirmed) {
        const cleanupSignal = AbortSignal.timeout(30000)
        await stopExpiredWorld(await inspect(world.containerId, cleanupSignal), cleanupSignal)
      }
    } catch (error) { throw new AggregateError([error], 'PROVENANCE_QUIESCENCE: final cutoff convergence is unconfirmed; no boundary is admitted') }
    throw new Error('PROVENANCE_EXPIRED: capture boundary finished after cutoff')
  }
  return { value, boundary: { kind: 'docker-paused', worldId: world.id, startedAt, finishedAt: new Date(finished).toISOString(), released: true } }
}
