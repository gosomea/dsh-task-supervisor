/** Diagnostic-only regression: no Docker, model, profile activation or process capture is performed. */
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readProbeOwnerActive, summarizeProbeFailure } from '../../eval/independent-verification/process-provenance-probe.ts'

it('retains nested aggregate cleanup and cause reasons while omitting arbitrary scope fields', () => {
  const command = Object.assign(new Error('Cannot unpause /private/secret/capture at C:\\control\\secret'), { code: 'EIO', scope: { secret: 'scope-secret' } })
  const result = summarizeProbeFailure(new AggregateError([command, new Error('native range remains active')], 'capture release failed', { cause: new Error('capture verification failed') }))
  expect(result).toMatchObject({ name: 'AggregateError', cause: { message: 'capture verification failed' }, errors: [{ name: 'Error', code: 'EIO' }, { message: 'native range remains active' }] })
  expect(result.errors?.[0]?.message).toContain('[path]')
  expect(JSON.stringify(result)).not.toMatch(/private|control|secret|scope/)
})

it('bounds cycles, deep causes, aggregate width and diagnostic strings', () => {
  const cycle = new Error('cycle'); cycle.cause = cycle
  expect(summarizeProbeFailure(cycle).cause?.name).toBe('TruncatedError')
  let deep: Error = new Error('deep')
  for (let i = 0; i < 100; i++) deep = new Error('deep', { cause: deep })
  const bounded = summarizeProbeFailure(deep)
  expect(bounded.cause?.cause?.cause?.cause?.name).toBe('TruncatedError')
  const wide = summarizeProbeFailure(new AggregateError(Array.from({ length: 100 }, () => new Error('x'.repeat(10000))), 'wide'))
  expect(wide.errors).toHaveLength(6)
  expect(wide.errors?.[0]?.message).toHaveLength(512)
  expect(JSON.stringify(wide).length).toBeLessThan(4000)
})

it('omits non-errors and throwing diagnostic getters without preventing result sealing', () => {
  expect(summarizeProbeFailure({ message: 'scope-secret', scope: { credential: 'secret' } })).toEqual({ name: 'NonError', message: 'Non-error failure omitted' })
  const error = new Error()
  for (const key of ['name', 'message', 'cause', 'code']) Object.defineProperty(error, key, { get() { throw new Error('getter-secret') } })
  expect(summarizeProbeFailure(error)).toEqual({ name: 'Error', message: 'Unreadable error diagnostics' })
})

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function ownerFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-probe-owner-')); roots.push(root)
  const now = Date.now(), deadline = new Date(now + 60000).toISOString(), lease = 'private-fixture-lease'
  const filename = (sequence: number) => join(root, `owner-state-${String(sequence).padStart(12, '0')}.json`)
  const record = async (sequence: number, data: Record<string, unknown> = {}) => {
    await writeFile(filename(sequence), JSON.stringify({ sequence, lease, active: true, atUnixMs: now, ...data }), { flag: 'wx' })
  }
  return { root, now, deadline, lease, filename, record }
}

it('uses newest immutable publication, ignores unpublished temp files, and observes terminal inactive state', async () => {
  const f = await ownerFixture(); await f.record(1)
  await writeFile(join(f.root, 'owner-state-000000000002.json.unpublished.tmp'), '{')
  expect(await readProbeOwnerActive(f.root, f.lease, f.deadline, 0, f.now)).toEqual({ active: true, sequence: 1 })
  await f.record(2, { active: false })
  expect(await readProbeOwnerActive(f.root, f.lease, f.deadline, 1, f.now)).toEqual({ active: false, sequence: 2 })
})

it('rejects malformed newest publication without falling back and seals only its hash and origin', async () => {
  const f = await ownerFixture(); await f.record(1)
  const bad = '{"lease":"do-not-publish-this-secret"'
  await writeFile(f.filename(2), bad, { flag: 'wx' })
  await expect(readProbeOwnerActive(f.root, f.lease, f.deadline, 1, f.now)).rejects.toThrow('PROBE_OWNER_STATE')
  const evidenceName = (await readdir(f.root)).find(name => name.startsWith('owner-read-fault-'))!
  const evidenceText = await readFile(join(f.root, evidenceName), 'utf8'), evidence = JSON.parse(evidenceText)
  expect(evidence).toMatchObject({ origin: 'PROBE_OWNER_STATE', sequence: 2, byteLength: Buffer.byteLength(bad) })
  expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(evidenceText).not.toMatch(/secret|lease|private-fixture/)
})

it('fails closed on identity, sequence regression and redirected heartbeat paths', async () => {
  const f = await ownerFixture(); await f.record(1)
  await expect(readProbeOwnerActive(f.root, f.lease, f.deadline, 2, f.now)).rejects.toThrow('PROBE_OWNER_STATE')
  await f.record(2, { lease: 'wrong-owner' })
  await expect(readProbeOwnerActive(f.root, f.lease, f.deadline, 1, f.now)).rejects.toThrow('PROBE_OWNER_STATE')
  await symlink(f.filename(1), f.filename(3))
  await expect(readProbeOwnerActive(f.root, f.lease, f.deadline, 1, f.now)).rejects.toThrow('PROBE_OWNER_STATE')
})

it('does not authorize an expired world or stale heartbeat', async () => {
  const f = await ownerFixture(); await f.record(1)
  expect(await readProbeOwnerActive(f.root, f.lease, f.deadline, 0, f.now + 2000)).toEqual({ active: false, sequence: 1 })
  expect(await readProbeOwnerActive(f.root, f.lease, new Date(f.now).toISOString(), 0, f.now)).toEqual({ active: false, sequence: 1 })
})
