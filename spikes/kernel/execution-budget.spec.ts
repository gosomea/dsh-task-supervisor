import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { longHorizonSchema, createExecutionBudget, reserveBudgetAction, confirmBudgetAction, stopExecutionBudget,
  foldExecutionBudgets, budgetCounts, BUDGET_VERSION, BUDGET_NAMESPACE } from '../../src/execution-budget.ts'
import { taskProjection, newTask, taskJson, RECORD_VERSION } from '../../src/state.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'

const created = Date.parse('2026-10-09T00:00:00Z')
const make = () => createExecutionBudget(randomUUID(), 'main', longHorizonSchema.parse({ taskDeadlineMs: 10000 }), created)
const action = (id: string, kind: 'truncation' | 'review-fault' | 'manual-resume' = 'truncation') =>
  ({ id, kind, requirementsVersion: 1, planVersion: 0, effectId: `${id}-effect` })
const fold = (values: ReturnType<typeof make>[], next: ReturnType<typeof make>) => foldExecutionBudgets(values, BUDGET_VERSION, 'state', JSON.parse(JSON.stringify(next)))

it('requires an explicit deadline and clips it to an earlier outer deadline', () => {
  expect(() => longHorizonSchema.parse({})).toThrow()
  expect(() => longHorizonSchema.parse({ taskDeadlineMs: 0 })).toThrow()
  expect(() => longHorizonSchema.parse({ taskDeadlineMs: 100, maxReviewFaultRetries: -1 })).toThrow()
  const policy = longHorizonSchema.parse({ taskDeadlineMs: 10000, outerDeadlineAt: new Date(created + 2000).toISOString() })
  expect(createExecutionBudget(randomUUID(), 'main', policy, created).deadlineAt).toBe(policy.outerDeadlineAt)
  expect(make().policy).toMatchObject({ maxTruncationRecoveries: 6, maxReviewFaultRetries: 3 })
})

it('counts reservations once, reconciles matching effects, and never refunds uncertain dispatch', () => {
  const initial = make(), reserved = reserveBudgetAction(initial, action('ending-1'), created + 1)
  expect(budgetCounts(reserved)).toEqual({ truncation: 1, reviewFault: 0, manual: 0 })
  expect(() => reserveBudgetAction(reserved, action('ending-1'), created + 2)).toThrow('action-unknown')
  expect(() => confirmBudgetAction(reserved, 'ending-1', 'another-effect')).toThrow('identity')
  const confirmed = confirmBudgetAction(reserved, 'ending-1', 'ending-1-effect', created + 2)
  expect(confirmBudgetAction(confirmed, 'ending-1', 'ending-1-effect', created + 3)).toBe(confirmed)
  expect(budgetCounts(confirmed).truncation).toBe(1)
  expect(fold(fold([], initial), reserved)).toEqual([reserved])
  expect(fold([reserved], confirmed)).toEqual([confirmed])
})

it('bounds automatic recovery across task requirement and plan revisions; manual recovery adds no budget', () => {
  let budget = make()
  for (let i = 0; i < 6; i++) budget = reserveBudgetAction(budget, { ...action(`truncate-${i}`), requirementsVersion: i + 1, planVersion: i }, created + i)
  expect(() => reserveBudgetAction(budget, action('truncate-6'), created + 7)).toThrow('truncation-budget')
  budget = reserveBudgetAction(budget, action('manual-1', 'manual-resume'), created + 8)
  expect(budgetCounts(budget)).toEqual({ truncation: 6, reviewFault: 0, manual: 1 })
  expect(() => reserveBudgetAction(budget, action('truncate-7'), created + 9)).toThrow('truncation-budget')
  for (let i = 0; i < 3; i++) budget = reserveBudgetAction(budget, action(`job-${i}:2`, 'review-fault'), created + 10 + i)
  expect(() => reserveBudgetAction(budget, action('job-3:2', 'review-fault'), created + 20)).toThrow('review-fault-budget')
})

it('rejects rewind, budget refill, binding and deadline changes, and fabricated confirmations', () => {
  const initial = make(), reserved = reserveBudgetAction(initial, action('first'), created + 1)
  expect(() => fold([reserved], initial)).toThrow('contiguous')
  for (const patch of [{ deadlineAt: new Date(created + 20000).toISOString() }, { taskId: randomUUID() }, { policy: { ...reserved.policy, maxTruncationRecoveries: 7 } }, { actions: [] }]) {
    expect(() => fold([reserved], { ...reserved, revision: reserved.revision + 1, ...patch })).toThrow()
  }
  expect(() => fold([initial], { ...reserved, actions: [{ ...reserved.actions[0]!, status: 'confirmed', confirmedAt: new Date(created + 2).toISOString() }] })).toThrow('reserved')
  const stopped = stopExecutionBudget(reserved, 'action-unknown', 'first', created + 3)
  expect(fold([reserved], stopped)).toEqual([stopped])
})

it('manual recovery and all automatic actions obey the original absolute deadline', () => {
  const initial = make()
  for (const kind of ['manual-resume', 'review-fault', 'truncation'] as const) expect(() => reserveBudgetAction(initial, action(kind, kind), created + 10000)).toThrow('task-deadline')
  expect(() => createExecutionBudget(randomUUID(), 'main', longHorizonSchema.parse({ taskDeadlineMs: 100, outerDeadlineAt: new Date(created).toISOString() }), created)).toThrow('task-deadline')
})

it('folds separate native budget state without changing Task revision or evidence position', () => {
  const task = newTask('A legacy or new Task')
  const state: SessionEvent = { type: 'extension/record', seq: SessionSeq(1), time: created, data: { namespace: 'dsh-task-supervisor', schemaVersion: RECORD_VERSION, recordId: 'state', kind: 'state', payload: taskJson(task) } }
  let projection = taskProjection.apply(taskProjection.init(), state)
  expect(projection.budgets).toEqual([])
  const budget = createExecutionBudget(task.id, 'main', longHorizonSchema.parse({ taskDeadlineMs: 10000 }), created)
  const event = (next: typeof budget, seq: number): SessionEvent => ({ type: 'extension/record', seq: SessionSeq(seq), time: created + seq, data: { namespace: BUDGET_NAMESPACE, schemaVersion: BUDGET_VERSION, recordId: String(seq), kind: 'state', payload: JSON.parse(JSON.stringify(next)) } })
  projection = taskProjection.apply(projection, event(budget, 2))
  projection = taskProjection.apply(projection, event(reserveBudgetAction(budget, action('boundary'), created + 3), 3))
  expect(projection.failure).toBeNull()
  expect(projection.current?.revision).toBe(1)
  expect(projection.currentSeq).toBe(1)
  expect(budgetCounts(projection.budgets[0]!)).toMatchObject({ truncation: 1 })
  const replayed = [state, event(budget, 2), event(reserveBudgetAction(budget, action('boundary'), created + 3), 3)].reduce(taskProjection.apply, taskProjection.init())
  expect(replayed).toEqual(projection)
})
