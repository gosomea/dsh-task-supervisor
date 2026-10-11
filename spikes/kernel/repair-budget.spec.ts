import { expect, it } from 'vitest'
import { newTask } from '../../src/state.ts'
import { initialRepairBudget, repairTransition, validateRepairHistory, hasRepairPermit } from '../../src/repair-budget.ts'
import { approvedTask } from '../../src/decisions.ts'
import { observationReason } from '../../src/observation.ts'
import { validateDelivery } from '../../src/delivery.ts'
import type { ReviewJob } from '../../src/review-schema.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { RequirementResult } from '../../src/review-results.ts'

function task() {
  return approvedTask({ ...newTask('Deliver the requested files'), repairBudget: initialRepairBudget(), phase: 'awaiting-approval', planVersion: 1,
    criteria: [{ id: 'c', text: 'Required output' }], stages: [{ id: 'a', title: 'A', criterionIds: ['c'] }, { id: 'b', title: 'B', criterionIds: ['c'] }],
    nodeRuns: [{ id: 'a', attempt: 1, status: 'passed' }, { id: 'b', attempt: 1, status: 'pending' }] }, 10)
}
it('bounds cumulative replans and per-node rework across plan changes, resume and duplicate callbacks', () => {
  let current = task()
  for (let i = 0; i < 3; i++) {
    const action = { id: `repair-${i}`, kind: 'rework' as const, nodeId: 'a', reason: 'A real defect', fingerprint: `content-${i}`, seq: 20 + i }
    const next = repairTransition(current, action)
    expect(repairTransition(next, action)).toBe(next)
    expect(next.nodeRuns?.map(run => run.attempt)).toEqual([i + 2, i + 2])
    validateRepairHistory(current, next); current = { ...next, phase: 'active', planVersion: i + 2, approvedPlanVersion: i + 2 }
  }
  const stopped = repairTransition(current, { id: 'fourth', kind: 'rework', nodeId: 'a', reason: 'Again', fingerprint: 'new', seq: 24 })
  expect(stopped).toMatchObject({ phase: 'paused', pauseReason: 'repair-budget' })
  expect(repairTransition({ ...stopped, phase: 'active' }, { id: 'manual-resumed', kind: 'rework', nodeId: 'a', reason: 'Again', fingerprint: 'newer', seq: 25 }).pauseReason).toBe('repair-budget')
  let replan = task()
  for (let i = 0; i < 3; i++) replan = repairTransition(replan, { id: `p${i}`, kind: 'replan', reason: 'Repair DAG', fingerprint: `${i}`, seq: i })
  expect(repairTransition(replan, { id: 'p4', kind: 'replan', reason: 'Repair DAG', fingerprint: '4', seq: 4 }).pauseReason).toBe('repair-budget')
  expect(() => validateRepairHistory(current, { ...current, repairBudget: initialRepairBudget() })).toThrow('reset')
})
it('stops two consecutive unchanged repair rounds and revokes permits for new requirements without resetting counters', () => {
  let current = task()
  for (let i = 0; i < 3; i++) current = repairTransition(current, { id: `${i}`, kind: 'rework', nodeId: 'a', reason: 'Repair', fingerprint: 'same', seq: i })
  expect(current).toMatchObject({ phase: 'paused', pauseReason: 'repair-stalled' })
  expect(current.repairBudget?.history.map(entry => entry.noProgress)).toEqual([0, 1, 2])
  const edited = { ...current, requirementsVersion: 2, everApproved: false, repairBudget: { ...current.repairBudget!, permit: null } }
  validateRepairHistory(current, edited); expect(hasRepairPermit(edited)).toBe(false)
  expect(() => repairTransition({ ...edited, phase: 'active' }, { id: 'new', kind: 'replan', reason: 'Again', fingerprint: 'changed', seq: 8 })).toThrow('approval permit')
  expect(() => validateRepairHistory(newTask('old'), task())).toThrow('Legacy')
})
it('does not use tool counts or elapsed time as anomaly evidence, but consecutive errors still trigger inspection', () => {
  const result = (seq: number, isError: boolean) => ({ seq, type: 'tool/result', data: { message: { isError } } }) as SessionEvent
  const cursor = { key: 'node', seq: 0, time: 0 }, policy = { toolCalls: 1, elapsedMs: 1, consecutiveErrors: 3 }
  expect(observationReason([result(1, false)], cursor, policy, 600000, true)).toBeNull()
  expect(observationReason([result(1, true), result(2, true), result(3, true)], cursor, policy, 600000, true)).toContain('consecutive tool errors')
})
it('requires requested delivery receipts without adding Git to static products or accepting a main-Agent claim', () => {
  const input = task(); input.nodeRuns!.forEach(run => { run.status = 'passed' })
  input.criteria[0]!.delivery = 'action'
  const job = { kind: 'completion', input, cutoff: 8 } as ReviewJob
  const requirement: RequirementResult = { id: 'deliver', criterionId: 'c', requirement: 'Requested action', source: { kind: 'objective', reference: 'objective' }, basis: 'explicit',
    delivery: 'action', status: 'satisfied', finding: 'Actual action checked', coverage: 'Requested destination', limitations: '', method: 'log',
    evidence: [{ kind: 'session', seq: 6, total: 4, ranges: [[0, 4]], truncated: false }] }
  const events = [{ seq: 5, type: 'tool/call', data: { name: 'bash', callId: 'one', turn: 1, step: 1 } },
    { seq: 6, type: 'tool/result', data: { turn: 1, step: 1, message: { source: { callId: 'one' }, isError: false } } }] as SessionEvent[]
  expect(() => validateDelivery(job, [requirement], events)).not.toThrow()
  expect(() => validateDelivery(job, [requirement], [{ seq: 6, type: 'assistant/message' } as SessionEvent])).toThrow('actual successful')
  expect(() => validateDelivery(job, [{ ...requirement, evidence: [{ ...requirement.evidence[0]!, truncated: true } as RequirementResult['evidence'][number]] }], events)).toThrow('actual successful')
  expect(() => validateDelivery(job, undefined, events)).toThrow('Delivery requirement')
  delete input.criteria[0]!.delivery
  expect(() => validateDelivery(job, undefined, [])).not.toThrow()
  input.nodeRuns![1]!.status = 'pending'
  expect(() => validateDelivery(job, undefined, [])).toThrow('every current DAG')
})
