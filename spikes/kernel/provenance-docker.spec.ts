/** Keyless native-subprocess contract tests; these do not attest a real Docker freezer. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withPausedWorld, type PausedWorldPolicy } from '../../src/provenance-docker.ts'
import type { WorldBinding } from '../../src/provenance-schema.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const id = 'a'.repeat(64), adminId = 'b'.repeat(64), foreignId = 'c'.repeat(64), image = `sha256:${'d'.repeat(64)}`
type Row = { Id: string; Name: string; Image: string; Config: { Labels: Record<string, string> }; State: { Running: boolean; Paused: boolean }; Mounts: { Type: string; Name?: string; Source: string; Destination: string; RW: boolean }[] }
async function fixture() {
  const source = await realpath(await mkdtemp(join(tmpdir(), 'provenance-source-'))); roots.push(source)
  let clock = Date.now(), active = true
  const mountpoint = '/var/lib/docker/volumes/workspace-owned/_data'
  const world: WorldBinding = { id: randomUUID(), lease: 'lease-main', mainSessionId: 'session-main', backend: 'docker',
    daemonIdentity: 'unix:///admin/docker.sock', containerId: id, ownerLabel: { name: 'owner', value: 'lease-main' },
    image, workspaceIdentity: 'workspace-owned', cwd: '/app', deadlineAt: new Date(clock + 60000).toISOString() }
  const main: Row = { Id: id, Name: '/main', Image: image, Config: { Labels: { owner: 'lease-main' } }, State: { Running: true, Paused: false },
    Mounts: [{ Type: 'volume', Name: 'workspace-owned', Source: mountpoint, Destination: '/app', RW: true }] }
  const admin: Row = { Id: adminId, Name: '/admin', Image: image, Config: { Labels: { owner: 'lease-admin' } }, State: { Running: true, Paused: false },
    Mounts: [{ Type: 'volume', Name: 'workspace-owned', Source: mountpoint, Destination: source, RW: false }] }
  const rows = new Map([[id, main], [adminId, admin]])
  const faults = { pauseBefore: false, pauseAfter: false, unpause: false, stopRunning: false, lossyInspect: false, rangeActive: false, expireOnUnpause: false }
  const commands: string[][] = [], specs: SubprocessSpawnSpec[] = []
  const subprocess = {
    resolveExecutable: vi.fn(async () => '/admin/docker'),
    spawn: vi.fn((spec: SubprocessSpawnSpec) => {
      spec.signal?.throwIfAborted(); specs.push(spec)
      const args = spec.argv.slice(3); commands.push(args)
      let stdout = '', code = 0
      if (args[0] === 'inspect') stdout = JSON.stringify([rows.get(args.at(-1)!)])
      else if (args[0] === 'volume') stdout = JSON.stringify([{ Name: 'workspace-owned', Mountpoint: mountpoint, Labels: { owner: 'lease-volume' } }])
      else if (args[0] === 'container') stdout = [...rows.keys()].join('\n')
      else if (args[0] === 'pause') { if (faults.pauseBefore) code = 1; else { main.State.Paused = true; if (faults.pauseAfter) code = 1 } }
      else if (args[0] === 'unpause') { if (faults.unpause) code = 1; else main.State.Paused = false; if (faults.expireOnUnpause) clock = Date.parse(world.deadlineAt) + 1 }
      else if (args[0] === 'stop') { if (!faults.stopRunning) { main.State.Running = false; main.State.Paused = false } }
      else throw new Error('unexpected native command')
      return { done: Promise.resolve({ exitCode: code, signal: null }), terminate: vi.fn(), waitForExit: vi.fn(async () => !faults.rangeActive),
        collected: { stdout: { readFrom: () => ({ text: stdout, lossy: faults.lossyInspect && args[0] === 'inspect' }) }, stderr: { readFrom: () => ({ text: '', lossy: false }) } } }
    }),
  }
  const release = vi.fn(async () => {})
  const cutoffAuthority = vi.fn(async (_signal: AbortSignal, operation: () => Promise<void>) => operation())
  const policy: PausedWorldPolicy = { dockerExecutable: '/admin/docker', endpoint: 'unix:///admin/docker.sock', daemonIdentity: world.daemonIdentity,
    mainContainerName: 'main', admin: { containerId: adminId, name: 'admin', image, ownerLabel: { name: 'owner', value: 'lease-admin' } },
    workspace: { identity: 'workspace-owned', volumeName: 'workspace-owned', mountpoint, ownerLabel: { name: 'owner', value: 'lease-volume' }, mainPath: '/app', adminPath: source },
    acquire: vi.fn(async () => ({ active: async () => active, release, withCutoffAuthority: cutoffAuthority })), now: () => clock }
  const ctx = { get: () => subprocess } as unknown as Context
  return { ctx, world, policy, main, admin, source, rows, commands, specs, faults, subprocess, release, cutoffAuthority,
    cutoff: () => { active = false }, expire: () => { clock = Date.parse(world.deadlineAt) + 1 } }
}
const signal = () => new AbortController().signal
const actions = (commands: string[][]) => commands.filter(args => ['pause', 'unpause', 'stop'].includes(args[0]!))

describe('administrator Docker capture barrier', () => {
  it('captures only the fixed administrator readonly source while the main world is paused, and returns a released boundary', async () => {
    const f = await fixture()
    const result = await withPausedWorld(f.ctx, f.policy, f.world, signal(), async (source, s) => {
      expect(f.main.State.Paused).toBe(true); expect(f.admin.State.Paused).toBe(false)
      expect(source.path).toBe(f.source); expect(source.world.id).toBe(f.world.id); expect(s.aborted).toBe(false)
      return 'captured'
    })
    expect(result).toMatchObject({ value: 'captured', boundary: { kind: 'docker-paused', worldId: f.world.id, released: true } })
    expect(actions(f.commands)).toEqual([['pause', id], ['unpause', id]])
    expect(f.release).toHaveBeenCalledOnce()
    expect(f.specs.every(spec => spec.argv[0] === '/admin/docker' && spec.argv[2] === f.policy.endpoint && spec.stdio.stdin === 'ignore')).toBe(true)
  })

  it('rejects a foreign main identity before pause', async () => {
    const f = await fixture(); f.main.Config.Labels.owner = 'foreign'
    const capture = vi.fn()
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), capture)).rejects.toThrow('container owner')
    expect(capture).not.toHaveBeenCalled(); expect(actions(f.commands)).toEqual([]); expect(f.release).toHaveBeenCalledOnce()
  })

  it('rejects an administrator whose exact identity or readonly mount is wrong', async () => {
    for (const mutate of [(f: Awaited<ReturnType<typeof fixture>>) => { f.admin.Image = `sha256:${'e'.repeat(64)}` },
      (f: Awaited<ReturnType<typeof fixture>>) => { f.admin.Mounts[0]!.RW = true }]) {
      const f = await fixture(); mutate(f)
      await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), vi.fn())).rejects.toThrow('PROVENANCE_UNAVAILABLE')
      expect(actions(f.commands)).toEqual([])
    }
  })

  it('rejects bind source, overlapping nested mount and foreign volume labels before capture', async () => {
    const f = await fixture(); f.main.Mounts[0]!.Type = 'bind'
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), vi.fn())).rejects.toThrow('named-volume')
    f.main.Mounts[0]!.Type = 'volume'; f.main.Mounts.push({ Type: 'bind', Source: '/foreign', Destination: '/app/nested', RW: true })
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), vi.fn())).rejects.toThrow('no overlaps')
    f.main.Mounts.pop(); f.policy.workspace.ownerLabel.value = 'foreign'
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), vi.fn())).rejects.toThrow('volume identity')
    expect(actions(f.commands)).toEqual([])
  })

  it('rejects an external writable container, including a bind of a descendant daemon volume path', async () => {
    const f = await fixture()
    f.rows.set(foreignId, { ...f.admin, Id: foreignId, Name: '/foreign', Mounts: [{ Type: 'bind', Source: f.policy.workspace.mountpoint + '/subtree', Destination: '/other', RW: true }] })
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), vi.fn())).rejects.toThrow('additional writable')
    expect(actions(f.commands)).toEqual([])
  })

  it('does not release a pause it did not acquire', async () => {
    const f = await fixture(); f.main.State.Paused = true
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), vi.fn())).rejects.toThrow('already paused')
    expect(actions(f.commands)).toEqual([]); expect(f.main.State.Paused).toBe(true)
  })

  it('preserves a capture exception and resumes its owned world', async () => {
    const f = await fixture(), failure = new Error('capture read failed')
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), async () => { throw failure })).rejects.toBe(failure)
    expect(actions(f.commands)).toEqual([['pause', id], ['unpause', id]])
    expect(f.main.State.Paused).toBe(false)
  })

  it('cleans a partially applied failed pause, but does not invent a pause for a pre-effect failure', async () => {
    for (const after of [false, true]) {
      const f = await fixture(); f.faults.pauseAfter = after; f.faults.pauseBefore = !after
      await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), vi.fn())).rejects.toThrow('complete successful outcome')
      expect(actions(f.commands)).toEqual(after ? [['pause', id], ['unpause', id]] : [['pause', id]])
      expect(f.main.State.Paused).toBe(false)
    }
  })

  it('uses an independent cleanup signal after caller cancellation', async () => {
    const f = await fixture(), controller = new AbortController(), failure = new Error('caller cancelled')
    await expect(withPausedWorld(f.ctx, f.policy, f.world, controller.signal, async () => { controller.abort(failure); return 'not publishable' })).rejects.toBe(failure)
    expect(actions(f.commands)).toEqual([['pause', id], ['unpause', id]])
  })

  it('stops the exact world at deadline or cutoff without an explicit unpause or admitted boundary', async () => {
    for (const expired of [false, true]) {
      const f = await fixture()
      await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), async () => { if (expired) f.expire(); else f.cutoff(); return 'discarded' })).rejects.toThrow('expired')
      expect(actions(f.commands)).toEqual([['pause', id], ['stop', '--time', '0', id]])
      expect(f.main.State.Running).toBe(false)
    }
  })

  it('rechecks deadline after unpause and confirms exact stop before releasing the owner lease', async () => {
    const f = await fixture(); f.faults.expireOnUnpause = true
    f.release.mockImplementation(async () => { expect(f.main.State.Running).toBe(false) })
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), async () => 'captured')).rejects.toThrow('PROVENANCE_EXPIRED')
    expect(actions(f.commands)).toEqual([['pause', id], ['unpause', id], ['stop', '--time', '0', id]])
    expect(f.release).toHaveBeenCalledOnce()
  })

  it('reacquires cutoff authority if lease release crosses the deadline', async () => {
    const f = await fixture(); f.release.mockImplementation(async () => { f.expire() })
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), async () => 'captured')).rejects.toThrow('PROVENANCE_EXPIRED')
    expect(actions(f.commands)).toEqual([['pause', id], ['unpause', id], ['stop', '--time', '0', id]])
    expect(f.cutoffAuthority).toHaveBeenCalledOnce(); expect(f.main.State.Running).toBe(false)
  })

  it('converges a cutoff first observed at the final boundary clock check', async () => {
    const f = await fixture(), originalNow = f.policy.now!
    let released = false, observations = 0
    f.release.mockImplementation(async () => { released = true })
    f.policy.now = () => { if (released && ++observations === 2) f.expire(); return originalNow() }
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), async () => 'captured')).rejects.toThrow('PROVENANCE_EXPIRED')
    expect(actions(f.commands)).toEqual([['pause', id], ['unpause', id], ['stop', '--time', '0', id]])
    expect(f.cutoffAuthority).toHaveBeenCalledOnce(); expect(f.main.State.Running).toBe(false)
  })

  it('retains cleanup fault if cutoff authority has been superseded, without stopping an unauthorized world', async () => {
    const f = await fixture(); f.release.mockImplementation(async () => { f.expire() })
    f.cutoffAuthority.mockRejectedValue(new Error('cutoff authority superseded'))
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), async () => 'captured')).rejects.toThrow('no boundary is admitted')
    expect(actions(f.commands)).toEqual([['pause', id], ['unpause', id]])
  })

  it('does not touch a replaced owner during finally and reports capture and cleanup failures together', async () => {
    const f = await fixture(), original = new Error('capture interrupted')
    const failed = withPausedWorld(f.ctx, f.policy, f.world, signal(), async () => { f.main.Config.Labels.owner = 'foreign'; throw original })
    const error = await failed.catch(error => error)
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toContain(original)
    expect(actions(f.commands)).toEqual([['pause', id]])
  })

  it('does not return a boundary when pause release fails or stop is not acknowledged', async () => {
    const f = await fixture(); f.faults.unpause = true
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), async () => 'captured')).rejects.toThrow('no boundary is admitted')
    const g = await fixture(); g.faults.stopRunning = true
    await expect(withPausedWorld(g.ctx, g.policy, g.world, signal(), async () => { g.expire(); return 'captured' })).rejects.toThrow('no boundary is admitted')
  })

  it('rejects lossy daemon observations and an unquiescent native range', async () => {
    const f = await fixture(); f.faults.lossyInspect = true
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), vi.fn())).rejects.toThrow('complete successful outcome')
    f.faults.lossyInspect = false; f.faults.rangeActive = true
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), vi.fn())).rejects.toThrow('range remains active')
    expect(actions(f.commands)).toEqual([])
  })

  it('rejects unknown world and expired binding before privileged commands', async () => {
    const f = await fixture()
    await expect(withPausedWorld(f.ctx, f.policy, { ...f.world, workspaceIdentity: 'other' }, signal(), vi.fn())).rejects.toThrow('does not match')
    f.expire()
    await expect(withPausedWorld(f.ctx, f.policy, f.world, signal(), vi.fn())).rejects.toThrow('expired')
    expect(f.commands).toEqual([])
  })
})
