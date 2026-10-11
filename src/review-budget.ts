/** One absolute review budget, shared by every retry and protocol turn. */
import { z } from 'zod'

export const reviewBudgetPolicySchema = z.object({
  minMs: z.number().int().positive().default(120000), maxMs: z.number().int().positive().max(3600000).default(600000),
  lightMs: z.number().int().positive().default(120000), regularMs: z.number().int().positive().default(300000),
  complexMs: z.number().int().positive().default(600000), reserveMs: z.number().int().positive().default(60000),
  convergenceRatio: z.number().min(0.1).max(0.9).default(0.7), decisionRatio: z.number().min(0.2).max(0.95).default(0.8),
}).strict().superRefine((policy, ctx) => {
  if (policy.minMs > policy.maxMs || policy.lightMs > policy.regularMs || policy.regularMs > policy.complexMs
    || policy.complexMs > policy.maxMs || policy.reserveMs >= policy.minMs || policy.convergenceRatio >= policy.decisionRatio) {
    ctx.addIssue({ code: 'custom', message: 'reviewBudget requires ordered tiers, min <= max, reserve < min and convergence < decision' })
  }
})
export type ReviewBudgetConfig = z.input<typeof reviewBudgetPolicySchema>
export type ReviewBudgetPolicy = z.output<typeof reviewBudgetPolicySchema>
export const reviewBudgetSchema = z.object({ policy: reviewBudgetPolicySchema,
  admittedAt: z.iso.datetime(), capAt: z.iso.datetime(), deadlineAt: z.iso.datetime(), convergenceAt: z.iso.datetime(), decisionAt: z.iso.datetime(),
  workloadBound: z.boolean().default(false),
  tier: z.enum(['light', 'regular', 'complex']), phase: z.enum(['checking', 'converging', 'decision']),
  history: z.array(z.object({ at: z.string(), phase: z.enum(['checking', 'converging', 'decision']) }).strict()),
}).strict()
export type ReviewBudget = z.infer<typeof reviewBudgetSchema>

function boundaries(budget: ReviewBudget, deadline: number) {
  const start = Date.parse(budget.admittedAt), duration = deadline - start
  return { deadlineAt: new Date(deadline).toISOString(),
    convergenceAt: new Date(start + Math.floor(duration * budget.policy.convergenceRatio)).toISOString(),
    decisionAt: new Date(Math.min(start + Math.floor(duration * budget.policy.decisionRatio), deadline - Math.min(budget.policy.reserveMs, duration * 0.2))).toISOString() }
}
export function admitReviewBudget(policy: ReviewBudgetPolicy, cap: number, now = Date.now()): ReviewBudget {
  const deadline = Math.min(now + policy.complexMs, now + policy.maxMs, cap)
  const at = new Date(now).toISOString()
  const budget: ReviewBudget = { policy, admittedAt: at, capAt: new Date(deadline).toISOString(),
    deadlineAt: at, convergenceAt: at, decisionAt: at, tier: 'complex', phase: 'checking', workloadBound: false, history: [{ at, phase: 'checking' }] }
  return { ...budget, ...boundaries(budget, deadline) }
}
export interface CheckCost { source: { kind: string; reference: string }; fact: string; method: string; expected: string;
  expectedBytes?: number | undefined; expectedCommandMs?: number | undefined }

/** Missing cost is unknown, never a cheap task-category assumption. */
export function workloadTier(checks: readonly CheckCost[]): ReviewBudget['tier'] {
  const unique = [...new Map(checks.map(check => [JSON.stringify([check.source, check.fact, check.method, check.expected]), check])).values()]
  if (!unique.length || unique.some(check => check.method !== 'read' && check.method !== 'run'
    || !Number.isSafeInteger(check.expectedBytes) || check.expectedBytes! < 0
    || check.method === 'run' && (!Number.isSafeInteger(check.expectedCommandMs) || check.expectedCommandMs! < 0))) return 'complex'
  const bytes = unique.reduce((sum, check) => sum + check.expectedBytes!, 0)
  if (unique.length <= 4 && unique.every(check => check.method === 'read') && bytes <= 256 * 1024) return 'light'
  if (unique.length <= 8 && bytes <= 1024 * 1024 && unique.reduce((sum, check) => sum + (check.expectedCommandMs ?? 0), 0) <= 120000) return 'regular'
  return 'complex'
}
export function narrowReviewBudget(budget: ReviewBudget, checks: readonly CheckCost[], now = Date.now()): ReviewBudget {
  // Only the initial plan may narrow. Supplementary checks and recovery cannot renew time.
  if (budget.workloadBound || budget.history.length !== 1 || budget.phase !== 'checking') return budget
  const tier = workloadTier(checks), selected = budget.policy[`${tier}Ms`]
  const deadline = Math.min(Date.parse(budget.deadlineAt), Math.max(now + budget.policy.reserveMs,
    Date.parse(budget.admittedAt) + Math.max(budget.policy.minMs, selected)))
  return { ...budget, tier, workloadBound: true, ...boundaries(budget, deadline) }
}
export function reviewBudgetPhase(budget: ReviewBudget, now = Date.now()): 'checking' | 'converging' | 'decision' | 'expired' {
  if (now >= Date.parse(budget.deadlineAt)) return 'expired'
  if (now >= Date.parse(budget.decisionAt)) return 'decision'
  if (now >= Date.parse(budget.convergenceAt)) return 'converging'
  return 'checking'
}
export function moveReviewBudget(budget: ReviewBudget, phase: ReviewBudget['phase'], now = Date.now()): ReviewBudget {
  if (budget.phase === phase) return budget
  const order = ['checking', 'converging', 'decision']
  if (order.indexOf(phase) < order.indexOf(budget.phase)) throw new Error('review phase cannot rewind')
  const at = new Date(now).toISOString()
  return { ...budget, phase, history: [...budget.history, { at, phase }] }
}

/** Commands must leave the decision reserve intact. */
export function remainingCheckMs(budget: ReviewBudget, now = Date.now()): number {
  return Math.max(0, Date.parse(budget.decisionAt) - now)
}
