/** Durable one-task state projected from the main DSH Session. */

import { validateGraph } from './graph.ts'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export const NAMESPACE = 'dsh-task-supervisor'
export const RECORD_VERSION = 6
export const READABLE_RECORD_VERSIONS = [1, 2, 3, 4, 5, 6]

export const provenanceSchema = z.object({
  kind: z.enum(['user', 'project', 'implementation']),
  reference: z.string().min(1),
  sourceSeq: z.number().int().nonnegative().optional(),
}).strict()
export const criterionSchema = z.object({
  id: z.string().min(1), text: z.string().min(1), provenance: provenanceSchema.optional(), evidenceKind: z.enum(['text', 'visual']).optional(),
}).strict()
export const stageSchema = z.object({
  dependsOn: z.array(z.string().min(1)).optional(), writePaths: z.array(z.string().min(1)).optional(),
  id: z.string().min(1), title: z.string().min(1), description: z.string().optional(), criterionIds: z.array(z.string().min(1)).min(1),
}).strict()
const nodeRunSchema = z.object({
  id: z.string().min(1), attempt: z.number().int().positive(),
  status: z.enum(['pending', 'running', 'reviewing', 'passed', 'needs-revision', 'awaiting-user']),
  sessionId: z.string().optional(), startedAt: z.string().optional(), finishedAt: z.string().optional(),
  evidenceAfterSeq: z.number().int().nonnegative().optional(),
  reviewSeq: z.number().int().nonnegative().optional(),
}).strict()
export type NodeRun = z.infer<typeof nodeRunSchema>
const reviewSchema = z.object({
  stageId: z.string().min(1),
  cutoff: z.number().int().nonnegative(),
  verdict: z.enum(['pass', 'revise', 'needs-user']),
  finding: z.string(),
  imageSeqs: z.array(z.number().int().nonnegative()).optional(),
  evidenceSeqs: z.array(z.number().int().nonnegative()).optional(),
  reviewerSessionId: z.string().min(1).optional(),
  model: z.object({ provider: z.string().min(1), model: z.string().min(1),
    reasoningEffort: z.string().optional() }).strict().optional(),
}).strict()
const pendingReviewSchema = z.object({
  kind: z.enum(['stage', 'progress', 'completion']),
  stageId: z.string().min(1),
  evidence: z.string().min(1),
}).strict()

export const taskSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  objective: z.string().min(1),
  responseLanguage: z.string().min(1).optional(),
  lastApproval: z.object({ planVersion: z.number().int().nonnegative(), userMessageSeq: z.number().int().nonnegative().nullable() }).strict().optional(),
  requirementsVersion: z.number().int().positive(),
  planVersion: z.number().int().nonnegative(),
  criteria: z.array(criterionSchema),
  stages: z.array(stageSchema),
  nodeRuns: z.array(nodeRunSchema).optional(),
  stageIndex: z.number().int().nonnegative(),
  roundsSinceReview: z.number().int().nonnegative(),
  approvedPlanVersion: z.number().int().nonnegative().nullable(),
  readOnlyTurnsBeforeWrite: z.number().int().min(0).max(10).optional(),
  readOnlyGateStartSeq: z.number().int().nonnegative().nullable().optional(),
  everApproved: z.boolean(),
  enabled: z.boolean(),
  phase: z.enum(['planning', 'awaiting-approval', 'active', 'reviewing', 'paused', 'complete', 'cleared']),
  pendingReview: pendingReviewSchema.nullable(),
  lastReview: reviewSchema.nullable(),
}).strict()

export type TaskSnapshot = z.infer<typeof taskSchema>
export type TaskStage = z.infer<typeof stageSchema>
export type TaskCriterion = z.infer<typeof criterionSchema>

export interface TaskProjection {
  current: TaskSnapshot | null
  failure: string | null
  reviews: z.infer<typeof reviewSchema>[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    taskSupervisor: TaskProjection
  }
}

/** Rebuild the only authoritative task state from ordered extension records. */
export const taskProjection = {
  key: 'taskSupervisor',
  stateVersion: 6,
  stateSchema: z.object({ current: taskSchema.nullable(), failure: z.string().nullable(), reviews: z.array(reviewSchema) }),
  init: (): TaskProjection => ({ current: null, failure: null, reviews: [] }),
  apply(state: TaskProjection, event: SessionEvent): TaskProjection {
    if (event.type !== 'extension/record' || event.data.namespace !== NAMESPACE) return state
    if (state.failure !== null) return state
    try {
      if (!READABLE_RECORD_VERSIONS.includes(event.data.schemaVersion) || event.data.kind !== 'state') {
        throw new Error('unsupported Supervisor record')
      }
      const next = taskSchema.parse(event.data.payload)
      const previous = state.current
      if (previous === null && next.revision !== 1) throw new Error('first task revision must be one')
      if (previous !== null && next.id === previous.id && next.revision !== previous.revision + 1) {
        throw new Error('task revision is not contiguous')
      }
      if (previous !== null && next.id !== previous.id
        && (!['complete', 'cleared'].includes(previous.phase) || next.revision !== 1)) {
        throw new Error('new task identity requires a terminal predecessor')
      }
      if (next.stages.length) validatePlan(next.criteria, next.stages)
      if (next.nodeRuns && (next.nodeRuns.length !== next.stages.length
        || new Set(next.nodeRuns.map(run => run.id)).size !== next.stages.length
        || next.nodeRuns.some(run => !next.stages.some(stage => stage.id === run.id)))) {
        throw new Error('node runs must match the plan')
      }
      if (next.stageIndex > next.stages.length) throw new Error('stage index exceeds the plan')
      const reviews = previous?.id === next.id ? state.reviews : []
      const review = next.lastReview
      const fresh = review !== null && !reviews.some(item => item.stageId === review.stageId
        && item.cutoff === review.cutoff && item.reviewerSessionId === review.reviewerSessionId)
      return { current: next, failure: null, reviews: fresh ? [...reviews, review].slice(-50) : reviews }
    } catch (error: unknown) {
      return { ...state, failure: `Supervisor record at seq ${event.seq}: ${String(error)}` }
    }
  },
} satisfies ProjectionDefinition<'taskSupervisor', TaskProjection>

/** Read the exact folded state, refusing a damaged or unavailable projection. */
export function taskOf(ctx: Context, agent: Agent): TaskSnapshot | null {
  const projection = ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')
  if (projection === undefined) throw new Error('Supervisor state projection is not installed')
  if (projection.failure !== null) throw new Error(projection.failure)
  return projection.current
}

/** Append one full post-mutation state; no separate mutable JSON ledger exists. */
export function taskJson(state: TaskSnapshot): JsonValue {
  return {
    id: state.id,
    revision: state.revision,
    objective: state.objective,
    ...state.responseLanguage === undefined ? {} : { responseLanguage: state.responseLanguage },
    ...state.lastApproval === undefined ? {} : { lastApproval: { ...state.lastApproval } },
    requirementsVersion: state.requirementsVersion,
    planVersion: state.planVersion,
    criteria: state.criteria.map(item => ({ id: item.id, text: item.text,
      ...item.evidenceKind === undefined ? {} : { evidenceKind: item.evidenceKind },
      ...item.provenance === undefined ? {} : { provenance: { kind: item.provenance.kind, reference: item.provenance.reference,
        ...item.provenance.sourceSeq === undefined ? {} : { sourceSeq: item.provenance.sourceSeq } } } })),
    ...state.nodeRuns === undefined ? {} : { nodeRuns: state.nodeRuns.map(run => ({
      id: run.id, attempt: run.attempt, status: run.status,
      ...run.sessionId === undefined ? {} : { sessionId: run.sessionId },
      ...run.startedAt === undefined ? {} : { startedAt: run.startedAt },
      ...run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt },
      ...run.evidenceAfterSeq === undefined ? {} : { evidenceAfterSeq: run.evidenceAfterSeq },
      ...run.reviewSeq === undefined ? {} : { reviewSeq: run.reviewSeq },
    })) },
    stages: state.stages.map(item => ({ id: item.id, title: item.title,
      ...item.dependsOn === undefined ? {} : { dependsOn: [...item.dependsOn] },
      ...item.writePaths === undefined ? {} : { writePaths: [...item.writePaths] }, ...item.description === undefined ? {} : { description: item.description }, criterionIds: [...item.criterionIds] })),
    stageIndex: state.stageIndex,
    roundsSinceReview: state.roundsSinceReview,
    approvedPlanVersion: state.approvedPlanVersion,
    ...state.readOnlyTurnsBeforeWrite === undefined ? {} : { readOnlyTurnsBeforeWrite: state.readOnlyTurnsBeforeWrite },
    ...state.readOnlyGateStartSeq === undefined ? {} : { readOnlyGateStartSeq: state.readOnlyGateStartSeq },
    everApproved: state.everApproved,
    enabled: state.enabled,
    phase: state.phase,
    pendingReview: state.pendingReview === null ? null : { ...state.pendingReview },
    lastReview: state.lastReview === null ? null : {
      stageId: state.lastReview.stageId, cutoff: state.lastReview.cutoff,
      verdict: state.lastReview.verdict, finding: state.lastReview.finding,
      ...state.lastReview.imageSeqs === undefined ? {} : { imageSeqs: [...state.lastReview.imageSeqs] },
      ...state.lastReview.evidenceSeqs === undefined ? {} : { evidenceSeqs: [...state.lastReview.evidenceSeqs] },
      ...state.lastReview.reviewerSessionId === undefined ? {} : { reviewerSessionId: state.lastReview.reviewerSessionId },
      ...state.lastReview.model === undefined ? {} : { model: {
        provider: state.lastReview.model.provider, model: state.lastReview.model.model,
        ...state.lastReview.model.reasoningEffort === undefined ? {}
          : { reasoningEffort: state.lastReview.model.reasoningEffort },
      } },
    },
  }
}

export function appendTask(ctx: Context, agent: Agent, next: TaskSnapshot): TaskSnapshot {
  const state = taskSchema.parse(next)
  const payload = taskJson(state)
  agent.session.append('extension/record', {
    namespace: NAMESPACE, schemaVersion: RECORD_VERSION, recordId: randomUUID(), kind: 'state', payload,
  })
  const committed = taskOf(ctx, agent)
  if (committed === null || committed.revision !== state.revision) {
    throw new Error('Supervisor state did not project after append')
  }
  return committed
}

/** Construct a new disarmed task from a direct user objective. */
export function newTask(objective: string): TaskSnapshot {
  const text = objective.trim()
  if (!text) throw new Error('task objective is required')
  return {
    id: randomUUID(), revision: 1, objective: text, requirementsVersion: 1,
    planVersion: 0, criteria: [], stages: [], stageIndex: 0, roundsSinceReview: 0,
    approvedPlanVersion: null, readOnlyTurnsBeforeWrite: 0, readOnlyGateStartSeq: null,
    everApproved: false, enabled: true,
    phase: 'planning', pendingReview: null, lastReview: null,
  }
}

/** Reject plans that lose criteria or use ambiguous stage identities. */
export function validatePlan(criteria: readonly TaskCriterion[], stages: readonly TaskStage[]): void {
  if (criteria.length === 0 || stages.length === 0) throw new Error('plan needs criteria and stages')
  const criteriaIds = new Set(criteria.map(item => item.id))
  const stageIds = new Set(stages.map(item => item.id))
  if (criteriaIds.size !== criteria.length || stageIds.size !== stages.length) {
    throw new Error('criteria and stage IDs must be unique')
  }
  const covered = new Set<string>()
  for (const stage of stages) {
    for (const id of stage.criterionIds) {
      if (!criteriaIds.has(id)) throw new Error(`stage ${stage.id} cites unknown criterion ${id}`)
      covered.add(id)
    }
  }
  validateGraph(stages)
  if (covered.size !== criteriaIds.size) throw new Error('every criterion must appear in a stage')
}
