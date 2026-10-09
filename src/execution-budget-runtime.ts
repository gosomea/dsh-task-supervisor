/** Durable execution budget on public native Session and lifecycle interfaces. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { randomUUID } from 'node:crypto'
import { appendControlRecord } from './session-records.ts'
import { appendTask, taskOf, type TaskSnapshot } from './state.ts'
import { BUDGET_NAMESPACE, BUDGET_VERSION, assertBudgetTime, createExecutionBudget, confirmBudgetAction,
  reserveBudgetAction, stopExecutionBudget, ExecutionBudgetError,
  type ExecutionBudget, type LongHorizonPolicy, type BudgetActionKind } from './execution-budget.ts'

export function installExecutionBudget(ctx: Context, policy: LongHorizonPolicy | undefined,
  withdraw: (agent: Agent, reason: Error) => void) {
  const timers = new Map<Agent, ReturnType<typeof setTimeout>>()
  const writes = new Set<Promise<void>>()
  let disposed = false
  const budgetOf = (agent: Agent, taskId = taskOf(ctx, agent)?.id) => ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.budgets.find(item => item.taskId === taskId)
  const flush = async (agent: Agent) => { if (!await ctx.sessions.flush(agent.session)) throw new Error('execution budget Session is not durable') }
  function append(agent: Agent, budget: ExecutionBudget): void {
    appendControlRecord(agent, { namespace: BUDGET_NAMESPACE, schemaVersion: BUDGET_VERSION,
      recordId: `${budget.taskId}:${budget.revision}`, kind: 'state', payload: JSON.parse(JSON.stringify(budget)) })
    if (budgetOf(agent, budget.taskId)?.revision !== budget.revision) throw new Error('execution budget did not project')
  }
  function persistStop(agent: Agent, error: ExecutionBudgetError, actionId?: string): void {
    const budget = budgetOf(agent), task = taskOf(ctx, agent)
    if (!budget || !task || ['complete', 'cleared'].includes(task.phase)) return
    const stopped = stopExecutionBudget(budget, error.reason, actionId)
    if (stopped !== budget) append(agent, stopped)
    withdraw(agent, error)
    const reason = error.reason === 'task-deadline' ? 'task-deadline' : 'execution-budget'
    const actual = taskOf(ctx, agent)
    const fault = error.reason === 'review-fault-budget' ? ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviewJobs.findLast(job => job.taskId === task.id && job.fault)?.fault : undefined
    if (actual?.id === task.id && (actual.phase !== 'paused' || actual.pauseReason !== reason)) appendTask(ctx, agent,
      { ...actual, revision: actual.revision + 1, phase: 'paused', pauseReason: reason, ...fault ? { reviewFault: fault } : {} })
    const write = flush(agent).catch(error => ctx.logger.warn(`Execution budget stop persistence failed: ${String(error)}`)).finally(() => writes.delete(write))
    writes.add(write)
  }
  function requireTime(agent: Agent): void {
    const budget = budgetOf(agent)
    if (!budget) return
    if (budget.mainSessionId !== agent.id) throw new Error('Task budget belongs to the original Session; create a distinct Task before execution in this fork')
    if (disposed) throw new Error('Supervisor execution budget unloaded')
    try { assertBudgetTime(budget) } catch (error) {
      if (error instanceof ExecutionBudgetError) persistStop(agent, error)
      throw error
    }
  }
  function watch(agent: Agent): void {
    clearTimeout(timers.get(agent)); timers.delete(agent)
    const budget = budgetOf(agent), task = taskOf(ctx, agent)
    if (disposed || !budget || !task || ['complete', 'cleared'].includes(task.phase)) return
    if (budget.mainSessionId !== agent.id) return // A fork may read the original budget, not acquire its automatic authority.
    const remaining = Date.parse(budget.deadlineAt) - Date.now()
    if (remaining <= 0) { persistStop(agent, new ExecutionBudgetError('task-deadline')); return }
    const timer = setTimeout(() => { timers.delete(agent); watch(agent) }, Math.min(remaining, 2147483647))
    timer.unref(); timers.set(agent, timer)
  }
  ctx.on('agent/created', ({ agent }) => { watch(agent) })
  ctx.on('agent/disposed', ({ agent }) => { clearTimeout(timers.get(agent)); timers.delete(agent) })
  ctx.effect(() => async () => {
    disposed = true
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    await Promise.all([...writes])
  })
  return {
    budgetOf, requireTime,
    uncertain(agent: Agent, actionId: string): void { persistStop(agent, new ExecutionBudgetError('action-unknown'), actionId) },
    initialize(agent: Agent, task: TaskSnapshot): void {
      if (!policy || budgetOf(agent, task.id)) return
      // Only call at new Task creation. Restoring a legacy Task never invokes this.
      append(agent, createExecutionBudget(task.id, agent.id, policy)); watch(agent)
    },
    async reserve(agent: Agent, task: TaskSnapshot, kind: BudgetActionKind, id: string, effectId: string): Promise<void> {
      requireTime(agent)
      const budget = budgetOf(agent, task.id)
      if (!budget) return
      if (taskOf(ctx, agent)?.id !== task.id) throw new Error('execution budget belongs to a different Task')
      try {
        append(agent, reserveBudgetAction(budget, { id, kind, effectId, requirementsVersion: task.requirementsVersion, planVersion: task.planVersion }))
        await flush(agent)
      } catch (error) {
        if (error instanceof ExecutionBudgetError) persistStop(agent, error, id)
        else if (budgetOf(agent, task.id)?.actions.some(item => item.id === id)) persistStop(agent, new ExecutionBudgetError('action-unknown'), id)
        throw error
      }
    },
    async confirm(agent: Agent, taskId: string, id: string, effectId: string): Promise<void> {
      const budget = budgetOf(agent, taskId)
      if (!budget) return
      const next = confirmBudgetAction(budget, id, effectId)
      if (next !== budget) { append(agent, next); await flush(agent) }
    },
    manualId(agent: Agent) { return `manual:${agent.session.seq}:${randomUUID()}` },
  }
}
