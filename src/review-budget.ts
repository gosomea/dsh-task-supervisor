/** Persisted phase budgets separate model attention from bounded check execution. */
import { z } from 'zod'
export const reviewBudgetSchema = z.object({
  modelMs: z.number().int().positive(), modelMaxMs: z.number().int().positive(), extensionMs: z.number().int().positive(),
  reserveMs: z.number().int().nonnegative(), checksMs: z.number().int().positive(), wallMs: z.number().int().positive(),
  usedModelMs: z.number().nonnegative(), usedChecksMs: z.number().nonnegative(),
  extensions: z.number().int().nonnegative(), progress: z.number().int().nonnegative(), extendedProgress: z.number().int().nonnegative(),
  mode: z.enum(['preparing', 'model', 'checking', 'settled']), since: z.number(),
  times: z.object({ preparing: z.number(), model: z.number(), checking: z.number(), settled: z.number() }).strict(),
}).strict()
export type ReviewBudget = z.infer<typeof reviewBudgetSchema>
export interface ReviewBudgetConfig { modelMs?: number; modelMaxMs?: number; extensionMs?: number; reserveMs?: number; checksMs?: number; wallMs?: number }
/** Validate configured caps once. A shorter explicit model cap also shortens its reserve. */
export function resolveReviewBudget(config: ReviewBudgetConfig = {}) {
  const modelMs = config.modelMs ?? 600000
  const value = { modelMs, modelMaxMs: config.modelMaxMs ?? Math.max(modelMs, 1200000), extensionMs: config.extensionMs ?? 300000,
    reserveMs: config.reserveMs ?? Math.min(60000, Math.floor(modelMs / 10)), checksMs: config.checksMs ?? 1800000, wallMs: config.wallMs ?? 3600000 }
  for (const [key, ms] of Object.entries(value)) if (!Number.isSafeInteger(ms) || ms < (key === 'reserveMs' ? 0 : 1) || ms > (key === 'wallMs' ? 10800000 : key === 'checksMs' ? 7200000 : 3600000)) throw new TypeError(`invalid reviewBudget.${key}`)
  if (value.modelMaxMs < modelMs || value.reserveMs >= modelMs) throw new TypeError('review budget maximum/reserve conflicts with initial model budget')
  return value
}
/** New jobs own new counters; replay and retries retain saved counters. */
export function newReviewBudget(config: ReturnType<typeof resolveReviewBudget>, now: number): ReviewBudget {
  return { ...config, usedModelMs: 0, usedChecksMs: 0, extensions: 0, progress: 0, extendedProgress: 0,
    mode: 'preparing', since: now, times: { preparing: 0, model: 0, checking: 0, settled: 0 } }
}
/** Charge the previous phase before transitioning; elapsed wall time is never refunded. */
export function chargeReviewBudget(value: ReviewBudget, mode: ReviewBudget['mode'], now: number): void {
  const elapsed = Math.max(0, now - value.since)
  value.times[value.mode] += elapsed
  if (value.mode === 'model') value.usedModelMs += elapsed
  if (value.mode === 'checking') value.usedChecksMs += elapsed
  value.since = now; value.mode = mode
}
/** A new accepted finding or completed check buys at most one bounded extension. */
export function extendReviewBudget(value: ReviewBudget): boolean {
  if (value.progress <= value.extendedProgress || value.modelMs >= value.modelMaxMs) return false
  value.modelMs = Math.min(value.modelMaxMs, value.modelMs + value.extensionMs)
  value.extendedProgress = value.progress; value.extensions++
  return true
}
