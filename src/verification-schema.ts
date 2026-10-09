/** Wire schemas shared by durable review records and the native check consumer. */
import { z } from 'zod'
import { checkPlanRevisionSchema, checkFindingSchema } from './review-check-plan.ts'

export const snapshotSchema = z.object({
  id: z.string().uuid(), workspace: z.string(), digest: z.string(), root: z.string(), baseline: z.string(), check: z.string(),
  excluded: z.array(z.string()), entries: z.array(z.object({ path: z.string(), kind: z.enum(['file', 'directory', 'link']),
    hash: z.string(), bytes: z.number().int().nonnegative(), mode: z.number().int(), target: z.string().optional() }).strict()),
}).strict()
export type ArtifactSnapshot = z.infer<typeof snapshotSchema>

export const checkResultSchema = z.object({ id: z.string().uuid(), snapshotId: z.string().uuid(), argv: z.array(z.string()).min(1),
  cwd: z.string(), startedAt: z.string(), finishedAt: z.string(), exitCode: z.number().int().nullable(), signal: z.string().nullable(),
  runtime: z.object({ kind: z.literal('docker'), context: z.string(), image: z.string(), containerName: z.string() }).strict().optional(),
  timedOut: z.boolean(), cancelled: z.boolean(), stdout: z.string(), stderr: z.string(), outputIncomplete: z.boolean(), changed: z.array(z.string()),
  isolation: z.literal('fresh-copy').optional(), generated: z.array(z.string()).optional() }).strict()
export type CheckResult = z.infer<typeof checkResultSchema>

export const findingSchema = z.object({ criterionId: z.string().min(1), status: z.enum(['satisfied', 'failed', 'unverified']),
  method: z.enum(['read', 'run', 'visual']), finding: z.string().min(1), evidenceIds: z.array(z.string().min(1)), checkIds: z.array(z.string().min(1)).optional(), coverage: z.string().optional(), limitations: z.string().optional() }).strict()
export type CriterionFinding = z.infer<typeof findingSchema>
export const verificationSchema = z.object({ snapshot: snapshotSchema, phase: z.enum(['independent', 'comparison']),
  observations: z.array(findingSchema),
  phaseTimes: z.object({ planning: z.string(), independent: z.string().optional(), comparison: z.string().optional() }).strict().optional(),
  checkPlan: z.array(checkPlanRevisionSchema).optional(), checkFindings: z.array(checkFindingSchema).optional(),
  readInputs: z.array(z.number().int().nonnegative()).optional(), checks: z.array(checkResultSchema.omit({ stdout: true, stderr: true })),
  readFiles: z.array(z.object({ path: z.string(), purpose: z.enum(['input', 'constraint', 'deliverable']).optional(), ranges: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])), total: z.number().int().nonnegative() }).strict()),
  readChecks: z.array(z.object({ id: z.string(), stream: z.enum(['stdout', 'stderr']), ranges: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])), total: z.number().int().nonnegative() }).strict()),
}).strict()
export type VerificationState = z.infer<typeof verificationSchema>
