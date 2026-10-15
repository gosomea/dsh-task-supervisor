/** Real Team and reviewer lifecycles; scripted decisions establish isolation, not review quality. */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Commands from '@deepseek-ai/dsh-commands'
import LlmRuntime, { LlmAdapter, LlmError, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import Subagents, { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import TeamService, { TeamError } from '@deepseek-ai/dsh-experimental-agent-team'
import * as TeamTools from '@deepseek-ai/dsh-experimental-tool-agent-team'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { installNativePresets } from '../kernel/native-presets.ts'
import { createReviewJob, reviewStage } from '../../src/reviewer.ts'
import { foldReviewJobs, recordReview, type ReviewJob } from '../../src/review-records.ts'
import { newTask, appendTask, taskProjection } from '../../src/state.ts'

function response(name?: string, args: Record<string, unknown> = {}): StreamChunk[] {
  if (name === undefined) return [{ type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'recorded' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'recorded' } }, { type: 'finish', reason: { kind: 'stop' } }]
  const id = ToolCallId(randomUUID()), argumentsText = JSON.stringify(args)
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } }]
}

class Adapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  script: StreamChunk[][] = []
  failure: Error | undefined
  override resolveModel(provider: string, model: string) { return Promise.resolve({ provider, id: model, name: model }) }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (options.model === 'reviewer' && this.failure) {
      const error = this.failure; this.failure = undefined; throw error
    }
    yield* options.model === 'reviewer' ? this.script.shift() ?? response() : response()
  }
}

const contexts: Context[] = [], roots: string[] = []
afterEach(async () => {
  try { for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose() }
  finally { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) }
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-team-review-')); roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjections)
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(Commands)
  await ctx.plugin(AgentRegistry); await ctx.plugin(JsonlPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] }); await installNativePresets(ctx)
  await ctx.plugin(LocalFileSystem); await ctx.plugin(WorkingDirectoryService, { defaultDirectory: root })
  await ctx.plugin(Subagents); await ctx.plugin(TeamService); await ctx.plugin(TeamTools)
  const adapter = new Adapter(); ctx.llm.registerAdapter(['scripted'], adapter)
  ctx.effect(() => ctx.sessionProjections.register(taskProjection))
  const publications: { id: string; identified: boolean; team: boolean }[] = []
  ctx.on('agent/created', ({ agent }) => {
    if (agent.id.startsWith('task-review-')) publications.push({ id: agent.id,
      identified: agent.session.snapshotEvents().some(event => event.type === 'subagent/descriptor'),
      team: ctx.agentTeams.tryMembership(agent) !== undefined })
  })
  const { agent } = await ctx.agents.create({ sessionId: SessionId('main'), meta: { cwd: root },
    agentOptions: { provider: 'scripted', model: 'main' } })
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect the input and report the result.' }] }))
  await agent.whenIdle()
  const seq = agent.session.snapshotEvents().find(event => event.type === 'user/message')!.seq
  const task = newTask('Inspect the input and report the result.')
  appendTask(ctx, agent, task)
  return { ctx, agent, adapter, seq, publications, task }
}

function script(adapter: Adapter, seq: number, kind: ReviewJob['kind'], verdict: 'pass' | 'revise') {
  adapter.script = [response('read_task_evidence', { from_seq: 0, limit: 30 }),
    ...kind === 'planning' ? [] : [response('read_task_context', { field: 'stages' })],
    response('task_review_decision', { verdict, finding: 'Controlled lifecycle decision', evidence_seqs: [seq],
      ...kind === 'planning' ? { planning: { facts: ['Input recorded'], unknowns: [], nextAction: 'Inspect the input', progress: true } } : {} })]
}

const model = { provider: 'scripted', model: 'reviewer' }
it.each(['planning', 'plan', 'progress', 'stage', 'completion'] as const)('isolates fresh %s reviewers from Team scope across resubmission', async kind => {
  const { ctx, agent, adapter, seq, publications, task } = await fixture()
  expect(ctx.agentTeams.membership(agent).role).toBe('lead')
  expect(ctx.tools.get('list_agents', agent)).toBeDefined()
  for (const verdict of ['revise', 'pass'] as const) {
    script(adapter, seq, kind, verdict)
    const decision = await reviewStage(ctx, agent, task, kind, 'submitted evidence', new AbortController().signal, model, kind)
    expect(decision.verdict).toBe(verdict)
  }
  expect(publications).toHaveLength(2)
  expect(new Set(publications.map(item => item.id)).size).toBe(2)
  expect(publications.every(item => item.identified && !item.team)).toBe(true)
  for (const request of adapter.requests.filter(item => item.model === 'reviewer')) {
    const instructions = request.messages.filter(message => message.role === 'system' || message.source?.kind === 'runtime-context')
    expect(JSON.stringify(instructions)).not.toContain('You are the Team Lead')
    expect(request.tools?.some(tool => ['spawn_teammate', 'list_agents', 'send_message'].includes(tool.name))).toBe(false)
  }
  expect(ctx.agentTeams.membership(agent).role).toBe('lead')
})

it('resumes a transiently failed reviewer with one identity and the original deadline', async () => {
  const { ctx, agent, adapter, seq, task, publications } = await fixture()
  script(adapter, seq, 'plan', 'pass')
  adapter.failure = new LlmError('gateway unavailable', 'SERVER', { status: 502 })
  const decision = await reviewStage(ctx, agent, task, 'plan', 'submitted evidence', new AbortController().signal,
    model, 'plan', { faultRecovery: { attempts: 1, delayMs: 0, resume: false, armed: false } })
  expect(decision.verdict).toBe('pass')
  expect(publications).toHaveLength(2)
  expect(new Set(publications.map(item => item.id)).size).toBe(1)
  expect(publications.every(item => item.identified && !item.team)).toBe(true)
  const reader = await ctx.sessionPersistence.open(SessionId(decision.reviewerSessionId!), 'read')
  try { expect((await reader.read()).events.filter(event => event.type === 'subagent/descriptor')).toHaveLength(1) }
  finally { await reader.close() }
  let jobs: ReviewJob[] = []
  const deadlines = new Set<string | undefined>()
  for (const event of agent.session.snapshotEvents()) { jobs = foldReviewJobs(jobs, event); if (jobs[0]) deadlines.add(jobs[0].deadlineAt) }
  expect(deadlines.size).toBe(1)
  expect(jobs[0]).toMatchObject({ attempt: 2, recovery: { consumed: 1 } })
})

it('records a local prompt failure as internal without an automatic provider retry', async () => {
  const { ctx, agent, adapter, seq, task } = await fixture()
  ctx.on('agent/created', ({ agent: child }) => {
    if (child.id.startsWith('task-review-')) child.ctx.systemPrompt.context({ name: 'fixture:failure', order: 100, required: true,
      text: () => { throw new TeamError('reviewer is not a Team member', 'TEAM_NOT_MEMBER') } })
  })
  script(adapter, seq, 'plan', 'pass')
  await expect(reviewStage(ctx, agent, task, 'plan', 'submitted evidence', new AbortController().signal, model, 'plan',
    { faultRecovery: { attempts: 1, delayMs: 0, resume: false, armed: false } }))
    .rejects.toMatchObject({ fault: { code: 'internal', attempt: 1, message: expect.stringContaining('TEAM_NOT_MEMBER') } })
  expect(adapter.requests.filter(item => item.model === 'reviewer')).toHaveLength(0)
})

it('rejects an incompatible persisted child identity before publishing a resumed reviewer', async () => {
  const { ctx, agent, adapter, task, publications } = await fixture()
  const previous = createReviewJob(agent, task, 'plan', 'submitted evidence', 'plan')
  await recordReview(ctx, agent, previous)
  const handle = await ctx.agents.create({ sessionId: SessionId(previous.reviewerSessionId!), parentAgent: agent,
    agentOptions: { provider: 'scripted', model: 'reviewer' }, setup(_scope, child) {
      child.session.append('subagent/descriptor', snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'other-provider', label: 'other worker' }))
    } })
  await handle.dispose()
  await expect(reviewStage(ctx, agent, task, 'plan', 'submitted evidence', new AbortController().signal, model, 'plan', {}, previous, true))
    .rejects.toMatchObject({ fault: { code: 'internal', message: expect.stringContaining('incompatible subagent identity') } })
  expect(publications).toHaveLength(1)
  expect(ctx.agents.get(SessionId(previous.reviewerSessionId!))).toBeUndefined()
  expect(adapter.requests.filter(item => item.model === 'reviewer')).toHaveLength(0)
})

it('does not publish a reviewer or renew an already expired job on manual recovery', async () => {
  const { ctx, agent, adapter, task, publications } = await fixture()
  const previous = createReviewJob(agent, task, 'plan', 'submitted evidence', 'plan')
  previous.deadlineAt = new Date(0).toISOString()
  await recordReview(ctx, agent, previous)
  await expect(reviewStage(ctx, agent, task, 'plan', 'submitted evidence', new AbortController().signal, model, 'plan', {}, previous, true))
    .rejects.toMatchObject({ fault: { code: 'timeout', retryable: false } })
  expect(publications).toHaveLength(0)
  expect(adapter.requests.filter(item => item.model === 'reviewer')).toHaveLength(0)
})
