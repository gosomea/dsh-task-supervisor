import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Commands from '@deepseek-ai/dsh-commands'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
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

class PausingAdapter extends ScriptedAdapter {
  pauseNext = false
  pauseModel = 'scripted'
  entered = Promise.withResolvers<void>()
  release = Promise.withResolvers<void>()
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.pauseNext && options.model === this.pauseModel) {
      this.pauseNext = false
      this.entered.resolve()
      await this.release.promise
    }
    yield* super.stream(options)
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
  maxAutomaticRoundsWithoutReport = 3, planCoverageReview = false,
  planningReadTools: string[] = []): Promise<Context> {
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
  if (supervisor) await ctx.plugin(Supervisor, { planningReadTools, automaticContinuation,
    maxAutomaticRoundsWithoutReport, planCoverageReview,
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

it('replaces an unapproved plan before the human approves it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-plan-revision-'))
  roots.push(root)
  const ctx = await host(root, new ScriptedAdapter())
  const { agent } = await ctx.agents.create({ sessionId: SessionId('plan-revision-main'),
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  expect((await ctx.commands.execute(agent, '/task new Fix addition', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  const submit = (callId: string, stages: { id: string; title: string; criterionIds: string[] }[]) =>
    ctx.tools.execute({ callId: ToolCallId(callId), name: 'task_submit_plan', agent, signal,
      arguments: { criteria: [{ id: 'c1', text: 'Tests pass' }], stages } })
  expect((await submit('first-plan', [
    { id: 's1', title: 'Change code', criterionIds: ['c1'] },
    { id: 's2', title: 'Run tests', criterionIds: ['c1'] },
  ])).isError).toBe(false)
  expect(taskOf(ctx, agent)?.phase).toBe('awaiting-approval')
  expect((await submit('revised-plan', [
    { id: 's1', title: 'Change code and run tests', criterionIds: ['c1'] },
  ])).isError).toBe(false)
  const pending = taskOf(ctx, agent)
  expect(pending?.phase).toBe('awaiting-approval')
  expect(pending?.planVersion).toBe(2)
  expect(pending?.stages).toHaveLength(1)
  expect(pending?.approvedPlanVersion).toBeNull()
  expect((await ctx.commands.execute(agent, '/task approve', [], signal))?.result.kind).toBe('success')
  expect(taskOf(ctx, agent)?.approvedPlanVersion).toBe(2)
})

it('accepts a goal edit while an approved model turn is still running', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-live-edit-'))
  roots.push(root)
  const adapter = new PausingAdapter()
  const ctx = await host(root, adapter)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('live-edit-main'),
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  expect((await ctx.commands.execute(agent, '/task new Make count report', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect((await ctx.tools.execute({ callId: ToolCallId('live-edit-plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'c1', text: 'count report exists' }],
      stages: [{ id: 's1', title: 'Make report', criterionIds: ['c1'] }] } })).isError).toBe(false)
  adapter.pauseNext = true
  expect((await ctx.commands.execute(agent, '/task approve', [], signal))?.result.kind).toBe('success')
  await adapter.entered.promise
  const edit = ctx.commands.execute(agent, '/task edit Make count and max report', [], signal)
  await vi.waitFor(() => expect(taskOf(ctx, agent)?.requirementsVersion).toBe(2))
  expect(taskOf(ctx, agent)?.objective).toBe('Make count and max report')
  adapter.release.resolve()
  expect((await edit)?.result.kind).toBe('success')
  await agent.whenIdle()
  expect(taskOf(ctx, agent)?.phase).toBe('planning')
  expect(taskOf(ctx, agent)?.requirementsVersion).toBe(2)
  expect(taskOf(ctx, agent)?.planVersion).toBe(2)
})

it('invalidates an in-flight stage review when the user edits the objective', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-review-edit-'))
  roots.push(root)
  const adapter = new PausingAdapter({ main: [textResponse('ready'),
    toolResponse('task_report_stage', { stage_id: 's1', evidence: 'report generated' }, 'old-stage-report')] })
  adapter.pauseModel = 'reviewer'
  const ctx = await host(root, adapter, true, { provider: 'scripted', model: 'reviewer' })
  const { agent } = await ctx.agents.create({ sessionId: SessionId('review-edit-main'),
    agentOptions: { provider: 'scripted', model: 'main' } })
  const signal = new AbortController().signal
  expect((await ctx.commands.execute(agent, '/task new Make count report', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect((await ctx.tools.execute({ callId: ToolCallId('review-edit-plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'c1', text: 'count report exists' }],
      stages: [{ id: 's1', title: 'Make report', criterionIds: ['c1'] }] } })).isError).toBe(false)
  adapter.pauseNext = true
  expect((await ctx.commands.execute(agent, '/task approve', [], signal))?.result.kind).toBe('success')
  await adapter.entered.promise
  expect(taskOf(ctx, agent)?.phase).toBe('reviewing')
  const edit = ctx.commands.execute(agent, '/task edit Make count and max report', [], signal)
  await vi.waitFor(() => expect(taskOf(ctx, agent)?.requirementsVersion).toBe(2))
  adapter.release.resolve()
  expect((await edit)?.result.kind).toBe('success')
  await agent.whenIdle()
  expect(taskOf(ctx, agent)?.phase).toBe('planning')
  expect(taskOf(ctx, agent)?.objective).toBe('Make count and max report')
  expect(taskOf(ctx, agent)?.lastReview).toBeNull()
})

it('holds a plan with omitted objective constraints until independent coverage review passes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-plan-coverage-'))
  roots.push(root)
  const adapter = new ScriptedAdapter({ reviewer: [
    toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }, 'plan-read-1'),
    toolResponse('task_review_decision', { verdict: 'revise',
      finding: 'Add a criterion requiring a completed read-only turn before the write turn',
      evidence_seqs: [0] }, 'plan-revise'),
    toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }, 'plan-read-2'),
    toolResponse('task_review_decision', { verdict: 'pass',
      finding: 'All explicit constraints are now in acceptance criteria',
      evidence_seqs: [0] }, 'plan-pass'),
  ] })
  const ctx = await host(root, adapter, true, { provider: 'scripted', model: 'reviewer' }, false, 3, true)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('plan-coverage-main'),
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  expect((await ctx.commands.execute(agent,
    '/task new Read input.csv in one completed read-only turn; write report.json in a later turn', [], signal))?.result.kind)
    .toBe('success')
  await agent.whenIdle()
  const submit = (id: string, criteria: { id: string; text: string }[]) => ctx.tools.execute({
    callId: ToolCallId(id), name: 'task_submit_plan', agent, signal,
    arguments: { criteria, stages: [{ id: 's1', title: 'Read then write', criterionIds: criteria.map(c => c.id) }] },
  })
  const rejected = await submit('missing-order', [{ id: 'c1', text: 'report.json exists' }])
  expect(rejected.isError).toBe(false)
  expect(rejected.content.some(block => block.type === 'text' && block.text.includes('"verdict":"revise"'))).toBe(true)
  expect(taskOf(ctx, agent)?.phase).toBe('planning')
  expect(taskOf(ctx, agent)?.planVersion).toBe(0)
  const accepted = await submit('with-order', [
    { id: 'c1', text: 'report.json exists' },
    { id: 'c2', text: 'A completed read-only turn precedes the report write turn' },
  ])
  expect(accepted.isError).toBe(false)
  expect(taskOf(ctx, agent)?.phase).toBe('awaiting-approval')
  expect(taskOf(ctx, agent)?.lastReview?.stageId).toBe('plan')
  expect(taskOf(ctx, agent)?.lastReview?.reviewerSessionId).toMatch(/^task-review-/)
})

it('blocks writes until a completed post-approval read-only model turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-read-gate-'))
  roots.push(root)
  const adapter = new ScriptedAdapter({ scripted: [
    textResponse('plan first'),
    toolResponse('unsafe_write', {}, 'too-early-write'),
    toolResponse('read', {}, 'read-source'),
    textResponse('read-only turn complete'),
  ] })
  const ctx = await host(root, adapter, true, undefined, false, 3, false, ['read'])
  const { agent } = await ctx.agents.create({ sessionId: SessionId('read-gate-main'),
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  let writes = 0
  ctx.tools.register(defineContentToolFixture({ name: 'unsafe_write', description: 'mutate fixture', parameters: {},
    execute: async () => { writes++; return [{ type: 'text', text: 'written' }] } }))
  ctx.tools.register(defineContentToolFixture({ name: 'read', description: 'read fixture', parameters: {},
    execute: async () => [{ type: 'text', text: 'input.csv: alpha,3' }] }))
  const signal = new AbortController().signal
  expect((await ctx.commands.execute(agent, '/task new Read input.csv in one turn before writing', [], signal))?.result.kind)
    .toBe('success')
  await agent.whenIdle()
  expect((await ctx.tools.execute({ callId: ToolCallId('gate-plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'c1', text: 'Read-only turn precedes write' }],
      stages: [{ id: 's1', title: 'Read then write', criterionIds: ['c1'] }],
      read_only_turns_before_write: 1 } })).isError).toBe(false)
  expect((await ctx.commands.execute(agent, '/task approve', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  const events = agent.session.snapshotEvents()
  expect(events.some(event => event.type === 'tool/result' && event.data.message.source.callId === 'too-early-write'
    && event.data.message.isError === true)).toBe(true)
  expect(events.some(event => event.type === 'tool/result' && event.data.message.source.callId === 'read-source'
    && event.data.message.isError !== true)).toBe(true)
  expect(writes).toBe(0)
  const allowed = await ctx.tools.execute({ callId: ToolCallId('after-read-turn'),
    name: 'unsafe_write', agent, signal, arguments: {} })
  expect(allowed.isError).toBe(false)
  expect(writes).toBe(1)
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

it('clear withdraws queued Supervisor work but preserves pending human input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-clear-queued-'))
  roots.push(root)
  const ctx = await host(root, new ScriptedAdapter())
  const { agent } = await ctx.agents.create({ sessionId: SessionId('clear-queued-main'),
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  expect((await ctx.commands.execute(agent, '/task new Inspect the fixture', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  const task = taskOf(ctx, agent)!
  const owned = createUserMessage({ content: [{ type: 'text', text: 'stale continuation' }],
    source: { kind: 'task-supervisor', taskId: task.id, revision: task.revision } })
  const human = createUserMessage({ content: [{ type: 'text', text: 'new human instruction' }],
    source: { kind: 'user' } })
  agent.inbox.append('next-turn', owned)
  agent.inbox.append('next-turn', human)
  expect((await ctx.commands.execute(agent, '/task clear', [], signal))?.result.kind).toBe('success')
  expect(taskOf(ctx, agent)?.phase).toBe('cleared')
  expect(agent.inbox.nextTurn.map(message => message.id)).toEqual([human.id])
})

it('forked active tasks retain history but do not inherit execution authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-fork-'))
  roots.push(root)
  const ctx = await host(root, new ScriptedAdapter())
  const { agent } = await ctx.agents.create({ sessionId: SessionId('fork-parent'), meta: { cwd: root },
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  expect((await ctx.commands.execute(agent, '/task new Inspect the fixture', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect((await ctx.tools.execute({ callId: ToolCallId('fork-plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'c1', text: 'Fixture inspected' }],
      stages: [{ id: 's1', title: 'Inspect', criterionIds: ['c1'] }] } })).isError).toBe(false)
  expect((await ctx.commands.execute(agent, '/task approve', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  const seed = agent.session.snapshotEvents()
  const fork = await ctx.agents.create({ sessionId: SessionId('fork-child'),
    seed, inheritedEventCount: SessionLogOffset(seed.length),
    meta: { cwd: root, parentSession: agent.id, isSeeded: true },
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const inherited = taskOf(ctx, fork.agent)
  expect(inherited?.phase).toBe('active')
  expect(inherited?.id).toBe(taskOf(ctx, agent)?.id)
  expect((await ctx.commands.execute(fork.agent, '/task', [], signal))?.result.text).toContain('(waiting)')
  expect((await ctx.commands.execute(fork.agent, '/task resume', [], signal))?.result.kind).toBe('success')
  await fork.agent.whenIdle()
  expect((await ctx.commands.execute(fork.agent, '/task', [], signal))?.result.text).toContain('(armed)')
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
    meta: { cwd: root },
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
    expect(reviewerLog.header.cwd).toBe(root)
    expect(reviewerLog.header.parentSession).toBe(agent.id)
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
