/** Host/client shared wire schema; no runtime service dependencies. */
import { z } from 'zod'

export const provenanceSchema = z.object({
  kind: z.enum(['user', 'project', 'implementation']),
  reference: z.string().min(1),
  sourceSeq: z.number().int().nonnegative().optional(),
}).strict()
export const criterionSchema = z.object({
  id: z.string().min(1), text: z.string().min(1), provenance: provenanceSchema.optional(), evidenceKind: z.enum(['text', 'visual']).optional(),
}).strict()
export const stageSchema = z.object({
  dependsOn: z.array(z.string().min(1)).optional(), writePaths: z.array(z.string().min(1)).optional(),
  id: z.string().min(1), title: z.string().min(1), description: z.string().optional(), criterionIds: z.array(z.string().min(1)).min(1),
}).strict()
const nodeRunSchema = z.object({
  id: z.string().min(1), attempt: z.number().int().positive(),
  status: z.enum(['pending', 'running', 'reviewing', 'passed', 'needs-revision', 'awaiting-user']),
  sessionId: z.string().optional(), startedAt: z.string().optional(), finishedAt: z.string().optional(),
  evidenceAfterSeq: z.number().int().nonnegative().optional(),
  reviewSeq: z.number().int().nonnegative().optional(),
}).strict()
export type NodeRun = z.infer<typeof nodeRunSchema>
export const reviewSchema = z.object({
  stageId: z.string().min(1),
  cutoff: z.number().int().nonnegative(),
  verdict: z.enum(['pass', 'revise', 'needs-user']),
  finding: z.string(),
  imageSeqs: z.array(z.number().int().nonnegative()).optional(),
  evidenceSeqs: z.array(z.number().int().nonnegative()).optional(),
  reviewerSessionId: z.string().min(1).optional(),
  model: z.object({ provider: z.string().min(1), model: z.string().min(1),
    reasoningEffort: z.string().optional() }).strict().optional(),
}).strict()
const pendingReviewSchema = z.object({
  kind: z.enum(['stage', 'progress', 'completion']),
  stageId: z.string().min(1),
  evidence: z.string().min(1),
}).strict()

export const taskSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  objective: z.string().min(1),
  responseLanguage: z.string().min(1).optional(),
  lastApproval: z.object({ planVersion: z.number().int().nonnegative(), userMessageSeq: z.number().int().nonnegative().nullable() }).strict().optional(),
  requirementsVersion: z.number().int().positive(),
  planVersion: z.number().int().nonnegative(),
  criteria: z.array(criterionSchema),
  stages: z.array(stageSchema),
  nodeRuns: z.array(nodeRunSchema).optional(),
  stageIndex: z.number().int().nonnegative(),
  roundsSinceReview: z.number().int().nonnegative(),
  approvedPlanVersion: z.number().int().nonnegative().nullable(),
  readOnlyTurnsBeforeWrite: z.number().int().min(0).max(10).optional(),
  readOnlyGateStartSeq: z.number().int().nonnegative().nullable().optional(),
  everApproved: z.boolean(),
  enabled: z.boolean(),
  phase: z.enum(['planning', 'awaiting-approval', 'active', 'reviewing', 'paused', 'complete', 'cleared']),
  pendingReview: pendingReviewSchema.nullable(),
  lastReview: reviewSchema.nullable(),
}).strict()

export type TaskSnapshot = z.infer<typeof taskSchema>
export type TaskStage = z.infer<typeof stageSchema>
export type TaskCriterion = z.infer<typeof criterionSchema>

