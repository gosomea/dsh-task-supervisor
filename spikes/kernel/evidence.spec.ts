import { expect, it } from 'vitest'
import { redact, textPage } from '../../src/evidence.ts'
import { validateProvenance } from '../../src/provenance.ts'
import { newTask, taskJson, taskSchema, type TaskCriterion } from '../../src/state.ts'

it('redacts named JSON API keys through quote escaping levels while preserving nonsecret fields', () => {
  for (const key of ['api_key', 'apiKey', 'api-key', 'API_KEY']) {
    let raw = JSON.stringify({ [key]: 'FAKE_TEST_TOKEN_123456', result: 'passed', count: 12 })
    for (let depth = 0; depth < 3; depth++) {
      const safe = redact(raw)
      expect(safe).not.toContain('FAKE_TEST_TOKEN_123456')
      expect(safe).toContain('[redacted]')
      expect(safe).toContain('passed')
      expect(() => JSON.parse(safe)).not.toThrow()
      raw = JSON.stringify(raw)
    }
  }
  const raw = JSON.stringify({ apiKey: 'prefix"inside\\suffix$123', apiKeyLabel: 'ordinary label' })
  expect(JSON.parse(redact(raw))).toEqual({ apiKey: '[redacted]', apiKeyLabel: 'ordinary label' })
  let trailing = JSON.stringify({ apiKey: 'FAKE_TRAILING_TOKEN_123456\\', result: 'tail' })
  for (let depth = 0; depth < 3; depth++) {
    expect(redact(trailing)).not.toContain('FAKE_TRAILING_TOKEN_123456')
    expect(() => JSON.parse(redact(trailing))).not.toThrow()
    trailing = JSON.stringify(trailing)
  }
  expect(redact('{"result":"passed","count":12,"apiKeyLabel":"normal","not_api_key":"normal"}'))
    .toBe('{"result":"passed","count":12,"apiKeyLabel":"normal","not_api_key":"normal"}')
})

it('preserves existing Bearer, sk prefix and plain API key redaction', () => {
  const raw = 'Bearer FAKE_BEARER_123456 sk-FAKE_SK_123456 api_key=FAKE_PLAIN_123456 apiKey: FAKE_CAMEL_123456'
  const safe = redact(raw)
  expect(safe).toBe('Bearer [redacted] sk-[redacted] api_key=[redacted] apiKey: [redacted]')
})

it('paginates quoted JSON assignments by the redacted character positions', () => {
  const raw = JSON.stringify({ api_key: 'FAKE_TEST_TOKEN_123456', result: 'tail remains' })
  let offset: number | null = 0, joined = ''
  while (offset !== null) { const view = textPage(raw, offset, 3); joined += view.text; offset = view.nextOffset }
  expect(joined).toBe(redact(raw)); expect(joined).not.toContain('FAKE_TEST_TOKEN_123456')
  expect(joined).toContain('tail remains')
})

it('reconstructs redacted evidence across arbitrary page boundaries without losing the tail', () => {
  const raw = 'x'.repeat(699) + 'Bearer super-secret-credential\n' + 'y'.repeat(7300) + '\nFAILED at the end'
  let offset: number | null = 0
  let full = ''
  while (offset !== null) {
    const page = textPage(raw, offset, 700)
    full += page.text
    offset = page.nextOffset
  }
  expect(full).toBe(redact(raw))
  expect(full).toContain('FAILED at the end')
  expect(full).not.toContain('super-secret-credential')
  expect(textPage(raw, 0, 99999).text).toHaveLength(6000)
  expect(() => textPage(raw, -1)).toThrow('offset')
})

it('requires provenance for new plans while preserving old snapshots and implementation origins', () => {
  const legacy: TaskCriterion = { id: 'c1', text: 'greeting exists' }
  const task = { ...newTask('Write a greeting'), criteria: [legacy] }
  expect(taskSchema.parse(taskJson(task)).criteria).toEqual([legacy])
  expect(() => validateProvenance([legacy], [])).toThrow('needs provenance')
  const criterion = { ...legacy, provenance: { kind: 'user' as const, reference: 'objective' } }
  expect(() => validateProvenance([criterion], [])).not.toThrow()
  expect(() => validateProvenance([{ ...criterion, provenance: { kind: 'project', reference: 'leftover verify.mjs' } }], [])).toThrow('no valid project source')
  expect(() => validateProvenance([{ ...criterion, provenance: { kind: 'user', reference: 'assistant said so', sourceSeq: 999 } }], [])).toThrow('no valid user source')
  expect(taskSchema.parse(taskJson({ ...task, criteria: [criterion] })).criteria).toEqual([criterion])
})

it('indexes redacted paired calls at a fixed cutoff without promoting summaries to citation evidence', async () => {
  const { taskEvidenceIndex } = await import('../../src/evidence-index.ts')
  const { SessionId } = await import('@deepseek-ai/dsh-session')
  const { createUserMessage, createToolResultMessage, ToolCallId } = await import('@deepseek-ai/dsh-llm')
  const { SessionStore } = await import('@deepseek-ai/dsh-session')
  const { Context } = await import('@deepseek-ai/cordis')
  const ctx = new Context(); await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('index-fixture'))
  try {
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'original requirement' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const call = session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('call-index'), name: 'read_file', arguments: JSON.stringify({ apiKey: 'FAKE_KEY_123456', file: 'result.txt' }) })
  const result = session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId('call-index'), isError: true, content: [{ type: 'text', text: 'x'.repeat(900) }] }) }, { surfaceOp: 'append' })
  const events = session.snapshotEvents()
  const page = taskEvidenceIndex(events, result.seq, { tool: 'read_file', errorsOnly: true, limit: 1 })
  expect(page.entries[0]).toMatchObject({ seq: call.seq, callSeq: call.seq, resultSeq: result.seq, error: true, citationReady: false })
  expect(page.entries[0]!.summary).not.toContain('FAKE_KEY_123456')
  const next = taskEvidenceIndex(events, result.seq, { fromSeq: page.nextSeq!, limit: 1 })
  expect(next.entries[0]).toMatchObject({ seq: result.seq, truncated: true, totalChars: 900 })
  expect(taskEvidenceIndex(events, call.seq, { tool: 'read_file' }).entries[0]?.resultSeq).toBeNull()
  } finally { await ctx.fiber.dispose() }
})
