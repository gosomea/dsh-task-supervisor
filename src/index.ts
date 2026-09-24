/** Native DSH task controller: durable state, human commands, and model tools. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { reviewStage, type ReviewerModel } from './reviewer.ts'
import { installPanelApi } from './panel-api.ts'
import {
  NAMESPACE, RECORD_VERSION, appendTask, newTask, taskJson, taskOf, taskProjection, validatePlan,
  type TaskSnapshot,
} from './state.ts'

export const name = 'task-supervisor'
export const inject = ['agents', 'commands', 'sessions', 'sessionProjections', 'sessionPersistence', 'tools']

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'task-supervisor': {
      kind: 'task-supervisor'
      taskId: string
      revision: number
    } & ContextFormed
  }
}

/** Read tools available before the first plan approval. */
export interface Config {
  planningReadTools?: string[]
  reviewerModel?: ReviewerModel
  maxAutomaticRoundsWithoutReport?: number
  automaticContinuation?: boolean
}

interface Runtime {
  armed: boolean
  ownedTurn: boolean
}

const planInput = z.object({
  criteria: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) }).strict()).min(1),
  stages: z.array(z.object({
    id: z.string().min(1), title: z.string().min(1), criterionIds: z.array(z.string().min(1)).min(1),
  }).strict()).min(1),
}).strict()

function toolAgent(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new Error('Supervisor tools require a live Agent')
  return exec.agent
}

function reply(title: string, task: TaskSnapshot | null, armed: boolean): CommandResult {
  if (task === null) return { kind: 'success', text: `${title}\nNo supervised task. Use /task new <objective>.` }
  return { kind: 'success', text: [
    title,
    `Task: ${task.id}`,
    `Phase: ${task.phase}${armed ? ' (armed)' : ' (waiting)'}`,
    `Objective: ${task.objective}`,
    `Revision: ${task.revision}`,
    `Plan: ${task.planVersion}; stage ${Math.min(task.stageIndex + 1, task.stages.length)}/${task.stages.length}`,
    `Supervisor: ${task.enabled ? 'on' : 'off'}`,
  ].join('\n') }
}

function inputFor(task: TaskSnapshot, instruction: string) {
  return createUserMessage({
    content: [{ type: 'text', text: instruction }],
    source: { kind: 'task-supervisor', taskId: task.id, revision: task.revision },
  })
}

/** Register one independently owned workflow on public DSH seams. */
export function apply(ctx: Context, config: Config = {}): void {
  const planningReadTools = config.planningReadTools ?? []
  if (!Array.isArray(planningReadTools) || planningReadTools.some(tool => typeof tool !== 'string' || !tool.trim())) {
    throw new TypeError('planningReadTools must contain nonempty tool names')
  }
  const planningTools = new Set([...planningReadTools, 'task_status', 'task_submit_plan'])
  const maxAutomaticRoundsWithoutReport = config.maxAutomaticRoundsWithoutReport ?? 3
  if (!Number.isSafeInteger(maxAutomaticRoundsWithoutReport) || maxAutomaticRoundsWithoutReport < 1) {
    throw new TypeError('maxAutomaticRoundsWithoutReport must be a positive integer')
  }
  if (config.reviewerModel !== undefined
    && (!config.reviewerModel.provider.trim() || !config.reviewerModel.model.trim())) {
    throw new TypeError('reviewerModel requires a provider and model from the active DSH profile')
  }
  const lifetimes = new WeakMap<Agent, Runtime>()
  const knownAgents = new Set<Agent>()
  const reviewAbort = new Map<Agent, AbortController>()
  const scheduling = new Set<Agent>()
  let disposed = false

  function runtime(agent: Agent): Runtime {
    let current = lifetimes.get(agent)
    if (current === undefined) {
      current = { armed: false, ownedTurn: false }
      lifetimes.set(agent, current)
      knownAgents.add(agent)
    }
    return current
  }

  function current(agent: Agent): TaskSnapshot | null {
    if (ctx.agents.get(agent.id) !== agent) throw new Error('the Agent is no longer live')
    return taskOf(ctx, agent)
  }

  async function flush(agent: Agent): Promise<void> {
    if (!await ctx.sessions.flush(agent.session)) {
      throw new Error('this Session has no durable writer')
    }
  }

  function withdrawOwned(agent: Agent): void {
    const life = runtime(agent)
    life.armed = false
    reviewAbort.get(agent)?.abort(new Error('Supervisor state changed'))
    for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
      if (message.source.kind === 'task-supervisor') agent.inbox.remove(message.id)
    }
    if (life.ownedTurn && agent.status === 'running') {
      agent.cancel({ kind: 'hook', reason: 'Supervisor stopped' }, { keepInbox: true })
    }
  }

  function hasPending(agent: Agent): boolean {
    return agent.inbox.nextStep.length > 0 || agent.inbox.nextTurn.length > 0
  }

  /** The idle maintenance lock holds a queued followup until both records are durable. */
  async function commitAndWake(agent: Agent, expected: TaskSnapshot | null, next: TaskSnapshot, instruction: string): Promise<void> {
    await agent.runMaintenance(async signal => {
      signal.throwIfAborted()
      if (disposed) throw new Error('Supervisor is unloaded')
      const actual = current(agent)
      if (actual?.id !== expected?.id || actual?.revision !== expected?.revision) {
        throw new Error('task changed before the action could be admitted')
      }
      const committed = appendTask(ctx, agent, next)
      await flush(agent)
      signal.throwIfAborted()
      runtime(agent).armed = committed.phase === 'active' || committed.phase === 'planning'
      agent.followup(inputFor(committed, instruction))
      await flush(agent)
    })
  }

  ctx.agents.registerSessionControlReader(NAMESPACE, [RECORD_VERSION])
  ctx.sessionProjections.register(taskProjection)
  installPanelApi(ctx, agent => runtime(agent).armed)
  ctx.effect(() => () => {
    disposed = true
    for (const agent of knownAgents) withdrawOwned(agent)
    knownAgents.clear()
  })

  ctx.on('agent/created', async ({ agent, source }) => {
    const task = taskOf(ctx, agent)
    if (task === null) return
    const life = runtime(agent)
    life.armed = false
    life.ownedTurn = false
    if (source === 'resume') {
      for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
        if (message.source.kind === 'task-supervisor') agent.inbox.remove(message.id)
      }
      await flush(agent)
    }
  })

  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const task = taskOf(ctx, agent)
    if (task === null) return next()
    const owned = messages.some(message => message.source.kind === 'task-supervisor')
    if (!owned) return next()
    const life = runtime(agent)
    if (!life.armed || !task.enabled || (task.phase !== 'active' && task.phase !== 'planning')
      || messages.some(message => message.source.kind === 'task-supervisor'
        && (message.source.taskId !== task.id || message.source.revision !== task.revision))) {
      return { kind: 'reject' }
    }
    life.ownedTurn = true
    return next()
  })

  async function reviewProgress(agent: Agent, expected: TaskSnapshot): Promise<void> {
    await agent.runMaintenance(async maintenanceSignal => {
      maintenanceSignal.throwIfAborted()
      const actual = current(agent)
      if (disposed || actual?.id !== expected.id || actual.revision !== expected.revision
        || actual.phase !== 'active' || !runtime(agent).armed || hasPending(agent)) return
      const stageId = actual.stages[actual.stageIndex]?.id ?? 'completion'
      const evidence = `Progress checkpoint after ${actual.roundsSinceReview} rounds without a stage report.`
      runtime(agent).armed = false
      const reviewing: TaskSnapshot = { ...actual, revision: actual.revision + 1, phase: 'reviewing',
        pendingReview: { kind: 'progress', stageId, evidence } }
      appendTask(ctx, agent, reviewing)
      await flush(agent)
      const abort = new AbortController()
      reviewAbort.set(agent, abort)
      const signal = AbortSignal.any([maintenanceSignal, abort.signal])
      try {
        const decision = await reviewStage(ctx, agent, reviewing, stageId, evidence,
          signal, config.reviewerModel, 'progress')
        signal.throwIfAborted()
        const latest = current(agent)
        if (latest?.id !== reviewing.id || latest.revision !== reviewing.revision
          || latest.phase !== 'reviewing') return
        const next: TaskSnapshot = { ...latest, revision: latest.revision + 1,
          phase: decision.verdict === 'needs-user' ? 'paused' : 'active',
          pendingReview: null, roundsSinceReview: 0,
          lastReview: { stageId, cutoff: decision.cutoff, verdict: decision.verdict,
            finding: decision.finding, evidenceSeqs: decision.evidenceSeqs,
            reviewerSessionId: decision.reviewerSessionId, model: decision.model } }
        appendTask(ctx, agent, next)
        await flush(agent)
        runtime(agent).armed = next.phase === 'active'
        if (next.phase === 'active') {
          agent.followup(inputFor(next,
            `Continue stage ${stageId} under the progress review: ${decision.finding}. `
            + 'Report concrete stage evidence with task_report_stage when ready.'))
          await flush(agent)
        }
      } catch (error: unknown) {
        const latest = current(agent)
        if (latest?.id === reviewing.id && latest.revision === reviewing.revision
          && latest.phase === 'reviewing') {
          appendTask(ctx, agent, { ...latest, revision: latest.revision + 1, phase: 'paused',
            lastReview: { stageId, cutoff: Math.max(0, agent.session.seq - 1),
              verdict: 'needs-user', finding: `Progress review did not settle: ${String(error)}` } })
          await flush(agent)
        }
        throw error
      } finally {
        reviewAbort.delete(agent)
      }
    })
  }

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    const life = runtime(agent)
    if (life.ownedTurn && taskOf(ctx, agent)?.phase === 'planning') life.armed = false
    life.ownedTurn = false
    if (disposed || config.automaticContinuation === false || scheduling.has(agent)
      || ctx.agents.get(agent.id) !== agent) return
    const task = taskOf(ctx, agent)
    if (task === null || task.phase !== 'active' || !task.enabled || !runtime(agent).armed
      || hasPending(agent)) return
    scheduling.add(agent)
    void ctx.agents.withoutInitiator(async () => {
      try {
        const latest = current(agent)
        if (disposed || latest === null || latest.id !== task.id || latest.revision !== task.revision
          || latest.phase !== 'active' || !runtime(agent).armed || hasPending(agent)) return
        if (latest.roundsSinceReview >= maxAutomaticRoundsWithoutReport) {
          await reviewProgress(agent, latest)
          return
        }
        const next: TaskSnapshot = { ...latest, revision: latest.revision + 1,
          roundsSinceReview: latest.roundsSinceReview + 1 }
        await commitAndWake(agent, latest, next,
          `Continue the approved task: ${next.objective}. Current stage: ${next.stages[next.stageIndex]?.id}. `
          + 'Report stage evidence with task_report_stage, or request completion after every stage passes.')
      } catch (error: unknown) {
        runtime(agent).armed = false
        ctx.logger.warn(`Supervisor continuation for ${agent.id} failed: ${String(error)}`)
      } finally {
        scheduling.delete(agent)
      }
    })
  })
  ctx.on('agent/disposed', ({ agent }) => {
    reviewAbort.get(agent)?.abort()
    reviewAbort.delete(agent)
    knownAgents.delete(agent)
  })

  // A monotonic guard enforces planning restrictions at the actual executor,
  // including nested and direct tool calls that bypass prompt visibility.
  ctx.tools.guard(exec => {
    if (exec.agent === undefined) return undefined
    const task = taskOf(ctx, exec.agent)
    if (task === null || task.phase === 'complete' || task.phase === 'cleared') return undefined
    if (!task.enabled || task.phase === 'paused' || task.phase === 'reviewing') {
      return 'Supervisor is stopped or awaiting review'
    }
    if ((task.phase === 'planning' || task.phase === 'awaiting-approval') && !planningTools.has(exec.name)) {
      return `tool "${exec.name}" is unavailable before plan approval`
    }
    return undefined
  })

  ctx.commands.register({
    name: 'task',
    description: 'Create, inspect, approve, pause, or resume a supervised task',
    input: { hint: '[new <objective>|approve|edit <objective>|pause|resume|clear|off|on]' },
    async handler({ agent, rawInput }) {
      const input = rawInput.trim()
      const task = current(agent)
      const life = runtime(agent)
      try {
        if (input === '') return reply('Supervisor', task, life.armed)
        if (input.startsWith('new ')) {
          if (task !== null && task.phase !== 'complete' && task.phase !== 'cleared') {
            throw new Error('clear or finish the current task first')
          }
          const next = newTask(input.slice(4))
          await commitAndWake(agent, task, next,
            `Plan this objective: ${next.objective}\nInspect the workspace using available read tools. Submit acceptance criteria and stages with task_submit_plan. Do not modify files before approval.`)
          return reply('Task created', next, life.armed)
        }
        if (task === null) throw new Error('no task exists; use /task new <objective>')
        if (input === 'approve') {
          if (task.phase !== 'awaiting-approval') throw new Error('the plan is not awaiting approval')
          const next: TaskSnapshot = { ...task, revision: task.revision + 1,
            approvedPlanVersion: task.planVersion, everApproved: true, phase: 'active' }
          await commitAndWake(agent, task, next,
            `Execute approved stage ${next.stages[next.stageIndex]?.id}. Objective: ${next.objective}. Report stage evidence using task_report_stage.`)
          return reply('Plan approved', next, life.armed)
        }
        if (input === 'pause' || input === 'off' || input === 'clear') {
          if (input === 'pause' && (task.phase === 'complete' || task.phase === 'cleared')) {
            throw new Error('a finished task cannot be paused')
          }
          withdrawOwned(agent)
          const next: TaskSnapshot = { ...task, revision: task.revision + 1,
            enabled: input === 'off' ? false : task.enabled,
            phase: input === 'clear' ? 'cleared' : input === 'pause' ? 'paused' : task.phase }
          appendTask(ctx, agent, next)
          await flush(agent)
          return reply(`Supervisor ${input}`, next, false)
        }
        if (input === 'on') {
          if (task.enabled) return reply('Supervisor already on', task, life.armed)
          const next: TaskSnapshot = { ...task, revision: task.revision + 1, enabled: true }
          appendTask(ctx, agent, next)
          await flush(agent)
          return reply('Supervisor on; use /task resume to continue', next, false)
        }
        if (input === 'resume') {
          if (!task.enabled || task.phase === 'awaiting-approval' || task.phase === 'complete' || task.phase === 'cleared') {
            throw new Error('this task cannot resume in its current state')
          }
          if (life.armed) return reply('Supervisor already running', task, true)
          const interruptedReview = task.pendingReview
          const next: TaskSnapshot = { ...task, revision: task.revision + 1,
            phase: task.phase === 'paused' || task.phase === 'reviewing'
              ? (task.everApproved ? 'active' : 'planning') : task.phase,
            pendingReview: null,
            lastReview: interruptedReview === null ? task.lastReview : {
              stageId: interruptedReview.stageId, cutoff: Math.max(0, agent.session.seq - 1),
              verdict: 'needs-user', finding: 'The previous review did not finish; resubmit its evidence.' } }
          await commitAndWake(agent, task, next,
            interruptedReview !== null
              ? `Review interrupted for ${interruptedReview.stageId}. Verify current state, then resubmit ${interruptedReview.kind === 'stage' ? 'task_report_stage' : 'task_request_completion'} with evidence: ${interruptedReview.evidence}`
              : next.phase === 'planning' ? `Resume planning: ${next.objective}. Submit the plan with task_submit_plan.`
                : `Resume the approved task: ${next.objective}. Check the current workspace before repeating any uncertain effects.`)
          return reply('Task resumed', next, true)
        }
        if (input.startsWith('edit ')) {
          const objective = input.slice(5).trim()
          if (!objective) throw new Error('replacement objective is required')
          if (task.phase === 'complete' || task.phase === 'cleared') {
            throw new Error('a finished task cannot be edited')
          }
          withdrawOwned(agent)
          const next: TaskSnapshot = { ...task, revision: task.revision + 1,
            objective, requirementsVersion: task.requirementsVersion + 1,
            planVersion: task.planVersion + 1, criteria: [], stages: [], stageIndex: 0, roundsSinceReview: 0,
            approvedPlanVersion: null, phase: 'planning', pendingReview: null, lastReview: null }
          if (!next.enabled) {
            appendTask(ctx, agent, next)
            await flush(agent)
            return reply('Task edited; enable and resume the Supervisor to replan', next, false)
          }
          await commitAndWake(agent, task, next,
            `Revise the plan for the updated objective: ${objective}. Submit a full plan with task_submit_plan.`)
          return reply('Task edited', next, true)
        }
        throw new Error('unknown task command')
      } catch (error: unknown) {
        return { kind: 'error', text: String(error) }
      }
    },
  })

  const textOutput = {
    schema: { type: 'json' as const },
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  }

  ctx.tools.register(defineTool({
    name: 'task_status', description: 'Read the current supervised objective, plan, and review state.',
    parameters: {}, output: textOutput,
    async execute(_args, exec) {
      const task = current(toolAgent(exec))
      return task === null ? null : taskJson(task)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_submit_plan', description: 'Submit acceptance criteria and ordered stages for the supervised task.',
    parameters: {
      criteria: { type: 'array', required: true, items: {
        type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true }, text: { type: 'string', required: true },
        },
      } },
      stages: { type: 'array', required: true, items: {
        type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true }, title: { type: 'string', required: true },
          criterionIds: { type: 'array', required: true, items: { type: 'string' } },
        },
      } },
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = toolAgent(exec)
      const task = current(agent)
      if (task === null || task.phase !== 'planning') throw new Error('task is not planning')
      const parsed = planInput.parse(args)
      validatePlan(parsed.criteria, parsed.stages)
      const next: TaskSnapshot = { ...task, revision: task.revision + 1,
        planVersion: task.planVersion + 1, criteria: parsed.criteria, stages: parsed.stages, stageIndex: 0,
        roundsSinceReview: 0,
        phase: task.everApproved ? 'active' : 'awaiting-approval',
        approvedPlanVersion: task.everApproved ? task.planVersion + 1 : null }
      appendTask(ctx, agent, next)
      await flush(agent)
      if (next.phase === 'active') runtime(agent).armed = true
      exec.concludeTurn()
      return { phase: next.phase, planVersion: next.planVersion,
        message: next.phase === 'awaiting-approval' ? 'Ask the user to run /task approve.' : 'Continue with the revised plan.' }
    },
  }))

  async function settleReview(agent: Agent, task: TaskSnapshot, stageId: string,
    evidence: string, kind: 'stage' | 'completion', exec: ToolRunContext) {
    runtime(agent).armed = false
    const reviewing: TaskSnapshot = { ...task, revision: task.revision + 1, phase: 'reviewing',
      pendingReview: { kind, stageId, evidence } }
    appendTask(ctx, agent, reviewing)
    await flush(agent)
    const abort = new AbortController()
    reviewAbort.set(agent, abort)
    const signal = AbortSignal.any([exec.signal, abort.signal])
    try {
      const decision = await reviewStage(ctx, agent, reviewing, stageId, evidence, signal, config.reviewerModel, kind)
      signal.throwIfAborted()
      const latest = current(agent)
      if (latest?.id !== reviewing.id || latest.revision !== reviewing.revision || latest.phase !== 'reviewing') {
        throw new Error('review is stale after a task change')
      }
      const next: TaskSnapshot = { ...latest, revision: latest.revision + 1,
        phase: decision.verdict === 'needs-user' ? 'paused'
          : kind === 'completion' && decision.verdict === 'pass' ? 'complete' : 'active',
        pendingReview: null,
        stageIndex: kind === 'stage' && decision.verdict === 'pass' ? latest.stageIndex + 1 : latest.stageIndex,
        roundsSinceReview: 0,
        lastReview: { stageId, cutoff: decision.cutoff, verdict: decision.verdict, finding: decision.finding,
          evidenceSeqs: decision.evidenceSeqs, reviewerSessionId: decision.reviewerSessionId, model: decision.model } }
      appendTask(ctx, agent, next)
      await flush(agent)
      runtime(agent).armed = next.phase === 'active'
      exec.concludeTurn()
      return { verdict: decision.verdict, finding: decision.finding,
        evidenceSeqs: decision.evidenceSeqs, reviewerSessionId: decision.reviewerSessionId,
        nextStage: next.stages[next.stageIndex]?.id ?? null, phase: next.phase }
    } catch (error: unknown) {
      const latest = current(agent)
      if (latest?.id === reviewing.id && latest.revision === reviewing.revision && latest.phase === 'reviewing') {
        appendTask(ctx, agent, { ...latest, revision: latest.revision + 1, phase: 'paused',
          lastReview: { stageId, cutoff: Math.max(0, agent.session.seq - 1),
            verdict: 'needs-user', finding: `Reviewer did not settle: ${String(error)}` } })
        await flush(agent)
      }
      throw error
    } finally {
      reviewAbort.delete(agent)
    }
  }

  ctx.tools.register(defineTool({
    name: 'task_report_stage',
    description: 'Submit evidence for the current plan stage; an independent reviewer checks it.',
    parameters: {
      stage_id: { type: 'string', required: true },
      evidence: { type: 'string', required: true, description: 'Concrete artifact and test evidence, with Session references when known.' },
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = toolAgent(exec)
      const task = current(agent)
      if (task === null || task.phase !== 'active' || !runtime(agent).armed) throw new Error('task is not executing')
      const stage = task.stages[task.stageIndex]
      if (stage === undefined || stage.id !== args.stage_id || !args.evidence.trim()) {
        throw new Error('report the current stage with concrete evidence')
      }
      return settleReview(agent, task, stage.id, args.evidence, 'stage', exec)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_request_completion',
    description: 'Ask an independent reviewer to assess final completion after every plan stage passes.',
    parameters: {
      evidence: { type: 'string', required: true,
        description: 'Concrete evidence that every acceptance criterion is satisfied.' },
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = toolAgent(exec)
      const task = current(agent)
      if (task === null || task.phase !== 'active' || !runtime(agent).armed) throw new Error('task is not executing')
      if (task.stages.length === 0 || task.stageIndex !== task.stages.length || !args.evidence.trim()) {
        throw new Error('every stage must pass before requesting final completion')
      }
      return settleReview(agent, task, 'completion', args.evidence, 'completion', exec)
    },
  }))
}
