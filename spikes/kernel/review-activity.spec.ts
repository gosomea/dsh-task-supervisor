import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReviewJob } from '../../src/review-records.ts'
import { reviewActivity } from '../../src/review-activity.ts'

const job = { id: 'job', reviewerSessionId: 'review', status: 'started' } as ReviewJob
function event(type: string, data: unknown, seq: number): SessionEvent {
  return { type, data, seq, time: seq * 1000 } as SessionEvent
}
const call = (id: string, name: string, args = '{}', seq = 1) => event('tool/call', { callId: id, name, arguments: args, turn: 1, step: 1 }, seq)
const result = (id: string, seq: number, isError = false) => event('tool/result', { turn: 1, step: 1,
  message: { role: 'tool', source: { kind: 'tool', callId: id }, content: [], isError } }, seq)

it('shows artifact reads and the actual independent command runner', () => {
  const events = [call('a', 'inspect_task_artifact', '{"path":"report.json"}')]
  expect(reviewActivity(job, events, true)).toMatchObject({ action: 'reading', target: 'report.json' })
  events.push(result('a', 2), call('b', 'run_review_check', '{}', 3))
  expect(reviewActivity(job, events, true)).toMatchObject({ action: 'checking', tool: 'run_review_check', reads: 1 })
})
it('keeps remaining parallel calls visible and clears the completed tool during generation', () => {
  const events = [call('a', 'read_task_text', '{"seq":8}'), call('b', 'read_task_call', '{}', 2), result('b', 3)]
  expect(reviewActivity(job, events, true)).toMatchObject({ action: 'reading', tool: 'read_task_text', target: 'seq 8', reads: 1 })
  events.push(result('a', 4))
  expect(reviewActivity(job, events, true)).toMatchObject({ action: 'generating', tool: null, target: null, reads: 2 })
})
it('records errors without counting them as reads, and uses actual event time', () => {
  const events = [call('a', 'read_task_text'), result('a', 2, true), event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3)]
  expect(reviewActivity(job, events, false)).toMatchObject({ action: 'settled', errors: 1, reads: 0, lastActivityAt: 3000 })
})
