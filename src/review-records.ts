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
  appendControlRecord(agent, { namespace: REVIEW_NAMESPACE, schemaVersion: job.incrementalProtocol || job.sessionChain || job.budget || job.cleanupHistory || job.confirmation ? 9 : job.scope ? 8 : job.recovery ? 7 : job.owner === 'controller' ? 6 : job.checkProtocol ? 5 : job.verificationMode ? 4 : job.kind === 'planning' ? 3 : job.verification ? 2 : 1,
    kind: 'job', recordId: `${job.id}:${job.revision}`, payload: JSON.parse(JSON.stringify(job)) as JsonValue })
  if (!await ctx.sessions.flush(agent.session)) throw new Error('review record is not durable')
}

export function foldReviewJobs(jobs: readonly ReviewJob[], event: SessionEvent): ReviewJob[] {
  event = controlEvent(event)
  if (event.type !== 'extension/record' || event.data.namespace !== REVIEW_NAMESPACE) return [...jobs]
  if (!REVIEW_RECORD_VERSIONS.includes(event.data.schemaVersion) || event.data.kind !== 'job') throw new Error('unsupported review record')
  const job = reviewJobSchema.parse(event.data.payload)
  if (job.kind === 'planning' && ![3, 4, 5, 6, 7, 8, 9].includes(event.data.schemaVersion)) throw new Error('planning review requires record version 3')
  const previous = jobs.find(item => item.id === job.id)
  if (job.revision !== (previous?.revision ?? 0) + 1) throw new Error('review revision is not contiguous')
  if (previous && (job.taskId !== previous.taskId || job.taskRevision !== previous.taskRevision
    || job.cutoff !== previous.cutoff || job.reviewerSessionId !== previous.reviewerSessionId && !validReplacement(previous, job)
    || job.mainSessionId !== previous.mainSessionId || job.planVersion !== previous.planVersion
    || job.stageId !== previous.stageId || job.kind !== previous.kind || job.nodeAttempt !== previous.nodeAttempt
    || job.evidence !== previous.evidence || JSON.stringify(job.input) !== JSON.stringify(previous.input)
    || previous.verification && JSON.stringify(job.verification?.snapshot) !== JSON.stringify(previous.verification.snapshot)
    || previous.verification?.phase === 'comparison' && job.verification?.phase !== 'comparison'
    || previous.verification?.phase === 'comparison' && JSON.stringify(job.verification?.observations) !== JSON.stringify(previous.verification.observations)
    || job.owner !== previous.owner || job.checkProtocol !== previous.checkProtocol || JSON.stringify(job.scope) !== JSON.stringify(previous.scope)
    || job.verificationMode !== previous.verificationMode || job.requirementsProtocol !== previous.requirementsProtocol || job.resultProtocol !== previous.resultProtocol || job.incrementalProtocol !== previous.incrementalProtocol
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
  if (previous?.decision && JSON.stringify(job.decision) !== JSON.stringify(previous.decision)) throw new Error('recorded decision changed')
  if (previous?.budget && (!job.budget || job.budget.admittedAt !== previous.budget.admittedAt
    || job.budget.capAt !== previous.budget.capAt || JSON.stringify(job.budget.policy) !== JSON.stringify(previous.budget.policy)
    || previous.budget.workloadBound && (!job.budget.workloadBound || job.budget.tier !== previous.budget.tier || job.budget.deadlineAt !== previous.budget.deadlineAt)
    || Date.parse(job.deadlineAt!) > Date.parse(previous.deadlineAt!)
    || job.deadlineAt !== job.budget.deadlineAt
    || JSON.stringify(job.budget.history.slice(0, previous.budget.history.length)) !== JSON.stringify(previous.budget.history))) throw new Error('review budget renewed or history changed')
  if (previous?.confirmation && (!job.confirmation || job.confirmation.callId !== previous.confirmation.callId
    || job.confirmation.submittedAt !== previous.confirmation.submittedAt
    || previous.confirmation.resultSeq !== undefined && job.confirmation.resultSeq !== previous.confirmation.resultSeq
    || previous.confirmation.appliedAt !== undefined && job.confirmation.appliedAt !== previous.confirmation.appliedAt
    || previous.confirmation.appliedTaskRevision !== undefined && job.confirmation.appliedTaskRevision !== previous.confirmation.appliedTaskRevision)) throw new Error('decision confirmation changed')
  if (previous?.cleanupHistory?.some((entry, index) => !job.cleanupHistory?.[index]
    || entry.runtimeId !== job.cleanupHistory[index]!.runtimeId || entry.startedAt !== job.cleanupHistory[index]!.startedAt
    || entry.finishedAt && JSON.stringify(entry) !== JSON.stringify(job.cleanupHistory[index]))) throw new Error('cleanup history changed')
  const oldHistory = previous?.verification?.checkHistory ?? [], nextHistory = job.verification?.checkHistory ?? []
  if (JSON.stringify(nextHistory.slice(0, oldHistory.length)) !== JSON.stringify(oldHistory) || nextHistory.some((entry, index) => entry.revision !== index + 1)) throw new Error('incremental finding history changed')
  const priorPlan = previous?.verification?.checkPlan ?? [], plan = job.verification?.checkPlan ?? []
  if (JSON.stringify(plan.slice(0, priorPlan.length)) !== JSON.stringify(priorPlan) || plan.some((entry, index) => entry.revision !== index + 1)) throw new Error('check plan history changed')
  if (previous?.verification?.phase === 'comparison' && JSON.stringify(previous.verification.checkFindings) !== JSON.stringify(job.verification?.checkFindings)) throw new Error('independent check findings changed')
  const reused = previous?.verification?.reusedChecks ?? []
  if (JSON.stringify(job.verification?.reusedChecks?.slice(0, reused.length) ?? []) !== JSON.stringify(reused)) throw new Error('reused evidence history changed')
  if (previous?.sessionChain && JSON.stringify(job.sessionChain?.slice(0, previous.sessionChain.length)) !== JSON.stringify(previous.sessionChain)) throw new Error('review Session inheritance changed')
  return [...jobs.filter(item => item.id !== job.id), job].slice(-50)
}

function validReplacement(previous: ReviewJob, next: ReviewJob): boolean {
  return previous.sessionChain?.length === 1 && next.sessionChain?.length === 2
    && previous.sessionChain[0]!.sessionId === previous.reviewerSessionId
    && next.sessionChain[1]!.sessionId === next.reviewerSessionId && next.sessionChain[1]!.reason === 'missing-session'
    && (next.recovery?.consumed ?? 0) > 0 && !previous.decision && previous.cleanupHistory?.at(-1)?.confirmed === true
    && !previous.cleanupHistory.some(entry => !entry.finishedAt || entry.confirmed !== true)
}

export function faultFrom(error: unknown): ReviewFault | undefined { return error instanceof ReviewFailure ? error.fault : undefined }
