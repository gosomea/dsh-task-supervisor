import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Commands from '@deepseek-ai/dsh-commands'
import LlmRuntime, { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import * as Supervisor from '../../src/index.ts'
import { appendTask, taskOf } from '../../src/state.ts'

class ScriptedAdapter extends LlmAdapter {
  requests = 0
  constructor(private readonly scripts: Record<string, StreamChunk[][]> = {}) { super() }
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests++
    const response = this.scripts[options.model]?.shift()
    if (response !== undefined) {
      for (const chunk of response) yield chunk
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ack' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ack' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function toolResponse(name: string, args: Record<string, unknown>, id: string): StreamChunk[] {
  const callId = ToolCallId(id)
  const serialized = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: serialized },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: serialized } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  try {
    for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  } finally {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  }
})

async function host(root: string, adapter: ScriptedAdapter, supervisor = true,
  reviewerModel?: { provider: string; model: string }, automaticContinuation = false,
  maxAutomaticRoundsWithoutReport = 3): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Commands)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(JsonlPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  if (supervisor) await ctx.plugin(Supervisor, { planningReadTools: [], automaticContinuation,
    maxAutomaticRoundsWithoutReport,
    ...reviewerModel === undefined ? {} : { reviewerModel } })
  ctx.llm.registerAdapter(['scripted'], adapter)
  return ctx
}

it('keeps one task in the native Session and resumes only after a human command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-prototype-'))
  roots.push(root)
  const id = SessionId('task-main')
  const adapter = new ScriptedAdapter()
  const first = await host(root, adapter)
  const { agent } = await first.agents.create({ sessionId: id, agentOptions: { provider: 'scripted', model: 'scripted' } })
  let unsafeCalls = 0
  first.tools.register(defineContentToolFixture({
    name: 'unsafe_write', description: 'test mutation', parameters: {},
    execute: async () => { unsafeCalls++; return [{ type: 'text', text: 'wrote' }] },
  }))
  const signal = new AbortController().signal
  const create = await first.commands.execute(agent, '/task new Build an import endpoint', [], signal)
  expect(create?.result.kind).toBe('success')
  await agent.whenIdle()
  expect(taskOf(first, agent)?.phase).toBe('planning')

  const denied = await first.tools.execute({
    callId: ToolCallId('blocked-write'), name: 'unsafe_write', arguments: {}, agent, signal,
  })
  expect(denied.isError).toBe(true)
  expect(unsafeCalls).toBe(0)

  const plan = await first.tools.execute({
    callId: ToolCallId('submit-plan'), name: 'task_submit_plan', agent, signal,
    arguments: {
      criteria: [{ id: 'c1', text: 'Import is persisted' }],
      stages: [{ id: 's1', title: 'Implement import', criterionIds: ['c1'] }],
    },
  })
  expect(plan.isError).toBe(false)
  expect(taskOf(first, agent)?.phase).toBe('awaiting-approval')
  expect((await first.commands.execute(agent, '/task approve', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect(taskOf(first, agent)?.phase).toBe('active')
  expect(adapter.requests).toBe(2)
  await first.fiber.dispose()
  contexts.splice(contexts.indexOf(first), 1)

  const withoutReader = await host(root, new ScriptedAdapter(), false)
  await expect(withoutReader.agents.resume({ resumeSessionId: id })).rejects.toThrow('compatible "dsh-task-supervisor" extension reader')
  await withoutReader.fiber.dispose()
  contexts.splice(contexts.indexOf(withoutReader), 1)

  const secondAdapter = new ScriptedAdapter()
  const second = await host(root, secondAdapter)
  const resumed = await second.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'scripted', model: 'scripted' } })
  await resumed.agent.whenIdle()
  expect(secondAdapter.requests).toBe(0)
  expect(taskOf(second, resumed.agent)?.phase).toBe('active')
  expect((await second.commands.execute(resumed.agent, '/task resume', [], signal))?.result.kind).toBe('success')
  await resumed.agent.whenIdle()
  expect(secondAdapter.requests).toBe(1)
})

it('automatically continues approved work and requests a progress decision at the configured interval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-drive-'))
  roots.push(root)
  const adapter = new ScriptedAdapter({ reviewer: [
    toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }, 'progress-read'),
    toolResponse('task_review_decision', { verdict: 'needs-user',
      finding: 'The endpoint requirement needs clarification', evidence_seqs: [0] }, 'progress-decision'),
  ] })
  const ctx = await host(root, adapter, true, { provider: 'scripted', model: 'reviewer' }, true, 2)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('drive-main'),
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  expect((await ctx.commands.execute(agent, '/task new Build import endpoint', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect((await ctx.tools.execute({ callId: ToolCallId('drive-plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'c1', text: 'Endpoint persists imports' }],
      stages: [{ id: 's1', title: 'Implement endpoint', criterionIds: ['c1'] }] } })).isError).toBe(false)
  expect((await ctx.commands.execute(agent, '/task approve', [], signal))?.result.kind).toBe('success')
  await vi.waitFor(() => expect(taskOf(ctx, agent)?.phase).toBe('paused'), { timeout: 5000 })
  expect(adapter.requests).toBe(6)
  expect(taskOf(ctx, agent)?.roundsSinceReview).toBe(0)
  expect(taskOf(ctx, agent)?.lastReview?.verdict).toBe('needs-user')
  expect(taskOf(ctx, agent)?.lastReview?.reviewerSessionId).toMatch(/^task-review-/)
  expect(agent.inbox.nextStep).toHaveLength(0)
  expect(agent.inbox.nextTurn).toHaveLength(0)
})

it('continues after a passing progress review and records both reviewer decisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-progress-pass-'))
  roots.push(root)
  const adapter = new ScriptedAdapter({ reviewer: [
    toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }, 'progress-pass-read'),
    toolResponse('task_review_decision', { verdict: 'pass',
      finding: 'Continue the implementation', evidence_seqs: [0] }, 'progress-pass-decision'),
    toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }, 'progress-stop-read'),
    toolResponse('task_review_decision', { verdict: 'needs-user',
      finding: 'Confirm the new requirement', evidence_seqs: [0] }, 'progress-stop-decision'),
  ] })
  const ctx = await host(root, adapter, true, { provider: 'scripted', model: 'reviewer' }, true, 1)
  const id = SessionId('progress-pass-main')
  const { agent } = await ctx.agents.create({ sessionId: id,
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  expect((await ctx.commands.execute(agent, '/task new Build import endpoint', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect((await ctx.tools.execute({ callId: ToolCallId('progress-plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'c1', text: 'Endpoint persists imports' }],
      stages: [{ id: 's1', title: 'Implement endpoint', criterionIds: ['c1'] }] } })).isError).toBe(false)
  expect((await ctx.commands.execute(agent, '/task approve', [], signal))?.result.kind).toBe('success')
  await vi.waitFor(() => expect(taskOf(ctx, agent)?.phase).toBe('paused'), { timeout: 5000 })
  expect(taskOf(ctx, agent)?.lastReview?.finding).toBe('Confirm the new requirement')
  expect(adapter.requests).toBeGreaterThan(7)
  const mainLog = await ctx.sessionPersistence.open(id, 'read')
  try {
    const persisted = await mainLog.read()
    const decisions = persisted.events.flatMap(event => event.type === 'extension/record'
      && event.data.namespace === 'dsh-task-supervisor' ? [JSON.stringify(event.data.payload)] : [])
    expect(decisions.some(record => record.includes('"verdict":"pass"'))).toBe(true)
    expect(decisions.some(record => record.includes('"verdict":"needs-user"'))).toBe(true)
  } finally {
    await mainLog.close()
  }
})

it('requires manual recovery of an interrupted review and retains its evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-interrupted-'))
  roots.push(root)
  const id = SessionId('interrupted-main')
  const first = await host(root, new ScriptedAdapter())
  const { agent } = await first.agents.create({ sessionId: id,
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  expect((await first.commands.execute(agent, '/task new Build import endpoint', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect((await first.tools.execute({ callId: ToolCallId('interrupted-plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'c1', text: 'Endpoint persists imports' }],
      stages: [{ id: 's1', title: 'Implement endpoint', criterionIds: ['c1'] }] } })).isError).toBe(false)
  expect((await first.commands.execute(agent, '/task approve', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  const active = taskOf(first, agent)!
  appendTask(first, agent, { ...active, revision: active.revision + 1, phase: 'reviewing',
    pendingReview: { kind: 'stage', stageId: 's1', evidence: 'fixture passed' } })
  expect(await first.sessions.flush(agent.session)).toBe(true)
  await first.fiber.dispose()
  contexts.splice(contexts.indexOf(first), 1)

  const adapter = new ScriptedAdapter()
  const second = await host(root, adapter)
  const resumed = await second.agents.resume({ resumeSessionId: id,
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  await resumed.agent.whenIdle()
  expect(adapter.requests).toBe(0)
  expect(taskOf(second, resumed.agent)?.pendingReview?.evidence).toBe('fixture passed')
  expect((await second.commands.execute(resumed.agent, '/task resume', [], signal))?.result.kind).toBe('success')
  await resumed.agent.whenIdle()
  expect(taskOf(second, resumed.agent)?.phase).toBe('active')
  expect(taskOf(second, resumed.agent)?.pendingReview).toBeNull()
  expect(taskOf(second, resumed.agent)?.lastReview?.verdict).toBe('needs-user')
  expect(adapter.requests).toBe(1)
})

it('turns the Supervisor off without discarding human input or silently rearming it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-off-'))
  roots.push(root)
  const adapter = new ScriptedAdapter()
  const ctx = await host(root, adapter)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('off-main'),
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  expect((await ctx.commands.execute(agent, '/task new Build endpoint', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect((await ctx.tools.execute({ callId: ToolCallId('off-plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'c1', text: 'Endpoint works' }],
      stages: [{ id: 's1', title: 'Implement', criterionIds: ['c1'] }] } })).isError).toBe(false)
  expect((await ctx.commands.execute(agent, '/task approve', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect(adapter.requests).toBe(2)
  expect((await ctx.commands.execute(agent, '/task off', [], signal))?.result.kind).toBe('success')
  expect(taskOf(ctx, agent)?.enabled).toBe(false)
  expect((await ctx.commands.execute(agent, '/task on', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect(adapter.requests).toBe(2)
  expect((await ctx.commands.execute(agent, '/task resume', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect(adapter.requests).toBe(3)
})

it('reviews a stage and final completion in fresh bounded reviewer Sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-review-'))
  roots.push(root)
  const adapter = new ScriptedAdapter({ scripted: [
    textResponse('planning turn'), textResponse('execution turn'),
    toolResponse('task_review_decision', { verdict: 'pass', finding: 'premature',
      evidence_seqs: [0] }, 'judge-before-reading'),
    toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }, 'read-stage'),
    toolResponse('task_review_decision', { verdict: 'pass', finding: 'stage supported', evidence_seqs: [0] }, 'judge-stage'),
    toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }, 'read-final'),
    toolResponse('task_review_decision', { verdict: 'pass', finding: 'all criteria supported', evidence_seqs: [0] }, 'judge-final'),
  ] })
  const ctx = await host(root, adapter)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('review-main'),
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  expect((await ctx.commands.execute(agent, '/task new Build import endpoint', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect((await ctx.tools.execute({ callId: ToolCallId('plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'c1', text: 'Endpoint persists imports' }],
      stages: [{ id: 's1', title: 'Implement endpoint', criterionIds: ['c1'] }] } })).isError).toBe(false)
  expect((await ctx.commands.execute(agent, '/task approve', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()

  const early = await ctx.tools.execute({ callId: ToolCallId('early'), name: 'task_request_completion', agent, signal,
    arguments: { evidence: 'too early' } })
  expect(early.isError).toBe(true)
  const stage = await ctx.tools.execute({ callId: ToolCallId('stage'), name: 'task_report_stage', agent, signal,
    arguments: { stage_id: 's1', evidence: 'Endpoint and persistence fixture passed' } })
  expect(stage.isError).toBe(false)
  const afterStage = taskOf(ctx, agent)
  expect(afterStage?.stageIndex).toBe(1)
  expect(afterStage?.lastReview?.reviewerSessionId).toMatch(/^task-review-/)
  expect(afterStage?.lastReview?.evidenceSeqs).toEqual([0])
  expect(afterStage?.lastReview?.model).toEqual({ provider: 'scripted', model: 'scripted' })
  const reviewerLog = await ctx.sessionPersistence.open(SessionId(afterStage!.lastReview!.reviewerSessionId!), 'read')
  try {
    const persisted = await reviewerLog.read()
    expect(persisted.events.filter(event => event.type === 'tool/call').map(event => event.data.name))
      .toEqual(['task_review_decision', 'read_task_evidence', 'task_review_decision'])
    const results = persisted.events.filter(event => event.type === 'tool/result')
    expect(results[0]?.data.message.isError).toBe(true)
    const evidenceResult = results[1]
    expect(evidenceResult?.data.message.content.some(block => block.type === 'text'
      && block.text.includes('"sessionId":"review-main"'))).toBe(true)
  } finally {
    await reviewerLog.close()
  }

  const final = await ctx.tools.execute({ callId: ToolCallId('final'), name: 'task_request_completion', agent, signal,
    arguments: { evidence: 'All accepted stages and criteria remain satisfied' } })
  expect(final.isError).toBe(false)
  expect(taskOf(ctx, agent)?.phase).toBe('complete')
  expect(taskOf(ctx, agent)?.lastReview?.stageId).toBe('completion')
  expect(adapter.requests).toBe(7)
})
