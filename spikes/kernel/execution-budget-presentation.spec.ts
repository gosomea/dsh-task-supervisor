import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ExecutionBudgetStatus } from '../../src/client/execution-budget.tsx'
import { zh, en } from '../../src/client/locales.ts'
import { createExecutionBudget, longHorizonSchema, reserveBudgetAction, stopExecutionBudget } from '../../src/execution-budget.ts'
import { newTask } from '../../src/state.ts'
import type { PanelState } from '../../src/client/task-store.ts'

it.each(['zh', 'en'] as const)('renders the real deadline, cumulative counters and stop reason in %s', language => {
  const task = { ...newTask('Task'), phase: 'paused' as const, pauseReason: 'execution-budget' as const }
  const at = Date.parse('2026-10-09T00:00:00Z')
  let budget = createExecutionBudget(task.id, 'main', longHorizonSchema.parse({ taskDeadlineMs: 10000 }), at)
  budget = reserveBudgetAction(budget, { id: 'retry', kind: 'review-fault', requirementsVersion: 1, planVersion: 0, effectId: 'job-runtime' }, at + 1)
  budget = stopExecutionBudget(budget, 'action-unknown', 'retry', at + 2)
  const state: PanelState = { task, armed: false, reviewing: false, live: true, actions: ['resume'], executionBudget: budget, executionActivityAt: at + 1 }
  const strings = language === 'zh' ? zh : en
  const html = renderToStaticMarkup(createElement(ExecutionBudgetStatus, { state, t: key => strings[key] }))
  expect(html).toContain('0/6'); expect(html).toContain('1/3')
  expect(html).toContain(strings.taskDeadline); expect(html).toContain(strings.taskUnknownAction)
  expect(html).toContain(strings.taskLastActivity)
  expect(html).not.toContain('%')
  expect(renderToStaticMarkup(createElement(ExecutionBudgetStatus, { state: { ...state, task: newTask('other Task') }, t: key => strings[key] }))).toBe('')
})
