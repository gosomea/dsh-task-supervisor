/** Durable review identities and outcomes, separate from semantic task decisions. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { z } from 'zod'
import { reviewFaultSchema, taskSchema } from './state-schema.ts'

export const REVIEW_NAMESPACE = 'dsh-task-supervisor-review'
export const reviewJobSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(),
  mainSessionId: z.string().min(1), taskId: z.string().uuid(), taskRevision: z.number().int().positive(),
  planVersion: z.number().int().nonnegative(), stageId: z.string().min(1), nodeAttempt: z.number().int().positive().nullable(),
  kind: z.enum(['plan', 'stage', 'progress', 'completion']), cutoff: z.number().int().min(-1),
  reviewerSessionId: z.string().nullable(), model: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }).nullable(),
  runtimeId: z.string().uuid(), status: z.enum(['repairing', 'started', 'submitted', 'failed', 'applied', 'stale']),
  attempt: z.number().int().positive(), repairLimit: z.number().int().nonnegative(),
  deadlineAt: z.string().optional(),
  startedAt: z.string(), finishedAt: z.string().nullable(), trigger: z.string(),
  input: taskSchema, evidence: z.string(), fault: reviewFaultSchema.nullable(),
  decision: z.object({ verdict: z.enum(['pass', 'revise', 'needs-user']), finding: z.string(), evidenceSeqs: z.array(z.number().int()),
    imageSeqs: z.array(z.number().int()), decisionSeq: z.number().int().nonnegative() }).nullable(),
}).strict()
export type ReviewJob = z.infer<typeof reviewJobSchema>
export type ReviewFault = z.infer<typeof reviewFaultSchema>

export class ReviewFailure extends Error {
  constructor(readonly fault: ReviewFault, options?: ErrorOptions) { super(fault.message, options) }
}

export async function recordReview(ctx: Context, agent: Agent, value: ReviewJob): Promise<void> {
  const job = reviewJobSchema.parse(value)
  agent.session.append('extension/record', { namespace: REVIEW_NAMESPACE, schemaVersion: 1,
    kind: 'job', recordId: `${job.id}:${job.revision}`, payload: JSON.parse(JSON.stringify(job)) as JsonValue })
  if (!await ctx.sessions.flush(agent.session)) throw new Error('review record is not durable')
}

export function foldReviewJobs(jobs: readonly ReviewJob[], event: SessionEvent): ReviewJob[] {
  if (event.type !== 'extension/record' || event.data.namespace !== REVIEW_NAMESPACE) return [...jobs]
  if (event.data.schemaVersion !== 1 || event.data.kind !== 'job') throw new Error('unsupported review record')
  const job = reviewJobSchema.parse(event.data.payload)
  const previous = jobs.find(item => item.id === job.id)
  if (job.revision !== (previous?.revision ?? 0) + 1) throw new Error('review revision is not contiguous')
  if (previous && (job.taskId !== previous.taskId || job.taskRevision !== previous.taskRevision
    || job.cutoff !== previous.cutoff || job.reviewerSessionId !== previous.reviewerSessionId
    || job.mainSessionId !== previous.mainSessionId || job.planVersion !== previous.planVersion
    || job.stageId !== previous.stageId || job.kind !== previous.kind || job.nodeAttempt !== previous.nodeAttempt
    || job.evidence !== previous.evidence || JSON.stringify(job.input) !== JSON.stringify(previous.input)
    || previous.model !== null && JSON.stringify(job.model) !== JSON.stringify(previous.model))) throw new Error('review identity changed')
  return [...jobs.filter(item => item.id !== job.id), job].slice(-50)
}

export function faultFrom(error: unknown): ReviewFault | undefined { return error instanceof ReviewFailure ? error.fault : undefined }
