/** Restore read eligibility only from paired, successful native tool results. */
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReviewJob } from './review-records.ts'
import { runsOf } from './graph.ts'

const page = z.object({ cutoff: z.number().int(), sessionId: z.string().optional(),
  events: z.array(z.object({ seq: z.number().int().nonnegative(), type: z.string() }).passthrough()).optional(),
  entries: z.array(z.object({ seq: z.number().int().nonnegative() }).passthrough()).optional(),
  seq: z.number().int().nonnegative().optional(), text: z.string().optional(), nodeId: z.string().optional(), attempt: z.number().int().optional(),
}).passthrough()
const textResult = z.object({ seq: z.number().int().nonnegative(), text: z.string() }).passthrough()
const readRange = textResult.extend({ offset: z.number().int().nonnegative(), totalChars: z.number().int().nonnegative(),
  truncated: z.boolean(), nextOffset: z.number().int().nonnegative().nullable() }).refine(value => value.offset + value.text.length <= value.totalChars)
const artifactRead = z.object({ snapshotId: z.string(), path: z.string(), hash: z.string(), offset: z.number().int().nonnegative(), totalChars: z.number().int().nonnegative(), text: z.string() }).passthrough()
const checkRead = artifactRead.omit({ path: true, hash: true }).extend({ checkId: z.string(), stream: z.enum(['stdout', 'stderr']) })
export function restoreReviewReads(events: readonly SessionEvent[], job: ReviewJob, mainEvents: readonly SessionEvent[] = []) {
  const observed = new Set<number>(), located = new Set<number>(), workers = new Set<string>(), inspectedWorkers = new Set<string>()
  const ranges = new Map<number, { total: number; ranges: [number, number][]; truncated: boolean }>()
  const accept = (raw: unknown) => {
    const value = readRange.safeParse(raw)
    if (!value.success || value.data.seq > job.cutoff) return false
    const item = value.data, prior = ranges.get(item.seq)
    if (prior && prior.total !== item.totalChars) return false
    const range = prior ?? { total: item.totalChars, ranges: [], truncated: false }
    range.ranges.push([item.offset, item.offset + item.text.length]); range.truncated ||= item.truncated
    ranges.set(item.seq, range); observed.add(item.seq); return true
  }
  const calls = new Map<string, Extract<SessionEvent, { type: 'tool/call' }>>()
  const files: NonNullable<ReviewJob['verification']>['readFiles'] = [], checks: NonNullable<ReviewJob['verification']>['readChecks'] = [], images = new Set<number>()
  const comparison = job.verification?.phase !== 'independent'
  for (const event of events) {
    if (event.type === 'tool/call') { calls.set(event.data.callId, event); continue }
    if (event.type !== 'tool/result' || event.data.message.isError) continue
    const call = calls.get(event.data.message.source.callId)
    if (!call || call.data.turn !== event.data.turn || call.data.step !== event.data.step) continue
    if (call.data.name === 'read_task_image' && comparison) {
      const args = z.object({ seq: z.number().int().nonnegative(), image_index: z.number().int().nonnegative() }).safeParse((() => { try { return JSON.parse(call.data.arguments) } catch { return null } })())
      if (!args.success || !observed.has(args.data.seq) || args.data.seq > job.cutoff) continue
      const after = runsOf(job.input).find(run => run.id === job.stageId)?.evidenceAfterSeq ?? job.input.readOnlyGateStartSeq ?? 0
      if (args.data.seq < after) continue
      const original = mainEvents.find(event => event.seq === args.data.seq)
      const blocks = original?.type === 'user/message' ? original.data.content : original?.type === 'tool/result' ? original.data.message.content : []
      const image = blocks.filter(block => block.type === 'image')[args.data.image_index]
      const result = event.data.message.content
      if (image?.type === 'image' && result.length === 2 && result[0]?.type === 'text'
        && result[0].text === `Image evidence from main Session seq ${args.data.seq}; immutable attachment ${image.attachment.attachmentId}.`
        && result[1]?.type === 'image' && JSON.stringify(result[1].attachment) === JSON.stringify(image.attachment)) images.add(args.data.seq)
      continue
    }
    // Multiple blocks or truncated/non-JSON results cannot establish a reliable read.
    const content = event.data.message.content
    if (content.length !== 1 || content[0]?.type !== 'text') continue
    let raw: unknown
    try { raw = JSON.parse(content[0].text) } catch { continue }
    if (call.data.name === 'read_task_evidence_batch' && comparison) {
      const result = z.object({ sessionId: z.string(), cutoff: z.number().int(), items: z.array(z.object({ ok: z.boolean() }).passthrough()).max(6) }).safeParse(raw)
      if (!result.success || result.data.sessionId !== job.mainSessionId || result.data.cutoff !== job.cutoff) continue
      for (const item of result.data.items) if (item.ok === true && typeof item.seq === 'number' && (observed.has(item.seq) || located.has(item.seq))) accept(item)
      continue
    }
    if (call.data.name === 'inspect_task_artifact' && job.verification) {
      const parsed = artifactRead.safeParse(raw)
      if (!parsed.success || parsed.data.snapshotId !== job.verification.snapshot.id) continue
      const value = parsed.data, entry = job.verification.snapshot.entries.find(entry => entry.path === value.path && entry.kind === 'file' && entry.hash === value.hash)
      if (!entry || value.offset + value.text.length > value.totalChars) continue
      const prior = job.verification.readFiles.find(read => read.path === value.path && read.total === value.totalChars)
      if (!prior) continue
      let read = files.find(read => read.path === value.path)
      if (!read) { read = { ...prior, ranges: [] }; files.push(read) }
      read.ranges.push([value.offset, value.offset + value.text.length])
      continue
    }
    if (call.data.name === 'read_review_evidence' && job.verification) {
      const parsed = checkRead.safeParse(raw)
      if (!parsed.success || parsed.data.snapshotId !== job.verification.snapshot.id) continue
      const value = parsed.data, prior = job.verification.readChecks.find(read => read.id === value.checkId && read.stream === value.stream && read.total === value.totalChars)
      if (!prior || value.offset + value.text.length > value.totalChars || !job.verification.checks.some(check => check.id === value.checkId && check.snapshotId === value.snapshotId)) continue
      let read = checks.find(read => read.id === value.checkId && read.stream === value.stream)
      if (!read) { read = { ...prior, ranges: [] }; checks.push(read) }
      read.ranges.push([value.offset, value.offset + value.text.length])
      continue
    }
    const parsed = page.safeParse(raw)
    if (['read_task_input', 'read_task_evidence', 'read_task_evidence_index', 'read_task_worker'].includes(call.data.name)) {
      if (!parsed.success) continue
      const value = parsed.data
      if (call.data.name === 'read_task_worker') {
        if (!comparison) continue
        const run = runsOf(job.input).find(run => run.id === value.nodeId)
        if (!run || run.sessionId !== value.sessionId || run.attempt !== value.attempt || run.workerCutoff !== value.cutoff) continue
        for (const item of value.events ?? []) if (item.seq <= value.cutoff) { workers.add(`${run.id}:${item.seq}`); inspectedWorkers.add(run.id) }
        continue
      }
      if (value.cutoff !== job.cutoff || value.sessionId !== undefined && value.sessionId !== job.mainSessionId) continue
      if (call.data.name !== 'read_task_input' && !comparison) continue
      if (call.data.name === 'read_task_evidence_index') {
        for (const item of value.entries ?? []) if (item.seq <= job.cutoff) located.add(item.seq)
      } else {
        for (const item of value.events ?? []) if (item.seq <= job.cutoff && (call.data.name !== 'read_task_input' || item.type === 'user/message')) {
          located.add(item.seq)
          if (job.scope) accept(item); else observed.add(item.seq)
        }
        if (call.data.name === 'read_task_input' && value.seq !== undefined && value.seq <= job.cutoff && value.text !== undefined) {
          if (job.scope) accept(value); else observed.add(value.seq)
        }
      }
    } else if (comparison && ['read_task_text', 'read_task_call'].includes(call.data.name)) {
      const text = textResult.safeParse(raw)
      if (text.success && text.data.seq <= job.cutoff && (observed.has(text.data.seq) || located.has(text.data.seq))) {
        if (job.scope) accept(raw); else observed.add(text.data.seq)
      }
    }
  }
  return { observed, located, workers, inspectedWorkers, images, files, checks, ranges }
}
