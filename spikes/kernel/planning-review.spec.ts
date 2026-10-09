import { controlEvent } from '../../src/session-records.ts'
import { installNativePresets } from './native-presets.ts'
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
import { reviewStage, reviewTruncationBoundary } from '../../src/reviewer.ts'
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
  readonly requests: GenerateOptions[] = []
  constructor(readonly scripts: Record<string, StreamChunk[][]> = {}) { super() }
  override resolveModel(provider: string, model: string) { return Promise.resolve({ provider, id: model, name: model }) }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
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
  await installNativePresets(ctx)
  const adapter = new ScriptedAdapter(); ctx.llm.registerAdapter(['scripted'], adapter)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('planning-main'), agentOptions: { provider: 'scripted', model: 'main' } })
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '先调查原有入口，再拟定计划；尚未批准实施。' }] }))
  await agent.whenIdle()
  const seq = agent.session.snapshotEvents().map(controlEvent).find(event => event.type === 'user/message')!.seq
  return { ctx, agent, adapter, seq, root, task: newTask('先调查原有入口，再拟定计划；尚未批准实施。') }
}
const planning = { facts: ['用户要求先调查入口'], unknowns: ['入口的实现尚未核实'], nextAction: '读取现有入口并提交草案', progress: false }
const selected = { provider: 'scripted', model: 'reviewer' }

it.each(['page', 'message'] as const)('admits original user input citations in a formal plan review: %s', async view => {
  const { ctx, agent, adapter, seq, task } = await fixture()
  adapter.scripts.reviewer = [toolResponse('read_task_input', view === 'page' ? { from_seq: seq } : { seq, offset: 0, chars: 6000 }),
    toolResponse('task_review_decision', { verdict: 'pass', finding: '原始要求已核对', evidence_seqs: [seq] })]
  const result = await reviewStage(ctx, agent, task, 'plan', 'submitted plan', new AbortController().signal, selected, 'plan', { repairAttempts: 0 })
  expect(result).toMatchObject({ verdict: 'pass', evidenceSeqs: [seq] })
  expect(result.planning).toBeUndefined()
  const tool = adapter.requests.find(request => request.model === 'reviewer')!.tools?.find(tool => tool.name === 'task_review_decision')
  expect(tool).toBeDefined()
  expect(JSON.stringify(tool)).not.toContain('"planning":')
})

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
  const records = agent.session.snapshotEvents().map(controlEvent).filter(event => event.type === 'extension/record' && event.data.namespace === REVIEW_NAMESPACE)
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
  expect(agent.session.snapshotEvents().map(controlEvent).filter(event => event.type === 'extension/record' && event.data.namespace === REVIEW_NAMESPACE)
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
  const jobs = agent.session.snapshotEvents().map(controlEvent).filter(event => event.type === 'extension/record' && event.data.namespace === REVIEW_NAMESPACE)
    .map(event => reviewJobSchema.parse(event.type === 'extension/record' ? event.data.payload : null))
  expect(new Set(jobs.map(job => job.reviewerSessionId)).size).toBe(1)
  expect(jobs.at(-1)).toMatchObject({ attempt: 2, status: 'submitted' })
})

function truncatedResponse(): StreamChunk[] {
  return [{ type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: '尚未形成完整审查决定' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: '尚未形成完整审查决定' } },
    { type: 'finish', reason: { kind: 'max-tokens' } }]
}

it.each(['planning', 'plan', 'stage'] as const)('repairs an actual reasoning-only max-tokens %s review in the original Session and cutoff', async kind => {
  const { ctx, agent, adapter, seq, task } = await fixture()
  const cutoff = agent.session.seq - 1
  adapter.scripts.reviewer = [truncatedResponse(), toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }),
    toolResponse('task_review_decision', { verdict: 'pass', finding: '证据核对完毕', evidence_seqs: [seq], ...kind === 'planning' ? { planning } : {} })]
  const decision = await reviewStage(ctx, agent, task, kind, '观察', new AbortController().signal, selected, kind)
  const records = agent.session.snapshotEvents().map(controlEvent).filter(event => event.type === 'extension/record' && event.data.namespace === REVIEW_NAMESPACE)
    .map(event => reviewJobSchema.parse(event.type === 'extension/record' ? event.data.payload : null))
  const repairs = records.filter(job => job.status === 'repairing')
  expect(repairs).toHaveLength(1)
  expect(repairs[0]).toMatchObject({ attempt: 2, fault: { code: 'protocol-missing' }, taskRevision: task.revision, cutoff })
  expect(repairs[0]!.fault?.message).toContain('max-tokens')
  expect(new Set(records.map(job => job.reviewerSessionId)).size).toBe(1)
  expect(new Set(records.map(job => job.deadlineAt)).size).toBe(1)
  expect(records.at(-1)).toMatchObject({ status: 'submitted', attempt: 2, cutoff })
  expect(decision.cutoff).toBe(cutoff)
  expect(task).toMatchObject({ phase: 'planning', everApproved: false, revision: 1 })
  const reader = await ctx.sessionPersistence.open(SessionId(decision.reviewerSessionId), 'read')
  try {
    const events = (await reader.read(0, 256)).events
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(2)
    expect(events.filter(event => event.type === 'turn/end').map(event => event.type === 'turn/end' && event.data.reason.kind)).toEqual(['max-tokens', 'completed'])
    const repair = JSON.stringify(events.filter(event => event.type === 'user/message').at(-1))
    expect(repair).toContain('actual latest native request reached its output limit')
    expect(repair).toContain('do not repeat long reasoning')
    expect(repair).toContain(`task revision ${task.revision} and cutoff ${cutoff}`)
    expect(repair).not.toContain('preserve the same snapshot and phase')
    expect(repair).not.toContain('record task_review_observations')
    expect(repair).not.toContain('Independent reviews also require criteria')
    if (kind !== 'planning') expect(repair).toContain('existing objective, acceptance criteria and original Session log evidence')
  } finally { await reader.close() }
})

it('retains already-read evidence across truncation rather than requiring duplicate reads', async () => {
  const { ctx, agent, adapter, seq, task } = await fixture()
  adapter.scripts.reviewer = [toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }), truncatedResponse(),
    toolResponse('task_review_decision', { verdict: 'revise', finding: '保留证据，缩小调查问题', evidence_seqs: [seq], planning })]
  const decision = await reviewStage(ctx, agent, task, 'planning', '观察', new AbortController().signal, selected, 'planning')
  const reader = await ctx.sessionPersistence.open(SessionId(decision.reviewerSessionId), 'read')
  try {
    const events = (await reader.read(0, 256)).events
    expect(events.filter(event => event.type === 'tool/call' && event.data.name === 'read_task_evidence')).toHaveLength(1)
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(2)
  } finally { await reader.close() }
})

it.each([0, 1, 2])('bounds truncated review repair to the configured %i extra attempts', async repairAttempts => {
  const { ctx, agent, adapter, task } = await fixture()
  adapter.scripts.reviewer = Array.from({ length: repairAttempts + 2 }, truncatedResponse)
  await expect(reviewStage(ctx, agent, task, 'planning', '观察', new AbortController().signal, selected, 'planning', { repairAttempts }))
    .rejects.toMatchObject({ fault: { code: 'protocol-missing', attempt: repairAttempts + 1 } })
  expect(adapter.requests.filter(request => request.model === 'reviewer')).toHaveLength(repairAttempts + 1)
  const jobs = agent.session.snapshotEvents().map(controlEvent).filter(event => event.type === 'extension/record' && event.data.namespace === REVIEW_NAMESPACE)
    .map(event => reviewJobSchema.parse(event.type === 'extension/record' ? event.data.payload : null))
  expect(jobs.at(-1)).toMatchObject({ status: 'failed', attempt: repairAttempts + 1, repairLimit: repairAttempts })
  expect(jobs.at(-1)!.fault?.message).toContain('native reason max-tokens')
})

it('does not use truncation to rescue a failed evidence tool', async () => {
  const { ctx, agent, adapter, task } = await fixture()
  adapter.scripts.reviewer = [toolResponse('read_task_text', { seq: 0 }), truncatedResponse(),
    toolResponse('read_task_evidence', { from_seq: 0, limit: 30 })]
  await expect(reviewStage(ctx, agent, task, 'planning', '观察', new AbortController().signal, selected, 'planning'))
    .rejects.toMatchObject({ fault: { code: 'evidence-read', attempt: 1 } })
  expect(adapter.requests.filter(request => request.model === 'reviewer')).toHaveLength(2)
})

it.each(['planning', 'plan', 'progress', 'stage', 'completion'] as const)('allows bounded %s decision repair after evidence reads recover', async kind => {
  const { ctx, agent, adapter, seq, task } = await fixture()
  const cutoff = agent.session.seq - 1
  adapter.scripts.reviewer = [
    toolResponse('read_task_text', { seq }),
    toolResponse('read_task_evidence_index', { from_seq: 0, limit: 60 }),
    toolResponse('read_task_evidence_index', { from_seq: 0, limit: 50 }),
    toolResponse('read_task_text', { seq }), textResponse('Inspection ended without a decision'),
    toolResponse('task_review_decision', { verdict: 'revise', finding: '继续核对要求', evidence_seqs: [seq],
      ...kind === 'planning' ? { planning } : {} }),
  ]
  const decision = await reviewStage(ctx, agent, task, kind, '观察', new AbortController().signal, selected, kind)
  expect(decision).toMatchObject({ verdict: 'revise', cutoff, evidenceSeqs: [seq] })
  const jobs = agent.session.snapshotEvents().map(controlEvent).filter(event => event.type === 'extension/record' && event.data.namespace === REVIEW_NAMESPACE)
    .map(event => reviewJobSchema.parse(event.type === 'extension/record' ? event.data.payload : null))
  expect(jobs.filter(job => job.status === 'repairing')).toHaveLength(1)
  expect(jobs.find(job => job.status === 'repairing')?.fault?.code).toBe('protocol-missing')
  expect(new Set(jobs.map(job => job.reviewerSessionId)).size).toBe(1)
  expect(new Set(jobs.map(job => job.deadlineAt)).size).toBe(1)
  const reader = await ctx.sessionPersistence.open(SessionId(decision.reviewerSessionId), 'read')
  try {
    const events = (await reader.read(0, 256)).events
    expect(events.filter(event => event.type === 'tool/result' && event.data.message.isError)).toHaveLength(2)
    expect(events.filter(event => event.type === 'tool/call' && event.data.name === 'read_task_text')).toHaveLength(2)
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(2)
  } finally { await reader.close() }
})

it('bounds text-only repair after a corrected read and retains the final protocol fault', async () => {
  const { ctx, agent, adapter, seq, task } = await fixture()
  adapter.scripts.reviewer = [toolResponse('read_task_text', { seq }),
    toolResponse('read_task_evidence_index', { from_seq: 0, limit: 50 }), toolResponse('read_task_text', { seq }),
    textResponse('No decision'), textResponse('Still no decision'), textResponse('Must not be requested')]
  await expect(reviewStage(ctx, agent, task, 'planning', '观察', new AbortController().signal, selected, 'planning'))
    .rejects.toMatchObject({ fault: { code: 'protocol-missing', attempt: 2 } })
  expect(adapter.requests.filter(request => request.model === 'reviewer')).toHaveLength(5)
})

it('does not turn an index-only read into valid decision evidence during repair', async () => {
  const { ctx, agent, adapter, seq, task } = await fixture()
  adapter.scripts.reviewer = [toolResponse('read_task_evidence_index', { from_seq: 0, limit: 50 }),
    textResponse('No decision'), toolResponse('task_review_decision', { verdict: 'pass', finding: 'Not actually read', evidence_seqs: [seq], planning }),
    textResponse('End')]
  await expect(reviewStage(ctx, agent, task, 'planning', '观察', new AbortController().signal, selected, 'planning'))
    .rejects.toMatchObject({ fault: { code: 'decision-invalid', attempt: 2, message: expect.stringContaining('task_review_decision result seq') } })
})

it.each(['blocked', 'aborted', 'error'] as const)('never repairs a native %s reviewer ending', async reason => {
  const { ctx, agent, adapter, task } = await fixture()
  if (reason === 'error') adapter.scripts.reviewer = [[{ type: 'finish', reason: { kind: 'error', failure: { code: 'TEST_PROVIDER', message: 'provider unavailable' } } }]]
  else ctx.on('agent/pre-step', async ({ agent: reviewer }, next) => {
    if (!reviewer.id.startsWith('task-review-')) return next()
    if (reason === 'blocked') return { kind: 'reject' }
    reviewer.cancel({ kind: 'parent' })
    return next()
  })
  await expect(reviewStage(ctx, agent, task, 'planning', '观察', new AbortController().signal, selected, 'planning'))
    .rejects.toMatchObject({ fault: { attempt: 1 } })
  const jobs = agent.session.snapshotEvents().map(controlEvent).filter(event => event.type === 'extension/record' && event.data.namespace === REVIEW_NAMESPACE)
    .map(event => reviewJobSchema.parse(event.type === 'extension/record' ? event.data.payload : null))
  expect(jobs.some(job => job.status === 'repairing')).toBe(false)
  expect(adapter.requests.filter(request => request.model === 'reviewer').length).toBeLessThanOrEqual(1)
  const reader = await ctx.sessionPersistence.open(SessionId(jobs.at(-1)!.reviewerSessionId!), 'read')
  try {
    const events = (await reader.read(0, 256)).events
    const ending = events.findLast(event => event.type === 'turn/end')
    expect(ending?.type === 'turn/end' && ending.data.reason.kind).toBe(reason)
  } finally { await reader.close() }
})

function reviewLog() {
  const events: SessionEvent[] = []
  function add(type: string, data: unknown) { events.push({ type, data, seq: events.length, time: events.length } as SessionEvent) }
  add('turn/start', { turn: 1 }); add('step/start', { turn: 1, step: 1 })
  const assistant = (step: number, reason: string) => add('assistant/message', { turn: 1, step,
    message: { role: 'assistant', content: [{ type: 'reasoning', text: '尚未完成' }], source: { provider: 'scripted', model: 'reviewer' } },
    stream: [{ type: 'chunk', time: 1, chunk: { type: 'finish', reason: { kind: reason } } }] })
  assistant(1, 'max-tokens'); add('step/end', { turn: 1, step: 1 }); add('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
  return { events, add, assistant }
}
it.each(['stop', 'tool-calls', 'error'])('requires the latest actual request to be truncated, not a sticky earlier turn marker before %s', reason => {
  const log = reviewLog(); expect(reviewTruncationBoundary(log.events)).toEqual({ endSeq: 4, turn: 1 })
  log.events.pop(); log.add('step/start', { turn: 1, step: 2 }); log.assistant(2, reason)
  log.add('step/end', { turn: 1, step: 2 }); log.add('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
  expect(reviewTruncationBoundary(log.events)).toBeNull()
})
it.each(['aborted', 'error', 'blocked', 'interrupted', 'completed'])('does not accept a forged max request with native %s ending', reason => {
  const log = reviewLog()
  log.events.pop(); log.add('turn/end', { turn: 1, reason: { kind: reason } })
  expect(reviewTruncationBoundary(log.events)).toBeNull()
})
it('rejects unsettled tool obligations even when the native step was closed', () => {
  const log = reviewLog(); log.events.splice(-2)
  log.add('tool/call', { turn: 1, step: 1, callId: 'unfinished', name: 'read_task_evidence', arguments: '{}' })
  log.add('step/end', { turn: 1, step: 1 }); log.add('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
  expect(reviewTruncationBoundary(log.events)).toBeNull()
})
it('rejects a declared tool call without a result even if it never became a native execution', () => {
  const log = reviewLog()
  const assistant = log.events.find(event => event.type === 'assistant/message')!
  if (assistant.type === 'assistant/message') assistant.data.message = { ...assistant.data.message,
    content: [...assistant.data.message.content, { type: 'tool-call', id: ToolCallId('not-started'), name: 'read_task_evidence', arguments: '{}' }] }
  expect(reviewTruncationBoundary(log.events)).toBeNull()
})
it('rejects settled tool effects after the purported final truncated response', () => {
  const log = reviewLog(); log.events.splice(-2)
  log.add('tool/call', { turn: 1, step: 1, callId: 'late', name: 'read_task_evidence', arguments: '{}' })
  log.add('tool/result', { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'late' }, content: [{ type: 'text', text: 'later success' }] } })
  log.add('step/end', { turn: 1, step: 1 }); log.add('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
  expect(reviewTruncationBoundary(log.events)).toBeNull()
})
it.each(['user/message', 'turn/start', 'step/start', 'assistant/attempt'])('rejects post-boundary %s activity', type => {
  const log = reviewLog(); log.add(type, { turn: 2, step: 1 })
  expect(reviewTruncationBoundary(log.events)).toBeNull()
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
