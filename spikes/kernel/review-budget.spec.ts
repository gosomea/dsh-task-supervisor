import { expect, it } from 'vitest'
import { admitReviewBudget, narrowReviewBudget, moveReviewBudget, remainingCheckMs,
  reviewBudgetPhase, reviewBudgetPolicySchema, workloadTier, type CheckCost } from '../../src/review-budget.ts'

const policy = reviewBudgetPolicySchema.parse({})
const start = Date.parse('2026-10-11T00:00:00Z')
const read: CheckCost = { source: { kind: 'objective', reference: 'objective' }, fact: 'Exact table', expected: 'required rows', method: 'read', expectedBytes: 2000 }
it('selects workload from deduplicated checks and costs rather than artifact class', () => {
  expect(workloadTier([read, read])).toBe('light')
  // A bounded original-log read is a read, not an unknown execution capability.
  expect(workloadTier([read, { ...read, fact: 'Approval receipt', method: 'log', expectedBytes: 3000 }])).toBe('light')
  expect(workloadTier([{ ...read, method: 'log' }, { ...read, method: 'run', expectedCommandMs: 5000 }])).toBe('regular')
  expect(workloadTier([{ ...read, method: 'log', expectedBytes: undefined }])).toBe('complex')
  expect(workloadTier([{ ...read, method: 'run', expectedCommandMs: 10000 }])).toBe('regular')
  for (const checks of [[{ ...read, expectedBytes: undefined }], [{ ...read, method: 'run' }],
    [{ ...read, method: 'visual' }], [{ ...read, expectedBytes: 2 * 1024 * 1024 }], []]) expect(workloadTier(checks)).toBe('complex')
})
it('uses 420s convergence and 480s decision for an unknown 600s job', () => {
  const budget = admitReviewBudget(policy, Infinity, start)
  expect(reviewBudgetPhase(budget, start + 419999)).toBe('checking')
  expect(reviewBudgetPhase(budget, start + 420000)).toBe('converging')
  expect(reviewBudgetPhase(budget, start + 480000)).toBe('decision')
  expect(reviewBudgetPhase(budget, start + 600000)).toBe('expired')
  expect(remainingCheckMs(budget, start + 479500)).toBe(500)
  expect(remainingCheckMs(budget, start + 480000)).toBe(0)
})
it('reserves the full configured decision window when the initial plan selects the 120s tier', () => {
  const budget = narrowReviewBudget(admitReviewBudget(policy, Infinity, start), [read], start + 30000)
  expect(reviewBudgetPhase(budget, start + 47999)).toBe('checking')
  expect(reviewBudgetPhase(budget, start + 48000)).toBe('converging')
  expect(reviewBudgetPhase(budget, start + 60000)).toBe('decision')
  expect(Date.parse(budget.deadlineAt) - Date.parse(budget.decisionAt)).toBe(60000)
  expect(remainingCheckMs(budget, start + 59999)).toBe(1)
  expect(remainingCheckMs(budget, start + 60000)).toBe(0)
  expect(reviewBudgetPhase(budget, start + 120000)).toBe('expired')
})
it('starts decision immediately when the earlier Task cutoff cannot fit the reserve without extending it', () => {
  const budget = admitReviewBudget(policy, start + 40000, start)
  expect(reviewBudgetPhase(budget, start)).toBe('decision')
  expect(remainingCheckMs(budget, start)).toBe(0)
  expect(Date.parse(budget.deadlineAt)).toBe(start + 40000)
  expect(Date.parse(budget.convergenceAt)).toBe(start)
  expect(reviewBudgetPhase(budget, start + 40000)).toBe('expired')
})
it('narrows only the initial plan, preserves the reserve and cannot renew a cap', () => {
  const original = admitReviewBudget(policy, Infinity, start)
  const light = narrowReviewBudget(original, [read], start + 30000)
  expect(Date.parse(light.deadlineAt) - start).toBe(120000)
  expect(light.capAt).toBe(original.capAt)
  const late = narrowReviewBudget(original, [read], start + 400000)
  expect(Date.parse(late.deadlineAt)).toBe(start + 460000)
  const supplemented = narrowReviewBudget(light, [{ ...read, method: 'run', expectedCommandMs: 100000 }], start + 100000)
  expect(supplemented.deadlineAt).toBe(light.deadlineAt)
  const decision = moveReviewBudget(original, 'decision', start + 480000)
  expect(narrowReviewBudget(decision, [read], start + 490000)).toBe(decision)
  expect(() => moveReviewBudget(decision, 'checking')).toThrow('rewind')
})
it('honors an earlier Task cutoff and permits a higher ceiling only through explicit configuration', () => {
  expect(admitReviewBudget(policy, start + 90000, start).deadlineAt).toBe(new Date(start + 90000).toISOString())
  expect(() => reviewBudgetPolicySchema.parse({ complexMs: 900000 })).toThrow()
  const explicit = reviewBudgetPolicySchema.parse({ maxMs: 900000, complexMs: 900000 })
  expect(Date.parse(admitReviewBudget(explicit, Infinity, start).deadlineAt) - start).toBe(900000)
})
