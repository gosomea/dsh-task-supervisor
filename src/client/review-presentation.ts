/** Durable outcomes stay visible when native process details are collapsed. */
import type { ReviewJob, ReviewFault } from '../review-schema.ts'
import type { PanelState } from './task-store.ts'
import type { SupervisorKey } from './locales.ts'

/** A persisted pending status alone is not proof of a running review. */
export function currentReviewJob(state: PanelState | null): ReviewJob | undefined {
  const task = state?.task
  if (!task) return undefined
  const id = task.pendingReview?.jobId ?? state.reviewActivity?.jobId
  return id ? state.reviewJobs?.find(job => job.taskId === task.id && job.id === id)
    : state.reviewJobs?.findLast(job => job.taskId === task.id && ['queued', 'started', 'repairing', 'submitted'].includes(job.status))
}

export function reviewPresentation(job: ReviewJob, state: PanelState | null) {
  const pending = ['queued', 'started', 'repairing', 'submitted'].includes(job.status)
  const current = state?.task?.id === job.taskId
  const active = pending && state?.live === true && currentReviewJob(state)?.id === job.id
    && state.reviewing
  const currentFault = current && state?.task?.reviewFault?.jobId === job.id
  const canRetry = currentFault && state?.live === true
    && state.actions.includes('retry-review')
  let label: SupervisorKey = 'reviewEnded'
  let tone: 'active' | 'success' | 'warning' | 'error' | 'neutral' = 'neutral'
  if (!state && pending) { label = 'reading' }
  else if (job.status === 'submitted') { label = 'reviewSubmitted'; tone = 'neutral' }
  else if (active) {
    label = job.recovery?.nextRetryAt || job.status === 'repairing' ? 'reviewRecoveringAction'
      : job.status === 'queued' ? 'reviewQueuedAction' : 'reviewRunning'
    tone = 'active'
  } else if (job.status === 'failed') { label = 'reviewFailed'; tone = 'error' }
  else if (job.status === 'stale') { label = 'reviewStale'; tone = 'warning' }
  else if (pending) { label = 'reviewWaitingRecovery'; tone = 'warning' }
  else if (job.status === 'applied' && job.decision) {
    label = `reviewVerdict.${job.decision.verdict}`
    tone = job.decision.verdict === 'pass' ? 'success' : 'warning'
  }
  const duration = job.finishedAt ? Math.max(0, Math.floor((Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000)) : null
  let next: SupervisorKey | null = null
  if (job.status === 'submitted') next = 'reviewSubmitted'
  else if (job.status === 'stale') next = 'reviewStale'
  else if (job.status === 'applied') {
    const latest = state?.reviewJobs?.findLast(item => item.taskId === job.taskId && item.status === 'applied')
    if (!current || latest?.id !== job.id) next = 'reviewPreviousDecision'
    else if (state.task?.phase === 'complete') next = 'reviewTaskComplete'
    else if (state.task?.phase === 'awaiting-approval') next = 'reviewAwaitApproval'
    else if (state.task?.pauseReason === 'decision') next = 'reviewUserNext'
    else if (!state.armed || !state.task?.enabled || state.task?.phase === 'paused') next = 'reviewManualRecovery'
    else next = state.task?.phase === 'planning' ? 'reviewNextPlanning' : 'reviewContinuing'
  }
  return { active, currentFault, canRetry, label, tone, next, duration: duration !== null && Number.isFinite(duration) ? duration : null }
}

const FAULT_LABELS: Record<ReviewFault['code'], SupervisorKey> = {
  'protocol-missing': 'reviewFaultProtocol', 'decision-invalid': 'reviewFaultDecision', 'evidence-read': 'reviewFaultEvidence',
  timeout: 'reviewFaultTimeout', provider: 'reviewFaultProvider', cancelled: 'reviewFaultCancelled', stale: 'reviewFaultStale',
  snapshot: 'reviewFaultSnapshot', 'check-infrastructure': 'reviewFaultInfrastructure', internal: 'reviewFaultInternal',
}
export function reviewFaultDescription(fault: ReviewFault): SupervisorKey { return FAULT_LABELS[fault.code] }

/** Native transcript virtualization can remount rows while their reviewer streams. */
export function createReviewDisclosureState(limit = 256) {
  const choices = new Map<string, { active: boolean; open: boolean }>()
  return {
    open(id: string, active: boolean): boolean {
      const before = choices.get(id)
      if (before?.active === active) return before.open
      if (before) choices.set(id, { active, open: active })
      return active
    },
    set(id: string, active: boolean, open: boolean) {
      choices.delete(id)
      choices.set(id, { active, open })
      while (choices.size > limit) choices.delete(choices.keys().next().value!)
    },
    clear() { choices.clear() },
  }
}
