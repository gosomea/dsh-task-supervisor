/** Recovery policy is captured per job; it never grants execution permission. */
import { setTimeout as delay } from 'node:timers/promises'
import type { ReviewFault, ReviewJob } from './review-records.ts'
import type { TaskSnapshot } from './state.ts'

export interface FaultRecoveryPolicy { attempts: number; delayMs: number; resume: boolean; armed: boolean }
export function faultRecoveryPolicy(attempts = 1, delayMs = 3000, resume = true, armed = false): FaultRecoveryPolicy {
  if (!Number.isSafeInteger(attempts) || attempts < 0 || attempts > 3) throw new TypeError('reviewFaultRetryAttempts must be 0–3')
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60000) throw new TypeError('reviewFaultRetryDelayMs must be 0–60000')
  if (typeof resume !== 'boolean') throw new TypeError('resumeAfterReviewRecovery must be boolean')
  return { attempts, delayMs, resume, armed }
}
export function transientReviewFault(fault: ReviewFault): boolean {
  if (fault.code === 'timeout') return true
  if (fault.code !== 'provider') return false
  if (fault.providerStatus === 401 || fault.providerStatus === 403 || ['AUTH', 'CONFIG', 'NO_ADAPTER'].includes(fault.providerCode ?? '')) return false
  return ['TIMEOUT', 'RATE_LIMIT', 'SERVER', 'TRANSPORT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(fault.providerCode ?? '')
    || [408, 429, 500, 502, 503, 504].includes(fault.providerStatus ?? 0)
}
export function recoveryCanContinue(job: ReviewJob | undefined, task: TaskSnapshot): boolean {
  if (!job?.recovery || job.recovery.consumed === 0 && !job.recovery.manualPending && job.trigger !== 'manual-retry') return true
  const recovery = job.recovery, permit = recovery.permit
  return recovery.resume && !recovery.manualOnly && permit.armed && job.taskId === task.id
    && permit.requirementsVersion === task.requirementsVersion
    && (job.kind === 'plan' ? permit.planVersion + 1 === task.planVersion : permit.planVersion === task.planVersion)
    && (task.phase === 'planning' || task.everApproved && task.approvedPlanVersion === task.planVersion
      && (job.kind === 'plan' || permit.approvedPlanVersion === permit.planVersion))
}
export async function waitReviewRetry(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await delay(ms, undefined, { signal })
  signal.throwIfAborted()
}
