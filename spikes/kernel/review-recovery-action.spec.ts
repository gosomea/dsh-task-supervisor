import { randomUUID } from 'node:crypto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { controlActions } from '../../src/decisions.ts'
import { newTask } from '../../src/state.ts'
import { reviewJobSchema, type ReviewFault } from '../../src/review-schema.ts'
import { reviewRecoveryAction } from '../../src/review-recovery-action.ts'
import { reviewRecoveryGuidance, reviewFaultRemedy } from '../../src/client/review-presentation.ts'
import { SessionConnection } from '../../src/client/session-connection.tsx'
import { zh } from '../../src/client/locales.ts'
import type { PanelState } from '../../src/client/task-store.ts'

const now = Date.parse('2026-10-15T14:00:00Z')
function fixture(code: ReviewFault['code'] = 'provider', retryable = true, expired = false) {
  const input = newTask('Check a static report')
  const id = randomUUID()
  const fault: ReviewFault = { jobId: id, stageId: 'plan', cutoff: 20, reviewerSessionId: 'review', code,
    message: 'controlled failure', retryable, attempt: 1, errorSeq: null, outcomeKnown: false }
  const task = { ...input, phase: 'paused' as const, pauseReason: 'review-fault' as const, reviewFault: fault }
  const job = reviewJobSchema.parse({ id, revision: 1, mainSessionId: 'main', taskId: task.id,
    taskRevision: 1, planVersion: 0, stageId: 'plan', nodeAttempt: null, kind: 'plan', cutoff: 20,
    reviewerSessionId: 'review', model: null, runtimeId: randomUUID(), owner: 'controller', status: 'failed',
    attempt: 1, repairLimit: 1, startedAt: new Date(now - 1000).toISOString(), deadlineAt: new Date(now + (expired ? -1 : 1000)).toISOString(),
    finishedAt: new Date(now).toISOString(), trigger: 'plan', input, evidence: 'report', fault, decision: null })
  return { task, job }
}

it.each(['provider', 'internal', 'evidence-read', 'decision-invalid', 'protocol-missing', 'timeout', 'cancelled', 'snapshot', 'check-infrastructure', 'stale'] as const)(
  'offers a fresh manual job after an expired %s fault without changing the old job', code => {
    const { task, job } = fixture(code, true, true)
    const before = JSON.stringify(job)
    expect(reviewRecoveryAction(task, job, now)).toBe('restart-review')
    expect(controlActions(task, false, false, job, now)).toEqual(['restart-review', 'off'])
    expect(JSON.stringify(job)).toBe(before)
  })

it('keeps eligible retries on the original deadline and permits a fresh job for non-retryable faults', () => {
  const { task, job } = fixture()
  expect(reviewRecoveryAction(task, job, now)).toBe('retry-review')
  expect(reviewRecoveryAction(task, job, Date.parse(job.deadlineAt!))).toBe('restart-review')
  expect(reviewRecoveryAction(task, { ...job, fault: { ...job.fault!, retryable: false } }, now)).toBe('restart-review')
  expect(reviewRecoveryAction(task, { ...job, fault: { ...job.fault!, code: 'stale' } }, now)).toBe('restart-review')
})

it('refuses missing, changed and historical bindings rather than advertising an unusable action', () => {
  const { task, job } = fixture()
  for (const changed of [undefined, { ...job, id: randomUUID() }, { ...job, taskId: randomUUID() },
    { ...job, planVersion: 1 }, { ...job, input: { ...job.input, requirementsVersion: 2 } },
    { ...job, nodeAttempt: 2 }, { ...job, status: 'applied' as const }, { ...job, deadlineAt: undefined }]) {
    expect(reviewRecoveryAction(task, changed, now)).toBeNull()
    expect(controlActions(task, false, false, changed, now)).toEqual(['off'])
  }
  expect(reviewRecoveryAction({ ...task, enabled: false }, job, now)).toBeNull()
})

it('matches recovery instructions to live controls and renders a connection action for cold records', () => {
  const { task, job } = fixture()
  const state: PanelState = { task, live: true, armed: false, reviewing: false, actions: ['retry-review', 'off'], reviewJobs: [job] }
  expect(reviewRecoveryGuidance(state)).toBe('reviewRetryNeeded')
  expect(reviewRecoveryGuidance({ ...state, actions: ['restart-review', 'off'] })).toBe('reviewRestartNeeded')
  expect(reviewRecoveryGuidance({ ...state, actions: ['off'] })).toBe('reviewRecoveryUnavailable')
  expect(reviewRecoveryGuidance({ ...state, live: false, actions: [] })).toBe('reviewConnectNeeded')
  const html = renderToStaticMarkup(createElement(SessionConnection, { state: { ...state, live: false, actions: [] }, connect: async () => {}, t: key => zh[key] }))
  expect(html).toContain('连接会话')
  expect(html).toContain('不会启动审查或任务执行')
  expect(html).not.toContain('disabled')
  expect(renderToStaticMarkup(createElement(SessionConnection, { state, connect: async () => {}, t: key => zh[key] }))).toBe('')
  expect(reviewRecoveryGuidance({ ...state, task: { ...task, pauseReason: 'decision' }, actions: ['resume', 'off'] })).toBe('reviewUserNext')
  expect(reviewFaultRemedy({ ...job.fault!, providerCode: 'AUTH' })).toBe('reviewFixAuth')
  expect(reviewFaultRemedy({ ...job.fault!, providerCode: 'NO_ADAPTER' })).toBe('reviewFixModel')
  expect(zh.reviewRetryNonTransient).not.toContain('手动重试')
})
