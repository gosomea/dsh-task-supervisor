/** Shared immutable review scope; safe for Host and Client. */
import { z } from 'zod'
export const reviewScopeSchema = z.object({
  protocol: z.literal(1), taskId: z.string().uuid(), requirementsVersion: z.number().int().positive(),
  planVersion: z.number().int().nonnegative(), nodeId: z.string(), nodeAttempt: z.number().int().positive().nullable(),
  cutoff: z.number().int().min(-1), taskFromSeq: z.number().int().nonnegative().nullable(),
  attemptFromSeq: z.number().int().nonnegative().nullable(), changesFromSeq: z.number().int().nonnegative().nullable(),
  sources: z.array(z.object({ seq: z.number().int().nonnegative(), relation: z.enum(['request', 'referenced-constraint', 'earlier-context']),
    attribution: z.enum(['bound', 'needs-check']) }).strict()),
}).strict()
export type ReviewScope = z.infer<typeof reviewScopeSchema>
