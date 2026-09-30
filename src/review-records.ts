/** Durable review identities and outcomes, separate from semantic task decisions. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { z } from 'zod'
import { planningSummarySchema, reviewFaultSchema, taskSchema } from './state-schema.ts'
import { checkFindingSchema } from './review-check-plan.ts'
import { verificationSchema, findingSchema } from './verification-schema.ts'

export const REVIEW_NAMESPACE = 'dsh-task-supervisor-review'
export const REVIEW_RECORD_VERSIONS = [1, 2, 3, 4, 5]
export type PlanningSummary = z.infer<typeof planningSummarySchema>
export const observationSettingsSchema = z.object({ mode: z.enum(['current', 'configured', 'required-only']),
  toolCalls: z.number().int().positive(), elapsedMs: z.number().int().positive(), consecutiveErrors: z.number().int().positive(),
  rounds: z.number().int().positive(), inTurn: z.boolean() }).strict()
export const reviewJobSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(),
  mainSessionId: z.string().min(1), taskId: z.string().uuid(), taskRevision: z.number().int().positive(),
  planVersion: z.number().int().nonnegative(), stageId: z.string().min(1), nodeAttempt: z.number().int().positive().nullable(),
  kind: z.enum(['planning', 'plan', 'stage', 'progress', 'completion']), cutoff: z.number().int().min(-1),
  reviewerSessionId: z.string().nullable(), model: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }).nullable(),
  runtimeId: z.string().uuid(), status: z.enum(['repairing', 'started', 'submitted', 'failed', 'applied', 'stale']),
  attempt: z.number().int().positive(), repairLimit: z.number().int().nonnegative(),
  deadlineAt: z.string().optional(),
  attemptStartedAt: z.string().optional(), observationSettings: observationSettingsSchema.optional(),
  startedAt: z.string(), finishedAt: z.string().nullable(), trigger: z.string(),
  input: taskSchema, evidence: z.string(), fault: reviewFaultSchema.nullable(),
  verification: verificationSchema.optional(),
  verificationMode: z.enum(['log', 'independent']).optional(),
  requirementsProtocol: z.literal(1).optional(),
  checkProtocol: z.literal(1).optional(),
  decision: z.object({ verdict: z.enum(['pass', 'revise', 'needs-user']), finding: z.string(), evidenceSeqs: z.array(z.number().int()),
    requiredCapabilities: z.array(z.enum(['read', 'run', 'visual'])).optional(),
    programs: z.array(z.string().min(1)).optional(),
    planning: planningSummarySchema.optional(),
    criteria: z.array(findingSchema).optional(), checks: z.array(checkFindingSchema).optional(),
    imageSeqs: z.array(z.number().int()), decisionSeq: z.number().int().nonnegative() }).nullable(),
}).strict().superRefine((job, ctx) => {
  if (job.kind === 'planning') {
    if (job.verification || job.nodeAttempt !== null) ctx.addIssue({ code: 'custom', message: 'planning reviews have no artifact verification or node attempt' })
    if (job.decision && (!job.decision.planning || job.decision.evidenceSeqs.length === 0
      || job.decision.evidenceSeqs.some(seq => !Number.isSafeInteger(seq) || seq < 0 || seq > job.cutoff))) {
      ctx.addIssue({ code: 'custom', message: 'planning decisions require a summary and bound Session evidence' })
    }
  } else if (job.decision?.planning) ctx.addIssue({ code: 'custom', message: 'planning summaries belong to planning reviews' })
})
export type ReviewJob = z.infer<typeof reviewJobSchema>
export type ReviewFault = z.infer<typeof reviewFaultSchema>

export class ReviewFailure extends Error {
  constructor(readonly fault: ReviewFault, options?: ErrorOptions) { super(fault.message, options) }
}

export async function recordReview(ctx: Context, agent: Agent, value: ReviewJob): Promise<void> {
  const job = reviewJobSchema.parse(value)
  agent.session.append('extension/record', { namespace: REVIEW_NAMESPACE, schemaVersion: job.checkProtocol ? 5 : job.verificationMode ? 4 : job.kind === 'planning' ? 3 : job.verification ? 2 : 1,
    kind: 'job', recordId: `${job.id}:${job.revision}`, payload: JSON.parse(JSON.stringify(job)) as JsonValue })
  if (!await ctx.sessions.flush(agent.session)) throw new Error('review record is not durable')
}

export function foldReviewJobs(jobs: readonly ReviewJob[], event: SessionEvent): ReviewJob[] {
  if (event.type !== 'extension/record' || event.data.namespace !== REVIEW_NAMESPACE) return [...jobs]
  if (!REVIEW_RECORD_VERSIONS.includes(event.data.schemaVersion) || event.data.kind !== 'job') throw new Error('unsupported review record')
  const job = reviewJobSchema.parse(event.data.payload)
  if (job.kind === 'planning' && ![3, 4, 5].includes(event.data.schemaVersion)) throw new Error('planning review requires record version 3')
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
    || job.checkProtocol !== previous.checkProtocol
    || job.verificationMode !== previous.verificationMode || job.requirementsProtocol !== previous.requirementsProtocol
    || JSON.stringify(job.observationSettings) !== JSON.stringify(previous.observationSettings)
    || previous.model !== null && JSON.stringify(job.model) !== JSON.stringify(previous.model))) throw new Error('review identity changed')
  const priorPlan = previous?.verification?.checkPlan ?? [], plan = job.verification?.checkPlan ?? []
  if (JSON.stringify(plan.slice(0, priorPlan.length)) !== JSON.stringify(priorPlan) || plan.some((entry, index) => entry.revision !== index + 1)) throw new Error('check plan history changed')
  if (previous?.verification?.phase === 'comparison' && JSON.stringify(previous.verification.checkFindings) !== JSON.stringify(job.verification?.checkFindings)) throw new Error('independent check findings changed')
  return [...jobs.filter(item => item.id !== job.id), job].slice(-50)
}

export function faultFrom(error: unknown): ReviewFault | undefined { return error instanceof ReviewFailure ? error.fault : undefined }
