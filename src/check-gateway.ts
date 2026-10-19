/** Administrator-only DSH plugin serving one private snapshot storage lease. */
import { createHash } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import { chmod, lstat, readFile, realpath, unlink, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, dirname, basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { captureSnapshot, changedArtifacts, within, type ArtifactSnapshot } from './artifact-snapshot.ts'
import { snapshotSchema } from './verification-schema.ts'
import { requestSchema, REQUEST_BYTES, type CheckRequest } from './check-channel.ts'
import { checkPolicy, runCheck, readCheck, recoverCheckContainers, type CheckPolicy, type ContainerPolicy } from './review-check.ts'
import { CheckInputError } from './check-errors.ts'

export const name = 'task-review-check-gateway'
export const inject = ['subprocess']
export interface Config {
  socketPath: string
  storageRoot: string
  privateStorageRoot: string
  deadlineAt: string
  container: ContainerPolicy
  commandDeadlineMs?: number
  commandOutputBytes?: number
  maxFiles?: number
  maxBytes?: number
  runtimeLinkTargets?: string[]
}

/** Derive privileged paths from the leased directory, rejecting client-controlled mount paths. */
export async function boundSnapshot(storage: string, request: CheckRequest): Promise<ArtifactSnapshot> {
  storage = await realpath(storage)
  const root = request.snapshotRoot
  if (!isAbsolute(root) || dirname(root) !== storage || !/^review-[A-Za-z0-9_-]+$/.test(basename(root))
    || (await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw new Error('snapshot is outside the leased storage')
  const manifest = join(root, 'manifest.json')
  const stat = await lstat(manifest)
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('invalid snapshot manifest')
  const snapshot = snapshotSchema.parse(JSON.parse(await readFile(manifest, 'utf8')))
  if (snapshot.root !== root || snapshot.id !== request.snapshotId || snapshot.baseline !== join(root, 'baseline')
    || snapshot.check !== join(root, 'check')) throw new Error('snapshot identity or directory binding differs')
  for (const path of [snapshot.baseline, snapshot.check, join(snapshot.check, 'tree')]) {
    if ((await lstat(path)).isSymbolicLink() || await realpath(path) !== path || !within(root, path)) throw new Error('snapshot directory binding changed')
  }
  for (const entry of snapshot.entries) {
    if (!entry.path || isAbsolute(entry.path) || entry.path.includes('\0')
      || entry.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('invalid manifest entry path')
  }
  if (new Set(snapshot.entries.map(entry => entry.path)).size !== snapshot.entries.length
    || createHash('sha256').update(JSON.stringify(snapshot.entries)).digest('hex') !== snapshot.digest) throw new Error('snapshot manifest digest differs')
  return snapshot
}

/** Own every request until native command ranges and their daemon resources reach quiescence. */
export async function openGateway(ctx: Context, config: Config) {
  if (!isAbsolute(config.socketPath) || !isAbsolute(config.storageRoot) || !isAbsolute(config.privateStorageRoot)
    || config.storageRoot === '/' || config.privateStorageRoot === '/') throw new TypeError('gateway requires private absolute paths')
  const deadline = Date.parse(config.deadlineAt)
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new TypeError('gateway lease has expired')
  const storage = await realpath(config.storageRoot)
  const privateStorage = await realpath(config.privateStorageRoot)
  if (within(storage, privateStorage) || within(privateStorage, storage)) throw new TypeError('privileged copies must be separate from client storage')
  const limits = { files: config.maxFiles ?? 10000, bytes: config.maxBytes ?? 256 * 1024 * 1024, excluded: [], runtimeLinkTargets: [...config.runtimeLinkTargets ?? []] }
  if (limits.runtimeLinkTargets.some(path => !isAbsolute(path) || path.includes('\0'))) throw new TypeError('runtime link targets must be absolute paths')
  for (const limit of [limits.files, limits.bytes]) if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('gateway snapshot limits must be positive integers')
  const parent = await realpath(dirname(config.socketPath))
  if (within(storage, config.socketPath) || parent !== dirname(config.socketPath)) throw new TypeError('gateway socket must be separate from leased artifact storage')
  const policy = checkPolicy({ container: config.container,
    ...config.commandDeadlineMs === undefined ? {} : { commandMs: config.commandDeadlineMs },
    ...config.commandOutputBytes === undefined ? {} : { outputBytes: config.commandOutputBytes } })
  const subprocess = ctx.get('subprocess')
  if (!subprocess) throw new Error('native subprocess is required')
  const docker = await subprocess.resolveExecutable('docker', { PATH: policy.path }, AbortSignal.timeout(15000))
  const handle = subprocess.spawn({ argv: [docker, 'context', 'inspect', policy.container.context], cwd: storage,
    signal: AbortSignal.timeout(15000), graceMs: policy.graceMs,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } } })
  const outcome = await handle.done
  if (!await handle.waitForExit(AbortSignal.timeout(10000)) || outcome.exitCode !== 0) throw new Error('gateway Docker context is unavailable')
  const output = handle.collected.stdout!.readFrom(0)
  const contexts = JSON.parse(output.text) as { Endpoints: { docker: { Host: string } } }[]
  const endpoint = contexts.length === 1 ? contexts[0]!.Endpoints.docker.Host : ''
  if (output.lossy || !endpoint.startsWith('unix:///') || endpoint.includes('\0')) throw new Error('gateway needs an administrator-selected Unix Docker endpoint')
  const copies = new Map<string, ArtifactSnapshot>()
  for (const file of await readdir(privateStorage)) if (/^snapshot-[a-f0-9-]{36}\.json$/.test(file)) {
    const snapshot = snapshotSchema.parse(JSON.parse(await readFile(join(privateStorage, file), 'utf8')))
    if (dirname(snapshot.root) !== privateStorage || await realpath(snapshot.root) !== snapshot.root
      || snapshot.baseline !== join(snapshot.root, 'baseline') || snapshot.check !== join(snapshot.root, 'check')) throw new Error('invalid private recovery record')
    for (const ledgerFile of await readdir(snapshot.root)) if (/^container-[a-f0-9-]{36}\.json$/.test(ledgerFile)) {
      const ledger = JSON.parse(await readFile(join(snapshot.root, ledgerFile), 'utf8')) as { endpoint: string }
      if (ledger.endpoint !== endpoint) throw new Error('private recovery belongs to a different endpoint')
    }
    await recoverCheckContainers(ctx, snapshot, policy, AbortSignal.timeout(30000))
    copies.set(snapshot.id, snapshot)
  }
  async function privateCopy(client: ArtifactSnapshot, signal: AbortSignal): Promise<ArtifactSnapshot> {
    if ((await changedArtifacts(client)).length) throw new Error('client check tree differs from captured artifacts')
    let owned = copies.get(client.id)
    if (owned && owned.digest !== client.digest) throw new Error('snapshot identity was reused for different artifacts')
    if (!owned) {
      const captured = await captureSnapshot(join(client.check, 'tree'), privateStorage, limits, signal)
      const comparable = (entries: ArtifactSnapshot['entries']) => JSON.stringify(entries.map(({ mode: _mode, ...entry }) => entry))
      if (comparable(captured.entries) !== comparable(client.entries)) throw new Error('private artifact copy differs from client manifest')
      owned = { ...captured, id: client.id, digest: client.digest, entries: client.entries }
      await writeFile(join(privateStorage, `snapshot-${client.id}.json`), JSON.stringify(owned), { flag: 'wx', mode: 0o600 })
      copies.set(client.id, owned)
    }
    if ((await changedArtifacts(owned)).length) throw new Error('private check tree changed; a new review is required')
    const destination = join(owned.check, 'probes')
    if (!(await lstat(destination)).isDirectory() || await realpath(destination) !== destination) throw new Error('private probe directory was changed')
    // Only regular, bounded probe files cross the lease. The command mount always uses the private copy.
    const probes = join(client.check, 'probes')
    if (await realpath(probes) !== probes) throw new Error('client probe directory was redirected')
    for (const name of await readdir(probes)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(name)) throw new Error('invalid probe filename')
      const path = join(probes, name), stat = await lstat(path)
      if (!stat.isFile() || stat.size > policy.outputBytes) throw new Error('probe must be a bounded regular file')
      const content = await readFile(path)
      const after = await lstat(path)
      if (!after.isFile() || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('probe changed during read')
      const target = join(owned.check, 'probes', name)
      try { await writeFile(target, content, { flag: 'wx', mode: 0o600 }) }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')
          || !(await lstat(target)).isFile() || await realpath(target) !== target
          || !content.equals(await readFile(target))) throw new Error('probe was rewritten after admission')
      }
    }
    return owned
  }
  const active = new Map<string, { binding: string; controller: AbortController; result: Promise<unknown> }>()
  const sockets = new Set<Socket>(), controllers = new Set<AbortController>(), jobs = new Set<Promise<unknown>>()
  let closing = false, busy = false
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket))
    let buffer = Buffer.alloc(0), request: CheckRequest | undefined, controller: AbortController | undefined
    socket.setTimeout(10000, () => { if (!request) socket.destroy() })
    socket.once('close', () => { if (request?.version !== 2) controller?.abort(new Error('check client disconnected')) })
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > REQUEST_BYTES) { socket.destroy(); return }
      for (;;) {
        const end = buffer.indexOf(10)
        if (end < 0) return
        const frame = buffer.subarray(0, end); buffer = buffer.subarray(end + 1)
        if (request) {
          try { const cancel = JSON.parse(frame.toString()); if (Object.keys(cancel).length !== 1 || cancel.cancel !== request.id) throw new Error('invalid cancellation'); controller!.abort(new Error('check request cancelled')) }
          catch { socket.destroy() }
          continue
        }
        try { request = requestSchema.parse(JSON.parse(frame.toString())) } catch { socket.destroy(); return }
        socket.setTimeout(0)
        const current = request
        const binding = JSON.stringify({ ...current, operation: 'run' })
        const existing = active.get(current.id)
        if (current.version === 2 && existing) {
          if (existing.binding !== binding) { socket.end(JSON.stringify({ version: 2, id: current.id, error: 'request identity reused with different input' }) + '\n'); return }
          controller = existing.controller
          void existing.result.then(reply => socket.end(JSON.stringify(reply) + '\n')).catch(() => socket.destroy())
          return
        }
        controller = new AbortController()
        const cancellation = controller
        const job = (async () => {
          let admitted = false
          const reply = (value: object) => ({ version: current.version, id: current.id, ...value })
          try {
            const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))])
            const client = await boundSnapshot(storage, current)
            if (current.version === 2) {
              const path = join(privateStorage, `request-${current.id}.json`)
              let prior: string | undefined
              try { prior = await readFile(path, 'utf8') } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
              if (prior !== undefined) {
                if (prior !== binding) throw new Error('request identity reused with different input')
                const receiptPath = join(privateStorage, `receipt-${current.id}.json`)
                try { return JSON.parse(await readFile(receiptPath, 'utf8')) } catch (error) {
                  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
                  // A crash after native receipt flush must not launch a second command.
                  const owned = copies.get(client.id)
                  if (!owned) throw new Error('known request has no confirmed execution receipt')
                  const result = await readCheck(owned, current.id)
                  if (result.snapshotId !== current.snapshotId || result.cwd !== current.cwd || JSON.stringify(result.argv) !== JSON.stringify(current.argv)) throw new Error('receipt identity mismatch')
                  const receipt = reply({ result })
                  await writeFile(receiptPath, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 })
                  return receipt
                }
              }
              if (current.operation === 'collect') throw new Error('unknown check identity; no execution was started by collection')
              if (closing || busy || Date.now() >= deadline) throw new Error('gateway is busy, closing or expired')
              // A durable admission prevents replay from executing the same command twice.
              busy = true; admitted = true; controllers.add(cancellation)
              await writeFile(path, binding, { flag: 'wx', mode: 0o600 })
            } else {
              if (closing || busy || Date.now() >= deadline) throw new Error('gateway is busy, closing or expired')
              busy = true; admitted = true; controllers.add(cancellation)
            }
            const bounded: CheckPolicy = { ...policy, commandMs: Math.min(policy.commandMs, current.commandMs, Math.max(1, deadline - Date.now())) }
            let result = null
            if (current.operation === 'recover') {
              const owned = copies.get(client.id)
              if (owned) await recoverCheckContainers(ctx, owned, bounded, signal)
            } else {
              const owned = await privateCopy(client, signal)
              result = await runCheck(ctx, owned, SessionId(current.sessionId), current.argv, current.cwd, bounded, signal, current.version === 2 ? current.id : undefined)
            }
            const response = reply({ result })
            if (current.version === 2) await writeFile(join(privateStorage, `receipt-${current.id}.json`), JSON.stringify(response), { flag: 'wx', mode: 0o600 })
            return response
          } catch (error) {
            const message = String(error).replace(/https?:\/\/\S+/g, '[redacted URL]').slice(0, 2048)
            return reply({ error: message, errorCode: error instanceof CheckInputError ? 'invalid-request' : 'infrastructure' })
          } finally { if (admitted) { controllers.delete(cancellation); busy = false } }
        })()
        if (current.version === 2) active.set(current.id, { binding, controller: cancellation, result: job })
        void job.then(reply => socket.end(JSON.stringify(reply) + '\n')).finally(() => active.delete(current.id)).catch(() => socket.destroy())
        jobs.add(job); void job.finally(() => jobs.delete(job)).catch(() => {})
      }
    })
  })
  // Listen refuses an existing socket rather than unlinking another gateway's endpoint.
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.socketPath, () => { server.removeListener('error', reject); resolve() }) })
  const identity = await lstat(config.socketPath)
  await chmod(config.socketPath, 0o600)
  const timer = setTimeout(() => { closing = true; for (const controller of controllers) controller.abort(new Error('gateway lease expired')) }, Math.min(2147483647, deadline - Date.now()))
  return async () => {
    closing = true; clearTimeout(timer)
    for (const controller of controllers) controller.abort(new Error('gateway disposed'))
    await Promise.allSettled([...jobs])
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    try { const current = await lstat(config.socketPath); if (current.ino === identity.ino && current.dev === identity.dev) await unlink(config.socketPath) }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  }
}

/** Mount through a DSH administrator profile; no model tools are registered. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => openGateway(ctx, config))
}
