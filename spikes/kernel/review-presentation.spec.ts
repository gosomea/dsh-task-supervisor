import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReviewReport } from '../../src/client/review-report.tsx'
import { zh } from '../../src/client/locales.ts'
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { newTask } from '../../src/state.ts'
import { reviewJobSchema, type ReviewJob } from '../../src/review-schema.ts'
import type { PanelState } from '../../src/client/task-store.ts'
import { reviewPresentation, reviewFaultDescription, createReviewDisclosureState } from '../../src/client/review-presentation.ts'

function fixture() {
  const task = newTask('读取输入并核对总数')
  const job = reviewJobSchema.parse({ id: randomUUID(), revision: 1, mainSessionId: 'main', taskId: task.id,
    taskRevision: 1, planVersion: 0, stageId: 'node', nodeAttempt: 1, kind: 'stage', cutoff: 20,
    reviewerSessionId: 'review', model: null, runtimeId: randomUUID(), owner: 'controller', status: 'started',
    attempt: 1, repairLimit: 1, startedAt: '2026-10-09T00:00:00Z', finishedAt: null, trigger: 'stage',
    input: task, evidence: '核对总数', fault: null, decision: null })
  const state: PanelState = { task, live: true, armed: true, reviewing: true, actions: ['pause', 'off'], reviewJobs: [job] }
  return { job, state }
}
it.each(['queued', 'started', 'repairing', 'submitted'] as const)('keeps the %s activity visible while process details are collapsed', status => {
  const { job, state } = fixture()
  const labels = { queued: 'reviewQueuedAction', started: 'reviewRunning', repairing: 'reviewRecoveringAction', submitted: 'reviewSubmitted' }
  expect(reviewPresentation({ ...job, status }, state)).toMatchObject({ active: true, tone: status === 'submitted' ? 'neutral' : 'active', label: labels[status], canRetry: false, duration: null })
})
it('shows a current fault and permits retry only for the bound live task and job', () => {
  const { job, state } = fixture()
  job.status = 'failed'
  job.fault = { jobId: job.id, stageId: job.stageId, cutoff: job.cutoff, reviewerSessionId: 'review', code: 'protocol-missing', message: 'missing decision',
    attempt: 1, retryable: true, outcomeKnown: true, errorSeq: null }
  state.task!.reviewFault = job.fault
  state.reviewing = false
  state.actions = ['retry-review', 'off']
  expect(reviewPresentation(job, state)).toMatchObject({ label: 'reviewFailed', tone: 'error', active: false, canRetry: true, currentFault: true })
  expect(reviewFaultDescription(job.fault)).toBe('reviewFaultProtocol')
  expect(reviewPresentation(job, { ...state, live: false }).canRetry).toBe(false)
  expect(reviewPresentation(job, { ...state, actions: ['off'] }).canRetry).toBe(false)
  expect(reviewPresentation(job, { ...state, task: { ...state.task!, reviewFault: { ...job.fault, jobId: randomUUID() } } }).currentFault).toBe(false)
  expect(reviewPresentation(job, { ...state, task: newTask('下一项任务') })).toMatchObject({ currentFault: false, canRetry: false })
})
it('does not describe a stopped or historical pending job as currently generating', () => {
  const { job, state } = fixture()
  expect(reviewPresentation(job, { ...state, live: false })).toMatchObject({ active: false, label: 'reviewWaitingRecovery' })
  expect(reviewPresentation(job, { ...state, reviewing: false })).toMatchObject({ active: false, label: 'reviewWaitingRecovery' })
  expect(reviewPresentation(job, { ...state, task: newTask('下一项任务') })).toMatchObject({ active: false, canRetry: false })
})
it('keeps a stale decision distinct from a current pass and reports only measured finished duration', () => {
  const { job, state } = fixture()
  const decision: ReviewJob['decision'] = { verdict: 'pass', finding: '已核对', evidenceSeqs: [10], imageSeqs: [], decisionSeq: 30 }
  const ended = { ...job, status: 'applied' as const, decision, finishedAt: '2026-10-09T00:03:13Z' }
  expect(reviewPresentation(ended, state)).toMatchObject({ label: 'reviewVerdict.pass', tone: 'success', active: false, duration: 193 })
  expect(reviewPresentation({ ...ended, status: 'stale' }, state)).toMatchObject({ label: 'reviewStale', tone: 'warning' })
  expect(reviewPresentation({ ...ended, finishedAt: 'invalid' }, state).duration).toBeNull()
})

it('retains explicit collapse across streaming remounts, resets for a new activity and bounds history', () => {
  const choices = createReviewDisclosureState(2)
  expect(choices.open('a', true)).toBe(true)
  choices.set('a', true, false)
  expect(choices.open('a', true)).toBe(false)
  expect(choices.open('a', false)).toBe(false)
  expect(choices.open('a', true)).toBe(true)
  choices.set('a', false, true)
  choices.set('b', false, true)
  choices.set('c', false, true)
  expect(choices.open('a', false)).toBe(false)
  expect(choices.open('b', false)).toBe(true)
  choices.clear()
  expect(choices.open('b', false)).toBe(false)
})

it('does not invent running status before the controller state loads', () => {
  const { job } = fixture()
  expect(reviewPresentation(job, null)).toMatchObject({ active: false, label: 'reading', tone: 'neutral' })
})
it('preserves separate report and process preferences across a browser reload with bounded, optional storage', () => {
  let saved = ''
  const storage = { getItem: () => saved, setItem: (_: string, value: string) => { saved = value } }
  const first = createReviewDisclosureState(2, storage)
  first.set('result:a', true, false)
  first.set('a', false, true)
  first.clear()
  const reloaded = createReviewDisclosureState(2, storage)
  expect(reloaded.open('result:a', true)).toBe(false)
  expect(reloaded.open('a', false)).toBe(true)
  reloaded.set('b', false, false)
  expect(JSON.parse(saved)).toHaveLength(2)
  saved = 'invalid'
  expect(createReviewDisclosureState(2, storage).open('a', true)).toBe(true)
  const denied = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  const ephemeral = createReviewDisclosureState(2, denied)
  ephemeral.set('a', true, false)
  expect(ephemeral.open('a', true)).toBe(false)
})
it('does not show a submitted pass as applied, and derives the next action from actual authorization', () => {
  const { job, state } = fixture()
  job.decision = { verdict: 'pass', finding: '完整结论\n\n正文末尾', evidenceSeqs: [10], imageSeqs: [], decisionSeq: 30 }
  job.status = 'submitted'
  expect(reviewPresentation(job, state)).toMatchObject({ tone: 'neutral', label: 'reviewSubmitted', next: 'reviewSubmitted' })
  job.status = 'applied'
  state.task!.phase = 'awaiting-approval'
  expect(reviewPresentation(job, state).next).toBe('reviewAwaitApproval')
  state.task!.phase = 'active'; state.armed = false
  expect(reviewPresentation(job, state).next).toBe('reviewManualRecovery')
  state.armed = true
  expect(reviewPresentation(job, state).next).toBe('reviewContinuing')
})
it('keeps the report visible when process details are collapsed, including after remounts', () => {
  const choices = createReviewDisclosureState()
  choices.set('job', false, false)
  expect(choices.open('result:job', true)).toBe(true)
  choices.set('result:job', true, false)
  expect(choices.open('result:job', true)).toBe(false)
  expect(choices.open('job', true)).toBe(true)
  expect(choices.open('result:job', true)).toBe(false)
})

it('does not describe the previous applied result as waiting for manual resume during the next review', () => {
  const { job, state } = fixture()
  job.status = 'applied'
  job.decision = { verdict: 'revise', finding: '补充核算', evidenceSeqs: [10], imageSeqs: [], decisionSeq: 30 }
  const next = { ...job, id: randomUUID(), status: 'started' as const, decision: null }
  state.reviewJobs = [job, next]
  state.task!.phase = 'reviewing'
  state.armed = false
  expect(reviewPresentation(job, state).next).toBe('reviewPreviousDecision')
  expect(reviewPresentation(next, state)).toMatchObject({ active: true, label: 'reviewRunning' })
})

it('renders the entire recorded tool-only report using native Markdown without truncating its tail', () => {
  const finding = '# 完整审查\n\n- 实际读取\n\n| 要求 | 结果 |\n| --- | --- |\n| 总数 | 通过 |\n\n```js\nconst n = 3;\n```\n\n' + '长正文。'.repeat(2000) + '\n\n末尾未验证事项'
  const html = renderToStaticMarkup(createElement(ReviewReport, { finding, t: key => zh[key] }))
  expect(html).toContain('<h1')
  expect(html).toContain('<table')
  expect(html).toContain('末尾未验证事项')
  expect(html).toContain('const')
  expect(html).not.toContain('max-height')
})
