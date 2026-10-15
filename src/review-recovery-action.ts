/** Manual recovery preserves failed jobs and never grants execution permission. */
import { runsOf } from './graph.ts'
import type { ReviewJob } from './review-schema.ts'
import type { TaskSnapshot } from './state-schema.ts'

/**
 * Select recovery for the current failed review, or refuse missing/changed bindings.
 * @param task - current durable task.
 * @param job - its recorded failed job; absence offers no review recovery.
 * @param now - admission time in Unix milliseconds.
 * @returns same-job retry, a fresh manual review, or no admissible recovery.
 */
export function reviewRecoveryAction(task: TaskSnapshot, job: ReviewJob | undefined, now: number): 'retry-review' | 'restart-review' | null {
  if (!task.enabled || task.phase !== 'paused' || task.pauseReason !== 'review-fault'
    || !job || job.status !== 'failed' || !job.fault || task.reviewFault?.jobId !== job.id
    || job.taskId !== task.id || job.planVersion !== task.planVersion
    || job.input.requirementsVersion !== task.requirementsVersion
    || job.nodeAttempt !== (runsOf(task).find(run => run.id === job.stageId)?.attempt ?? null)) return null
  const deadline = job.deadlineAt ? Date.parse(job.deadlineAt) : NaN
  if (!Number.isFinite(deadline)) return null
  return deadline <= now || !job.fault.retryable || job.fault.code === 'stale' ? 'restart-review' : 'retry-review'
}
