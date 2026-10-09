/** Durable outcomes stay visible when native process details are collapsed. */
import type { ReviewJob, ReviewFault } from '../review-schema.ts'
import type { PanelState } from './task-store.ts'
import type { SupervisorKey } from './locales.ts'

export function reviewPresentation(job: ReviewJob, state: PanelState | null) {
  const pending = ['queued', 'started', 'repairing', 'submitted'].includes(job.status)
  const current = state?.task?.id === job.taskId
  const active = pending && state?.live !== false && (!state || current && (state.reviewing || state.task?.phase === 'reviewing'))
  const currentFault = current && state?.task?.reviewFault?.jobId === job.id
  const canRetry = currentFault && state?.live === true
    && state.actions.includes('retry-review')
  let label: SupervisorKey = 'reviewEnded'
  let tone: 'active' | 'success' | 'warning' | 'error' | 'neutral' = 'neutral'
  if (active) {
    label = job.recovery?.nextRetryAt || job.status === 'repairing' ? 'reviewRecoveringAction'
      : job.status === 'queued' ? 'reviewQueuedAction' : job.status === 'submitted' ? 'reviewApplyingAction' : 'reviewRunning'
    tone = 'active'
  } else if (job.status === 'failed') { label = 'reviewFailed'; tone = 'error' }
  else if (job.status === 'stale') { label = 'reviewStale'; tone = 'warning' }
  else if (pending) { label = 'reviewWaitingRecovery'; tone = 'warning' }
  else if (job.decision) {
    label = `reviewVerdict.${job.decision.verdict}`
    tone = job.decision.verdict === 'pass' ? 'success' : 'warning'
  }
  const duration = job.finishedAt ? Math.max(0, Math.floor((Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000)) : null
  return { active, currentFault, canRetry, label, tone, duration: duration !== null && Number.isFinite(duration) ? duration : null }
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
