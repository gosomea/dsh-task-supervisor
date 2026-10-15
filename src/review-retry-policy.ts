/** Shared automatic-retry eligibility; manual retry still requires controller admission. */
import type { ReviewFault, ReviewJob } from './review-schema.ts'

export function transientReviewFault(fault: ReviewFault): boolean {
  if (!fault.retryable) return false
  if (fault.code === 'timeout') return true
  if (fault.code !== 'provider') return false
  if (fault.providerStatus === 401 || fault.providerStatus === 403 || ['AUTH', 'CONFIG', 'NO_ADAPTER'].includes(fault.providerCode ?? '')) return false
  return ['TIMEOUT', 'RATE_LIMIT', 'SERVER', 'TRANSPORT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(fault.providerCode ?? '')
    || [408, 429, 500, 502, 503, 504].includes(fault.providerStatus ?? 0)
}

/** Recorded policy reasons only; permission, cancellation and elapsed time are checked by the controller. */
export function automaticReviewRetryBlock(job: Pick<ReviewJob, 'fault' | 'recovery'>): 'non-transient' | 'disabled' | 'manual-only' | 'exhausted' | null {
  if (!job.fault) return null
  if (!transientReviewFault(job.fault)) return 'non-transient'
  if (!job.recovery || job.recovery.retryLimit === 0) return 'disabled'
  if (job.recovery.manualOnly) return 'manual-only'
  if (job.recovery.consumed >= job.recovery.retryLimit) return 'exhausted'
  return null
}
