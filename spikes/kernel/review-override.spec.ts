import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { newTask, taskSchema, taskJson } from '../../src/state.ts'
import { reviewJobSchema } from '../../src/review-schema.ts'
import { overrideActions, overrideReview } from '../../src/review-override.ts'
import { acceptedNodes, releasedNodes, readyNodes } from '../../src/graph.ts'
function fixture(kind = 'stage') {
  const task = taskSchema.parse({ ...newTask('Implement both steps'), phase: 'paused', pauseReason: 'review-fault', everApproved: true,
    stages: [{ id: 'a', title: 'A', criterionIds: ['a'] }, { id: 'b', title: 'B', criterionIds: ['b'] }],
    criteria: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
    nodeRuns: [{ id: 'a', attempt: 1, status: 'reviewing' }, { id: 'b', attempt: 1, status: 'pending' }] })
  const job = reviewJobSchema.parse({ id: randomUUID(), revision: 1, mainSessionId: 'main', taskId: task.id, taskRevision: task.revision,
    planVersion: task.planVersion, stageId: kind === 'stage' ? 'a' : kind, nodeAttempt: kind === 'stage' ? 1 : null,
    kind, cutoff: 20, reviewerSessionId: 'review', model: null, runtimeId: randomUUID(), status: 'failed', attempt: 1,
    repairLimit: 1, startedAt: '', finishedAt: '', trigger: kind, input: task, evidence: 'done', fault: null, decision: null })
  return { task, job }
}
it('releases scheduling without inventing passed evidence and survives serialization', () => {
  const { task, job } = fixture()
  const next = overrideReview(task, job, 'skip-review', 21, '2026-10-19T00:00:00Z')
  expect(acceptedNodes(next)).toEqual([])
  expect(releasedNodes(next)).toEqual(['a'])
  expect(readyNodes(next)).toEqual(['b'])
  expect(taskSchema.parse(taskJson(next)).reviewOverrides).toEqual(next.reviewOverrides)
  expect(() => overrideReview(next, job, 'skip-review', 22, '')).toThrow()
})
it('rejects changed requirements, node attempts and stale jobs', () => {
  const { task, job } = fixture()
  expect(overrideActions({ ...task, requirementsVersion: 2 }, job)).toEqual([])
  expect(overrideActions({ ...task, nodeRuns: [{ id: 'a', attempt: 2, status: 'running' }] }, job)).toEqual([])
  expect(overrideActions(task, { ...job, status: 'stale' })).toEqual([])
})
it('approves a concrete plan once without claiming review success', () => {
  const { task, job } = fixture('plan')
  const next = overrideReview(task, job, 'skip-review', 21, '')
  expect(next.approvedPlanVersion).toBe(task.planVersion + 1)
  expect(next.phase).toBe('active')
  expect(next.lastReview).toBeNull()
  expect(overrideActions(task, { ...job, input: { ...task, stages: [] } })).toEqual([])
})
it('closes final acceptance distinctly and cannot resume it via override', () => {
  const { task, job } = fixture('completion')
  const next = overrideReview(task, job, 'finish-without-review', 21, '')
  expect(next.phase).toBe('closed')
  expect(overrideActions(next, job)).toEqual([])
  expect(overrideActions(task, { ...job, kind: 'stage', stageId: 'a', nodeAttempt: 1 })).not.toContain('finish-without-review')
})

it('keeps human ending available after releasing final review without acceptance', () => {
  const { task, job } = fixture('completion')
  const next = overrideReview(task, job, 'skip-review', 21, '')
  expect(overrideActions(next, job)).toEqual(['finish-without-review'])
  const closed = overrideReview(next, job, 'finish-without-review', 22, '')
  expect(closed.phase).toBe('closed')
  expect(closed.reviewOverrides).toHaveLength(2)
  expect(closed.lastReview).toBeNull()
})
