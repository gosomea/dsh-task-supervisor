/** Real HTTP probe for the diagnostic middleware; no model calls. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from './route-audit.mjs'

test('native HTTP events remain bound to streams and redact bodies and credentials', async () => {
  const server = createServer((_request, response) => { response.writeHead(200, { 'x-request-id': 'PRIVATE_REQUEST_ID' }); response.end('ok') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = mkdtempSync(join(tmpdir(), 'dsh-model-route-audit-'))
  let listener
  let dispose
  const endpoint = `http://127.0.0.1:${server.address().port}/chat/completions`
  const output = join(root, 'audit.jsonl')
  try {
    apply({ effect: callback => { dispose = callback() }, on: (_event, callback) => { listener = callback } }, { endpoint, output })
    const observed = []
    const next = () => ({ async *[Symbol.asyncIterator]() {
      const response = await fetch(endpoint, { method: 'POST', headers: { authorization: 'Bearer PRIVATE_KEY' }, body: 'PRIVATE_PROMPT' })
      assert.equal(await response.text(), 'ok')
      yield { type: 'finish', reason: { kind: 'stop' } }
    } })
    await Promise.all(['test-main', 'test-review'].map(async sessionId => {
      for await (const chunk of listener({ sessionId, provider: 'deepseek-codebuddy', model: 'deepseek-v4.1-flash' }, next)) observed.push(chunk)
    }))
    assert.equal(observed.length, 2)
    assert.ok(observed.every(chunk => chunk.type === 'finish' && chunk.reason.kind === 'stop'))
    const text = readFileSync(output, 'utf8')
    assert.equal(text.includes('PRIVATE_KEY'), false)
    assert.equal(text.includes('PRIVATE_PROMPT'), false)
    assert.equal(text.includes('PRIVATE_REQUEST_ID'), false)
    const rows = text.trim().split('\n').map(row => JSON.parse(row))
    for (const sessionId of ['test-main', 'test-review']) {
      const group = rows.filter(row => row.sessionId === sessionId)
      assert.deepEqual(group.map(row => row.type), ['model-start', 'http-request', 'http-response', 'model-finish', 'model-end'])
      assert.ok(group.every(row => row.callId === group[0].callId))
      assert.equal(group[1].endpointMatched, true)
      assert.equal(group[2].statusCode, 200)
      assert.equal(group[2].providerRequestIds.length, 1)
      assert.match(group[2].providerRequestIds[0].sha256, /^[a-f0-9]{64}$/)
      assert.equal(group[4].exhausted, true)
    }
    assert.equal(new Set(rows.map(row => row.callId)).size, 2)
  } finally {
    dispose?.()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})
