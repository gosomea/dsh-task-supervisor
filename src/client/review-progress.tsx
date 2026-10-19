/** Both task surfaces explain who is working, measured activity and the next handoff. */
import { useEffect, useState } from 'react'
import type { PanelState } from './task-store.ts'
import type { SupervisorTranslate } from './locales.ts'
import { currentReviewJob, reviewPresentation, reviewRecoveryGuidance, reviewFaultRemedy } from './review-presentation.ts'

export function ReviewProgress({ state, t }: { state: PanelState; t: SupervisorTranslate }) {
  const [now, setNow] = useState(Date.now)
  const job = currentReviewJob(state)
  const active = job && reviewPresentation(job, state).active
  useEffect(() => {
    if (!active) return
    setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [job?.id, active])
  if (!active) {
    if (state.task?.phase === 'awaiting-approval') return <p className="dsh-task-next" role="status">{t('reviewAwaitApproval')}</p>
    const next = reviewRecoveryGuidance(state)
    if (next) return <div className="dsh-task-next" role="status"><p>{t(next)}</p>
      {state.task?.reviewFault && <p>{t(reviewFaultRemedy(state.task.reviewFault))}</p>}</div>
    return null
  }
  const activity = state.reviewActivity?.jobId === job.id ? state.reviewActivity : null
  const seconds = Math.max(0, Math.floor((now - Date.parse(job.attemptStartedAt ?? job.startedAt)) / 1000))
  const elapsed = `${Math.floor(seconds / 60)}${t('minute')} ${seconds % 60}${t('second')}`
  const waitingCheck = job.verification?.requests?.some(r => r.status === 'queued' || r.status === 'running')
  const action = waitingCheck ? t('reviewWaitingCheck') : job.recovery?.nextRetryAt ? t('reviewRecoveringAction') : job.status === 'queued' ? t('reviewQueuedAction') : activity?.action === 'reading' ? t('reviewReadingAction')
    : activity?.action === 'checking' ? t('reviewCheckingAction') : activity?.action === 'deciding' ? t('reviewDecidingAction')
      : activity?.action === 'settled' || job.status === 'submitted' ? t('reviewApplyingAction') : t('reviewGeneratingAction')
  const idleSeconds = activity?.lastActivityAt ? Math.max(0, Math.floor((now - activity.lastActivityAt) / 1000)) : null
  return <div className="dsh-task-review-progress" role="status" aria-live="off">
    <p><span className="dsh-task-activity-dot" aria-hidden="true" /><strong>Supervisor · {action}</strong> · {elapsed}</p>
    {job.budget && <small>{t('reviewBudgetModel')} {Math.floor((job.budget.usedModelMs + (job.budget.mode === 'model' ? Math.max(0, now - job.budget.since) : 0)) / 1000)}/{Math.floor(job.budget.modelMs / 1000)}{t('second')} · {t('reviewBudgetChecks')} {Math.floor((job.budget.usedChecksMs + (job.budget.mode === 'checking' ? Math.max(0, now - job.budget.since) : 0)) / 1000)}/{Math.floor(job.budget.checksMs / 1000)}{t('second')} · {t('reviewBudgetExtensions')} {job.budget.extensions}</small>}
    {job.qualityProtocol && <small>{t('reviewCoverage')} {job.verification?.partialCheckFindings?.length ?? job.partialRequirements?.length ?? 0}</small>}
    {job.recovery?.nextRetryAt && <small>{job.fault?.message} · {t('reviewFaultRetries')} {job.recovery.consumed}/{job.recovery.retryLimit} · {t('reviewRetryAt')} {new Date(job.recovery.nextRetryAt).toLocaleTimeString()}</small>}
    {activity?.tool && <small>{activity.tool}{activity.target ? ` · ${activity.target}` : ''}</small>}
    <small>{activity && `${t('reviewReads')} ${activity.reads} · ${t('reviewErrors')} ${activity.errors} · `}
      {idleSeconds !== null && `${t('reviewLastActivity')} ${idleSeconds}${t('second')} · `}
      {job.deadlineAt && `${t('reviewDeadline')} ${new Date(job.deadlineAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</small>
    <small>{t(state.primaryTurnEnded ? 'reviewPrimaryWaiting' : 'reviewPrimaryChecking')} {t(job.kind === 'plan' ? 'reviewNextPlan' : job.kind === 'planning' ? 'reviewNextPlanning' : 'reviewNextNode')}</small>
  </div>
}
