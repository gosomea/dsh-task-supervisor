/** One budget explanation shared by the composer progress and task details. */
import type { PanelState } from './task-store.ts'
import type { SupervisorTranslate } from './locales.ts'

export function ExecutionBudgetStatus({ state, t }: { state: PanelState; t: SupervisorTranslate }) {
  const budget = state.executionBudget
  if (!budget || budget.taskId !== state.task?.id) return null
  const truncations = budget.actions.filter(item => item.kind === 'truncation').length
  const retries = budget.actions.filter(item => item.kind === 'review-fault').length
  const manual = budget.actions.filter(item => item.kind === 'manual-resume').length
  const last = budget.stops.at(-1)
  return <div className="dsh-task-next" role="status">
    <small>{t('taskDeadline')} {new Date(budget.deadlineAt).toLocaleString()} · {t('taskTruncations')} {truncations}/{budget.policy.maxTruncationRecoveries} · {t('taskFaultRetries')} {retries}/{budget.policy.maxReviewFaultRetries}</small>
    {manual > 0 && <small> · {t('taskManualRounds')} {manual}</small>}
    {state.executionActivityAt && <small> · {t('taskLastActivity')} {new Date(state.executionActivityAt).toLocaleTimeString()}</small>}
    {state.task?.pauseReason === 'task-deadline' && <p>{t('taskDeadlineStopped')}</p>}
    {state.task?.pauseReason === 'execution-budget' && <p>{t(last?.reason === 'action-unknown' ? 'taskUnknownAction' : 'taskBudgetStopped')}</p>}
  </div>
}
