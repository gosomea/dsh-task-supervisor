/** Native Session evidence and protocol checks; scripted responses do not establish review quality. */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Commands from '@deepseek-ai/dsh-commands'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { reviewStage } from '../../src/reviewer.ts'
import { foldReviewJobs, REVIEW_NAMESPACE, reviewJobSchema, type ReviewJob } from '../../src/review-records.ts'
import { newTask } from '../../src/state.ts'
import { verificationPolicy } from '../../src/verification.ts'

function textResponse(text: string): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }]
}
function toolResponse(name: string, args: Record<string, unknown>): StreamChunk[] {
  const id = ToolCallId(randomUUID()), argumentsText = JSON.stringify(args)
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
}
class ScriptedAdapter extends LlmAdapter {
  constructor(readonly scripts: Record<string, StreamChunk[][]> = {}) { super() }
  override resolveModel(provider: string, model: string) { return Promise.resolve({ provider, id: model, name: model }) }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    for (const chunk of this.scripts[options.model]?.shift() ?? textResponse('No further decision')) yield chunk
  }
}
const contexts: Context[] = [], roots: string[] = []
afterEach(async () => {
  try { for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose() }
  finally { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) }
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-planning-review-')); roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjections)
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(Commands)
  await ctx.plugin(AgentRegistry); await ctx.plugin(JsonlPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(); ctx.llm.registerAdapter(['scripted'], adapter)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('planning-main'), agentOptions: { provider: 'scripted', model: 'main' } })
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '先调查原有入口，再拟定计划；尚未批准实施。' }] }))
  await agent.whenIdle()
  const seq = agent.session.snapshotEvents().find(event => event.type === 'user/message')!.seq
  return { ctx, agent, adapter, seq, root, task: newTask('先调查原有入口，再拟定计划；尚未批准实施。') }
}
const planning = { facts: ['用户要求先调查入口'], unknowns: ['入口的实现尚未核实'], nextAction: '读取现有入口并提交草案', progress: false }
const selected = { provider: 'scripted', model: 'reviewer' }

it.each(['pass', 'revise', 'needs-user'] as const)('records a %s planning decision without a DAG or artifact verification', async verdict => {
  const { ctx, agent, adapter, seq, task, root } = await fixture()
  const cutoff = agent.session.seq - 1
  adapter.scripts.reviewer = [toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }),
    toolResponse('task_review_decision', { verdict, finding: '下一步规划\n保持原要求，读取入口。', evidence_seqs: [seq], planning })]
  // A configured artifact runner must not be consulted during planning (no fs/subprocess in this Host).
  const verification = verificationPolicy({ storageRoot: root, container: { image: `sha256:${'a'.repeat(64)}`, context: 'unused', cpus: 1, memoryMiB: 1024, pids: 64 } })
  const result = await reviewStage(ctx, agent, task, 'planning', '尚无计划', new AbortController().signal, selected, 'planning', { verification })
  expect(result).toMatchObject({ verdict, planning, evidenceSeqs: [seq], cutoff })
  expect(task).toMatchObject({ phase: 'planning', everApproved: false, stages: [] })
  const records = agent.session.snapshotEvents().filter(event => event.type === 'extension/record' && event.data.namespace === REVIEW_NAMESPACE)
  expect(records.length).toBeGreaterThan(0)
  expect(records.every(event => event.type === 'extension/record' && event.data.schemaVersion === 3)).toBe(true)
  let jobs: ReviewJob[] = []
  for (const record of records) jobs = foldReviewJobs(jobs, record)
  expect(jobs[0]).toMatchObject({ kind: 'planning', nodeAttempt: null, status: 'submitted', decision: { planning } })
  expect(jobs[0]!.verification).toBeUndefined()
  const reader = await ctx.sessionPersistence.open(SessionId(result.reviewerSessionId), 'read')
  try {
    const events = (await reader.read(0, 256)).events
    const prompt = JSON.stringify(events.find(event => event.type === 'user/message'))
    expect(prompt).toContain('long reasoning')
    expect(prompt).toContain('None of these decisions approves implementation')
    expect(prompt).not.toContain('DAG execution semantics')
    expect(prompt).not.toContain('ARTIFACT-FIRST REVIEW')
    expect(events.some(event => event.type === 'tool/call' && event.data.name === 'read_task_evidence')).toBe(true)
  } finally { await reader.close() }
})

it.each([
  ['missing summary', undefined], ['missing unknowns', { facts: [], nextAction: '读入口', progress: false }],
  ['nonboolean progress', { ...planning, progress: 'yes' }], ['empty next action', { ...planning, nextAction: '' }],
  ['blank fact', { ...planning, facts: ['   '] }], ['oversized facts', { ...planning, facts: Array(21).fill('事实') }],
  ['oversized next action', { ...planning, nextAction: 'x'.repeat(2401) }],
] as const)('rejects %s instead of recording an unstructured planning pass', async (_label, value) => {
  const { ctx, agent, adapter, seq, task } = await fixture()
  adapter.scripts.reviewer = [toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }),
    toolResponse('task_review_decision', { verdict: 'pass', finding: '继续调查', evidence_seqs: [seq], ...value === undefined ? {} : { planning: value } })]
  await expect(reviewStage(ctx, agent, task, 'planning', 'raw summary', new AbortController().signal, selected, 'planning', { repairAttempts: 0 }))
    .rejects.toMatchObject({ fault: { code: 'decision-invalid' } })
  expect(agent.session.snapshotEvents().filter(event => event.type === 'extension/record' && event.data.namespace === REVIEW_NAMESPACE)
    .map(event => reviewJobSchema.parse(event.type === 'extension/record' ? event.data.payload : null)).every(job => job.decision === null)).toBe(true)
})

it('rejects planning facts when their cited main Session events were never read', async () => {
  const { ctx, agent, adapter, seq, task } = await fixture()
  adapter.scripts.reviewer = [toolResponse('read_task_context', { field: 'report' }),
    toolResponse('task_review_decision', { verdict: 'pass', finding: '继续调查', evidence_seqs: [seq], planning })]
  await expect(reviewStage(ctx, agent, task, 'planning', '主 Agent 声称已经调查完毕', new AbortController().signal, selected, 'planning', { repairAttempts: 0 }))
    .rejects.toMatchObject({ fault: { code: 'decision-invalid' } })
})

it('repairs a missing planning summary once in the same Session and evidence cutoff', async () => {
  const { ctx, agent, adapter, seq, task } = await fixture()
  const cutoff = agent.session.seq - 1
  adapter.scripts.reviewer = [toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }),
    toolResponse('task_review_decision', { verdict: 'pass', finding: '继续', evidence_seqs: [seq] }), textResponse('No structured summary'),
    toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }),
    toolResponse('task_review_decision', { verdict: 'pass', finding: '继续调查入口', evidence_seqs: [seq], planning })]
  const result = await reviewStage(ctx, agent, task, 'planning', '观察', new AbortController().signal, selected, 'planning')
  expect(result).toMatchObject({ cutoff, planning })
  const jobs = agent.session.snapshotEvents().filter(event => event.type === 'extension/record' && event.data.namespace === REVIEW_NAMESPACE)
    .map(event => reviewJobSchema.parse(event.type === 'extension/record' ? event.data.payload : null))
  expect(new Set(jobs.map(job => job.reviewerSessionId)).size).toBe(1)
  expect(jobs.at(-1)).toMatchObject({ attempt: 2, status: 'submitted' })
})

function job(kind: ReviewJob['kind'] = 'planning'): ReviewJob {
  const input = newTask('调查入口')
  return { id: randomUUID(), revision: 1, mainSessionId: 'main', taskId: input.id, taskRevision: input.revision,
    planVersion: 0, stageId: 'planning', nodeAttempt: null, kind, cutoff: 3, reviewerSessionId: 'reviewer', model: null,
    runtimeId: randomUUID(), status: 'submitted', attempt: 1, repairLimit: 1, startedAt: new Date().toISOString(), finishedAt: null,
    trigger: kind, input, evidence: '调查入口', fault: null,
    decision: { verdict: 'pass', finding: '继续调查', evidenceSeqs: [1], imageSeqs: [], decisionSeq: 10, ...kind === 'planning' ? { planning } : {} } }
}
function event(value: ReviewJob, version: number): SessionEvent {
  return { type: 'extension/record', seq: 4, time: 0, data: { namespace: REVIEW_NAMESPACE, schemaVersion: version,
    kind: 'job', recordId: `${value.id}:${value.revision}`, payload: JSON.parse(JSON.stringify(value)) } } as SessionEvent
}
it.each([1, 2])('does not accept planning under an old version %i record', version => {
  expect(() => foldReviewJobs([], event(job(), version))).toThrow('version 3')
})
it.each([1, 2, 3])('retains legacy decisions without forcing a planning summary at version %i', version => {
  expect(foldReviewJobs([], event(job('stage'), version))[0]?.kind).toBe('stage')
})
it('rejects planning records without a bound summary or with a fabricated node attempt', () => {
  const value = job()
  expect(reviewJobSchema.safeParse({ ...value, nodeAttempt: 1 }).success).toBe(false)
  expect(reviewJobSchema.safeParse({ ...value, decision: { ...value.decision, planning: undefined } }).success).toBe(false)
  expect(reviewJobSchema.safeParse({ ...value, decision: { ...value.decision, evidenceSeqs: [] } }).success).toBe(false)
  expect(reviewJobSchema.safeParse({ ...value, decision: { ...value.decision, evidenceSeqs: [4] } }).success).toBe(false)
  expect(reviewJobSchema.safeParse({ ...value, kind: 'stage' }).success).toBe(false)
})
