import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { newTask } from '../../src/state.ts'
import { reviewJobSchema } from '../../src/review-records.ts'
import { reviewFromEvent, reviewDefinition } from '../../src/client/review-events.ts'

function fixture() {
  const task = newTask('读取输入并核对总数')
  return reviewJobSchema.parse({ id: randomUUID(), revision: 1, mainSessionId: 'main', taskId: task.id,
    taskRevision: 1, planVersion: 0, stageId: 'planning', nodeAttempt: null, kind: 'planning', cutoff: 20,
    reviewerSessionId: 'review', model: null, runtimeId: randomUUID(), owner: 'controller', status: 'queued',
    attempt: 1, repairLimit: 1, startedAt: new Date().toISOString(), finishedAt: null, trigger: 'planning',
    input: task, evidence: '检查规划进度', fault: null, decision: null })
}
function carrier(job = fixture()) {
  return { type: 'agent/inbox/spliced', seq: 21, time: 1, data: { turn: 1, step: 1, queue: 'next-step',
    index: 0, deleted: [], inserted: [{ id: 'record', role: 'user', content: [], source: {
      kind: 'task-supervisor-record', queued: true, record: { namespace: 'dsh-task-supervisor-review',
        kind: 'job', schemaVersion: 6, recordId: `${job.id}:${job.revision}`, payload: job } } }] } } as Parameters<typeof reviewDefinition.match>[0]
}
it('locates planning and in-turn progress reviews from canceled native carriers, without a turn tail', () => {
  const event = carrier()
  expect(reviewFromEvent(event)?.kind).toBe('planning')
  expect(reviewDefinition.match(event)).toEqual({ id: reviewFromEvent(event)!.id, role: 'start' })
  const job = { ...fixture(), kind: 'progress' as const }
  expect(reviewFromEvent(carrier(job))?.kind).toBe('progress')
})
it('uses the same job identity for retries and ignores claimed or unrelated messages', () => {
  const job = fixture()
  const retry = { ...job, revision: 4, attempt: 2, status: 'started' as const }
  expect(reviewDefinition.match(carrier(retry))).toEqual({ id: job.id, role: 'update' })
  const event = carrier(job)
  if (event.type !== 'agent/inbox/spliced') throw new Error('wrong fixture')
  const source = event.data.inserted[0]!.source
  expect(reviewFromEvent({ type: 'user/message', data: { source } })).toBeUndefined()
  expect(reviewFromEvent({ type: 'tool/call', data: {} })).toBeUndefined()
})
it('rejects malformed review records instead of binding an arbitrary Session', () => {
  const job = fixture()
  const bad = { namespace: 'dsh-task-supervisor-review', kind: 'job', payload: { ...job, reviewerSessionId: 123 } }
  expect(reviewFromEvent({ type: 'extension/record', data: bad })).toBeUndefined()
})
