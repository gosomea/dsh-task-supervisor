/** Durable review identities and outcomes, separate from semantic task decisions. */
import { appendControlRecord, controlEvent } from './session-records.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { REVIEW_NAMESPACE, REVIEW_RECORD_VERSIONS, reviewJobSchema, type ReviewJob, type ReviewFault } from './review-schema.ts'
export * from './review-schema.ts'

export class ReviewFailure extends Error {
  constructor(readonly fault: ReviewFault, options?: ErrorOptions) { super(fault.message, options) }
}

export async function recordReview(ctx: Context, agent: Agent, value: ReviewJob): Promise<void> {
  const job = reviewJobSchema.parse(value)
  appendControlRecord(agent, { namespace: REVIEW_NAMESPACE, schemaVersion: job.scope ? 8 : job.recovery ? 7 : job.owner === 'controller' ? 6 : job.checkProtocol ? 5 : job.verificationMode ? 4 : job.kind === 'planning' ? 3 : job.verification ? 2 : 1,
    kind: 'job', recordId: `${job.id}:${job.revision}`, payload: JSON.parse(JSON.stringify(job)) as JsonValue })
  if (!await ctx.sessions.flush(agent.session)) throw new Error('review record is not durable')
}

export function foldReviewJobs(jobs: readonly ReviewJob[], event: SessionEvent): ReviewJob[] {
  event = controlEvent(event)
  if (event.type !== 'extension/record' || event.data.namespace !== REVIEW_NAMESPACE) return [...jobs]
  if (!REVIEW_RECORD_VERSIONS.includes(event.data.schemaVersion) || event.data.kind !== 'job') throw new Error('unsupported review record')
  const job = reviewJobSchema.parse(event.data.payload)
  if (job.kind === 'planning' && ![3, 4, 5, 6, 7, 8].includes(event.data.schemaVersion)) throw new Error('planning review requires record version 3')
  const previous = jobs.find(item => item.id === job.id)
  if (job.revision !== (previous?.revision ?? 0) + 1) throw new Error('review revision is not contiguous')
  if (previous && (job.taskId !== previous.taskId || job.taskRevision !== previous.taskRevision
    || job.cutoff !== previous.cutoff || job.reviewerSessionId !== previous.reviewerSessionId
    || job.mainSessionId !== previous.mainSessionId || job.planVersion !== previous.planVersion
    || job.stageId !== previous.stageId || job.kind !== previous.kind || job.nodeAttempt !== previous.nodeAttempt
    || job.evidence !== previous.evidence || JSON.stringify(job.input) !== JSON.stringify(previous.input)
    || previous.verification && JSON.stringify(job.verification?.snapshot) !== JSON.stringify(previous.verification.snapshot)
    || previous.verification?.phase === 'comparison' && job.verification?.phase !== 'comparison'
    || previous.verification?.phase === 'comparison' && JSON.stringify(job.verification?.observations) !== JSON.stringify(previous.verification.observations)
    || job.owner !== previous.owner || job.checkProtocol !== previous.checkProtocol || JSON.stringify(job.scope) !== JSON.stringify(previous.scope)
    || job.verificationMode !== previous.verificationMode || job.requirementsProtocol !== previous.requirementsProtocol
    || JSON.stringify(job.observationSettings) !== JSON.stringify(previous.observationSettings)
    || previous.model !== null && JSON.stringify(job.model) !== JSON.stringify(previous.model))) throw new Error('review identity changed')
  if (previous?.recovery) {
    const prior = previous.recovery, next = job.recovery
    if (!next || next.retryLimit !== prior.retryLimit || next.delayMs !== prior.delayMs || next.resume !== prior.resume
      || JSON.stringify(next.permit) !== JSON.stringify(prior.permit) || next.consumed < prior.consumed
      || next.protocolRepairs < prior.protocolRepairs || prior.manualOnly && !next.manualOnly
      || JSON.stringify(next.failures.slice(0, prior.failures.length)) !== JSON.stringify(prior.failures)) throw new Error('review recovery history changed')
  }
  if (previous?.readCorrections && (!job.readCorrections || job.readCorrections.limit !== previous.readCorrections.limit
    || job.readCorrections.consumed < previous.readCorrections.consumed
    || JSON.stringify(job.readCorrections.history.slice(0, previous.readCorrections.history.length)) !== JSON.stringify(previous.readCorrections.history))) throw new Error('read correction history changed')
  const priorPlan = previous?.verification?.checkPlan ?? [], plan = job.verification?.checkPlan ?? []
  if (JSON.stringify(plan.slice(0, priorPlan.length)) !== JSON.stringify(priorPlan) || plan.some((entry, index) => entry.revision !== index + 1)) throw new Error('check plan history changed')
  if (previous?.verification?.phase === 'comparison' && JSON.stringify(previous.verification.checkFindings) !== JSON.stringify(job.verification?.checkFindings)) throw new Error('independent check findings changed')
  return [...jobs.filter(item => item.id !== job.id), job].slice(-50)
}

export function faultFrom(error: unknown): ReviewFault | undefined { return error instanceof ReviewFailure ? error.fault : undefined }
