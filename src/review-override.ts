/** Direct user releases preserve failed reviews and never manufacture acceptance. */
import type { TaskSnapshot } from './state-schema.ts'
import type { ReviewJob } from './review-schema.ts'
import { runsOf, withRuns } from './graph.ts'

/** Return version-bound controls for the latest unresolved review. */
export function overrideActions(task: TaskSnapshot, job: ReviewJob | undefined): string[] {
  if (!job || !task.enabled || ['complete', 'closed', 'cleared'].includes(task.phase)
    || job.taskId !== task.id || job.planVersion !== task.planVersion
    || job.input.requirementsVersion !== task.requirementsVersion
    || job.status === 'stale' || job.decision?.verdict === 'pass') return []
  const prior = task.reviewOverrides?.filter(item => item.jobId === job.id) ?? []
  if (prior.length) return job.kind === 'completion' && prior.every(item => item.action === 'skip-review') ? ['finish-without-review'] : []
  if (job.kind === 'stage' && runsOf(task).find(run => run.id === job.stageId)?.attempt !== job.nodeAttempt) return []
  if (job.kind === 'plan' && (!job.input.stages.length || !job.input.criteria.length)) return []
  return job.kind === 'completion' ? ['skip-review', 'finish-without-review'] : ['skip-review']
}

/** Apply one human action to an exact review; the caller persists before delivery. */
export function overrideReview(task: TaskSnapshot, job: ReviewJob, action: string, recordSeq: number, now: string): TaskSnapshot {
  if (!overrideActions(task, job).includes(action)) throw new Error('Review or task changed; refresh task_status before acting.')
  const choice = action === 'finish-without-review' ? 'finish-without-review' as const : 'skip-review' as const
  let next: TaskSnapshot = { ...task, revision: task.revision + 1, pendingReview: null, reviewFault: null,
    pauseReason: null, roundsSinceReview: 0,
    phase: choice === 'finish-without-review' ? 'closed' : job.kind === 'planning' ? 'planning' : 'active',
    reviewOverrides: [...task.reviewOverrides ?? [], { jobId: job.id, action: choice,
      requirementsVersion: task.requirementsVersion, planVersion: task.planVersion, stageId: job.stageId,
      nodeAttempt: job.nodeAttempt, at: now, source: 'user', recordSeq }] }
  if (choice === 'finish-without-review') return { ...next, completedAt: now }
  if (job.kind === 'plan') next = { ...next, criteria: job.input.criteria, stages: job.input.stages,
    planVersion: task.planVersion + 1, approvedPlanVersion: task.planVersion + 1, everApproved: true,
    readOnlyGateStartSeq: recordSeq, readOnlyTurnsBeforeWrite: job.input.readOnlyTurnsBeforeWrite ?? 0,
    lastApproval: { planVersion: task.planVersion + 1, userMessageSeq: null }, stageIndex: 0,
    nodeRuns: job.input.stages.map(stage => ({ id: stage.id, attempt: 1, status: 'pending', evidenceAfterSeq: recordSeq })) }
  if (job.kind === 'stage') next = withRuns(next, runsOf(next).map(run => run.id === job.stageId
    ? { ...run, status: 'user-released', finishedAt: now } : run))
  return next
}
