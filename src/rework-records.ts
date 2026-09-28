/** Rebuild rework explanations from successful native tool results, including older Sessions. */
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { runsOf } from './graph.ts'
import { taskSchema, type TaskSnapshot } from './state-schema.ts'

const priorRunSchema = z.object({
  id: z.string(), attempt: z.number().int().positive(), status: z.string(),
  reviewSeq: z.number().int().nonnegative().optional(),
})
export const pendingReworkSchema = z.object({
  callId: z.string(), taskId: z.string(), stageId: z.string(), reason: z.string(),
  callSeq: z.number().int().nonnegative(), runs: z.array(priorRunSchema),
})
export const reworkRecordSchema = z.object({
  stageId: z.string(), planVersion: z.number().int().nonnegative(), reason: z.string(), callSeq: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(), time: z.number(),
  nodes: z.array(priorRunSchema.extend({ nextAttempt: z.number().int().positive() })),
})
export type ReworkRecord = z.infer<typeof reworkRecordSchema>
export type PendingRework = z.infer<typeof pendingReworkSchema>

/** Preserve exact prior statuses when multiple tool calls share a model step. */
export function changedAttempts(before: TaskSnapshot, after: TaskSnapshot) {
  const nextRuns = runsOf(after)
  return runsOf(before).flatMap(run => {
    const next = nextRuns.find(item => item.id === run.id)
    return next && next.attempt > run.attempt ? [{ id: run.id, attempt: run.attempt,
      status: run.status, nextAttempt: next.attempt,
      ...run.reviewSeq === undefined ? {} : { reviewSeq: run.reviewSeq } }] : []
  })
}

function parse(raw: string): unknown {
  try { return JSON.parse(raw) as unknown } catch { return null }
}

/** Capture the prior attempts at the call; rejected calls never create a rework notice. */
export function captureRework(event: SessionEvent, task: TaskSnapshot | null): PendingRework | null {
  if (!task || event.type !== 'tool/call' || event.data.name !== 'task_rework_node') return null
  const args = z.object({ stage_id: z.string().min(1), reason: z.string().min(1) }).safeParse(parse(event.data.arguments))
  if (!args.success) return null
  return { callId: event.data.callId, taskId: task.id, stageId: args.data.stage_id,
    reason: args.data.reason, callSeq: event.seq,
    runs: runsOf(task).map(run => ({ id: run.id, attempt: run.attempt, status: run.status,
      ...run.reviewSeq === undefined ? {} : { reviewSeq: run.reviewSeq } })) }
}

/** Match a successful result and retain only attempts advanced by this rework. */
export function settleRework(event: SessionEvent, pending: PendingRework): ReworkRecord | null {
  if (event.type !== 'tool/result' || event.data.message.source.callId !== pending.callId
    || event.data.message.isError) return null
  const text = event.data.message.content.find(block => block.type === 'text')
  if (text?.type !== 'text') return null
  const result = z.object({ task: taskSchema, rework: z.object({ nodes: reworkRecordSchema.shape.nodes }).optional() }).safeParse(parse(text.text))
  if (!result.success || result.data.task.id !== pending.taskId) return null
  const nextRuns = runsOf(result.data.task)
  const nodes = result.data.rework?.nodes ?? pending.runs.flatMap(run => {
    const next = nextRuns.find(item => item.id === run.id)
    return next && next.attempt > run.attempt ? [{ ...run, nextAttempt: next.attempt }] : []
  })
  if (!nodes.some(node => node.id === pending.stageId)) return null
  return { stageId: pending.stageId, planVersion: result.data.task.planVersion, reason: pending.reason, callSeq: pending.callSeq,
    seq: event.seq, time: event.time, nodes }
}
