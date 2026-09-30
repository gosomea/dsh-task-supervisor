/** Durable, requirement-driven checks; no task-class-specific checklist. */
import { z } from 'zod'
import type { VerificationState, CriterionFinding } from './verification-schema.ts'

export const reviewCheckSchema = z.object({
  id: z.string().min(1).max(100), criterionId: z.string().min(1).nullable(),
  source: z.object({ kind: z.enum(['objective', 'user-message', 'project-rule']), reference: z.string().min(1) }).strict(),
  fact: z.string().min(1), method: z.enum(['read', 'run', 'visual']),
  expected: z.string().min(1), coverage: z.string().min(1), basis: z.enum(['explicit', 'derived']),
}).strict()
export const checkPlanRevisionSchema = z.object({ revision: z.number().int().positive(), recordedAt: z.string(), phase: z.enum(['independent', 'comparison']).optional(), checks: z.array(reviewCheckSchema).min(1).max(100) }).strict()
export const checkFindingSchema = z.object({ checkId: z.string().min(1), status: z.enum(['satisfied', 'failed', 'unverified']),
  finding: z.string().min(1), coverage: z.string().min(1), limitations: z.string(), evidenceIds: z.array(z.string().min(1)) }).strict()
export type ReviewCheck = z.infer<typeof reviewCheckSchema>
export type CheckFinding = z.infer<typeof checkFindingSchema>

/** New revisions append checks; prior hypotheses and inspected facts remain auditable. */
export function appendCheckPlan(state: VerificationState, checks: ReviewCheck[], applicable: string[], now: string): void {
  const history = state.checkPlan ?? [], prior = history.flatMap(item => item.checks), all = [...prior, ...checks]
  if (!checks.length || all.length > 100 || new Set(all.map(item => item.id)).size !== all.length) throw new Error('check IDs must be unique and bounded; append new checks rather than replace history')
  if (checks.some(item => item.criterionId !== null && !applicable.includes(item.criterionId))) throw new Error('check criterion is outside this review')
  if (applicable.some(id => !all.some(item => item.criterionId === id))) throw new Error('initial check plan must cover every applicable criterion and any omitted original requirements')
  for (const check of checks) {
    if (check.source.kind === 'objective' && check.source.reference !== 'objective') throw new Error('objective source must reference objective')
    if (check.source.kind === 'user-message' && !state.readInputs?.includes(Number(check.source.reference.replace(/^seq:/, '')))) throw new Error('read the original direct user message before citing its requirement')
    if (check.source.kind === 'project-rule' && !state.readFiles.some(item => item.path === check.source.reference && item.purpose === 'constraint')) throw new Error('read the applicable project constraint before citing it')
  }
  state.checkPlan = [...history, { revision: history.length + 1, recordedAt: now, phase: state.phase, checks }]
}

/** Results describe actual coverage, not a process exit code or a main-Agent claim. */
export function checkResultsAsEvidence(state: VerificationState, results: CheckFinding[], passing: boolean): CriterionFinding[] {
  const checks = state.checkPlan?.flatMap(item => item.checks) ?? []
  if (!checks.length || results.length !== checks.length || new Set(results.map(item => item.checkId)).size !== results.length
    || results.some(item => !checks.some(check => check.id === item.checkId))) {
    throw new Error(`report every planned check exactly once: expected checkIds=${JSON.stringify(checks.map(item => item.id))}; received=${JSON.stringify(results.map(item => item.checkId))}`)
  }
  return results.map(result => {
    const check = checks.find(item => item.id === result.checkId)!
    if (passing && check.basis === 'explicit' && result.status !== 'satisfied') throw new Error('failed or unverified original requirements cannot pass')
    return { criterionId: check.id, method: check.method, status: result.status, finding: result.finding, evidenceIds: result.evidenceIds }
  })
}

export const checkPlanParameters = { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
  id: { type: 'string', required: true }, criterionId: { type: 'string', description: 'Applicable criterion ID; omit for an original requirement missing from the main plan.' },
  source: { type: 'object', required: true, additionalProperties: false, properties: { kind: { type: 'string', required: true, enum: ['objective', 'user-message', 'project-rule'] }, reference: { type: 'string', required: true, description: 'objective, seq:<direct user event>, or inspected constraint file path' } } },
  fact: { type: 'string', required: true }, method: { type: 'string', required: true, enum: ['read', 'run', 'visual'] },
  expected: { type: 'string', required: true }, coverage: { type: 'string', required: true }, basis: { type: 'string', required: true, enum: ['explicit', 'derived'] },
} } } as const
export const checkFindingParameters = { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
  checkId: { type: 'string', required: true }, status: { type: 'string', required: true, enum: ['satisfied', 'failed', 'unverified'] },
  finding: { type: 'string', required: true }, coverage: { type: 'string', required: true }, limitations: { type: 'string', required: true },
  evidenceIds: { type: 'array', required: true, items: { type: 'string' } },
} } } as const
