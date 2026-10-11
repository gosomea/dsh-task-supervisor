/** One budget explanation shared by the composer progress and task details. */
import type { PanelState } from './task-store.ts'
import type { SupervisorTranslate } from './locales.ts'

export function ExecutionBudgetStatus({ state, t }: { state: PanelState; t: SupervisorTranslate }) {
  const budget = state.executionBudget
  const repair = state.task?.repairBudget
  if ((!budget || budget.taskId !== state.task?.id) && !repair) return null
  const truncations = budget?.actions.filter(item => item.kind === 'truncation').length ?? 0
  const retries = budget?.actions.filter(item => item.kind === 'review-fault').length ?? 0
  const manual = budget?.actions.filter(item => item.kind === 'manual-resume').length ?? 0
  const last = budget?.stops.at(-1)
  const rework = repair?.history.findLast(item => item.kind === 'rework')
  return <div className="dsh-task-next" role="status">
    {budget && <small>{t('taskDeadline')} {new Date(budget.deadlineAt).toLocaleString()} · {t('taskTruncations')} {truncations}/{budget.policy.maxTruncationRecoveries} · {t('taskFaultRetries')} {retries}/{budget.policy.maxReviewFaultRetries}</small>}
    {repair && <small>{t('taskReplans')} {repair.history.filter(item => item.kind === 'replan' && item.admitted).length}/{repair.replanLimit}{rework && <> · {rework.nodeId} · {t('taskReworks')} {repair.history.filter(item => item.kind === 'rework' && item.nodeId === rework.nodeId && item.admitted).length}/{repair.nodeLimit}</>}</small>}
    {['repair-budget', 'repair-stalled'].includes(state.task?.pauseReason ?? '') && <p>{t(state.task?.pauseReason === 'repair-stalled' ? 'taskRepairStalled' : 'taskRepairLimit')} {repair?.history.at(-1)?.reason}</p>}
    {manual > 0 && <small> · {t('taskManualRounds')} {manual}</small>}
    {state.executionActivityAt && <small> · {t('taskLastActivity')} {new Date(state.executionActivityAt).toLocaleTimeString()}</small>}
    {state.task?.pauseReason === 'task-deadline' && <p>{t('taskDeadlineStopped')}</p>}
    {state.task?.pauseReason === 'execution-budget' && <p>{t(last?.reason === 'action-unknown' ? 'taskUnknownAction' : 'taskBudgetStopped')}</p>}
  </div>
}
