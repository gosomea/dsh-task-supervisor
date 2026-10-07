/** Durable one-task state projected from the main DSH Session. */
import { appendControlRecord, controlEvent } from './session-records.ts'

import { validateGraph } from './graph.ts'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { captureRework, settleRework, pendingReworkSchema, reworkRecordSchema,
  type PendingRework, type ReworkRecord } from './rework-records.ts'

export const NAMESPACE = 'dsh-task-supervisor'
export const RECORD_VERSION = 15
export const READABLE_RECORD_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]

export { criterionSchema, stageSchema, taskSchema } from './state-schema.ts'
export type { TaskSnapshot, TaskStage, TaskCriterion, NodeRun } from './state-schema.ts'
import { DRAFT_NAMESPACE, draftSchema, foldDraft, type TaskDraft } from './drafts.ts'
import { REVIEW_NAMESPACE, reviewJobSchema, foldReviewJobs, type ReviewJob } from './review-records.ts'
import { taskSchema, reviewSchema, type TaskSnapshot, type TaskStage, type TaskCriterion } from './state-schema.ts'
import { REPAIR_NAMESPACE, repairProposalSchema, foldRepairs, reopenTask, type RepairProposal } from './repairs.ts'

export const entrySchema = z.object({ active: z.boolean(), mainSessionId: z.string().min(1) }).strict()

export interface TaskProjection {
  entry: z.infer<typeof entrySchema> | null
  current: TaskSnapshot | null
  failure: string | null
  reviews: z.infer<typeof reviewSchema>[]
  draft: TaskDraft | null
  reviewJobs: ReviewJob[]
  reworks: ReworkRecord[]
  pendingReworks: PendingRework[]
  repairs: RepairProposal[]
  archivedTasks: TaskHistoryEntry[]
  currentSeq: number
}

export interface TaskHistoryEntry {
  task: TaskSnapshot
  reviews: z.infer<typeof reviewSchema>[]
  reworks: ReworkRecord[]
  lastSeq: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    taskSupervisor: TaskProjection
  }
}

/** Rebuild the authoritative task state from ordered native control records. */
export const taskProjection = {
  key: 'taskSupervisor',
  stateVersion: 19,
  stateSchema: z.object({ entry: entrySchema.nullable(), current: taskSchema.nullable(), failure: z.string().nullable(), reviews: z.array(reviewSchema),
    reviewJobs: z.array(reviewJobSchema), draft: draftSchema.nullable(), reworks: z.array(reworkRecordSchema), pendingReworks: z.array(pendingReworkSchema),
    repairs: z.array(repairProposalSchema), currentSeq: z.number().int().nonnegative(),
    archivedTasks: z.array(z.object({ task: taskSchema, reviews: z.array(reviewSchema), reworks: z.array(reworkRecordSchema), lastSeq: z.number().int().nonnegative() })) }),
  init: (): TaskProjection => ({ entry: null, current: null, failure: null, reviews: [], reviewJobs: [], draft: null, reworks: [], pendingReworks: [], repairs: [], archivedTasks: [], currentSeq: 0 }),
  apply(state: TaskProjection, event: SessionEvent): TaskProjection {
    event = controlEvent(event)
    if (state.failure !== null) return state
    const captured = captureRework(event, state.current)
    if (captured) return { ...state, pendingReworks: [...state.pendingReworks, captured].slice(-50) }
    const pending = event.type === 'tool/result'
      ? state.pendingReworks.find(item => item.callId === event.data.message.source.callId) : undefined
    if (pending) {
      const record = settleRework(event, pending)
      return { ...state, pendingReworks: state.pendingReworks.filter(item => item.callId !== pending.callId),
        reworks: record ? [...state.reworks, record].slice(-50) : state.reworks }
    }
    if (event.type !== 'extension/record' || ![NAMESPACE, REVIEW_NAMESPACE, DRAFT_NAMESPACE, REPAIR_NAMESPACE].includes(event.data.namespace)) return state
    try {
      if (event.data.namespace === NAMESPACE && event.data.kind === 'entry') {
        if (event.data.schemaVersion !== 1) throw new Error('unsupported task entry record')
        return { ...state, entry: entrySchema.parse(event.data.payload) }
      }
      if (event.data.namespace === REPAIR_NAMESPACE) return { ...state, repairs: foldRepairs(state.repairs, event) }
      if (event.data.namespace === DRAFT_NAMESPACE) return { ...state, draft: foldDraft(state.draft, event) }
      if (event.data.namespace === REVIEW_NAMESPACE) return { ...state, reviewJobs: foldReviewJobs(state.reviewJobs, event) }
      if (!READABLE_RECORD_VERSIONS.includes(event.data.schemaVersion) || event.data.kind !== 'state') {
        throw new Error('unsupported Supervisor record')
      }
      const next = taskSchema.parse(event.data.payload)
      const previous = state.current
      const archived = state.archivedTasks.find(entry => entry.task.id === next.id)
      if (previous === null && next.revision !== 1) throw new Error('first task revision must be one')
      if (previous !== null && next.id === previous.id && next.revision !== previous.revision + 1) {
        throw new Error('task revision is not contiguous')
      }
      if (previous !== null && next.id !== previous.id
        && (!['complete', 'cleared'].includes(previous.phase) || (!archived && next.revision !== 1))) {
        throw new Error('new task identity requires a terminal predecessor')
      }
      const source = previous?.id === next.id ? previous : archived?.task
      if (source?.phase === 'complete' && next.phase === 'active') {
        const proposal = state.repairs.find(p => p.id === next.reopenedFromProposalId)
        if (!proposal || JSON.stringify(taskJson(reopenTask(source, proposal, event.seq))) !== JSON.stringify(taskJson(next))) {
          throw new Error('completed task reopening requires the exact confirmed repair transition')
        }
      } else if (archived && previous?.id !== next.id) throw new Error('historical tasks require confirmed reopening')
      if (next.stages.length) validatePlan(next.criteria, next.stages)
      if (next.nodeRuns && (next.nodeRuns.length !== next.stages.length
        || new Set(next.nodeRuns.map(run => run.id)).size !== next.stages.length
        || next.nodeRuns.some(run => !next.stages.some(stage => stage.id === run.id)))) {
        throw new Error('node runs must match the plan')
      }
      if (next.stageIndex > next.stages.length) throw new Error('stage index exceeds the plan')
      const reviews = previous?.id === next.id ? state.reviews : archived?.reviews ?? []
      const review = next.lastReview
      const fresh = review !== null && !reviews.some(item => item.stageId === review.stageId
        && item.cutoff === review.cutoff && item.reviewerSessionId === review.reviewerSessionId)
      const archivedTasks = state.archivedTasks.filter(entry => entry.task.id !== next.id && entry.task.id !== previous?.id)
      if (previous && previous.id !== next.id) archivedTasks.push({ task: previous, reviews: state.reviews, reworks: state.reworks, lastSeq: state.currentSeq })
      return { ...state, entry: null, current: next, currentSeq: event.seq, archivedTasks, failure: null,
        repairs: state.repairs.map(p => p.id === next.reopenedFromProposalId && p.status === 'confirmed' ? { ...p, status: 'applied' } : p),
        reviews: fresh ? [...reviews, review].slice(-50) : reviews,
        reworks: previous?.id === next.id ? state.reworks : archived?.reworks ?? [],
        pendingReworks: previous?.id === next.id ? state.pendingReworks : [] }
    } catch (error: unknown) {
      return { ...state, failure: `Supervisor record at seq ${event.seq}: ${String(error)}` }
    }
  },
} satisfies ProjectionDefinition<'taskSupervisor', TaskProjection>

/** Read completed and cleared tasks from the same ordered Session records as the live projection. */
export function createTaskHistoryCollector() {
  let projection = taskProjection.init()
  const terminal = (task: TaskSnapshot) => task.phase === 'complete' || task.phase === 'cleared'
  return {
    add(event: SessionEvent) {
      projection = taskProjection.apply(projection, event)
      if (projection.failure !== null) throw new Error(projection.failure)
    },
    finish(): TaskHistoryEntry[] {
      const current = projection.current && terminal(projection.current)
        ? [{ task: projection.current, reviews: projection.reviews, reworks: projection.reworks, lastSeq: projection.currentSeq }] : []
      return [...projection.archivedTasks.filter(entry => terminal(entry.task)), ...current].sort((a, b) => b.lastSeq - a.lastSeq)
    },
  }
}

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
    ...state.acceptanceCycle === undefined ? {} : { acceptanceCycle: state.acceptanceCycle },
    ...state.completedAt === undefined ? {} : { completedAt: state.completedAt },
    ...state.reopenedFromProposalId === undefined ? {} : { reopenedFromProposalId: state.reopenedFromProposalId },
    ...state.repairHistory === undefined ? {} : { repairHistory: JSON.parse(JSON.stringify(state.repairHistory)) as JsonValue },
    ...state.recovery === undefined ? {} : { recovery: { ...state.recovery, evidenceSeqs: [...state.recovery.evidenceSeqs] } },
    ...state.planning === undefined ? {} : { planning: { ...state.planning, facts: [...state.planning.facts], unknowns: [...state.planning.unknowns], evidenceSeqs: [...state.planning.evidenceSeqs] } },
    objective: state.objective,
    ...state.creationRequestId === undefined ? {} : { creationRequestId: state.creationRequestId },
    ...state.responseLanguage === undefined ? {} : { responseLanguage: state.responseLanguage },
    ...state.lastApproval === undefined ? {} : { lastApproval: { planVersion: state.lastApproval.planVersion, userMessageSeq: state.lastApproval.userMessageSeq,
      ...state.lastApproval.source === undefined ? {} : { source: state.lastApproval.source },
      ...state.lastApproval.authorizationSeq === undefined ? {} : { authorizationSeq: state.lastApproval.authorizationSeq },
      ...state.lastApproval.reviewJobId === undefined ? {} : { reviewJobId: state.lastApproval.reviewJobId } } },
    ...state.approvalPolicy === undefined ? {} : { approvalPolicy: { ...state.approvalPolicy } },
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
      ...run.workerCutoff === undefined ? {} : { workerCutoff: run.workerCutoff },
      ...run.integrationAfterSeq === undefined ? {} : { integrationAfterSeq: run.integrationAfterSeq },
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
    ...state.reviewFault === undefined ? {} : { reviewFault: state.reviewFault === null ? null : JSON.parse(JSON.stringify(state.reviewFault)) as JsonValue },
    ...state.pauseReason === undefined ? {} : { pauseReason: state.pauseReason },
    pendingReview: state.pendingReview === null ? null : { kind: state.pendingReview.kind, stageId: state.pendingReview.stageId, evidence: state.pendingReview.evidence, ...state.pendingReview.cutoff === undefined ? {} : { cutoff: state.pendingReview.cutoff }, ...state.pendingReview.jobId === undefined ? {} : { jobId: state.pendingReview.jobId } },
    lastReview: state.lastReview === null ? null : {
      ...state.lastReview.jobId === undefined ? {} : { jobId: state.lastReview.jobId },
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
  appendControlRecord(agent, {
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
