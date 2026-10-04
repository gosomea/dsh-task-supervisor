/** Resolve a durable execution grant; eligibility never schedules execution. */
import { controlEvent } from './session-records.ts'
import { isDeepStrictEqual } from 'node:util'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReviewJob } from './review-records.ts'
import { NAMESPACE, READABLE_RECORD_VERSIONS } from './state.ts'
import { taskSchema, type TaskSnapshot } from './state-schema.ts'

export interface PolicyApproval {
  source: 'policy'
  authorizationSeq: number
  reviewJobId: string
}

/** The caller must separately verify the live revision and continuation state. */
export function policyApproval(task: TaskSnapshot, mainSessionId: string,
  events: readonly SessionEvent[], job: ReviewJob | null | undefined): PolicyApproval | null {
  events = events.map(controlEvent)
  const parsed = taskSchema.shape.approvalPolicy.safeParse(task.approvalPolicy)
  const policy = parsed.success ? parsed.data : undefined
  if (!policy || policy.mode !== 'after-review' || policy.mainSessionId !== mainSessionId
    || policy.requirementsVersion !== task.requirementsVersion || !task.enabled
    || task.phase !== 'awaiting-approval' || task.everApproved || task.pendingReview !== null
    || task.reviewFault != null || task.pauseReason != null) return null

  const grants = events.filter(event => event.seq === policy.grantSeq)
  if (grants.length !== 1) return null
  const event = grants[0]!
  if (event.type !== 'extension/record' || event.data.namespace !== NAMESPACE
    // Execution grants were introduced in record version 14. Legacy task
    // readability does not grant new authorization semantics to old records.
    || event.data.kind !== 'state' || event.data.schemaVersion < 14
    || !READABLE_RECORD_VERSIONS.includes(event.data.schemaVersion)) return null
  const captured = taskSchema.safeParse(event.data.payload)
  if (!captured.success) return null
  const grant = captured.data
  if (grant.id !== task.id || grant.requirementsVersion !== task.requirementsVersion
    || grant.objective !== task.objective || grant.revision > task.revision
    || !grant.enabled || grant.everApproved || !['planning', 'awaiting-approval'].includes(grant.phase)
    || !isDeepStrictEqual(grant.approvalPolicy, policy)) return null

  if (!job || job.kind !== 'plan' || job.stageId !== 'plan'
    || !['submitted', 'applied'].includes(job.status) || job.fault !== null
    || job.decision?.verdict !== 'pass' || job.mainSessionId !== mainSessionId
    || job.taskId !== task.id || job.input.id !== task.id
    || job.taskRevision !== job.input.revision || job.taskRevision >= task.revision
    || job.planVersion !== job.input.planVersion || job.input.planVersion + 1 !== task.planVersion
    || job.input.requirementsVersion !== task.requirementsVersion || job.input.objective !== task.objective
    || !isDeepStrictEqual(job.input.criteria, task.criteria)
    || !isDeepStrictEqual(job.input.stages, task.stages)
    || (job.input.readOnlyTurnsBeforeWrite ?? 0) !== (task.readOnlyTurnsBeforeWrite ?? 0)) return null
  return { source: 'policy', authorizationSeq: event.seq, reviewJobId: job.id }
}
