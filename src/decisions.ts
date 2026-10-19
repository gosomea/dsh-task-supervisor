/** Version-bound approval from a direct user message, never an injected prompt. */
import { overrideActions } from './review-override.ts'
import { controlEvent } from './session-records.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { NAMESPACE, type TaskSnapshot } from './state.ts'
import type { ReviewJob } from './review-schema.ts'
import { reviewRecoveryAction } from './review-recovery-action.ts'

export function isApprovalText(text: string): boolean {
  const normalized = text.trim().replace(/[。！!．.]$/u, '').trim()
  return /^(?:批准(?:当前|这个|该)?(?:计划)?|同意(?:当前|这个|该)?计划(?:，?开始(?:执行)?)?|可以[，, ]*开始(?:执行)?(?:吧)?|approve(?: the)?(?: current)?(?: plan)?|yes[ ,]+(?:approve|proceed))$/iu.test(normalized)
}

export function approvalMessage(events: readonly SessionEvent[], task: TaskSnapshot): number | null {
  let planSeq = -1
  let latestUser: Extract<SessionEvent, { type: 'user/message' }> | undefined
  for (const event of events.map(controlEvent)) {
    if (event.type === 'extension/record' && event.data.namespace === NAMESPACE) {
      const payload = event.data.payload
      if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        && payload.id === task.id && payload.planVersion === task.planVersion
        && payload.phase === 'awaiting-approval' && planSeq === -1) planSeq = event.seq
    }
    if (event.type === 'user/message' && event.data.source.kind === 'user') latestUser = event
  }
  if (planSeq < 0 || latestUser === undefined || latestUser.seq <= planSeq) return null
  const text = latestUser.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  return isApprovalText(text) ? latestUser.seq : null
}

export function approvedTask(task: TaskSnapshot, startSeq: number, userMessageSeq?: number): TaskSnapshot {
  if (task.phase !== 'awaiting-approval' || !task.enabled) throw new Error('the current plan is not awaiting approval')
  return { ...task, revision: task.revision + 1, approvedPlanVersion: task.planVersion,
    everApproved: true, phase: 'active', readOnlyGateStartSeq: startSeq,
    lastApproval: { planVersion: task.planVersion, userMessageSeq: userMessageSeq ?? null } }
}

/**
 * List current controls; a missing failed job offers no review recovery.
 * @param task - selected task, or null for no task.
 * @param armed - current continuation permission.
 * @param reviewing - whether the controller currently owns a running review.
 * @param failedReview - recorded failed job, when available.
 * @param now - deadline comparison time; defaults to the current clock.
 * @returns actions that the current state admits.
 */
export function controlActions(task: TaskSnapshot | null, armed: boolean, reviewing: boolean, failedReview?: ReviewJob, now = Date.now()): string[] {
  if (task === null || task.phase === 'cleared') return []
  if (!task.enabled) return ['on']
  if (task.phase === 'complete' || task.phase === 'closed') return []
  const overrides = overrideActions(task, failedReview)
  if (reviewing) return task.approvalPolicy?.mode === 'after-review' && !task.everApproved ? ['auto-approve-off', 'pause', ...overrides, 'off'] : ['pause', ...overrides, 'off']
  const policyAction = task.approvalPolicy?.mode === 'after-review' ? 'auto-approve-off' : 'auto-approve-on'
  if (task.phase === 'awaiting-approval') return ['approve', policyAction, 'pause', 'off']
  if (task.phase === 'planning') return [armed ? 'pause' : 'resume', policyAction, ...overrides, 'off']
  if (task.phase === 'paused' && task.pauseReason === 'review-fault') {
    const action = reviewRecoveryAction(task, failedReview, now)
    return action ? [action, ...overrides, 'off'] : [...overrides, 'off']
  }
  if (task.phase === 'paused' || task.phase === 'reviewing' || !armed) return ['resume', ...overrides, 'off']
  return ['pause', ...overrides, 'off']
}
