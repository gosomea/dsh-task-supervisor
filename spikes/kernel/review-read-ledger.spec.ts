import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReviewJob } from '../../src/review-records.ts'
import { newTask } from '../../src/state.ts'
import { restoreReviewReads } from '../../src/review-read-ledger.ts'

const job = { mainSessionId: 'main', cutoff: 20, stageId: 's', input: newTask('Inspect') } as ReviewJob
function pair(name: string, value: unknown, error = false, args = '{}'): SessionEvent[] {
  return [{ type: 'tool/call', seq: 1, time: 0, data: { turn: 1, step: 1, callId: 'a', name, arguments: args } },
    { type: 'tool/result', seq: 2, time: 1, data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'a' },
      content: [{ type: 'text', text: JSON.stringify(value) }], isError: error } } }] as SessionEvent[]
}
it('restores the real bounded read, including its original truncation metadata, and rejects foreign or failed reads', () => {
  const value = { sessionId: 'main', cutoff: 20, events: [{ seq: 8, type: 'tool/result', text: 'partial', truncated: true, nextOffset: 7 }] }
  const events = pair('read_task_evidence', value)
  expect([...restoreReviewReads(events, job).observed]).toEqual([8])
  expect(events[1]).toMatchObject({ data: { message: { content: [{ text: JSON.stringify(value) }] } } })
  expect(restoreReviewReads(pair('read_task_evidence', value, true), job).observed.size).toBe(0)
  expect(restoreReviewReads(pair('read_task_evidence', { ...value, sessionId: 'other' }), job).observed.size).toBe(0)
  expect(restoreReviewReads(pair('read_task_evidence', { ...value, cutoff: 21 }), job).observed.size).toBe(0)
  expect(restoreReviewReads(events.slice(1), job).observed.size).toBe(0)
})
it('index summaries locate but do not make evidence citable; expanding the original does', () => {
  const index = pair('read_task_evidence_index', { sessionId: 'main', cutoff: 20, entries: [{ seq: 9 }] })
  const first = restoreReviewReads(index, job)
  expect([...first.located]).toEqual([9]); expect(first.observed.size).toBe(0)
  const original = pair('read_task_text', { seq: 9, text: 'original', truncated: false })
  expect([...restoreReviewReads([...index, ...original], job).observed]).toEqual([9])
  expect(restoreReviewReads(original, job).observed.size).toBe(0)
})
it('recovery retains the independent/comparison lock instead of exposing prior main-session reads', () => {
  const locked = { ...job, verification: { phase: 'independent' } } as ReviewJob
  const events = pair('read_task_evidence', { sessionId: 'main', cutoff: 20, events: [{ seq: 8, type: 'assistant/message' }] })
  expect(restoreReviewReads(events, locked).observed.size).toBe(0)
  expect([...restoreReviewReads(pair('read_task_input', { cutoff: 20, seq: 3, text: 'original request' }), locked).observed]).toEqual([3])
})
