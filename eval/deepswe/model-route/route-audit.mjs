/** Test-only middleware: record request identity and HTTP outcome without payloads. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { channel } from 'node:diagnostics_channel'
import { appendFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

export const name = 'deepswe-model-route-audit'
export const inject = ['llm']

/** Observe native adapter streams; forwarding never changes request options or chunks. */
export function apply(ctx, config) {
  writeFileSync(config.output, '', { flag: 'wx', mode: 0o600 })
  const scope = new AsyncLocalStorage()
  const requests = new WeakMap()
  const write = row => appendFileSync(config.output, JSON.stringify({ time: Date.now(), ...row }) + '\n')
  const expected = new URL(config.endpoint)
  const onCreate = ({ request }) => {
    const call = scope.getStore()
    if (!call) return
    const actual = new URL(request.path, request.origin)
    const row = { ...call, httpId: randomUUID(), endpointSha256: createHash('sha256').update(actual.href).digest('hex'),
      endpointMatched: actual.href === expected.href, method: request.method }
    requests.set(request, row)
    write({ type: 'http-request', ...row })
  }
  const onHeaders = ({ request, response }) => {
    const row = requests.get(request)
    if (!row) return
    const ids = []
    for (let index = 0; index + 1 < (response.headers?.length ?? 0); index += 2) {
      const name = String(response.headers[index]).toLowerCase()
      if (name === 'x-request-id' || name === 'request-id') ids.push({ header: name,
        sha256: createHash('sha256').update(String(response.headers[index + 1])).digest('hex') })
    }
    write({ type: 'http-response', ...row, statusCode: response.statusCode, providerRequestIds: ids })
  }
  const onError = ({ request, error }) => {
    const row = requests.get(request)
    if (row) write({ type: 'http-error', ...row, errorType: error?.name ?? 'Error' })
  }
  ctx.effect(() => {
    channel('undici:request:create').subscribe(onCreate)
    channel('undici:request:headers').subscribe(onHeaders)
    channel('undici:request:error').subscribe(onError)
    return () => {
      channel('undici:request:create').unsubscribe(onCreate)
      channel('undici:request:headers').unsubscribe(onHeaders)
      channel('undici:request:error').unsubscribe(onError)
    }
  })
  ctx.on('llm/stream', (options, next) => ({
    async *[Symbol.asyncIterator]() {
      const call = { callId: randomUUID(), sessionId: options.sessionId ?? null,
        provider: options.provider, model: options.model }
      write({ type: 'model-start', ...call })
      const iterator = scope.run(call, () => next()[Symbol.asyncIterator]())
      let exhausted = false
      try {
        while (true) {
          const result = await scope.run(call, () => iterator.next())
          if (result.done) { exhausted = true; break }
          if (result.value.type === 'finish') write({ type: 'model-finish', ...call, finishKind: result.value.reason.kind })
          yield result.value
        }
      } catch (error) {
        write({ type: 'model-error', ...call, errorType: error?.name ?? 'Error' })
        throw error
      } finally {
        if (!exhausted) await scope.run(call, () => iterator.return?.())
        write({ type: 'model-end', ...call, exhausted })
      }
    },
  }))
}
