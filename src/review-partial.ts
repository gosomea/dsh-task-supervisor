/** Explicit unverified rows complete a corrective report without inventing coverage. */
import type { VerificationState, CriterionFinding } from './verification-schema.ts'
import type { CheckFinding } from './review-check-plan.ts'
import type { ReviewJob } from './review-schema.ts'
import { applicableCriteria, type RequirementResult } from './review-results.ts'
export function completeCheckFindings(state: VerificationState, findings: CheckFinding[]): CheckFinding[] {
  const planned = state.checkPlan?.flatMap(item => item.checks) ?? []
  if (new Set(findings.map(f => f.checkId)).size !== findings.length || findings.some(f => !planned.some(p => p.id === f.checkId))) throw new Error('unknown or duplicate check IDs')
  return planned.map(check => findings.find(f => f.checkId === check.id) ?? { checkId: check.id, status: 'unverified', finding: 'Not inspected', coverage: 'None', limitations: 'Review ended before this check was verified', evidenceIds: [] })
}
export function completeCriterionFindings(state: VerificationState, ids: string[], findings: CriterionFinding[]): CriterionFinding[] {
  if (new Set(findings.map(f => f.criterionId)).size !== findings.length || findings.some(f => !ids.includes(f.criterionId))) throw new Error('unknown or duplicate criterion IDs')
  return ids.map(id => findings.find(f => f.criterionId === id) ?? { criterionId: id, status: 'unverified', method: 'read', finding: 'Not inspected', evidenceIds: [], checkIds: state.checkPlan?.flatMap(p => p.checks).filter(c => c.criterionId === id).map(c => c.id) ?? [], coverage: 'None', limitations: 'Review ended before this criterion was verified' })
}
export function completeRequirementFindings(job: ReviewJob, findings: RequirementResult[]): RequirementResult[] {
  return [...findings, ...applicableCriteria(job).filter(c => !findings.some(f => f.criterionId === c.id)).map(c => ({ id: `uninspected:${c.id}`, criterionId: c.id, requirement: c.text, source: { kind: 'unknown' as const, reference: c.provenance?.reference ?? 'uninspected' }, basis: 'explicit' as const, status: 'unverified' as const, finding: 'Not inspected', coverage: 'None', limitations: 'Review ended before this requirement was verified', method: 'log' as const, evidence: [] }))]
}
