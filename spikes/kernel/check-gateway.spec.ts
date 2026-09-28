/** Private check-channel tests keep privileged mounts outside client-owned trees. */
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtemp, mkdir, writeFile, readFile, realpath, readdir, lstat, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { captureSnapshot } from '../../src/artifact-snapshot.ts'
import { boundSnapshot, openGateway } from '../../src/check-gateway.ts'
import { checkPolicy, runCheck, recoverCheckContainers } from '../../src/review-check.ts'
import type { CheckRequest } from '../../src/check-channel.ts'

const contexts: Context[] = [], dirs: string[] = [], closers: (() => Promise<void>)[] = [], recoverers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const recover of recoverers.splice(0)) await recover()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  async function writable(dir: string): Promise<void> {
    await chmod(dir, 0o700)
    for (const name of await readdir(dir)) { const path = join(dir, name); if ((await lstat(path)).isDirectory()) await writable(path) }
  }
  for (const dir of dirs.splice(0)) { await writable(dir); await rm(dir, { recursive: true, force: true }) }
})
const native = Boolean(process.env.DSH_CHECK_DOCKER_CONTEXT && process.env.DSH_CHECK_DOCKER_IMAGE)
async function fixture() {
  const root = await mkdtemp(join(process.env.DSH_CHECK_STORAGE_BASE ?? tmpdir(), 'dsh-gateway-test-')); dirs.push(root)
  const sockets = await mkdtemp(join(await realpath('/tmp'), 'dsh-rpc-')); dirs.push(sockets)
  const source = join(root, 'source'), storage = join(root, 'client'), privateStorage = join(root, 'private')
  for (const dir of [source, storage, privateStorage]) await mkdir(dir)
  await writeFile(join(source, 'code.mjs'), 'export const value = 7')
  const snapshot = await captureSnapshot(source, storage, { files: 100, bytes: 10000, excluded: ['.git'] }, new AbortController().signal)
  const request: CheckRequest = { version: 1, id: randomUUID(), operation: 'recover', snapshotRoot: snapshot.root,
    snapshotId: snapshot.id, sessionId: 'gateway-test', argv: [], cwd: 'tree', commandMs: 30000 }
  const container = { context: process.env.DSH_CHECK_DOCKER_CONTEXT ?? 'default',
    image: process.env.DSH_CHECK_DOCKER_IMAGE ?? 'sha256:' + '0'.repeat(64), cpus: 1, memoryMiB: 512, pids: 64 }
  const socketPath = join(sockets, 'check.sock')
  const policy = checkPolicy({ container, gatewaySocket: socketPath, commandMs: 30000, outputBytes: 8192 })
  const ctx = new Context(); contexts.push(ctx); await ctx.plugin(LocalSubprocess)
  recoverers.push(async () => {
    const { gatewaySocket: _socket, ...localPolicy } = policy
    for (const file of await readdir(privateStorage)) if (/^snapshot-[a-f0-9-]{36}\.json$/.test(file)) {
      const owned = JSON.parse(await readFile(join(privateStorage, file), 'utf8'))
      await recoverCheckContainers(ctx, owned, localPolicy, new AbortController().signal)
    }
  })
  return { root, snapshot, request, source, storage, privateStorage, ctx, socketPath, policy,
    config: { socketPath, storageRoot: storage, privateStorageRoot: privateStorage, container,
      commandDeadlineMs: 30000, commandOutputBytes: 8192, deadlineAt: new Date(Date.now() + 120000).toISOString(), maxFiles: 100, maxBytes: 10000 } }
}

it.skipIf(process.platform === 'win32')('rejects outside storage, redirected paths and forged manifest digests', async () => {
  const f = await fixture()
  expect((await boundSnapshot(f.storage, f.request)).id).toBe(f.snapshot.id)
  await expect(boundSnapshot(f.privateStorage, f.request)).rejects.toThrow('leased storage')
  const path = join(f.snapshot.root, 'manifest.json')
  await writeFile(path, JSON.stringify({ ...f.snapshot, baseline: f.source }))
  await expect(boundSnapshot(f.storage, f.request)).rejects.toThrow('binding')
  await writeFile(path, JSON.stringify({ ...f.snapshot, entries: [...f.snapshot.entries, { path: '../escaped', kind: 'file', hash: '', mode: 0o600, bytes: 0 }] }))
  await expect(boundSnapshot(f.storage, f.request)).rejects.toThrow('entry path')
  await writeFile(path, JSON.stringify({ ...f.snapshot, digest: 'f'.repeat(64) }))
  await expect(boundSnapshot(f.storage, f.request)).rejects.toThrow('digest')
})
it('rejects a relative gateway socket and mutable image policy', () => {
  const container = { context: 'default', image: 'sha256:' + '0'.repeat(64), cpus: 1, memoryMiB: 512, pids: 64 }
  expect(() => checkPolicy({ container, gatewaySocket: './check.sock' })).toThrow('absolute')
  expect(() => checkPolicy({ container: { ...container, image: 'node:latest' }, gatewaySocket: '/private/check.sock' })).toThrow('immutable')
})
it.skipIf(!native || process.platform === 'win32')('runs with administrator-owned mounts and persists acknowledged client evidence', async () => {
  const f = await fixture(), close = await openGateway(f.ctx, f.config); closers.push(close)
  // Client requests cannot choose a Docker endpoint, mount, runtime image, CPU or memory.
  const result = await runCheck(f.ctx, f.snapshot, SessionId('gateway-test'), ['node', '-e',
    "const fs=require('fs');console.log(fs.readFileSync('code.mjs','utf8'));fs.writeFileSync('../output/checked','ok')"], 'tree', f.policy, new AbortController().signal)
  expect(result.exitCode, result.stderr).toBe(0); expect(result.changed).toEqual([])
  const owned = JSON.parse(await readFile(join(f.privateStorage, `snapshot-${f.snapshot.id}.json`), 'utf8'))
  expect(owned.root).not.toBe(f.snapshot.root)
  expect(await readFile(join(owned.check, 'output/checked'), 'utf8')).toBe('ok')
  expect(await readdir(join(f.snapshot.check, 'output'))).toEqual([])
  expect(JSON.parse(await readFile(join(f.snapshot.root, `check-${result.id}.json`), 'utf8')).id).toBe(result.id)
  await recoverCheckContainers(f.ctx, f.snapshot, f.policy, new AbortController().signal)
})

async function readiness(privateStorage: string, snapshotId: string) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const owned = JSON.parse(await readFile(join(privateStorage, `snapshot-${snapshotId}.json`), 'utf8'))
      if (await readFile(join(owned.check, 'output/ready'), 'utf8') === 'ready') return
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('native gateway command never reached readiness')
}
it.skipIf(!native || process.platform === 'win32')('cancellation waits for the native command and daemon cleanup acknowledgement', async () => {
  const f = await fixture(), close = await openGateway(f.ctx, f.config); closers.push(close)
  const controller = new AbortController()
  const pending = runCheck(f.ctx, f.snapshot, SessionId('gateway-cancel'), ['node', '-e',
    "require('fs').writeFileSync('../output/ready','ready');setInterval(()=>{},1000)"], 'tree', f.policy, controller.signal)
  await readiness(f.privateStorage, f.snapshot.id)
  controller.abort(new Error('test cancellation'))
  const result = await pending
  expect(result.cancelled).toBe(true)
  const owned = JSON.parse(await readFile(join(f.privateStorage, `snapshot-${f.snapshot.id}.json`), 'utf8'))
  expect(JSON.parse(await readFile(join(owned.root, `removed-${result.id}.json`), 'utf8')).removed).toBe(true)
})
it.skipIf(!native || process.platform === 'win32')('a restart recovers only the private records and refuses a client artifact rewrite', async () => {
  const f = await fixture(), first = await openGateway(f.ctx, f.config)
  try { await runCheck(f.ctx, f.snapshot, SessionId('gateway-restart'), ['node', '-e', '0'], 'tree', f.policy, new AbortController().signal) }
  finally { await first() }
  const second = await openGateway(f.ctx, f.config); closers.push(second)
  await recoverCheckContainers(f.ctx, f.snapshot, f.policy, new AbortController().signal)
  await writeFile(join(f.snapshot.check, 'tree/code.mjs'), 'changed')
  await expect(runCheck(f.ctx, f.snapshot, SessionId('gateway-rewrite'), ['node', '-e', '0'], 'tree', f.policy, new AbortController().signal)).rejects.toThrow('differs')
})
it.skipIf(!native || process.platform === 'win32')('refuses replaced probe directories before copying another probe', async () => {
  const f = await fixture(), close = await openGateway(f.ctx, f.config); closers.push(close)
  await runCheck(f.ctx, f.snapshot, SessionId('gateway-probe-path'), ['node', '-e',
    "const fs=require('fs');fs.rmdirSync('../probes');fs.symlinkSync('/outside','../probes')"], 'tree', f.policy, new AbortController().signal)
  await writeFile(join(f.snapshot.check, 'probes/assert.mjs'), 'console.log(7)')
  await expect(runCheck(f.ctx, f.snapshot, SessionId('gateway-probe-path'), ['node', '../probes/assert.mjs'], 'tree', f.policy, new AbortController().signal)).rejects.toThrow('private probe directory')
})
