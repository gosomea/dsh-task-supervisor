/** Requirement outcomes retain actual inspection coverage and never upgrade log evidence. */
import { z } from 'zod'
import type { ReviewJob } from './review-schema.ts'
import type { CheckFinding } from './review-check-plan.ts'

export const requirementSourceSchema = z.object({ kind: z.enum(['objective', 'user-message', 'project-rule', 'implementation', 'unknown']), reference: z.string().min(1) }).strict()
const logRequirementSchema = z.object({ id: z.string().min(1).max(100), criterionId: z.string().min(1).nullable(),
  requirement: z.string().min(1), source: requirementSourceSchema, basis: z.enum(['explicit', 'derived']),
  status: z.enum(['satisfied', 'failed', 'unverified']), finding: z.string().min(1), coverage: z.string().min(1), limitations: z.string(),
  evidenceSeqs: z.array(z.number().int().nonnegative()),
}).strict()
export const requirementResultSchema = logRequirementSchema.omit({ evidenceSeqs: true }).extend({
  method: z.enum(['log', 'read', 'run', 'visual']),
  evidence: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('session'), seq: z.number().int().nonnegative(), ranges: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])), total: z.number().int().nonnegative(), truncated: z.boolean() }).strict(),
    z.object({ kind: z.literal('artifact'), snapshotId: z.string(), path: z.string(), hash: z.string(), ranges: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])), total: z.number().int().nonnegative() }).strict(),
    z.object({ kind: z.literal('check'), snapshotId: z.string(), checkId: z.string(), argv: z.array(z.string()), streams: z.array(z.object({ stream: z.enum(['stdout', 'stderr']), ranges: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])), total: z.number().int().nonnegative() }).strict()) }).strict(),
  ])),
}).strict()
export type RequirementResult = z.infer<typeof requirementResultSchema>
export const logRequirementsParameters = { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
  id: { type: 'string', required: true }, criterionId: { type: 'string', description: 'Applicable criterion ID; omit for an original requirement missing from the plan.' },
  requirement: { type: 'string', required: true }, source: { type: 'object', required: true, additionalProperties: false, properties: {
    kind: { type: 'string', required: true, enum: ['objective', 'user-message', 'project-rule', 'implementation', 'unknown'] }, reference: { type: 'string', required: true },
  } }, basis: { type: 'string', required: true, enum: ['explicit', 'derived'] },
  status: { type: 'string', required: true, enum: ['satisfied', 'failed', 'unverified'] }, finding: { type: 'string', required: true },
  coverage: { type: 'string', required: true }, limitations: { type: 'string', required: true }, evidenceSeqs: { type: 'array', required: true, items: { type: 'integer' } },
} } } as const

type ReadRanges = Map<number, { total: number; ranges: [number, number][]; truncated: boolean }>
export function logRequirementResults(job: ReviewJob, raw: unknown, ranges: ReadRanges, passing: boolean): RequirementResult[] {
  const values = z.array(logRequirementSchema).min(1).max(100).parse(raw)
  const criteria = job.kind === 'plan' || job.kind === 'completion' ? job.input.criteria
    : job.input.criteria.filter(item => job.input.stages.find(stage => stage.id === job.stageId)?.criterionIds.includes(item.id))
  if (new Set(values.map(item => item.id)).size !== values.length || values.some(item => item.criterionId !== null && !criteria.some(c => c.id === item.criterionId))
    || criteria.some(item => !values.some(value => value.criterionId === item.id))) throw new Error('requirement results must cover every applicable criterion and use unique IDs')
  if (!values.some(value => value.basis === 'explicit' && value.source.kind === 'objective')) throw new Error('include the original objective requirements, including omissions from the main plan')
  return values.map(value => {
    if (value.source.kind === 'objective' && value.source.reference !== 'objective') throw new Error('objective source must reference objective')
    if (value.source.kind === 'user-message' && (!/^seq:\d+$/u.test(value.source.reference) || !ranges.has(Number(value.source.reference.slice(4))))) throw new Error('read the original user requirement before citing its source')
    const criterion = criteria.find(item => item.id === value.criterionId)
    if (criterion?.provenance?.kind === 'user' && value.basis !== 'explicit') throw new Error('user requirements cannot become optional derived checks')
    if (value.source.kind === 'implementation' && value.basis !== 'derived' || value.source.kind === 'unknown' && passing) throw new Error('unknown or implementation sources cannot establish explicit acceptance')
    if (passing && value.basis === 'explicit' && value.status !== 'satisfied') throw new Error('failed or unverified original requirements cannot pass')
    if (value.status !== 'unverified' && !value.evidenceSeqs.length) throw new Error('verified log results require actually read original evidence')
    const evidence = value.evidenceSeqs.map(seq => {
      const read = ranges.get(seq)
      if (!read || seq > job.cutoff) throw new Error('requirement evidence was not actually read in this job')
      return { kind: 'session' as const, seq, ...read }
    })
    const { evidenceSeqs: _seqs, ...result } = value
    return { ...result, method: 'log', evidence }
  })
}

/** Existing independent checks already specify requirement, method and findings. */
export function independentRequirementResults(job: ReviewJob, findings: CheckFinding[], ranges?: ReadRanges): RequirementResult[] {
  const state = job.verification
  if (!state?.checkPlan) throw new Error('independent requirement results require an actual check plan')
  return state.checkPlan.flatMap(revision => revision.checks).map(check => {
    const result = findings.find(item => item.checkId === check.id)
    if (!result) throw new Error('missing independent check finding')
    const evidence: RequirementResult['evidence'] = result.evidenceIds.map(id => {
      if (check.method === 'log') {
        const seq = /^seq:\d+$/u.test(id) ? Number(id.slice(4)) : NaN, read = ranges?.get(seq)
        if (state.phase !== 'comparison' || !read || seq > job.cutoff) throw new Error('log evidence is not from this bound comparison')
        return { kind: 'session', seq, ...read }
      }
      if (id.startsWith('file:')) {
        const path = id.slice(5), entry = state.snapshot.entries.find(item => item.path === path), read = state.readFiles.find(item => item.path === path)
        if (!entry || !read) throw new Error('artifact evidence is not bound to this snapshot')
        return { kind: 'artifact', snapshotId: state.snapshot.id, path, hash: entry.hash, ranges: read.ranges, total: read.total }
      }
      const executed = state.checks.find(item => item.id === id && item.snapshotId === state.snapshot.id)
      if (!executed) throw new Error('check evidence is not bound to this snapshot')
      return { kind: 'check', snapshotId: state.snapshot.id, checkId: id, argv: executed.argv,
        streams: state.readChecks.filter(item => item.id === id).map(item => ({ stream: item.stream, ranges: item.ranges, total: item.total })) }
    })
    return { id: check.id, criterionId: check.criterionId, requirement: check.fact, source: check.source, basis: check.basis, method: check.method,
      status: result.status, finding: result.finding, coverage: result.coverage, limitations: result.limitations, evidence }
  })
}
