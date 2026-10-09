/** Shared review wire schema; safe to load without Host runtime services. */
import { z } from 'zod'
import { planningSummarySchema, reviewFaultSchema, taskSchema } from './state-schema.ts'
import { checkFindingSchema } from './review-check-plan.ts'
import { verificationSchema, findingSchema } from './verification-schema.ts'
import { reviewScopeSchema } from './review-scope-schema.ts'

export const REVIEW_NAMESPACE = 'dsh-task-supervisor-review'
export const REVIEW_RECORD_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8]
export type PlanningSummary = z.infer<typeof planningSummarySchema>
export const observationSettingsSchema = z.object({ mode: z.enum(['current', 'configured', 'required-only']),
  toolCalls: z.number().int().positive(), elapsedMs: z.number().int().positive(), consecutiveErrors: z.number().int().positive(),
  rounds: z.number().int().positive(), inTurn: z.boolean() }).strict()
export const reviewRecoverySchema = z.object({
  retryLimit: z.number().int().min(0).max(3), delayMs: z.number().int().min(0).max(60000),
  resume: z.boolean(), consumed: z.number().int().min(0).max(3), protocolRepairs: z.number().int().nonnegative(),
  permit: z.object({ armed: z.boolean(), requirementsVersion: z.number().int().positive(),
    planVersion: z.number().int().nonnegative(), approvedPlanVersion: z.number().int().nonnegative().nullable() }).strict(),
  manualOnly: z.boolean(), manualPending: z.boolean(), nextRetryAt: z.string().nullable(),
  failures: z.array(z.object({ at: z.string(), fault: reviewFaultSchema }).strict()),
}).strict()
export const reviewJobSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(),
  mainSessionId: z.string().min(1), taskId: z.string().uuid(), taskRevision: z.number().int().positive(),
  planVersion: z.number().int().nonnegative(), stageId: z.string().min(1), nodeAttempt: z.number().int().positive().nullable(),
  kind: z.enum(['planning', 'plan', 'stage', 'progress', 'completion']), cutoff: z.number().int().min(-1),
  reviewerSessionId: z.string().nullable(), model: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }).nullable(),
  runtimeId: z.string().uuid(), owner: z.literal('controller').optional(),
  status: z.enum(['queued', 'repairing', 'started', 'submitted', 'failed', 'applied', 'stale']),
  attempt: z.number().int().positive(), repairLimit: z.number().int().nonnegative(),
  deadlineAt: z.string().optional(),
  attemptStartedAt: z.string().optional(), observationSettings: observationSettingsSchema.optional(),
  startedAt: z.string(), finishedAt: z.string().nullable(), trigger: z.string(),
  input: taskSchema, evidence: z.string(), fault: reviewFaultSchema.nullable(),
  recovery: reviewRecoverySchema.optional(),
  scope: reviewScopeSchema.optional(),
  readCorrections: z.object({ limit: z.number().int().min(0).max(1), consumed: z.number().int().min(0).max(1),
    history: z.array(z.object({ at: z.string(), errorSeq: z.number().int().nonnegative(), tool: z.string(),
      code: z.string(), field: z.string(), validRange: z.string(), nextAction: z.string() }).strict()).max(1) }).strict().optional(),
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
  if (job.readCorrections && !job.scope) ctx.addIssue({ code: 'custom', message: 'read corrections require a bound review scope' })
  if (job.scope && (job.scope.taskId !== job.taskId || job.scope.cutoff !== job.cutoff || job.scope.planVersion !== job.planVersion
    || job.scope.requirementsVersion !== job.input.requirementsVersion || job.scope.nodeId !== job.stageId
    || job.scope.nodeAttempt !== job.nodeAttempt)) ctx.addIssue({ code: 'custom', message: 'review scope does not bind this job' })
  if (job.readCorrections && job.readCorrections.consumed !== job.readCorrections.history.length) ctx.addIssue({ code: 'custom', message: 'read correction history is inconsistent' })
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
