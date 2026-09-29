/** Process-local authority over externally protected, immutable administrator receipts. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { provenanceBodySchema, provenanceReceiptSchema, provenanceScopeSchema, worldBindingSchema,
  type ProvenanceBody, type ProvenanceReceipt, type ProvenanceScope, type WorldBinding } from './provenance-schema.ts'

const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

export interface ProvenanceProvider {
  /** Query the actual daemon/container/lease; client Session strings are not authorization. */
  verifyWorld(world: Readonly<WorldBinding>, signal: AbortSignal): Promise<void>
  /** Called only by the administrator/controller, never by a model upload endpoint. */
  capture(world: Readonly<WorldBinding>, scope: Readonly<ProvenanceScope>, kind: 'git' | 'execution', signal: AbortSignal): Promise<ProvenanceBody>
}
export interface SealedReceipt { id: string; sha256: string }

/**
 * Construction requires an administrator-protected directory and trusted provider code.
 * Permissions/hash checks do not protect against a model with administrator filesystem access.
 * There is deliberately no JSON registration/upload RPC and no ambient directory recovery.
 */
export async function createProvenanceAuthority(storageRoot: string, provider: ProvenanceProvider, now = Date.now) {
  if (!isAbsolute(storageRoot) || resolve(storageRoot) === '/') throw new TypeError('private provenance storage required')
  const storage = await realpath(storageRoot)
  const storageIdentity = await lstat(storage)
  if (storage !== resolve(storageRoot) || !storageIdentity.isDirectory()) throw new Error('provenance storage was redirected')
  const worlds = new Map<string, WorldBinding>()
  const scopes = new Map<string, { scope: ProvenanceScope; active: boolean; receipts: SealedReceipt[] }>()
  const bytesLimit = 2 * 1024 * 1024

  async function current(scopeId: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const observed = await lstat(storageRoot)
    if (await realpath(storageRoot) !== storage || !observed.isDirectory()
      || observed.dev !== storageIdentity.dev || observed.ino !== storageIdentity.ino) throw new Error('provenance storage was redirected or replaced')
    const entry = scopes.get(scopeId)
    if (!entry?.active) throw new Error('provenance scope is absent or invalidated')
    const world = worlds.get(entry.scope.worldId)!
    if (Date.parse(world.deadlineAt) <= now()) throw new Error('provenance world lease has expired')
    await provider.verifyWorld(structuredClone(world), signal)
    signal.throwIfAborted()
    if (!entry.active) throw new Error('provenance scope was invalidated')
    if (Date.parse(world.deadlineAt) <= now()) throw new Error('provenance world lease has expired')
    return { entry, world }
  }

  async function readSealed(seal: SealedReceipt): Promise<ProvenanceReceipt> {
    if (!/^[a-f0-9-]{36}$/.test(seal.id) || !/^[a-f0-9]{64}$/.test(seal.sha256)) throw new Error('invalid trusted receipt seal')
    const file = await open(join(storage, `provenance-${seal.id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > bytesLimit) throw new Error('invalid provenance receipt file')
      const bytes = await file.readFile()
      if (bytes.length > bytesLimit || hash(bytes) !== seal.sha256) throw new Error('provenance receipt digest differs from trusted seal')
      const receipt = provenanceReceiptSchema.parse(JSON.parse(bytes.toString('utf8')))
      if (receipt.id !== seal.id) throw new Error('provenance receipt identity differs')
      return receipt
    } finally { await file.close() }
  }

  return {
    /** Deployment-only registration. The constructor's caller, not model input, owns this authority. */
    registerWorld(value: WorldBinding): void {
      const world = worldBindingSchema.parse(value)
      const old = worlds.get(world.id)
      if (old && !same(old, world)) throw new Error('world identity cannot be reused')
      if (Date.parse(world.deadlineAt) <= now()) throw new Error('world lease has expired')
      worlds.set(world.id, structuredClone(world))
    },
    registerScope(value: ProvenanceScope): void {
      const scope = provenanceScopeSchema.parse(value)
      if (!worlds.has(scope.worldId)) throw new Error('scope requires a registered world')
      const old = scopes.get(scope.id)
      if (old && (!old.active || !same(old.scope, scope))) throw new Error('scope identity cannot be reused')
      if (!old) scopes.set(scope.id, { scope: structuredClone(scope), active: true, receipts: [] })
    },
    invalidateScope(scopeId: string): void {
      const entry = scopes.get(scopeId)
      if (entry) entry.active = false
    },
    /** Actual producer entry point, intentionally not installed as a model tool. */
    async capture(scopeId: string, kind: 'git' | 'execution', signal: AbortSignal): Promise<SealedReceipt> {
      const { entry, world } = await current(scopeId, signal)
      const body = provenanceBodySchema.parse(await provider.capture(structuredClone(world), structuredClone(entry.scope), kind, signal))
      if ((body.status === 'available' ? body.evidence.kind : body.kind) !== kind) throw new Error('producer returned a different evidence domain')
      await current(scopeId, signal)
      const receipt = provenanceReceiptSchema.parse({ schemaVersion: 1, id: randomUUID(), createdAt: new Date(now()).toISOString(),
        scope: entry.scope, world, body })
      const text = JSON.stringify(receipt)
      if (Buffer.byteLength(text) > bytesLimit) throw new Error('provenance receipt exceeds bound')
      const file = await open(join(storage, `provenance-${receipt.id}.json`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { await file.writeFile(text); await file.sync() } finally { await file.close() }
      const directory = await open(storage, constants.O_RDONLY)
      try { await directory.sync() } finally { await directory.close() }
      // Invalidated work remains on disk for investigation, never becomes admissible evidence.
      await current(scopeId, signal)
      const seal = { id: receipt.id, sha256: hash(text) }
      entry.receipts.push(seal)
      return { ...seal }
    },
    /** Restart recovery accepts only seals supplied through trusted deployment storage. */
    async restore(scopeId: string, seals: SealedReceipt[], signal: AbortSignal): Promise<void> {
      const { entry, world } = await current(scopeId, signal)
      const recovered: SealedReceipt[] = []
      for (const seal of seals) {
        const receipt = await readSealed(seal)
        if (!same(receipt.scope, entry.scope) || !same(receipt.world, world)) throw new Error('restored receipt has a foreign or stale binding')
        if (entry.receipts.some(value => value.id === seal.id) || recovered.some(value => value.id === seal.id)) throw new Error('duplicate restored receipt')
        recovered.push({ ...seal })
      }
      await current(scopeId, signal)
      if (recovered.some(seal => entry.receipts.some(value => value.id === seal.id))) throw new Error('duplicate restored receipt')
      entry.receipts.push(...recovered)
    },
    /** Read admission is by the controller's exact scope, not a caller-supplied Session name. */
    async read(scope: ProvenanceScope, receiptId: string, signal: AbortSignal): Promise<ProvenanceReceipt> {
      const expected = provenanceScopeSchema.parse(scope)
      const { entry, world } = await current(expected.id, signal)
      if (!same(expected, entry.scope)) throw new Error('foreign or stale provenance scope')
      const seal = entry.receipts.find(value => value.id === receiptId)
      if (!seal) throw new Error('receipt is not admitted to this scope')
      const receipt = await readSealed(seal)
      if (!same(receipt.scope, expected) || !same(receipt.world, world)) throw new Error('receipt binding differs')
      await current(expected.id, signal)
      return receipt
    },
  }
}
