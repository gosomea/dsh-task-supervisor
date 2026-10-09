/** Task-wide recovery accounting. Budget updates never revise the Task or its review input. */
import { z } from 'zod'

export const BUDGET_NAMESPACE = 'dsh-task-supervisor-execution-budget'
export const BUDGET_VERSION = 1

export const longHorizonSchema = z.object({
  taskDeadlineMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  /** An outer run may shorten, but cannot lengthen, the Task deadline. */
  outerDeadlineAt: z.iso.datetime().optional(),
  maxTruncationRecoveries: z.number().int().min(0).max(100).default(6),
  maxReviewFaultRetries: z.number().int().min(0).max(100).default(3),
}).strict()
export type LongHorizonConfig = z.input<typeof longHorizonSchema>
export type LongHorizonPolicy = z.output<typeof longHorizonSchema>
export type BudgetActionKind = 'truncation' | 'review-fault' | 'manual-resume'
export const budgetActionSchema = z.object({
  id: z.string().min(1), kind: z.enum(['truncation', 'review-fault', 'manual-resume']),
  at: z.iso.datetime(), requirementsVersion: z.number().int().positive(),
  planVersion: z.number().int().nonnegative(),
  effectId: z.string().min(1), status: z.enum(['reserved', 'confirmed']),
  confirmedAt: z.iso.datetime().optional(),
}).strict()
export type BudgetAction = z.infer<typeof budgetActionSchema>
export const budgetStopSchema = z.object({
  at: z.iso.datetime(), reason: z.enum(['task-deadline', 'truncation-budget', 'review-fault-budget', 'action-unknown']),
  actionId: z.string().min(1).optional(),
}).strict()
export type BudgetStopReason = z.infer<typeof budgetStopSchema>['reason']
export const executionBudgetSchema = z.object({
  taskId: z.string().uuid(), mainSessionId: z.string().min(1), revision: z.number().int().positive(),
  policy: longHorizonSchema, createdAt: z.iso.datetime(), deadlineAt: z.iso.datetime(),
  actions: z.array(budgetActionSchema), stops: z.array(budgetStopSchema),
}).strict()
export type ExecutionBudget = z.infer<typeof executionBudgetSchema>

function same(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

export class ExecutionBudgetError extends Error {
  constructor(readonly reason: BudgetStopReason) { super(`TASK_EXECUTION_BUDGET: ${reason}`) }
}

export function createExecutionBudget(taskId: string, mainSessionId: string, policy: LongHorizonPolicy, now = Date.now()): ExecutionBudget {
  const deadline = Math.min(now + policy.taskDeadlineMs, policy.outerDeadlineAt ? Date.parse(policy.outerDeadlineAt) : Infinity)
  if (!Number.isSafeInteger(deadline) || deadline <= now) throw new ExecutionBudgetError('task-deadline')
  return executionBudgetSchema.parse({ taskId, mainSessionId, revision: 1, policy,
    createdAt: new Date(now).toISOString(), deadlineAt: new Date(deadline).toISOString(), actions: [], stops: [] })
}

export function budgetCounts(budget: ExecutionBudget) {
  // Reservations consume budget even when the effect's result is unknown. Nothing refunds them.
  return { truncation: budget.actions.filter(action => action.kind === 'truncation').length,
    reviewFault: budget.actions.filter(action => action.kind === 'review-fault').length,
    manual: budget.actions.filter(action => action.kind === 'manual-resume').length }
}

export function assertBudgetTime(budget: ExecutionBudget, now = Date.now()): void {
  if (now >= Date.parse(budget.deadlineAt)) throw new ExecutionBudgetError('task-deadline')
}

/** Duplicate identities are reconciled by the caller, never reserved a second time. */
export function reserveBudgetAction(budget: ExecutionBudget, action: Omit<BudgetAction, 'status' | 'at' | 'confirmedAt'>, now = Date.now()): ExecutionBudget {
  assertBudgetTime(budget, now)
  if (budget.actions.some(item => item.id === action.id)) throw new ExecutionBudgetError('action-unknown')
  const counts = budgetCounts(budget)
  if (action.kind === 'truncation' && counts.truncation >= budget.policy.maxTruncationRecoveries) throw new ExecutionBudgetError('truncation-budget')
  if (action.kind === 'review-fault' && counts.reviewFault >= budget.policy.maxReviewFaultRetries) throw new ExecutionBudgetError('review-fault-budget')
  return { ...budget, revision: budget.revision + 1,
    actions: [...budget.actions, { ...action, at: new Date(now).toISOString(), status: 'reserved' }] }
}

export function confirmBudgetAction(budget: ExecutionBudget, id: string, effectId: string, now = Date.now()): ExecutionBudget {
  const action = budget.actions.find(item => item.id === id)
  if (!action || action.effectId !== effectId) throw new Error('budget action effect identity mismatch')
  if (action.status === 'confirmed') return budget
  return { ...budget, revision: budget.revision + 1, actions: budget.actions.map(item => item.id === id
    ? { ...item, status: 'confirmed', confirmedAt: new Date(now).toISOString() } : item) }
}

export function stopExecutionBudget(budget: ExecutionBudget, reason: BudgetStopReason, actionId?: string, now = Date.now()): ExecutionBudget {
  if (budget.stops.at(-1)?.reason === reason && budget.stops.at(-1)?.actionId === actionId) return budget
  return { ...budget, revision: budget.revision + 1, stops: [...budget.stops,
    { at: new Date(now).toISOString(), reason, ...actionId ? { actionId } : {} }] }
}

/** Reject tampering, rewinds and replay; old Task records do not acquire a budget. */
export function foldExecutionBudgets(budgets: ExecutionBudget[], schemaVersion: number, kind: string, payload: unknown): ExecutionBudget[] {
  if (schemaVersion !== BUDGET_VERSION || kind !== 'state') throw new Error('unsupported execution budget record')
  const next = executionBudgetSchema.parse(payload)
  const previous = budgets.find(item => item.taskId === next.taskId)
  if (!previous) {
    const expected = createExecutionBudget(next.taskId, next.mainSessionId, next.policy, Date.parse(next.createdAt))
    if (!same(expected, next)) throw new Error('invalid initial execution budget')
  } else {
    if (next.revision !== previous.revision + 1) throw new Error('execution budget revision is not contiguous')
    const { revision: _oldRevision, actions: _oldActions, stops: _oldStops, ...oldBinding } = previous
    const { revision: _revision, actions: _actions, stops: _stops, ...binding } = next
    if (!same(oldBinding, binding)) throw new Error('execution budget binding cannot change')
    let valid = false
    if (next.actions.length === previous.actions.length + 1 && same(next.stops, previous.stops)) {
      const action = next.actions.at(-1)!
      const { at, status, confirmedAt, ...input } = action
      if (status !== 'reserved' || confirmedAt !== undefined) throw new Error('new action must be reserved')
      valid = same(reserveBudgetAction(previous, input, Date.parse(at)), next)
    } else if (next.actions.length === previous.actions.length && same(next.stops, previous.stops)) {
      const changed = next.actions.filter((item, i) => !same(item, previous.actions[i]))
      if (changed.length === 1 && changed[0]!.confirmedAt) valid = same(confirmBudgetAction(previous,
        changed[0]!.id, changed[0]!.effectId, Date.parse(changed[0]!.confirmedAt!)), next)
    } else if (next.stops.length === previous.stops.length + 1 && same(next.actions, previous.actions)) {
      const stop = next.stops.at(-1)!
      valid = same(stopExecutionBudget(previous, stop.reason, stop.actionId, Date.parse(stop.at)), next)
    }
    if (!valid) throw new Error('invalid execution budget transition')
  }
  return [...budgets.filter(item => item.taskId !== next.taskId), next]
}
