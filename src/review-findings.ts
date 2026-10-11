/** Incremental findings are retained independently of the final model report. */
import { z } from 'zod'
import { checkFindingSchema, type CheckFinding } from './review-check-plan.ts'
import type { VerificationState, CriterionFinding } from './verification-schema.ts'

export const checkHistorySchema = z.array(z.object({ revision: z.number().int().positive(), recordedAt: z.iso.datetime(),
  sessionId: z.string().min(1), callId: z.string().min(1), callSeq: z.number().int().nonnegative(),
  phase: z.enum(['independent', 'comparison']), result: checkFindingSchema }).strict())

export function appendCheckResult(state: VerificationState, result: CheckFinding,
  receipt: { sessionId: string; callId: string; callSeq: number }, now = new Date().toISOString()): void {
  const check = state.checkPlan?.flatMap(revision => revision.checks).find(check => check.id === result.checkId)
  if (!check) throw new Error('select an ID from the bound check plan')
  const sealed = state.checkFindings?.find(finding => finding.checkId === check.id)
  if (state.phase === 'comparison' && check.basis === 'explicit' && sealed?.status === 'failed' && result.status === 'satisfied') {
    const additional = result.evidenceIds.filter(id => !sealed.evidenceIds.includes(id))
    const supported = check.method === 'run' ? additional.some(id => state.checks.some(executed => executed.id === id))
      : check.method === 'log' ? additional.some(id => id.startsWith('seq:')) : additional.some(id => !id.startsWith('seq:'))
    if (!supported) throw new Error(`FAILED_CHECK_UNRESOLVED: ${check.id} failed its original fact and expected result. Comparison needs additional acquired evidence of method ${check.method}; the same evidence or a main report cannot turn failure into satisfaction. Do not reinterpret product correctness as completion of the checking activity. Preserve the failure and submit revise/needs-user when no new evidence resolves it.`)
  }
  const history = state.checkHistory ?? []
  if (history.some(entry => entry.sessionId === receipt.sessionId && entry.callId === receipt.callId)) throw new Error('check result receipt already recorded')
  state.checkHistory = [...history, { revision: history.length + 1, recordedAt: now, ...receipt, phase: state.phase, result }]
}

/** Unfinished checks retain explicit gaps; a deadline never converts them to success. */
export function currentCheckResults(state: VerificationState): CheckFinding[] {
  return (state.checkPlan?.flatMap(revision => revision.checks) ?? []).map(check => {
    // Sealed observations remain immutable. Validated comparison receipts resolve
    // the same check separately, without erasing its earlier coverage gap.
    const saved = state.checkHistory?.findLast(entry => entry.result.checkId === check.id)?.result
      ?? state.checkFindings?.find(result => result.checkId === check.id)
    return saved ?? { checkId: check.id, status: 'unverified', finding: 'No validated incremental finding was recorded.',
      coverage: check.coverage, limitations: 'The controller sealed this unfinished check as unverified.', evidenceIds: [] }
  })
}

/** Per-check methods and evidence remain authoritative in the requirement results. */
export function criterionSummary(state: VerificationState, results: CheckFinding[], ids: string[]): CriterionFinding[] {
  const checks = state.checkPlan?.flatMap(revision => revision.checks) ?? []
  return ids.map(criterionId => {
    const group = checks.filter(check => check.criterionId === criterionId)
    const required = group.filter(check => check.basis === 'explicit'), relevant = required.length ? required : group
    const facts = relevant.map(check => results.find(result => result.checkId === check.id)!)
    const status = facts.some(fact => fact.status === 'failed') ? 'failed' : !facts.length || facts.some(fact => fact.status === 'unverified') ? 'unverified' : 'satisfied'
    const method = relevant.some(check => check.method === 'run') ? 'run' : relevant.some(check => check.method === 'read') ? 'read' : relevant.some(check => check.method === 'log') ? 'log' : 'visual'
    const evidenceIds = [...new Set(facts.flatMap(fact => fact.evidenceIds).filter(id => method === 'log' ? id.startsWith('seq:') : !id.startsWith('seq:')))]
    return { criterionId, status, method, checkIds: group.map(check => check.id), evidenceIds,
      finding: facts.map(fact => fact.finding).join('\n') || 'No planned coverage.',
      coverage: facts.map(fact => fact.coverage).join('\n') || 'No coverage.',
      limitations: facts.map(fact => fact.limitations).filter(Boolean).join('\n') }
  })
}
