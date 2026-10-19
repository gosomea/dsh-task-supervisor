/** Model attention, check waiting and hard wall limits are independent clocks. */
import { expect, it } from 'vitest'
import { chargeReviewBudget, extendReviewBudget, newReviewBudget, resolveReviewBudget } from '../../src/review-budget.ts'
import { completeCriterionFindings, completeCheckFindings } from '../../src/review-partial.ts'
it('does not charge a twenty-minute check to the model and only extends for new accepted progress', () => {
  const b = newReviewBudget(resolveReviewBudget(), 0)
  chargeReviewBudget(b, 'model', 1000)
  chargeReviewBudget(b, 'checking', 61000)
  chargeReviewBudget(b, 'model', 1261000)
  expect(b.usedModelMs).toBe(60000); expect(b.usedChecksMs).toBe(1200000)
  expect(extendReviewBudget(b)).toBe(false)
  b.progress++
  expect(extendReviewBudget(b)).toBe(true); expect(b.modelMs).toBe(900000)
  expect(extendReviewBudget(b)).toBe(false)
  b.progress++
  expect(extendReviewBudget(b)).toBe(true); expect(b.modelMs).toBe(1200000)
  b.progress++
  expect(extendReviewBudget(b)).toBe(false)
})
it('rejects impossible budgets and retains configured ceilings', () => {
  expect(() => resolveReviewBudget({ modelMs: 1000, reserveMs: 1000 })).toThrow('reserve')
  expect(() => resolveReviewBudget({ checksMs: 7200001 })).toThrow('checksMs')
  expect(() => resolveReviewBudget({ wallMs: 10800001 })).toThrow('wallMs')
  expect(resolveReviewBudget({ modelMs: 500, modelMaxMs: 500, wallMs: 500 }).reserveMs).toBe(50)
})
it('makes missing checks explicit without weakening pass validation', () => {
  const state = { checkPlan: [{ revision: 1, recordedAt: 'now', checks: [{ id: 'check', criterionId: 'c', source: { kind: 'objective' as const, reference: 'objective' }, fact: 'behavior', method: 'run' as const, expected: 'correct', coverage: 'case', basis: 'explicit' as const }] }] } as Parameters<typeof completeCheckFindings>[0]
  const checks = completeCheckFindings(state, [])
  expect(checks[0]?.status).toBe('unverified')
  expect(completeCriterionFindings(state, ['c'], [])[0]).toMatchObject({ status: 'unverified', checkIds: ['check'], evidenceIds: [] })
  expect(() => completeCheckFindings(state, [{ ...checks[0]!, checkId: 'foreign' }])).toThrow('unknown')
})
