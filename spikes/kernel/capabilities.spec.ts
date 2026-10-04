import { controlEvent } from '../../src/session-records.ts'
import { installNativePresets } from './native-presets.ts'
/** Real DSH services with scripted model output; these experiments do not measure review quality. */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Commands from '@deepseek-ai/dsh-commands'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage, type ContextFormed, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { resolveChildAgentOptions } from '@deepseek-ai/dsh-subagent'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'supervisor-spike': { kind: 'supervisor-spike' } & ContextFormed
  }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'supervisor-spike/state': { revision: number; phase: 'paused' | 'active' }
  }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolResponse(name: string): StreamChunk[] {
  const id = ToolCallId(`call-${name}`)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly scripts: Record<string, StreamChunk[][]>) { super() }
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  override async *stream(options: GenerateOptions) {
    this.requests.push(options)
    const response = this.scripts[options.model]?.shift()
    if (!response) throw new Error(`No scripted response for ${options.model}`)
    for (const chunk of response) yield chunk
  }
}

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  try {
    for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  } finally {
    for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
  }
})

async function kernel(adapter: ScriptedAdapter, root?: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Commands)
  await ctx.plugin(AgentRegistry)
  if (root) await ctx.plugin(JsonlPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await installNativePresets(ctx)
  ctx.effect(() => ctx.llm.registerAdapter(['scripted'], adapter))
  return ctx
}

async function makeAgent(ctx: Context, id: string, model = 'executor') {
  return ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider: 'scripted', model } })
}

function message(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'supervisor-spike' } })
}

function registerTool(ctx: Context, name: string, execute: () => string) {
  ctx.effect(() => ctx.tools.register(defineContentToolFixture({
    name, description: `Test-only ${name}`, parameters: {},
    execute: async () => [{ type: 'text', text: execute() }],
  })))
}

async function tempStore() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-spike-'))
  directories.push(root)
  return root
}

/** Release a held pre-step on cancellation as well as review settlement; remove its abort listener. */
async function waitReview(review: Promise<void>, signal: AbortSignal): Promise<void> {
  const cancelled = Promise.withResolvers<void>()
  const onAbort = () => cancelled.resolve()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    if (!signal.aborted) await Promise.race([review, cancelled.promise])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

describe('Supervisor kernel capability experiments', () => {
  it('registers an independent human command and model tool without Goal, Plan, or Team', async () => {
    const adapter = new ScriptedAdapter({ executor: [toolResponse('task_probe'), textResponse('done')] })
    const ctx = await kernel(adapter)
    const { agent } = await makeAgent(ctx, 'command-main')
    registerTool(agent.ctx, 'task_probe', () => 'task state')
    ctx.effect(() => ctx.commands.register({
      name: 'task', description: 'Test-only task command',
      handler: () => ({ kind: 'success', text: 'task status' }),
    }))
    expect((await ctx.commands.execute(agent, '/task', [], new AbortController().signal))?.result)
      .toEqual({ kind: 'success', text: 'task status' })
    expect(adapter.requests).toHaveLength(0)
    agent.followup(message('Read the task.'))
    await agent.whenIdle()
    expect(agent.session.snapshotEvents().map(controlEvent).filter(e => e.type === 'tool/result')).toHaveLength(1)
    expect(ctx.commands.list(agent).map(c => c.name)).toEqual(['task'])
    expect(ctx.get('goals')).toBeUndefined()
    expect(ctx.get('planMode')).toBeUndefined()
  })

  it('holds the main step while a separate reviewer reads a bound evidence prefix', async () => {
    const adapter = new ScriptedAdapter({
      executor: [toolResponse('checkpoint'), textResponse('continued')],
      reviewer: [toolResponse('read_main_log'), textResponse('review accepted')],
    })
    const ctx = await kernel(adapter)
    const { agent: main } = await makeAgent(ctx, 'checkpoint-main')
    registerTool(main.ctx, 'checkpoint', () => 'stage evidence')
    const entered = Promise.withResolvers<void>()
    const reviewed = Promise.withResolvers<void>()
    let holds = 0
    main.ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
      if (agent !== main || step !== 2) return next()
      holds++
      entered.resolve()
      await waitReview(reviewed.promise, signal)
      return signal.aborted ? { kind: 'reject' } : next()
    })
    main.followup(message('Execute one stage.'))
    await entered.promise
    expect(adapter.requests.map(r => r.model)).toEqual(['executor'])
    const prefix = main.session.snapshotEvents().map(controlEvent)
    const cutoff = prefix.at(-1)!.seq
    const { agent: reviewer } = await makeAgent(ctx, 'checkpoint-reviewer', 'reviewer')
    let readEvidence: readonly SessionEvent[] = []
    registerTool(reviewer.ctx, 'read_main_log', () => {
      readEvidence = prefix.filter(e => e.seq <= cutoff)
      return JSON.stringify(readEvidence)
    })
    reviewer.followup(message('Read the bound evidence and review.'))
    await reviewer.whenIdle()
    expect(readEvidence.some(e => e.type === 'tool/result')).toBe(true)
    expect(ctx.tools.schemas(reviewer).map(t => t.name)).toEqual(['read_main_log'])
    expect(ctx.tools.schemas(main).map(t => t.name)).toEqual(['checkpoint'])
    expect(adapter.requests.filter(r => r.model === 'executor')).toHaveLength(1)
    reviewed.resolve()
    await main.whenIdle()
    expect(adapter.requests.map(r => r.model)).toEqual(['executor', 'reviewer', 'reviewer', 'executor'])
    expect(holds).toBe(1)
  })

  it('cancels a held main step and ignores a later review release', async () => {
    const adapter = new ScriptedAdapter({ executor: [toolResponse('checkpoint'), textResponse('MUST NOT RUN')] })
    const ctx = await kernel(adapter)
    const { agent } = await makeAgent(ctx, 'close-main')
    registerTool(agent.ctx, 'checkpoint', () => 'stage evidence')
    const entered = Promise.withResolvers<void>()
    const reviewed = Promise.withResolvers<void>()
    agent.ctx.on('agent/pre-step', async ({ step, signal }, next) => {
      if (step !== 2) return next()
      entered.resolve()
      await waitReview(reviewed.promise, signal)
      return signal.aborted ? { kind: 'reject' } : next()
    })
    agent.followup(message('Reach the review checkpoint.'))
    await entered.promise
    agent.cancel({ kind: 'hook', reason: 'supervisor disabled' })
    await agent.whenIdle()
    reviewed.resolve()
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(agent.status).toBe('idle')
  })

  it('keeps passive injection idle and logs the plugin source when followup wakes it', async () => {
    const adapter = new ScriptedAdapter({ executor: [textResponse('continued')] })
    const ctx = await kernel(adapter)
    const { agent } = await makeAgent(ctx, 'wake-main')
    agent.inject(message('review evidence'))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    agent.followup(message('one next action'))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    const admitted = agent.session.snapshotEvents().map(controlEvent).filter(e => e.type === 'user/message')
    expect(admitted).toHaveLength(2)
    expect(admitted.every(e => e.data.source.kind === 'supervisor-spike')).toBe(true)
  })

  it('reproduces the rejection when reopening an external event appended through Session', async () => {
    const ctx = await kernel(new ScriptedAdapter({}), await tempStore())
    const session = ctx.sessions.prepare(SessionId('external-event'))
    const event = session.append('supervisor-spike/state', { revision: 1, phase: 'active' })
    expect(event.ignorable).toBeUndefined()
    const handle = await ctx.sessionPersistence.create(session.header)
    try {
      await handle.append(session.snapshotEvents())
    } finally {
      await handle.close()
    }
    await expect(ctx.sessionPersistence.open(session.id, 'read'))
      .rejects.toThrow('unknown to this harness and not marked ignorable')
  })

  it('retains an explicitly ignorable external event through the lower persistence API', async () => {
    const ctx = await kernel(new ScriptedAdapter({}), await tempStore())
    const session = ctx.sessions.prepare(SessionId('ignorable-event'))
    const event = session.append('supervisor-spike/state', { revision: 1, phase: 'paused' })
    const handle = await ctx.sessionPersistence.create(session.header)
    try {
      await handle.append([{ ...event, ignorable: true }])
    } finally {
      await handle.close()
    }
    const reader = await ctx.sessionPersistence.open(session.id, 'read')
    try {
      expect((await reader.read()).events).toEqual([{ ...event, ignorable: true }])
    } finally {
      await reader.close()
    }
  })

  it('keeps a recovered inbox idle but consumes an old continuation on a later human wake', async () => {
    const adapter = new ScriptedAdapter({ executor: [textResponse('old action'), textResponse('human answer')] })
    const ctx = await kernel(adapter, await tempStore())
    const session = ctx.sessions.prepare(SessionId('pending-restore'))
    session.append('agent/inbox/spliced', {
      target: 'next-turn', start: 0, inserted: [message('old authorized continuation')],
    })
    const handle = await ctx.sessionPersistence.create(session.header)
    try {
      await handle.append(session.snapshotEvents())
      await handle.flush()
    } finally {
      await handle.close()
    }
    const { agent } = await ctx.agents.resume({
      resumeSessionId: session.id, agentOptions: { provider: 'scripted', model: 'executor' },
    })
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    expect(agent.inbox.nextTurn).toHaveLength(1)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'What is the status?' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const inputs = agent.session.snapshotEvents().map(controlEvent).filter(e => e.type === 'user/message')
    expect(inputs.map(e => e.data.source.kind)).toEqual(['supervisor-spike', 'user'])
    expect(adapter.requests).toHaveLength(2)
  })

  it('withdraws only owned stale inbox work during recovery before a human wake', async () => {
    const adapter = new ScriptedAdapter({ executor: [textResponse('human answer')] })
    const ctx = await kernel(adapter, await tempStore())
    const session = ctx.sessions.prepare(SessionId('guarded-restore'))
    const human = createUserMessage({ content: [{ type: 'text', text: 'Keep my instruction.' }], source: { kind: 'user' } })
    session.append('agent/inbox/spliced', {
      target: 'next-turn', start: 0, inserted: [message('old continuation'), human],
    })
    const handle = await ctx.sessionPersistence.create(session.header)
    try {
      await handle.append(session.snapshotEvents())
      await handle.flush()
    } finally {
      await handle.close()
    }
    ctx.on('agent/created', async ({ agent, source }) => {
      if (source !== 'resume' || agent.id !== session.id) return
      for (const pending of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
        if (pending.source.kind === 'supervisor-spike') agent.inbox.remove(pending.id)
      }
      await ctx.sessionPersistence.flush()
    })
    const { agent } = await ctx.agents.resume({
      resumeSessionId: session.id, agentOptions: { provider: 'scripted', model: 'executor' },
    })
    expect(adapter.requests).toHaveLength(0)
    expect(agent.inbox.nextTurn.map(item => item.id)).toEqual([human.id])
    agent.steer(createUserMessage({ content: [{ type: 'text', text: 'Show the recovered state.' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    const inputs = agent.session.snapshotEvents().map(controlEvent).filter(e => e.type === 'user/message')
    expect(inputs.flatMap(e => e.data.content).some(block => block.type === 'text' && block.text === 'old continuation')).toBe(false)
  })

  it('distinguishes default child inheritance from a pending human model selection', async () => {
    const adapter = new ScriptedAdapter({ executor: [textResponse('first request')] })
    const ctx = await kernel(adapter)
    const { agent } = await makeAgent(ctx, 'model-main')
    agent.followup(message('First request uses the original model.'))
    await agent.whenIdle()
    const nextSelection = { provider: 'scripted', model: 'reviewer' }
    agent.session.append('model/selection', nextSelection)
    expect(resolveChildAgentOptions(agent, undefined, 1).model).toBe('executor')
    expect(resolveChildAgentOptions(agent, nextSelection, 1).model).toBe('reviewer')
    expect(adapter.requests).toHaveLength(1)
  })

  it('holds a queued followup in idle maintenance until its inbox record is durable', async () => {
    const adapter = new ScriptedAdapter({ executor: [textResponse('durable continuation')] })
    const ctx = await kernel(adapter, await tempStore())
    const { agent } = await makeAgent(ctx, 'maintenance-main')
    const input = message('continue after the durability barrier')
    const stored = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const maintenance = agent.runMaintenance(async signal => {
      agent.followup(input)
      await ctx.sessionPersistence.flush()
      stored.resolve()
      await waitReview(release.promise, signal)
    })
    await stored.promise
    expect(adapter.requests).toHaveLength(0)
    const reader = await ctx.sessionPersistence.open(agent.id, 'read')
    try {
      const events = (await reader.read()).events
      expect(events.some(e => e.type === 'agent/inbox/spliced'
        && e.data.inserted.some(item => item.id === input.id))).toBe(true)
    } finally {
      await reader.close()
      release.resolve()
    }
    await maintenance
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
  })
})
