/** Both task surfaces explain who is working, measured activity and the next handoff. */
import { useEffect, useState } from 'react'
import type { PanelState } from './task-store.ts'
import type { SupervisorTranslate } from './locales.ts'
import { currentReviewJob, reviewPresentation, reviewNextAction } from './review-presentation.ts'

export function ReviewProgress({ state, t }: { state: PanelState; t: SupervisorTranslate }) {
  const [now, setNow] = useState(Date.now)
  const job = currentReviewJob(state)
  const active = job && reviewPresentation(job, state).active
  const cleanup = job?.cleanupHistory?.findLast(item => !item.finishedAt || item.confirmed !== true)
  useEffect(() => {
    if (!active && !cleanup) return
    setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [job?.id, active, cleanup?.runtimeId])
  if (!active) {
    if (cleanup) return <div className="dsh-task-review-progress" role="status"><strong>{t(cleanup.finishedAt ? 'reviewCleanupFault' : 'reviewCleaning')}</strong> · {Math.max(0, Math.floor((now - Date.parse(cleanup.startedAt)) / 1000))}{t('second')}<p>{cleanup.error ?? t('reviewCleanupNext')}</p></div>
    if (state.task?.phase === 'awaiting-approval') return <p className="dsh-task-next" role="status">{t('reviewAwaitApproval')}</p>
    if (state.task?.pauseReason === 'review-fault') return <p className="dsh-task-next" role="status">{t('reviewFaultPaused')}</p>
    return null
  }
  const activity = state.reviewActivity?.jobId === job.id ? state.reviewActivity : null
  const seconds = Math.max(0, Math.floor((now - Date.parse(job.budget?.admittedAt ?? job.startedAt)) / 1000))
  const remaining = job.deadlineAt ? Math.max(0, Math.ceil((Date.parse(job.deadlineAt) - now) / 1000)) : null
  const elapsed = `${Math.floor(seconds / 60)}${t('minute')} ${seconds % 60}${t('second')}`
  const action = job.recovery?.nextRetryAt ? t('reviewRecoveringAction') : job.status === 'queued' ? t('reviewQueuedAction') : activity?.action === 'reading' ? t('reviewReadingAction')
    : activity?.action === 'checking' ? t('reviewCheckingAction') : activity?.action === 'deciding' ? t('reviewDecidingAction')
      : activity?.action === 'settled' || job.status === 'submitted' ? t('reviewApplyingAction') : t('reviewGeneratingAction')
  const idleSeconds = activity?.lastActivityAt ? Math.max(0, Math.floor((now - activity.lastActivityAt) / 1000)) : null
  return <div className="dsh-task-review-progress" role="status" aria-live="off">
    <p><span className="dsh-task-activity-dot" aria-hidden="true" /><strong>Supervisor · {action}</strong> · {elapsed}</p>
    {job.recovery?.nextRetryAt && <small>{job.fault?.message} · {t('reviewFaultRetries')} {job.recovery.consumed}/{job.recovery.retryLimit} · {t('reviewRetryAt')} {new Date(job.recovery.nextRetryAt).toLocaleTimeString()}</small>}
    {activity?.tool && <small>{activity.tool}{activity.target ? ` · ${activity.target}` : ''}</small>}
    {job.budget && <small>{t('reviewWorkload')} {t(`reviewTier.${job.budget.tier}`)} · {t(`reviewPhase.${job.budget.phase}`)} · {t('reviewRemaining')} {remaining}{t('second')} · {t('reviewBudgetTotal')} {Math.ceil((Date.parse(job.budget.deadlineAt) - Date.parse(job.budget.admittedAt)) / 1000)}{t('second')}</small>}
    <small>{activity && `${t('reviewReads')} ${activity.reads} · ${t('reviewErrors')} ${activity.errors} · `}
      {idleSeconds !== null && `${t('reviewLastActivity')} ${idleSeconds}${t('second')} · `}
      {job.deadlineAt && `${t('reviewDeadline')} ${new Date(job.deadlineAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</small>
    <small>{t(state.primaryTurnEnded ? 'reviewPrimaryWaiting' : 'reviewPrimaryChecking')} {t(reviewNextAction(job.kind))}</small>
  </div>
}
