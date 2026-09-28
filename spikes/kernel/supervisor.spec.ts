import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import * as FsTools from '@deepseek-ai/dsh-tool-fs'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Commands from '@deepseek-ai/dsh-commands'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import * as Supervisor from '../../src/index.ts'
import { reviewStage } from '../../src/reviewer.ts'
import { validateProvenance } from '../../src/provenance.ts'
import { appendTask, taskOf, newTask } from '../../src/state.ts'

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
    vi.restoreAllMocks()
  }
})

async function host(root: string, adapter: ScriptedAdapter, supervisor = true,
  reviewerModel?: { provider: string; model: string }, automaticContinuation = false,
  maxAutomaticRoundsWithoutReport = 3, planCoverageReview = false,
  planningReadTools: string[] = [], extra: Supervisor.Config = {}): Promise<Context> {
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
    maxAutomaticRoundsWithoutReport, planCoverageReview, ...extra,
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
      criteria: [{ id: 'c1', text: 'Import is persisted', provenance: { kind: 'user', reference: 'objective' } }],
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
      arguments: { criteria: [{ id: 'c1', text: 'Tests pass', provenance: { kind: 'user', reference: 'objective' } }], stages } })
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
    arguments: { criteria: [{ id: 'c1', text: 'count report exists', provenance: { kind: 'user', reference: 'objective' } }],
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
    arguments: { criteria: [{ id: 'c1', text: 'count report exists', provenance: { kind: 'user', reference: 'objective' } }],
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
  const submit = (id: string, criteria: import('../../src/state.ts').TaskCriterion[]) => ctx.tools.execute({
    callId: ToolCallId(id), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: criteria.map(c => ({ ...c, provenance: { kind: 'user', reference: 'objective' } })), stages: [{ id: 's1', title: 'Read then write', criterionIds: criteria.map(c => c.id) }] },
  })
  const rejected = await submit('missing-order', [{ id: 'c1', text: 'report.json exists', provenance: { kind: 'user', reference: 'objective' } }])
  expect(rejected.isError).toBe(false)
  expect(rejected.content.some(block => block.type === 'text' && block.text.includes('"verdict":"revise"'))).toBe(true)
  expect(taskOf(ctx, agent)?.phase).toBe('planning')
  expect(taskOf(ctx, agent)?.planVersion).toBe(0)
  const accepted = await submit('with-order', [
    { id: 'c1', text: 'report.json exists', provenance: { kind: 'user', reference: 'objective' } },
    { id: 'c2', text: 'A completed read-only turn precedes the report write turn', provenance: { kind: 'user', reference: 'objective' } },
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
    arguments: { criteria: [{ id: 'c1', text: 'Read-only turn precedes write', provenance: { kind: 'user', reference: 'objective' } }],
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
    arguments: { criteria: [{ id: 'c1', text: 'Endpoint persists imports', provenance: { kind: 'user', reference: 'objective' } }],
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
    arguments: { criteria: [{ id: 'c1', text: 'Endpoint persists imports', provenance: { kind: 'user', reference: 'objective' } }],
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
    arguments: { criteria: [{ id: 'c1', text: 'Endpoint persists imports', provenance: { kind: 'user', reference: 'objective' } }],
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
  expect(taskOf(second, resumed.agent)?.lastReview?.verdict).not.toBe('needs-user')
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
    arguments: { criteria: [{ id: 'c1', text: 'Endpoint works', provenance: { kind: 'user', reference: 'objective' } }],
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
    arguments: { criteria: [{ id: 'c1', text: 'Fixture inspected', provenance: { kind: 'user', reference: 'objective' } }],
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
    arguments: { criteria: [{ id: 'c1', text: 'Endpoint persists imports', provenance: { kind: 'user', reference: 'objective' } }],
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

it('validates direct chat approval and rejects injected or stale authorization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-chat-approval-'))
  roots.push(root)
  const adapter = new ScriptedAdapter()
  const ctx = await host(root, adapter)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('chat-approval'),
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  await ctx.commands.execute(agent, '/task new 制作一个场景', [], signal)
  await agent.whenIdle()
  await ctx.tools.execute({ callId: ToolCallId('chat-plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'C1', text: '场景可运行', provenance: { kind: 'user', reference: 'objective' } }],
      stages: [{ id: 'S1', title: '实现场景', description: '构建并验证', criterionIds: ['C1'] }] } })
  const task = taskOf(ctx, agent)!
  const approve = (seq: number, version = task.planVersion) => ctx.tools.execute({
    callId: ToolCallId(`approval-${seq}-${version}`), name: 'task_approve', agent, signal,
    arguments: { task_id: task.id, plan_version: version, user_message_seq: seq } })
  expect((await approve(0)).isError).toBe(true)
  agent.followup(createUserMessage({ source: { kind: 'task-supervisor', taskId: task.id, revision: task.revision },
    content: [{ type: 'text', text: '批准' }] }))
  // The pre-step guard refuses injected approval without granting execution.
  await agent.whenIdle()
  expect(taskOf(ctx, agent)?.phase).toBe('awaiting-approval')
  // Clear the rejected injection so the actual human input can be claimed.
  for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) agent.inbox.remove(message.id)
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '批准' }] }))
  await agent.whenIdle()
  const user = agent.session.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')!
  expect((await approve(user.seq, task.planVersion + 1)).isError).toBe(true)
  const before = adapter.requests
  expect((await approve(user.seq)).isError).toBe(false)
  await agent.whenIdle()
  expect(taskOf(ctx, agent)?.phase).toBe('active')
  expect(taskOf(ctx, agent)?.lastApproval?.userMessageSeq).toBe(user.seq)
  expect(adapter.requests).toBe(before + 1)
  expect((await approve(user.seq)).isError).toBe(false)
  await agent.whenIdle()
  expect(adapter.requests).toBe(before + 1)
})

it('rejects version-bound controls after another control changes the task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-stale-action-'))
  roots.push(root)
  const ctx = await host(root, new ScriptedAdapter())
  const { agent } = await ctx.agents.create({ sessionId: SessionId('stale-action'),
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  await ctx.commands.execute(agent, '/task new Build scene', [], signal)
  await agent.whenIdle()
  const old = taskOf(ctx, agent)!
  expect((await ctx.commands.execute(agent, `/task pause ${old.id} ${old.revision}`, [], signal))?.result.kind).toBe('success')
  expect((await ctx.commands.execute(agent, `/task resume ${old.id} ${old.revision}`, [], signal))?.result.kind).toBe('error')
  expect(taskOf(ctx, agent)?.phase).toBe('paused')
})


it('hands off exactly one continuation after task_approve runs inside the model turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-live-approval-'))
  roots.push(root)
  let approval: (() => Record<string, unknown>) | undefined
  class ApprovalAdapter extends ScriptedAdapter {
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (approval !== undefined) {
        const args = approval()
        approval = undefined
        this.requests++
        yield* toolResponse('task_approve', args, 'live-approval')
      } else yield* super.stream(options)
    }
  }
  const adapter = new ApprovalAdapter()
  const ctx = await host(root, adapter)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('live-approval'),
    agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  await ctx.commands.execute(agent, '/task new 创建报告', [], signal)
  await agent.whenIdle()
  await ctx.tools.execute({ callId: ToolCallId('plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'C1', text: '报告可读', provenance: { kind: 'user', reference: 'objective' } }],
      stages: [{ id: 'S1', title: '创建报告', criterionIds: ['C1'] }] } })
  const task = taskOf(ctx, agent)!
  approval = () => ({ task_id: task.id, plan_version: task.planVersion,
    user_message_seq: agent.session.snapshotEvents().findLast(event => event.type === 'user/message'
      && event.data.source.kind === 'user')!.seq })
  const before = adapter.requests
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '批准当前计划' }] }))
  await agent.whenIdle()
  expect(taskOf(ctx, agent)?.phase).toBe('active')
  expect(adapter.requests).toBe(before + 2)
  const result = agent.session.snapshotEvents().find(event => event.type === 'tool/result'
    && event.data.message.source.callId === ToolCallId('live-approval'))
  expect(result).toBeDefined()
  expect(agent.inbox.nextTurn).toHaveLength(0)
})

it('pages full review evidence within its cutoff and rejects injected requirement sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-evidence-'))
  roots.push(root)
  const scripts: Record<string, StreamChunk[][]> = { main: [
    toolResponse('read', { path: 'AGENTS.md' }, 'long-read'), textResponse('inspected'),
  ] }
  const ctx = await host(root, new ScriptedAdapter(scripts), false)
  ctx.tools.register(defineContentToolFixture({ name: 'read', description: 'read fixture', parameters: { path: { type: 'string', required: true } },
    execute: async () => [{ type: 'text', text: 'OK\n'.repeat(700) + 'FAIL: required check did not pass' }] }))
  const { agent } = await ctx.agents.create({ sessionId: SessionId('evidence-main'), agentOptions: { provider: 'scripted', model: 'main' } })
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect project rules' }] }))
  await agent.whenIdle()
  const events = agent.session.snapshotEvents()
  const result = events.find(event => event.type === 'tool/result')!
  const user = events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
  expect(() => validateProvenance([{ id: 'c1', text: 'a project rule', provenance: { kind: 'project', reference: 'AGENTS.md', sourceSeq: result.seq } }], events)).not.toThrow()
  expect(() => validateProvenance([{ id: 'c1', text: 'a user rule', provenance: { kind: 'user', reference: 'read result', sourceSeq: result.seq } }], events)).toThrow('no valid user source')
  expect(() => validateProvenance([{ id: 'c1', text: 'a user rule', provenance: { kind: 'user', reference: 'Inspect project rules', sourceSeq: user.seq } }], events)).not.toThrow()
  scripts.reviewer = [
    toolResponse('read_task_text', { seq: result.seq }, 'before-page'),
    toolResponse('read_task_evidence', { from_seq: result.seq, limit: 1 }, 'first-page'),
    toolResponse('read_task_text', { seq: result.seq, offset: 700 }, 'tail'),
    toolResponse('read_task_evidence', { from_seq: 999999, limit: 30 }, 'future'),
    toolResponse('read_task_text', { seq: 999999 }, 'future-text'),
    toolResponse('read_task_context', { field: 'objective', offset: 6000 }, 'context-tail'),
    toolResponse('task_review_decision', { verdict: 'revise', finding: 'Failure found in the output tail', evidence_seqs: [result.seq] }, 'decision'),
  ]
  const decision = await reviewStage(ctx, agent, newTask('x'.repeat(6500) + 'Hard constraint at the end'), 's1', 'claimed success', new AbortController().signal,
    { provider: 'scripted', model: 'reviewer' })
  const reader = await ctx.sessionPersistence.open(SessionId(decision.reviewerSessionId), 'read')
  try {
    const outcomes = (await reader.read()).events.filter(event => event.type === 'tool/result')
    const output = (id: string) => outcomes.find(event => event.data.message.source.callId === id)!.data.message
    expect(output('before-page').isError).toBe(true)
    expect(JSON.stringify(output('first-page').content)).toContain('nextOffset')
    expect(JSON.stringify(output('tail').content)).toContain('FAIL: required check did not pass')
    expect(JSON.stringify(output('future').content)).toContain('\\"events\\":[]')
    expect(output('future-text').isError).toBe(true)
    expect(JSON.stringify(output('context-tail').content)).toContain('Hard constraint at the end')
  } finally { await reader.close() }
})

it('reviews independent DAG branches out of order without releasing an unfinished join', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-dag-'))
  roots.push(root)
  const ctx = await host(root, new ScriptedAdapter({ reviewer: [
    toolResponse('read_task_evidence', { from_seq: 0, limit: 1 }, 'b-read'),
    toolResponse('task_review_decision', { verdict: 'pass', finding: 'B accepted', evidence_seqs: [0] }, 'b-pass'),
    toolResponse('read_task_evidence', { from_seq: 0, limit: 1 }, 'a-read'),
    toolResponse('task_review_decision', { verdict: 'pass', finding: 'A accepted', evidence_seqs: [0] }, 'a-pass'),
  ] }), true, { provider: 'scripted', model: 'reviewer' })
  const { agent } = await ctx.agents.create({ sessionId: SessionId('dag-main'), agentOptions: { provider: 'scripted', model: 'main' } })
  const signal = new AbortController().signal
  await ctx.commands.execute(agent, '/task new Build two branches', [], signal)
  await agent.whenIdle()
  expect((await ctx.tools.execute({ name: 'task_submit_plan', callId: ToolCallId('dag-plan'), agent, signal, arguments: {
    criteria: [{ id: 'c', text: 'Integrated', provenance: { kind: 'user', reference: 'objective' } }],
    stages: [{ id: 'a', title: 'A', criterionIds: ['c'], dependsOn: [] },
      { id: 'b', title: 'B', criterionIds: ['c'], dependsOn: [] },
      { id: 'j', title: 'Join', criterionIds: ['c'], dependsOn: ['a', 'b'] }],
  } })).isError).toBe(false)
  await ctx.commands.execute(agent, '/task approve', [], signal)
  await agent.whenIdle()
  const report = (id: string, attempt = 1) => ctx.tools.execute({ name: 'task_report_stage', callId: ToolCallId(`report-${id}-${attempt}`), agent, signal,
    arguments: { stage_id: id, attempt, evidence: 'executed checks' } })
  expect((await report('j')).isError).toBe(true)
  expect((await report('b')).isError).toBe(false)
  expect(taskOf(ctx, agent)?.stageIndex).toBe(0)
  expect((await report('a')).isError).toBe(false)
  expect(taskOf(ctx, agent)?.stageIndex).toBe(2)
  expect((await ctx.tools.execute({ name: 'task_rework_node', callId: ToolCallId('rework-a'), agent, signal,
    arguments: { stage_id: 'a', reason: 'A interface changed' } })).isError).toBe(false)
  expect((await report('a', 1)).isError).toBe(true)
  expect(taskOf(ctx, agent)?.nodeRuns?.map(run => [run.id, run.attempt, run.status]))
    .toEqual([['a', 2, 'pending'], ['b', 1, 'passed'], ['j', 2, 'pending']])
})

it.each(['activity', 'elapsed'] as const)('observes %s inside one turn without accepting the node or adding a turn', async trigger => {
  let now = 100000
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-observe-'))
  roots.push(root)
  const adapter = new ScriptedAdapter({ main: [textResponse('plan'),
    toolResponse('read', {}, 'work-1'), toolResponse('read', {}, 'work-2'), textResponse('still productive')],
  reviewer: [toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }, 'observe-read'),
    toolResponse('task_review_decision', { verdict: 'pass', finding: 'Productive progress; continue', evidence_seqs: [0] }, 'observe-pass')] })
  const ctx = await host(root, adapter, true, { provider: 'scripted', model: 'reviewer' }, false, 3, false, ['read'], { observationToolCalls: trigger === 'activity' ? 2 : 999, observationIntervalMs: trigger === 'elapsed' ? 200 : 300000 })
  ctx.tools.register(defineContentToolFixture({ name: 'read', description: 'read progress fixture', parameters: {}, execute: async () => { now += 100; return [{ type: 'text', text: 'inspected next module' }] } }))
  const { agent } = await ctx.agents.create({ sessionId: SessionId('observe-main'), agentOptions: { provider: 'scripted', model: 'main' } })
  const signal = new AbortController().signal
  await ctx.commands.execute(agent, '/task new Inspect modules', [], signal)
  await agent.whenIdle()
  await ctx.tools.execute({ name: 'task_submit_plan', callId: ToolCallId('observe-plan'), agent, signal,
    arguments: { criteria: [{ id: 'c', text: 'Modules inspected', provenance: { kind: 'user', reference: 'objective' } }],
      stages: [{ id: 's', title: 'Inspect', criterionIds: ['c'] }] } })
  await ctx.commands.execute(agent, '/task approve', [], signal)
  await agent.whenIdle()
  expect(taskOf(ctx, agent)?.phase).toBe('active')
  expect(taskOf(ctx, agent)?.nodeRuns?.[0]?.status).toBe('pending')
  expect(taskOf(ctx, agent)?.lastReview?.finding).toBe('Productive progress; continue')
  expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(2)
  expect(agent.session.snapshotEvents().some(event => event.type === 'user/message'
    && event.data.content.some(block => block.type === 'text' && block.text.includes('Continue in this same turn')))).toBe(true)
  expect(adapter.requests).toBe(6)
  clock.mockRestore()
})

it('disabling the supervisor during an observation prevents the old reviewer from resuming the turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-observe-off-'))
  roots.push(root)
  const adapter = new PausingAdapter({ main: [textResponse('plan'), toolResponse('read', {}, 'one-read'), textResponse('must not execute')] })
  adapter.pauseModel = 'reviewer'
  const ctx = await host(root, adapter, true, { provider: 'scripted', model: 'reviewer' }, false, 3, false, ['read'], { observationToolCalls: 1 })
  ctx.tools.register(defineContentToolFixture({ name: 'read', description: 'read', parameters: {}, execute: async () => [{ type: 'text', text: 'ok' }] }))
  const { agent } = await ctx.agents.create({ sessionId: SessionId('observe-off-main'), agentOptions: { provider: 'scripted', model: 'main' } })
  const signal = new AbortController().signal
  await ctx.commands.execute(agent, '/task new Inspect modules', [], signal)
  await agent.whenIdle()
  await ctx.tools.execute({ name: 'task_submit_plan', callId: ToolCallId('off-plan'), agent, signal,
    arguments: { criteria: [{ id: 'c', text: 'Done', provenance: { kind: 'user', reference: 'objective' } }], stages: [{ id: 's', title: 'Inspect', criterionIds: ['c'] }] } })
  adapter.pauseNext = true
  await ctx.commands.execute(agent, '/task approve', [], signal)
  await adapter.entered.promise
  await ctx.commands.execute(agent, '/task off', [], signal)
  adapter.release.resolve()
  await agent.whenIdle()
  expect(taskOf(ctx, agent)?.enabled).toBe(false)
  expect(taskOf(ctx, agent)?.lastReview).toBeNull()
  expect(agent.inbox.nextStep).toHaveLength(0)
  expect(agent.inbox.nextTurn).toHaveLength(0)
  expect(agent.session.snapshotEvents().some(event => event.type === 'assistant/message'
    && event.data.message.content.some(block => block.type === 'text' && block.text === 'must not execute'))).toBe(false)
})


it.each(['image', 'text', 'stale'] as const)('admits native visual evidence only for capable routes and current attempts: %s', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-image-'))
  roots.push(root)
  const scripts: Record<string, StreamChunk[][]> = {}
  class ImageAdapter extends ScriptedAdapter {
    sawImage = false
    override resolveModel(provider: string, model: string) {
      return Promise.resolve({ provider, id: model, name: model, inputModalities: mode === 'text' ? ['text' as const] : ['text' as const, 'image' as const] })
    }
    override async *stream(options: GenerateOptions) {
      if (options.model === 'reviewer' && JSON.stringify(options.messages).includes('"type":"image"')) this.sawImage = true
      yield* super.stream(options)
    }
  }
  const adapter = new ImageAdapter(scripts)
  const ctx = await host(root, adapter, false)
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  const attachment = await ctx.attachments.saveImage({ mediaType: 'image/png', data: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64') })
  const { agent } = await ctx.agents.create({ sessionId: SessionId(`image-${mode}`), agentOptions: { provider: 'scripted', model: 'main' } })
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect this artifact' }, { type: 'image', attachment }] }))
  await agent.whenIdle()
  const seq = agent.session.snapshotEvents().find(event => event.type === 'user/message')!.seq
  const task = { ...newTask('Review visual quality'), criteria: [{ id: 'v', text: 'Image composition is correct', evidenceKind: 'visual' as const }],
    stages: [{ id: 's', title: 'Visual check', criterionIds: ['v'] }],
    nodeRuns: [{ id: 's', status: 'reviewing' as const, attempt: 1, evidenceAfterSeq: mode === 'stale' ? seq + 1 : seq }] }
  scripts.reviewer = [
    toolResponse('read_task_evidence', { from_seq: seq, limit: 1 }, 'read'),
    toolResponse('task_review_decision', { verdict: 'pass', finding: 'claim', evidence_seqs: [seq] }, 'premature-pass'),
    toolResponse('read_task_image', { seq, image_index: 0 }, 'image'),
    toolResponse('task_review_decision', { verdict: mode === 'image' ? 'pass' : 'needs-user', finding: 'Visual evidence capability checked', evidence_seqs: [seq] }, 'decision'),
  ]
  const decision = await reviewStage(ctx, agent, task, 's', 'review', new AbortController().signal, { provider: 'scripted', model: 'reviewer' })
  expect(decision.verdict).toBe(mode === 'image' ? 'pass' : 'needs-user')
  expect(decision.imageSeqs).toEqual(mode === 'image' ? [seq] : [])
  expect(adapter.sawImage).toBe(mode === 'image')
  const reader = await ctx.sessionPersistence.open(SessionId(decision.reviewerSessionId), 'read')
  try {
    const results = (await reader.read()).events.filter(event => event.type === 'tool/result')
    expect(results.find(event => event.data.message.source.callId === 'premature-pass')?.data.message.isError).toBe(true)
    expect(results.find(event => event.data.message.source.callId === 'image')?.data.message.isError).toBe(mode !== 'image')
  } finally { await reader.close() }
})


it('keeps native consultation questions read-only, deduplicates explicit controls, and restores its binding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-consult-'))
  roots.push(root)
  const scripts: Record<string, StreamChunk[][]> = { main: [textResponse('planning')] }
  const ctx = await host(root, new ScriptedAdapter(scripts), true, { provider: 'scripted', model: 'consult' })
  const { agent: main } = await ctx.agents.create({ sessionId: SessionId('consult-main'), agentOptions: { provider: 'scripted', model: 'main' } })
  const signal = new AbortController().signal
  await ctx.commands.execute(main, '/task new 实现一个模块', [], signal)
  await main.whenIdle()
  const before = taskOf(ctx, main)!
  await ctx.commands.execute(main, '/task consult', [], signal)
  const chatId = SessionId(`task-chat-${main.id}-${before.id}`)
  const chat = ctx.agents.get(chatId)!
  expect(ctx.tools.get('supervisor_read_status', main)).toBeUndefined()
  expect(ctx.tools.get('supervisor_read_status', chat)).toBeDefined()
  expect(ctx.tools.get('task_delegate_nodes', chat)).toBeUndefined()
  scripts.consult = [toolResponse('supervisor_read_status', {}, 'status'), textResponse('目前在规划中。')]
  chat.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '进展如何？' }] }))
  await chat.whenIdle()
  expect(taskOf(ctx, main)).toEqual(before)
  expect(main.inbox.nextTurn).toHaveLength(0)
  const questionSeq = chat.session.snapshotEvents().find(e => e.type === 'user/message' && e.data.source.kind === 'user')!.seq
  const call = (id: string, userSeq: number, revision: number) => ctx.tools.execute({ agent: chat, signal,
    callId: ToolCallId(id), name: 'supervisor_control', arguments: { directive: 'pause', user_seq: userSeq, revision } })
  expect((await call('question-not-control', questionSeq, before.revision)).isError).toBe(true)
  chat.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '暂停任务' }] }))
  await chat.whenIdle()
  const userSeq = [...chat.session.snapshotEvents()].reverse().find(e => e.type === 'user/message' && e.data.source.kind === 'user')!.seq
  expect((await call('stale-control', userSeq, before.revision + 99)).isError).toBe(true)
  expect((await call('pause-control', userSeq, before.revision)).isError).toBe(false)
  expect(taskOf(ctx, main)?.phase).toBe('paused')
  const paused = taskOf(ctx, main)!
  expect((await call('duplicate', userSeq, before.revision)).isError).toBe(false)
  expect(taskOf(ctx, main)).toEqual(paused)
  const commands = main.session.snapshotEvents().filter(e => e.type === 'command/run' && e.data.args?.trim().startsWith('pause'))
  expect(commands).toHaveLength(1)
  await ctx.fiber.dispose(); contexts.splice(contexts.indexOf(ctx), 1)
  const resumed = await host(root, new ScriptedAdapter())
  const mainAgain = await resumed.agents.resume({ resumeSessionId: main.id, agentOptions: { provider: 'scripted', model: 'main' } })
  await resumed.commands.execute(mainAgain.agent, '/task consult', [], signal)
  const chatAgain = resumed.agents.get(chatId)!
  expect(chatAgain.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'user')).toHaveLength(2)
  chatAgain.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '现在如何？' }] }))
  await chatAgain.whenIdle()
  expect(taskOf(resumed, mainAgain.agent)).toEqual(paused)
  expect(mainAgain.agent.inbox.nextTurn).toHaveLength(0)
})

it('routes consultation task commands to the bound main Session and rejects stale conversations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-consult-commands-'))
  roots.push(root)
  const ctx = await host(root, new ScriptedAdapter())
  const { agent: main } = await ctx.agents.create({ sessionId: SessionId('consult-commands-main'),
    agentOptions: { provider: 'scripted', model: 'main' } })
  const signal = new AbortController().signal
  await ctx.commands.execute(main, '/task new Inspect the directory', [], signal)
  await main.whenIdle()
  await ctx.commands.execute(main, '/task consult', [], signal)
  const first = taskOf(ctx, main)!
  const chat = ctx.agents.get(SessionId(`task-chat-${main.id}-${first.id}`))!

  expect((await ctx.commands.execute(chat, '/task', [], signal))?.result.text).toContain(first.id)
  expect((await ctx.commands.execute(chat, '/task pause', [], signal))?.result.kind).toBe('success')
  expect(taskOf(ctx, main)?.phase).toBe('paused')

  const paused = taskOf(ctx, main)!
  appendTask(ctx, main, { ...paused, revision: paused.revision + 1, phase: 'complete' })
  expect((await ctx.commands.execute(chat, '/task new Report the Node version', [], signal))?.result.kind).toBe('success')
  const second = taskOf(ctx, main)!
  expect(second.id).not.toBe(first.id)
  expect(second.objective).toBe('Report the Node version')
  expect((await ctx.commands.execute(chat, '/task pause', [], signal))?.result).toMatchObject({ kind: 'error' })
  expect(taskOf(ctx, main)?.id).toBe(second.id)
})


it.each(['complete', 'off', 'empty'])('runs disjoint native workers with file ownership and integration gating: %s', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-workers-')); roots.push(root)
  const bothEntered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>()
  const counts = new Map<string, number>()
  const scripts: Record<string, StreamChunk[][]> = {}
  class WorkerAdapter extends ScriptedAdapter {
    override async *stream(options: GenerateOptions) {
      const node = options.model === 'reviewer' ? undefined : /Execute only node (a|b):/u.exec(JSON.stringify(options.messages))?.[1]
      if (!node) { yield* super.stream(options); return }
      const step = counts.get(node) ?? 0; counts.set(node, step + 1)
      if (step === 0) { if (counts.size === 2) bothEntered.resolve(); await release.promise }
      const chunks = step === 0 && node === 'a'
        ? toolResponse('write', { file_path: 'b.txt', content: 'foreign overwrite' }, 'foreign')
        : step < (node === 'a' ? 2 : 1)
        ? toolResponse('write', { file_path: `${node}.txt`, content: node.toUpperCase() }, `write-${node}`)
        : node === 'b' ? textResponse(mode === 'empty' ? '' : 'b.txt produced; needs main integration')
        : toolResponse('task_worker_done', { report: `${node}.txt produced; needs main integration` }, `done-${node}`)
      for (const chunk of chunks) yield chunk
    }
  }
  const ctx = await host(root, new WorkerAdapter(scripts), true, { provider: 'scripted', model: 'reviewer' })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  ctx.tools.register(defineContentToolFixture({ name: 'bash', description: 'integration fixture', parameters: {}, execute: async () => {
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('A'); expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('B')
    return [{ type: 'text', text: 'A + B integration passed' }]
  } }))
  const { agent: main } = await ctx.agents.create({ sessionId: SessionId('worker-main'), meta: { cwd: root }, agentOptions: { provider: 'scripted', model: 'main' },
    async setup(agentCtx) { await agentCtx.plugin(FsTools, {}) } })
  expect(ctx.tools.get('write')).toBeUndefined()
  expect(ctx.tools.get('write', main)).toBeDefined()
  const signal = new AbortController().signal
  const task = { ...newTask('Create A and B and integrate'), phase: 'active' as const, planVersion: 1, approvedPlanVersion: 1, everApproved: true,
    criteria: [{ id: 'c', text: 'A and B integrate' }], stages: [
      { id: 'a', title: 'A', criterionIds: ['c'], dependsOn: [], writePaths: ['a.txt'] },
      { id: 'b', title: 'B', criterionIds: ['c'], dependsOn: [], writePaths: ['a.txt'] },
      { id: 'join', title: 'Integrate', criterionIds: ['c'], dependsOn: ['a', 'b'] },
    ] }
  appendTask(ctx, main, task)
  await ctx.commands.execute(main, '/task resume', [], signal); await main.whenIdle()
  const delegate = () => ctx.tools.execute({ agent: main, signal, callId: ToolCallId('delegate'), name: 'task_delegate_nodes', arguments: { node_ids: ['a', 'b'] } })
  expect((await delegate()).isError).toBe(true)
  const latest = taskOf(ctx, main)!
  appendTask(ctx, main, { ...latest, revision: latest.revision + 1, stages: latest.stages.map(stage => stage.id === 'b' ? { ...stage, writePaths: ['b.txt'] } : stage) })
  let batch: Promise<{ isError?: boolean }>
  if (mode === 'empty') {
    scripts.main = [toolResponse('task_delegate_nodes', { node_ids: ['a', 'b'] }, 'batch-in-turn'), textResponse('must not retry after pause')]
    main.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Execute approved nodes' }] }))
    batch = main.whenIdle().then(() => ({ isError: main.session.snapshotEvents().some(e => e.type === 'tool/result'
      && e.data.message.source.callId === 'batch-in-turn' && e.data.message.isError) }))
  } else batch = delegate()
  await Promise.race([bothEntered.promise, batch.then(result => { throw new Error(`batch ended before both workers entered: ${JSON.stringify(result)}`) })])
  expect(taskOf(ctx, main)?.nodeRuns?.filter(run => run.status === 'running')).toHaveLength(2)
  if (mode === 'off') await ctx.commands.execute(main, '/task off', [], signal)
  release.resolve()
  if (mode === 'off') {
    expect((await batch).isError).toBe(true)
    expect(taskOf(ctx, main)?.enabled).toBe(false)
    expect(main.inbox.nextTurn).toHaveLength(0)
    await expect(readFile(join(root, 'a.txt'))).rejects.toThrow()
    await expect(readFile(join(root, 'b.txt'))).rejects.toThrow()
    return
  }
  if (mode === 'empty') {
    expect((await batch).isError).toBe(true)
    expect(taskOf(ctx, main)?.phase).toBe('paused')
    expect(main.inbox.nextTurn).toHaveLength(0)
    expect(scripts.main).toHaveLength(1)
    scripts.main = [textResponse('Paused; waiting for your explicit resume.')]
    main.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Why did it pause?' }] }))
    await main.whenIdle()
    expect(scripts.main).toHaveLength(0)
    expect(taskOf(ctx, main)?.phase).toBe('paused')
    return
  }
  expect((await batch).isError).toBe(false)
  const settled = taskOf(ctx, main)!
  expect(settled.nodeRuns?.filter(run => run.status === 'awaiting-integration')).toHaveLength(2)
  expect(settled.nodeRuns?.find(run => run.id === 'join')?.status).toBe('pending')
  const run = settled.nodeRuns!.find(run => run.id === 'a')!
  const workerLog = await ctx.sessionPersistence.open(SessionId(run.sessionId!), 'read')
  try { const events = (await workerLog.read()).events
    expect(events.find(e => e.type === 'tool/result' && e.data.message.source.callId === 'foreign')).toMatchObject({ data: { message: { isError: true } } })
  } finally { await workerLog.close() }
  const report = () => ctx.tools.execute({ agent: main, signal, callId: ToolCallId('report-a'), name: 'task_report_stage', arguments: { stage_id: 'a', attempt: 1, evidence: 'A and B integration passed in main Session' } })
  expect((await report()).isError).toBe(true)
  scripts.main = [toolResponse('bash', {}, 'integration'), textResponse('integrated')]
  main.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Integrate outputs' }] })); await main.whenIdle()
  const result = main.session.snapshotEvents().find(e => e.type === 'tool/result' && e.data.message.source.callId === 'integration')!
  scripts.reviewer = [toolResponse('read_task_evidence', { from_seq: result.seq, limit: 1 }, 'main-check'),
    toolResponse('task_review_decision', { verdict: 'pass', finding: 'premature', evidence_seqs: [result.seq] }, 'no-worker'),
    toolResponse('read_task_worker', { node_id: 'a', from_seq: 0, limit: 30 }, 'worker-check'),
    toolResponse('task_review_decision', { verdict: 'pass', finding: 'A output independently read with main integration', evidence_seqs: [result.seq] }, 'accept')]
  expect((await report()).isError).toBe(false)
  expect(taskOf(ctx, main)?.nodeRuns?.find(run => run.id === 'a')?.status).toBe('passed')
  expect(taskOf(ctx, main)?.nodeRuns?.find(run => run.id === 'join')?.status).toBe('pending')
})

it('keeps the supervised DAG authoritative without disabling ordinary-session todos', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-todo-')); roots.push(root)
  const ctx = await host(root, new ScriptedAdapter())
  const { agent } = await ctx.agents.create({ sessionId: SessionId('todo-ownership'), agentOptions: { provider: 'scripted', model: 'main' } })
  let calls = 0
  ctx.tools.register(defineContentToolFixture({ name: 'todo_write', description: 'native checklist fixture', parameters: {},
    execute: async () => { calls++; return [{ type: 'text', text: 'updated' }] } }))
  const run = () => ctx.tools.execute({ agent, name: 'todo_write', callId: ToolCallId(`todo-${calls}`), arguments: {}, signal: new AbortController().signal })
  expect((await run()).isError).toBe(false)
  appendTask(ctx, agent, { ...newTask('Implement a supervised feature'), phase: 'active' })
  expect((await run()).isError).toBe(true)
  expect(calls).toBe(1)
  const task = taskOf(ctx, agent)!
  appendTask(ctx, agent, { ...task, revision: task.revision + 1, phase: 'cleared' })
  expect((await run()).isError).toBe(false)
  expect(calls).toBe(2)
})

it.each(['text', 'unexpected-tool'])('preserves one native answer after a checkpoint without further execution: %s', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-answer-')); roots.push(root)
  const scripts = { main: [toolResponse('task_submit_plan', {
    criteria: [{ id: 'c1', text: 'Create one file', provenance: { kind: 'user', reference: 'objective' } }],
    stages: [{ id: 's1', title: '创建文件', criterionIds: ['c1'] }],
  }, 'submit'), mode === 'text' ? textResponse('## 计划已就绪\n请批准后开始。') : toolResponse('unsafe_write', {}, 'must-not-write'),
  textResponse('must not consume a third step')] }
  const requests: GenerateOptions[] = []
  class AnswerAdapter extends ScriptedAdapter {
    override async *stream(options: GenerateOptions) { requests.push(options); yield* super.stream(options) }
  }
  const ctx = await host(root, new AnswerAdapter(scripts))
  let writes = 0
  ctx.tools.register(defineContentToolFixture({ name: 'unsafe_write', description: 'must not run', parameters: {},
    execute: async () => { writes++; return [{ type: 'text', text: 'write' }] } }))
  const { agent } = await ctx.agents.create({ sessionId: SessionId('native-answer'), agentOptions: { provider: 'scripted', model: 'main' } })
  appendTask(ctx, agent, newTask('Create one file'))
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '先制定计划' }] }))
  await agent.whenIdle()
  expect(requests).toHaveLength(2)
  expect(requests[1]?.tools ?? []).toHaveLength(0)
  expect(writes).toBe(0)
  expect(scripts.main).toHaveLength(1)
  expect(taskOf(ctx, agent)?.phase).toBe('awaiting-approval')
  if (mode === 'text') expect(agent.session.snapshotEvents().some(e => e.type === 'assistant/message'
    && e.data.message.content.some(block => block.type === 'text' && block.text === '## 计划已就绪\n请批准后开始。'))).toBe(true)
  scripts.main = [textResponse('仍在等待批准')]
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '现在进度如何' }] }))
  await agent.whenIdle()
  expect(scripts.main).toHaveLength(0)
  expect(requests[2]?.tools?.some(tool => tool.name === 'task_status')).toBe(true)
})

it('offers native completion tools immediately after the final stage review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-final-stage-')); roots.push(root)
  const mainRequests: GenerateOptions[] = []
  const rawCall = '<｜｜DSML｜｜ invoke name="task_request_completion">'
  class CompletionAdapter extends ScriptedAdapter {
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (options.model !== 'main') { yield* super.stream(options); return }
      mainRequests.push(options)
      const turn = mainRequests.length
      const response = turn === 1 ? textResponse('计划准备完成')
        : turn === 2 ? toolResponse('task_report_stage', {
          stage_id: 's1', evidence: '目标文件已创建并检查',
        }, 'report-final-stage')
        : turn === 3 && !options.tools?.some(tool => tool.name === 'task_request_completion')
          ? textResponse(rawCall)
          : turn <= 4 && options.tools?.some(tool => tool.name === 'task_request_completion')
            ? toolResponse('task_request_completion', { evidence: '唯一节点通过，文件内容已核对' }, `complete-${turn}`)
            : textResponse('## 任务完成\n整体审查通过。')
      for (const chunk of response) yield chunk
    }
  }
  const adapter = new CompletionAdapter({ reviewer: [
    toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }, 'read-stage'),
    toolResponse('task_review_decision', { verdict: 'pass', finding: '节点证据充分', evidence_seqs: [0] }, 'pass-stage'),
    toolResponse('read_task_evidence', { from_seq: 0, limit: 30 }, 'read-completion'),
    toolResponse('task_review_decision', { verdict: 'pass', finding: '整体证据充分', evidence_seqs: [0] }, 'pass-completion'),
  ] })
  const ctx = await host(root, adapter, true, { provider: 'scripted', model: 'reviewer' }, true)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('final-stage-transition'),
    agentOptions: { provider: 'scripted', model: 'main' } })
  const signal = new AbortController().signal
  expect((await ctx.commands.execute(agent, '/task new 创建并验证目标文件', [], signal))?.result.kind).toBe('success')
  await agent.whenIdle()
  expect((await ctx.tools.execute({ callId: ToolCallId('submit-final-stage-plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'c1', text: '目标文件已验证', provenance: { kind: 'user', reference: 'objective' } }],
      stages: [{ id: 's1', title: '创建并验证', criterionIds: ['c1'] }] } })).isError).toBe(false)
  expect((await ctx.commands.execute(agent, '/task approve', [], signal))?.result.kind).toBe('success')
  await vi.waitFor(() => expect(taskOf(ctx, agent)?.phase).toBe('complete'), { timeout: 10000 })
  await agent.whenIdle()
  expect(mainRequests).toHaveLength(4)
  expect(mainRequests[2]?.tools?.some(tool => tool.name === 'task_request_completion')).toBe(true)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')
    .flatMap(event => event.data.message.content)
    .some(block => block.type === 'text' && block.text.includes(rawCall))).toBe(false)
})

it.each(['plan', 'stage', 'progress', 'completion'] as const)('retains the immutable %s review identity on missing protocol', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-review-fault-'))
  roots.push(root)
  const ctx = await host(root, new ScriptedAdapter(), true, { provider: 'scripted', model: 'reviewer' })
  const { agent } = await ctx.agents.create({ sessionId: SessionId(`fault-${kind}`), agentOptions: { provider: 'scripted', model: 'scripted' } })
  const cutoff = agent.session.seq - 1
  const task = newTask('只读核对，不修改文件')
  await expect(reviewStage(ctx, agent, task, kind === 'plan' ? 'plan' : 's1', 'report', new AbortController().signal,
    { provider: 'scripted', model: 'reviewer' }, kind)).rejects.toMatchObject({ fault: { code: 'protocol-missing', cutoff, attempt: 1, outcomeKnown: true } })
  const projection = ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')!
  expect(projection.failure).toBeNull()
  expect(projection.reviews).toEqual([])
  expect(projection.reviewJobs).toHaveLength(1)
  const job = projection.reviewJobs[0]!
  expect(job).toMatchObject({ status: 'failed', cutoff, taskId: task.id, taskRevision: 1,
    kind, model: { provider: 'scripted', model: 'reviewer' }, fault: { reviewerSessionId: job.reviewerSessionId } })
  expect(await ctx.sessionPersistence.stat(SessionId(job.reviewerSessionId!))).toBeDefined()
  // Replay uses the same reader as cold UI state, independently of live projection memory.
  const { taskProjection } = await import('../../src/state.ts')
  const replayed = agent.session.snapshotEvents().reduce(taskProjection.apply, taskProjection.init())
  expect(replayed.reviewJobs).toEqual(projection.reviewJobs)
})

it.each([false, true])('pauses a failed review without inventing a user decision (plan=%s)', async plan => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-review-classification-'))
  roots.push(root)
  const ctx = await host(root, new ScriptedAdapter(), true, { provider: 'scripted', model: 'reviewer' }, false, 3, plan)
  const { agent } = await ctx.agents.create({ sessionId: SessionId(`classification-${plan}`), agentOptions: { provider: 'scripted', model: 'scripted' } })
  const signal = new AbortController().signal
  await ctx.commands.execute(agent, '/task new Inspect the fixture', [], signal)
  await agent.whenIdle()
  const result = await ctx.tools.execute({ callId: ToolCallId('fault-plan'), name: 'task_submit_plan', agent, signal,
    arguments: { criteria: [{ id: 'c', text: 'Inspect the fixture', provenance: { kind: 'user', reference: 'objective' } }],
      stages: [{ id: 's', title: 'Inspect', criterionIds: ['c'] }] } })
  if (!plan) {
    expect(result.isError).toBe(false)
    await ctx.commands.execute(agent, '/task approve', [], signal)
    await agent.whenIdle()
    const report = await ctx.tools.execute({ callId: ToolCallId('fault-report'), name: 'task_report_stage', agent, signal,
      arguments: { stage_id: 's', evidence: 'The fixture was inspected' } })
    expect(report.isError).toBe(true)
  } else expect(result.isError).toBe(true)
  expect(taskOf(ctx, agent)).toMatchObject({ phase: 'paused', pauseReason: 'review-fault', lastReview: null,
    reviewFault: { code: 'protocol-missing', reviewerSessionId: expect.stringMatching(/^task-review-/u) } })
})
