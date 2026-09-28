/** Private check RPC carries bounded requests, never Docker commands or administrator policy. */
import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { z } from 'zod'
import type { ArtifactSnapshot } from './artifact-snapshot.ts'
import type { CheckPolicy } from './review-check.ts'
import { checkResultSchema, type CheckResult } from './verification-schema.ts'

export const requestSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), operation: z.enum(['run', 'recover']),
  snapshotRoot: z.string().min(1).max(4096), snapshotId: z.string().uuid(),
  sessionId: z.string().min(1).max(256),
  argv: z.array(z.string().max(16384)).max(256), cwd: z.string().max(4096),
  commandMs: z.number().int().min(1).max(3600000),
}).strict()
export type CheckRequest = z.infer<typeof requestSchema>
export const REQUEST_BYTES = 64 * 1024

/** Wait for a cleanup acknowledgement after cancellation; lost acknowledgement remains a fault. */
export async function checkRequest(snapshot: ArtifactSnapshot, sessionId: string, operation: 'run' | 'recover',
  argv: string[], cwd: string, policy: CheckPolicy, signal: AbortSignal): Promise<CheckResult | null> {
  signal.throwIfAborted()
  const request = requestSchema.parse({ version: 1, id: randomUUID(), operation,
    snapshotRoot: snapshot.root, snapshotId: snapshot.id, sessionId, argv, cwd, commandMs: policy.commandMs })
  const frame = JSON.stringify(request) + '\n'
  if (Buffer.byteLength(frame) > REQUEST_BYTES) throw new Error('CHECK_CHANNEL: request exceeds framing limit')
  const reply = await new Promise<unknown>((resolve, reject) => {
    const socket = createConnection(policy.gatewaySocket!)
    let bytes = 0, chunks: Buffer[] = [], settled = false, connected = false
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', abort); socket.destroy()
      if (error) reject(error); else resolve(value)
    }
    const abort = () => { if (connected) socket.write(JSON.stringify({ cancel: request.id }) + '\n') }
    signal.addEventListener('abort', abort, { once: true })
    socket.setTimeout(policy.commandMs + 45000, () => finish(new Error('CHECK_INFRASTRUCTURE: gateway cleanup acknowledgement timed out')))
    socket.once('connect', () => { connected = true; socket.write(frame); if (signal.aborted) abort() })
    socket.on('error', error => finish(error))
    socket.on('close', () => finish(new Error('CHECK_INFRASTRUCTURE: gateway closed without cleanup acknowledgement')))
    socket.on('data', chunk => {
      bytes += chunk.length
      if (bytes > Math.min(64 * 1024 * 1024, 12 * policy.outputBytes + 1024 * 1024)) { finish(new Error('CHECK_CHANNEL: response exceeds framing limit')); return }
      chunks.push(chunk)
      if (!chunk.includes(10)) return
      const body = Buffer.concat(chunks).toString('utf8')
      if (!body.endsWith('\n') || body.slice(0, -1).includes('\n')) { finish(new Error('CHECK_CHANNEL: invalid response frame')); return }
      try { finish(undefined, JSON.parse(body)) } catch { finish(new Error('CHECK_CHANNEL: invalid response JSON')) }
    })
  })
  const response = z.object({ version: z.literal(1), id: z.literal(request.id),
    result: checkResultSchema.nullable().optional(), error: z.string().optional() }).strict().parse(reply)
  if (response.error) throw new Error(`CHECK_INFRASTRUCTURE: gateway: ${response.error}`)
  if (operation === 'recover') {
    if (response.result !== null) throw new Error('CHECK_CHANNEL: missing recovery acknowledgement')
    return null
  }
  const result = response.result
  if (!result || result.snapshotId !== snapshot.id || JSON.stringify(result.argv) !== JSON.stringify(argv)
    || result.cwd !== cwd || result.runtime?.image !== policy.container.image || result.runtime.context !== policy.container.context) {
    throw new Error('CHECK_CHANNEL: returned evidence does not match the bound request')
  }
  return result
}
