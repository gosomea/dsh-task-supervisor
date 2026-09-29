import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProvenanceAuthority, type ProvenanceProvider } from '../../src/provenance-store.ts'
import { provenanceReceiptSchema, publicProvenanceReceipt, type ProvenanceBody, type ProvenanceScope, type WorldBinding } from '../../src/provenance-schema.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const signal = () => new AbortController().signal
const digest = 'a'.repeat(64)
function bindings() {
  const world: WorldBinding = { id: randomUUID(), lease: randomUUID(), mainSessionId: 'session-test',
    backend: 'docker', daemonIdentity: 'unix:///private/daemon.sock', containerId: 'c'.repeat(64),
    ownerLabel: { name: 'owner', value: 'test-lease' }, image: `sha256:${digest}`,
    workspaceIdentity: 'workspace-test', cwd: '/workspace', deadlineAt: new Date(Date.now() + 3600000).toISOString() }
  const scope: ProvenanceScope = { id: randomUUID(), worldId: world.id, taskId: randomUUID(), taskRevision: 1,
    planVersion: 1, nodeId: 'implementation', nodeAttempt: 1, reviewJobId: randomUUID(), cutoff: 42,
    snapshotId: randomUUID(), artifactDigest: digest }
  return { world, scope }
}
const unavailable: ProvenanceBody = { status: 'unavailable', kind: 'git', reason: 'no trusted capture barrier configured' }
async function fixture(provider: ProvenanceProvider = { verifyWorld: async () => {}, capture: async () => unavailable }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-provenance-'))); roots.push(root)
  const authority = await createProvenanceAuthority(root, provider)
  const { world, scope } = bindings()
  authority.registerWorld(world); authority.registerScope(scope)
  return { root, authority, world, scope }
}

describe('administrator provenance authority', () => {
  it('persists an explicit unavailable result and admits it only with an exact scope and seal', async () => {
    const { authority, root, world, scope } = await fixture()
    const seal = await authority.capture(scope.id, 'git', signal())
    const receipt = await authority.read(scope, seal.id, signal())
    expect(receipt.body).toEqual(unavailable)
    expect(receipt.scope.snapshotId).toBe(scope.snapshotId)
    const visible = publicProvenanceReceipt(receipt)
    expect(visible.evidenceId).toBe(`provenance:${receipt.id}`)
    expect(visible).not.toHaveProperty('world')
    for (const secret of [world.lease, world.daemonIdentity, world.ownerLabel.value, world.containerId, world.cwd]) {
      expect(JSON.stringify(visible)).not.toContain(secret)
    }
    const recovered = await createProvenanceAuthority(root, { verifyWorld: async () => {}, capture: async () => unavailable })
    recovered.registerWorld(world); recovered.registerScope(scope)
    await expect(recovered.read(scope, seal.id, signal())).rejects.toThrow('not admitted')
    await recovered.restore(scope.id, [seal], signal())
    expect(await recovered.read(scope, seal.id, signal())).toEqual(receipt)
  })

  it('rejects foreign task, version, attempt, cutoff, snapshot and digest bindings', async () => {
    const { authority, scope } = await fixture()
    const seal = await authority.capture(scope.id, 'git', signal())
    for (const changed of [{ taskId: randomUUID() }, { taskRevision: 2 }, { nodeAttempt: 2 }, { cutoff: 43 },
      { snapshotId: randomUUID() }, { artifactDigest: 'b'.repeat(64) }, { reviewJobId: randomUUID() }, { planVersion: 2 }]) {
      await expect(authority.read({ ...scope, ...changed }, seal.id, signal())).rejects.toThrow('foreign or stale')
    }
    expect(() => authority.registerScope({ ...scope, nodeAttempt: 2 })).toThrow('cannot be reused')
  })

  it('rejects changed world identities and changed daemon observations', async () => {
    let replaced = false
    const provider = { verifyWorld: async () => { if (replaced) throw new Error('exact container identity differs') }, capture: async () => unavailable }
    const { authority, scope, world } = await fixture(provider)
    const seal = await authority.capture(scope.id, 'git', signal())
    expect(() => authority.registerWorld({ ...world, containerId: 'b'.repeat(64) })).toThrow('cannot be reused')
    replaced = true
    await expect(authority.read(scope, seal.id, signal())).rejects.toThrow('exact container identity differs')
    await expect(authority.capture(scope.id, 'git', signal())).rejects.toThrow('exact container identity differs')
  })

  it('rejects altered disk data even when it still parses as a valid receipt', async () => {
    const { authority, root, scope } = await fixture()
    const seal = await authority.capture(scope.id, 'git', signal())
    const file = join(root, `provenance-${seal.id}.json`)
    const receipt = JSON.parse(await readFile(file, 'utf8'))
    receipt.body.reason = 'fabricated evidence'
    await writeFile(file, JSON.stringify(receipt))
    await expect(authority.read(scope, seal.id, signal())).rejects.toThrow('digest differs')
  })

  it('does not recover arbitrary JSON or allow cross-scope restoration', async () => {
    const { authority, root, scope, world } = await fixture()
    const seal = await authority.capture(scope.id, 'git', signal())
    const recovered = await createProvenanceAuthority(root, { verifyWorld: async () => {}, capture: async () => unavailable })
    const other = { ...scope, id: randomUUID(), nodeAttempt: 2 }
    recovered.registerWorld(world); recovered.registerScope(other)
    await expect(recovered.restore(other.id, [seal], signal())).rejects.toThrow('foreign or stale binding')
    await expect(recovered.restore(other.id, [{ ...seal, sha256: '0'.repeat(64) }], signal())).rejects.toThrow('digest differs')
  })

  it('revokes pending capture before publication if the controller invalidates the scope', async () => {
    let enter!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const released = new Promise<void>(resolve => { release = resolve })
    const { authority, root, scope } = await fixture({ verifyWorld: async () => {},
      capture: async () => { enter(); await released; return unavailable } })
    const pending = authority.capture(scope.id, 'git', signal())
    const rejection = expect(pending).rejects.toThrow('invalidated')
    await entered
    authority.invalidateScope(scope.id); release()
    await rejection
    expect(await readdir(root)).toEqual([])
    expect(() => authority.registerScope(scope)).toThrow('cannot be reused')
  })

  it('retains old receipts but refuses reads after invalidation', async () => {
    const { authority, root, scope } = await fixture()
    const seal = await authority.capture(scope.id, 'git', signal())
    authority.invalidateScope(scope.id)
    await expect(authority.read(scope, seal.id, signal())).rejects.toThrow('invalidated')
    expect(await readdir(root)).toEqual([`provenance-${seal.id}.json`])
  })

  it('rejects a redirected receipt file without following the symlink', async () => {
    const { authority, root, scope } = await fixture()
    const seal = await authority.capture(scope.id, 'git', signal())
    const file = join(root, `provenance-${seal.id}.json`), target = join(root, 'foreign.json')
    await writeFile(target, await readFile(file)); await rm(file); await symlink(target, file)
    await expect(authority.read(scope, seal.id, signal())).rejects.toThrow()
  })

  it('checks domain and does not turn a provider declaration into another kind of evidence', async () => {
    const { authority, scope } = await fixture()
    await expect(authority.capture(scope.id, 'execution', signal())).rejects.toThrow('different evidence domain')
  })

  it('rejects expiry during an awaited daemon check', async () => {
    const { root, world, scope } = await fixture()
    let clock = Date.now()
    const authority = await createProvenanceAuthority(root, {
      verifyWorld: async () => { clock = Date.parse(world.deadlineAt) + 1 }, capture: async () => unavailable,
    }, () => clock)
    authority.registerWorld(world); authority.registerScope(scope)
    await expect(authority.capture(scope.id, 'git', signal())).rejects.toThrow('expired')
    expect(await readdir(root)).toEqual([])
  })

  it('admits each seal once even across concurrent recovery calls', async () => {
    const { authority, root, scope, world } = await fixture()
    const seal = await authority.capture(scope.id, 'git', signal())
    const recovered = await createProvenanceAuthority(root, { verifyWorld: async () => {}, capture: async () => unavailable })
    recovered.registerWorld(world); recovered.registerScope(scope)
    const results = await Promise.allSettled([recovered.restore(scope.id, [seal], signal()), recovered.restore(scope.id, [seal], signal())])
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(value => value.status === 'rejected')).toHaveLength(1)
  })

  it('rejects a replaced storage directory even at the same canonical path', async () => {
    const { authority, root, scope } = await fixture()
    const backup = `${root}-old`; roots.push(backup)
    await rename(root, backup); await mkdir(root)
    await expect(authority.capture(scope.id, 'git', signal())).rejects.toThrow('replaced')
  })

  it('rejects foreign capture boundaries and execution timestamps after the lease', () => {
    const { world, scope } = bindings()
    const now = new Date().toISOString()
    const value = { schemaVersion: 1, id: randomUUID(), createdAt: now, scope, world,
      body: { status: 'available', evidence: { kind: 'git', head: 'a'.repeat(40), tree: 'b'.repeat(40), parents: [], base: null,
        indexMatchesHead: true, worktreeMatchesIndex: true, untracked: [], wholeWorkspaceClean: true,
        excluded: ['.git'], metadataDigest: digest,
        boundary: { kind: 'docker-paused', worldId: String(randomUUID()), startedAt: now, finishedAt: now, released: true } } } }
    expect(provenanceReceiptSchema.safeParse(value).success).toBe(false)
    value.body.evidence.boundary.worldId = world.id
    value.body.evidence.boundary.finishedAt = new Date(Date.parse(now) + 5000).toISOString()
    expect(provenanceReceiptSchema.safeParse(value).success).toBe(false)
    value.body.evidence.boundary.finishedAt = new Date(Date.parse(world.deadlineAt) + 1).toISOString()
    expect(provenanceReceiptSchema.safeParse(value).success).toBe(false)
  })
})
