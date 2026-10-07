/** Native DSH task controller: durable state, human commands, and model tools. */
import { installStandardHost } from './standard-host.ts'
import { installTaskToolPresentation } from './task-tool-presentation.ts'
import { appendControlRecord, controlEvent } from './session-records.ts'

import type { Context } from '@deepseek-ai/cordis'
import { installClosingResponse, CLOSING_MESSAGE } from './closing-response.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-goal'
import { approvalMessage, approvedTask, controlActions } from './decisions.ts'
import { languagePolicy, resolveLanguage, continuationContext } from './task-context.ts'
import { policyApproval } from './execution-policy.ts'
import { recoveryBoundary } from './recovery.ts'
import { observationReason, type ObservationCursor } from './observation.ts'
import { acceptedNodes, readyNodes, runsOf, withRuns, beginNode, reviewNode, finishNode, reworkNode, recoverRuns } from './graph.ts'
import { changedAttempts } from './rework-records.ts'
import { installRepairs } from './repair-runtime.ts'
import { taskExecutionError } from './repairs.ts'
import { validateProvenance } from './provenance.ts'
import { faultFrom, recordReview } from './review-records.ts'
import { reviewStage, reviewPolicy, type ReviewerModel } from './reviewer.ts'
import { prepareCapabilities, type VerificationNeeds, type VerificationCapability } from './review-capabilities.ts'
import { verificationPolicy, type VerificationConfig } from './verification.ts'
import { installDelegation, requireIntegration } from './delegation.ts'
import { consultationBinding, installConsultation } from './consultation.ts'
import { installPanelApi } from './panel-api.ts'
import {
  NAMESPACE, taskSchema, criterionSchema, stageSchema, appendTask, newTask, taskJson, taskOf, taskProjection, validatePlan,
  type TaskSnapshot,
} from './state.ts'

export const name = 'task-supervisor'
export const inject = ['agents', 'commands', 'sessions', 'sessionProjections', 'sessionPersistence', 'tools', 'systemPrompt', 'llm']

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'task-supervisor': {
      kind: 'task-supervisor'
      taskId: string
      revision: number
    } & ContextFormed
  }
}

/** Deployment policy for supervised tasks, review and optional independent checks. */
export interface Config {
  /** Opt-in restore of Sessions created with 0.1.1 Supervisor preset identities. */
  legacyPresets?: boolean
  repairMaxFiles?: number
  repairMaxBytes?: number
  maxParallelNodes?: number
  integrationTools?: string[]
  observeLongTurns?: boolean
  progressReviewMode?: 'current' | 'configured' | 'required-only'
  observationToolCalls?: number
  observationIntervalMs?: number
  observationConsecutiveErrors?: number
  responseLanguage?: string
  fallbackLanguage?: string
  planningReadTools?: string[]
  reviewRepairAttempts?: number
  reviewDeadlineMs?: number
  reviewVerification?: 'log' | 'independent'
  requiredVerification?: VerificationNeeds
  independentVerification?: VerificationConfig
  reviewerModel?: ReviewerModel
  planCoverageReview?: boolean
  maxAutomaticRoundsWithoutReport?: number
  automaticContinuation?: boolean
  executionApproval?: 'manual' | 'after-review'
  planningSupervision?: boolean
  maxPlanningWithoutProgress?: number
  truncationRecovery?: boolean
  maxRecoveryWithoutProgress?: number
}

interface Runtime {
  armed: boolean
  ownedTurn: boolean
  observation?: ObservationCursor
}

const planInput = z.object({
  criteria: z.array(criterionSchema).min(1),
  stages: z.array(stageSchema).min(1),
  read_only_turns_before_write: z.number().int().min(0).max(10).optional(),
}).strict()

function toolAgent(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new Error('Supervisor tools require a live Agent')
  return exec.agent
}

function reply(title: string, task: TaskSnapshot | null, armed: boolean): CommandResult {
  if (task === null) return { kind: 'success', text: `${title}\nNo supervised task. Use /task <objective>.` }
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
    content: [{ type: 'text', text: continuationContext(task, instruction) }],
    source: { kind: 'task-supervisor', taskId: task.id, revision: task.revision },
  })
}

/** Register one independently owned workflow on public DSH seams. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const reviewerPolicy = reviewPolicy({ ...config.reviewRepairAttempts === undefined ? {} : { repairAttempts: config.reviewRepairAttempts },
    ...config.reviewDeadlineMs === undefined ? {} : { deadlineMs: config.reviewDeadlineMs } })
  resolveLanguage('', config.responseLanguage, config.fallbackLanguage)
  const repairLimits = { files: config.repairMaxFiles ?? 10000, bytes: config.repairMaxBytes ?? 256 * 1024 * 1024 }
  for (const [key, value] of Object.entries(repairLimits)) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`repair ${key} limit must be a positive integer`)
  const recoveryLimit = config.maxRecoveryWithoutProgress ?? 2
  if (!Number.isSafeInteger(recoveryLimit) || recoveryLimit < 1 || recoveryLimit > 10) throw new TypeError('maxRecoveryWithoutProgress must be 1–10')
  if (config.truncationRecovery !== undefined && typeof config.truncationRecovery !== 'boolean') throw new TypeError('truncationRecovery must be a boolean')
  if (config.executionApproval !== undefined && !['manual', 'after-review'].includes(config.executionApproval)) throw new TypeError('executionApproval must be manual or after-review')
  const planningLimit = config.maxPlanningWithoutProgress ?? 2
  if (!Number.isSafeInteger(planningLimit) || planningLimit < 1 || planningLimit > 10) throw new TypeError('maxPlanningWithoutProgress must be 1–10')
  if (config.planningSupervision !== undefined && typeof config.planningSupervision !== 'boolean') throw new TypeError('planningSupervision must be a boolean')
  const closeWithResponse = installClosingResponse(ctx)
  const observationPolicy = { toolCalls: config.observationToolCalls ?? 24,
    elapsedMs: config.observationIntervalMs ?? 300000, consecutiveErrors: config.observationConsecutiveErrors ?? 3 }
  for (const [key, value] of Object.entries(observationPolicy)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`observation ${key} must be a positive integer`)
  }
  if (config.observeLongTurns !== undefined && typeof config.observeLongTurns !== 'boolean') throw new TypeError('observeLongTurns must be a boolean')
  if (config.integrationTools !== undefined && (!config.integrationTools.length || config.integrationTools.some(name => typeof name !== 'string' || !name.trim()))) throw new TypeError('integrationTools must contain nonempty native tool names')
  const planningReadTools = config.planningReadTools ?? ['read', 'glob', 'grep']
  if (!Array.isArray(planningReadTools) || planningReadTools.some(tool => typeof tool !== 'string' || !tool.trim())) {
    throw new TypeError('planningReadTools must contain nonempty tool names')
  }
  const gateReadTools = new Set(planningReadTools.filter(tool => ['read', 'glob', 'grep'].includes(tool)))
  const maxAutomaticRoundsWithoutReport = config.maxAutomaticRoundsWithoutReport ?? 3
  if (!Number.isSafeInteger(maxAutomaticRoundsWithoutReport) || maxAutomaticRoundsWithoutReport < 1) {
    throw new TypeError('maxAutomaticRoundsWithoutReport must be a positive integer')
  }
  const progressReviewMode = config.progressReviewMode ?? 'current'
  if (!['current', 'configured', 'required-only'].includes(progressReviewMode)) throw new TypeError('invalid progressReviewMode')
  if (config.reviewVerification !== undefined && !['log', 'independent'].includes(config.reviewVerification)) throw new TypeError('reviewVerification must be log or independent')
  if (config.reviewVerification === 'independent' && !config.independentVerification) throw new TypeError('independent review requires artifact storage configuration')
  if (config.requiredVerification && (config.requiredVerification.capabilities.some(id => !['read', 'run', 'visual'].includes(id)))) throw new TypeError('invalid requiredVerification capability')
  const effectiveVerification = config.reviewVerification ?? (config.independentVerification ? 'independent' : 'log')
  const selectedReviewPolicy = { ...reviewerPolicy, verificationMode: effectiveVerification,
    ...config.reviewVerification === 'independent' ? { requirementsProtocol: 1 as const, checkProtocol: 1 as const } : {},
    ...effectiveVerification === 'independent' && config.independentVerification ? { verification: verificationPolicy(config.independentVerification) } : {},
    observationSettings: { ...observationPolicy,
    mode: progressReviewMode, rounds: maxAutomaticRoundsWithoutReport, inTurn: config.observeLongTurns !== false } }
  if (config.reviewerModel !== undefined
    && (!config.reviewerModel.provider.trim() || !config.reviewerModel.model.trim())) {
    throw new TypeError('reviewerModel requires a provider and model from the active DSH profile')
  }
  if (config.planCoverageReview !== undefined && typeof config.planCoverageReview !== 'boolean') {
    throw new TypeError('planCoverageReview must be a boolean')
  }
  if (config.legacyPresets !== undefined && typeof config.legacyPresets !== 'boolean') throw new TypeError('legacyPresets must be a boolean')
  const bindSupervisedSession = await installStandardHost(ctx, config.legacyPresets === true)
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

  /** A Task owns continuation; native Goal remains a durable planning record. */
  function ownContinuation(agent: Agent): void {
    const task = taskOf(ctx, agent)
    if (task && task.phase !== 'cleared' || entryActive(agent)) {
      agent.ctx.get('goals')?.disarm(agent)
    }
  }
  ctx.on('goal/changed', ({ agent }) => ownContinuation(agent))
  ctx.on('goal/activation-changed', ({ sessionId, goal }) => {
    const agent = ctx.agents.get(sessionId)
    if (agent && goal?.activation === 'armed') ownContinuation(agent)
  })

  function withdrawOwned(agent: Agent): void {
    ownContinuation(agent)
    delegation.cancel(agent)
    const life = runtime(agent)
    life.armed = false
    reviewAbort.get(agent)?.abort(new Error('Supervisor state changed'))
    for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
      if ((message.source.kind === 'task-supervisor' || message.source.kind === 'task-supervisor-record')) agent.inbox.remove(message.id)
    }
    if (life.ownedTurn && agent.status === 'running') {
      agent.cancel({ kind: 'hook', reason: 'Supervisor stopped' }, { keepInbox: true })
    }
  }

  function hasPending(agent: Agent): boolean {
    return [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind !== 'task-supervisor-record')
  }

  /** Completed post-approval read turns survive restart; aborted turns never unlock writes. */
  function readOnlyGateRemaining(agent: Agent, task: TaskSnapshot): number {
    const required = task.readOnlyTurnsBeforeWrite ?? 0
    const start = task.readOnlyGateStartSeq
    if (required === 0 || start === null || start === undefined) return 0
    const events = agent.session.snapshotEvents().map(controlEvent).filter(event => event.seq >= start)
    const readCalls = new Set(events.filter(event => event.type === 'tool/call'
      && gateReadTools.has(event.data.name)).map(event => event.type === 'tool/call' ? event.data.callId : ''))
    const readTurns = new Set(events.filter(event => event.type === 'tool/result'
      && event.data.message.isError !== true && readCalls.has(event.data.message.source.callId))
      .map(event => event.type === 'tool/result' ? event.data.turn : -1))
    const completed = new Set(events.filter(event => event.type === 'turn/end'
      && event.data.reason.kind === 'completed' && readTurns.has(event.data.turn))
      .map(event => event.type === 'turn/end' ? event.data.turn : -1))
    return Math.max(0, required - completed.size)
  }

  function executionPrompt(agent: Agent, task: TaskSnapshot, instruction: string): string {
    const remaining = readOnlyGateRemaining(agent, task)
    return remaining === 0 ? instruction
      : `${instruction} Before any write, complete ${remaining} read-only model turn(s). `
        + 'Call the directly supplied read/glob/grep tools to inspect the workspace, then end this turn without writing; do not wrap them in run_code. '
        + 'An aborted turn does not count; Supervisor will continue after a completed read-only turn.'
  }

  /** The idle maintenance lock holds a queued followup until both records are durable. */
  async function commitAndWake(agent: Agent, expected: TaskSnapshot | null, next: TaskSnapshot | (() => TaskSnapshot), instruction: string, beforeCommit?: () => Promise<void>, commandInput?: string, delivery?: ReturnType<typeof inputFor>): Promise<void> {
    await agent.runMaintenance(async signal => {
      signal.throwIfAborted()
      if (disposed) throw new Error('Supervisor is unloaded')
      const actual = current(agent)
      if (actual?.id !== expected?.id || actual?.revision !== expected?.revision) {
        throw new Error('task changed before the action could be admitted')
      }
      await beforeCommit?.()
      signal.throwIfAborted()
      if (current(agent)?.id !== expected?.id || current(agent)?.revision !== expected?.revision) throw new Error('task changed during admission')
      const committed = appendTask(ctx, agent, typeof next === 'function' ? next() : next)
      ownContinuation(agent)
      await flush(agent)
      signal.throwIfAborted()
      const persisted = current(agent)
      if (disposed || persisted?.id !== committed.id || persisted.revision !== committed.revision || hasPending(agent)) throw new Error('task or inbox changed before delivery')
      runtime(agent).armed = committed.phase === 'active' || committed.phase === 'planning'
      const message = delivery ?? (commandInput === undefined ? inputFor(committed, instruction) : createUserMessage({ content: [{ type: 'text', text: commandInput }], source: { kind: 'user' } }))
      agent.followup(message)
      try {
        await flush(agent)
        signal.throwIfAborted()
        const delivered = current(agent)
        if (disposed || delivered?.id !== committed.id || delivered.revision !== committed.revision
          || [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(item => item.id !== message.id && item.source.kind !== 'task-supervisor-record')) throw new Error('task or inbox changed during delivery')
      } catch (error) {
        agent.inbox.remove(message.id)
        runtime(agent).armed = false
        throw error
      }
    })
  }

  /** User edits can arrive during a model turn or review; replace the objective before waiting for cancellation. */
  async function replaceAndWake(agent: Agent, expected: TaskSnapshot, next: TaskSnapshot, instruction: string): Promise<void> {
    const actual = current(agent)
    if (disposed || actual?.id !== expected.id || actual.revision !== expected.revision) {
      throw new Error('task changed before the edit could be admitted')
    }
    const committed = appendTask(ctx, agent, next)
    await flush(agent)
    await agent.whenIdle()
    await agent.runMaintenance(async signal => {
      signal.throwIfAborted()
      const latest = current(agent)
      if (disposed || latest?.id !== committed.id || latest.revision !== committed.revision) return
      runtime(agent).armed = true
      agent.followup(inputFor(committed, instruction))
      await flush(agent)
    })
  }

  ctx.sessionProjections.register(taskProjection)
  installTaskToolPresentation(ctx, agent => {
    const task = taskOf(ctx, agent)
    return task?.phase === 'complete' || task?.phase === 'active' && readOnlyGateRemaining(agent, task) > 0
  })
  ctx.systemPrompt.section({ name: 'task-supervisor:entry', order: 2449, interpolate: false,
    text: ({ agent }) => {
      if (!agent || consultationBinding(agent)) return ''
      const task = taskOf(ctx, agent)
      if (!task || task.phase === 'cleared' || task.phase === 'complete') return 'Supervisor is available but selecting a native mode does not create a supervised task. When the user explicitly asks to create a supervised task, call task_status to read the latest human message and its seq, then task_create with the objective and user_message_seq. Do not substitute a Todo list, planning skill, native Goal or Plan for Task creation. For ordinary questions, keep the native workflow. Creating a Task does not approve implementation; submit its plan and wait for Task approval.'
      return 'Supervisor owns automatic continuation and final acceptance for this Task. Native Goal, Plan and Todo may organize work, but they do not replace the Task DAG, its approval or independent review. Native Goal automatic rounds are disarmed while this Task is retained. Native Goal completion and native Plan approval do not complete or approve this Task. Report completed nodes with task_report_stage and request final acceptance with task_request_completion.'
    },
  })
  ctx.systemPrompt.section({ name: 'task-supervisor:planning', order: 2451, interpolate: false,
    text: context => {
      const task = context.agent ? taskOf(ctx, context.agent) : null
      if (!task?.enabled || !['planning', 'awaiting-approval'].includes(task.phase)) return ''
      return 'The supervised task is being planned. Inspect the actual workspace with any available tools under the current native DSH permission policy. A universal tool such as run_code may be used for read-only investigation. Do not implement or modify deliverables before the user approves the plan. Submit criteria and DAG stages using task_submit_plan, then wait for approval. Task objective: ' + task.objective
    },
  })
  ctx.systemPrompt.section({ name: 'task-supervisor:language', order: 2450, interpolate: false,
    text: ({ agent }) => {
      if (agent === undefined) return ''
      const task = taskOf(ctx, agent)
      return task === null || !task.enabled || task.phase === 'cleared' ? '' : languagePolicy(task) + (task.phase === 'complete' ? '\nThe task is complete. Ordinary diagnosis is read-only. Task controls and reading tools are directly callable through their supplied schemas even with a PTC preset; do not wrap them in run_code, which cannot run an arbitrary program in this state. Read task_status directly, then pass latestUserMessage.seq as user_message_seq to task_create for an explicit new task request. For defects in the original objective, call task_propose_repair with affected roots and evidence, then stop and wait for the user to click the impact confirmation. Never repair files or call task_rework_node before confirmation. Prior completion remains historical acceptance, not repair authorization.' : '')
    },
  })
  const delegation = installDelegation(ctx, agent => runtime(agent).armed, config.maxParallelNodes)
  const creations = new WeakMap<Agent, Promise<TaskSnapshot>>()
  async function createTask(agent: Agent, objective: string, creationId?: string, commandInput?: string, source?: { seq: number; signal: AbortSignal }, inTurn = false): Promise<TaskSnapshot> {
    const previous = creations.get(agent)
    const pending = (async () => {
      if (previous) await previous.catch(() => undefined)
      return createTaskOnce(agent, objective, creationId, commandInput, source, inTurn)
    })()
    creations.set(agent, pending)
    try { return await pending } finally { if (creations.get(agent) === pending) creations.delete(agent) }
  }
  async function createTaskOnce(agent: Agent, objective: string, creationId?: string, commandInput?: string, source?: { seq: number; signal: AbortSignal }, inTurn = false): Promise<TaskSnapshot> {
    await bindSupervisedSession(agent)
    if (effectiveVerification === 'independent' && config.requiredVerification) await prepareCapabilities(ctx, agent, selectedReviewPolicy.verification, config.requiredVerification, AbortSignal.timeout(reviewerPolicy.deadlineMs))
    if (source) {
      source.signal.throwIfAborted()
      const latest = agent.session.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
      if (latest?.seq !== source.seq) throw new Error('human creation source changed during admission')
    }
    if (creationId) {
      for (const event of agent.session.snapshotEvents().map(controlEvent).reverse()) {
        if (event.type === 'extension/record' && event.data.namespace === NAMESPACE && event.data.kind === 'state') {
          const parsed = taskSchema.safeParse(event.data.payload)
          if (parsed.success && parsed.data.creationRequestId === creationId) {
            if (parsed.data.objective !== objective) throw new Error('creation source already binds a different objective')
            return parsed.data
          }
        }
      }
    }
    if (disposed) throw new Error('Supervisor is unloaded')
    if (inTurn && !entryActive(agent)) throw new Error('Task planning entry was canceled during admission')
    const task = current(agent)
    if (task && (!['complete', 'cleared'].includes(task.phase) || !task.enabled)) throw new Error('当前任务须结束且督导已启用，才能创建下一项；草案可先保存。')
    let next: TaskSnapshot = { ...newTask(objective), responseLanguage: resolveLanguage(objective, config.responseLanguage, config.fallbackLanguage),
      ...creationId === undefined ? {} : { creationRequestId: creationId } }
    const grant = () => next = { ...next, approvalPolicy: { mode: config.executionApproval ?? 'manual', source: 'profile', mainSessionId: agent.id, requirementsVersion: next.requirementsVersion, grantSeq: agent.session.seq } }
    if (inTurn || ctx.agents.currentInitiator() === agent && agent.status === 'running') {
      // Already executing in this Agent: maintenance would wait for its own turn.
      appendTask(ctx, agent, grant())
      ownContinuation(agent)
      await flush(agent)
      if (disposed || current(agent)?.id !== next.id || current(agent)?.revision !== next.revision) throw new Error('task changed during creation')
      runtime(agent).armed = true
      runtime(agent).ownedTurn = true
    } else {
      await commitAndWake(agent, task, grant,
        'Plan the objective above. Inspect the workspace using available read tools. Submit acceptance criteria and stages with task_submit_plan. Attribute each criterion to the user objective, a cited project rule, or a necessary implementation choice. Existing fixtures are not requirements; exclude unrelated tests and optional enhancements. Do not modify files before approval.', undefined, commandInput)
    }
    return next
  }

  function entryActive(agent: Agent): boolean {
    const entry = ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.entry
    return entry?.active === true && entry.mainSessionId === agent.id
  }
  async function setEntry(agent: Agent, active: boolean): Promise<void> {
    await bindSupervisedSession(agent)
    appendControlRecord(agent, { namespace: NAMESPACE, schemaVersion: 1, kind: 'entry',
      recordId: `entry:${agent.id}:${agent.session.seq}`, payload: { active, mainSessionId: agent.id } })
    ownContinuation(agent)
    await flush(agent)
  }
  // Bare /task waits for the next real human message; internal followups cannot create it.
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    if (!entryActive(agent)) return next()
    const human = messages.findLast(message => message.source.kind === 'user'
      && message.content.some(block => block.type === 'text' && block.text.trim()))
    if (!human) return next()
    const decision = await next()
    if (decision.kind === 'reject' || !entryActive(agent)) return decision
    signal.throwIfAborted()
    const objective = human.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
    await createTask(agent, objective, `entry:${agent.id}:${human.id}`, undefined, undefined, true)
    signal.throwIfAborted()
    return decision
  })

  const repairs = installRepairs(ctx, commitAndWake, repairLimits)
  const consultation = installConsultation(ctx, config.reviewerModel, createTask, repairs)
  installPanelApi(ctx, agent => ({ reviewVerification: effectiveVerification, armed: runtime(agent).armed, reviewing: reviewAbort.has(agent),
    actions: controlActions(current(agent), runtime(agent).armed, reviewAbort.has(agent)) }), consultation, repairs)
  ctx.effect(() => () => {
    disposed = true
    for (const agent of knownAgents) withdrawOwned(agent)
    knownAgents.clear()
  })

  ctx.on('agent/created', async ({ agent, source }) => {
    const task = taskOf(ctx, agent)
    if (task === null && !entryActive(agent)) return
    await bindSupervisedSession(agent)
    ownContinuation(agent)
    const life = runtime(agent)
    life.armed = false
    life.ownedTurn = false
    if (source === 'resume') {
      for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
        if ((message.source.kind === 'task-supervisor' || message.source.kind === 'task-supervisor-record')) agent.inbox.remove(message.id)
      }
      await flush(agent)
    }
  })

  async function verifyBeforeApproval(agent: Agent, task: TaskSnapshot, signal: AbortSignal): Promise<void> {
    if (effectiveVerification !== 'independent') return
    const job = ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviewJobs.find(item => item.id === task.lastReview?.jobId)
    const capabilities = new Set<VerificationCapability>(job?.decision?.requiredCapabilities ?? config.requiredVerification?.capabilities ?? ['read'])
    for (const criterion of task.criteria) if (criterion.evidenceKind === 'runtime') capabilities.add('run'); else if (criterion.evidenceKind === 'visual') capabilities.add('visual')
    const programs = job?.decision?.programs ?? config.requiredVerification?.programs
    await prepareCapabilities(ctx, agent, selectedReviewPolicy.verification, { capabilities: [...capabilities], ...programs ? { programs } : {} }, signal)
  }

  function approvalFor(agent: Agent, task: TaskSnapshot) {
    const job = ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviewJobs.find(item => item.id === task.lastReview?.jobId)
    return policyApproval(task, agent.id, agent.session.snapshotEvents().map(controlEvent), job)
  }

  async function finishReviewRecord(agent: Agent, jobId: string, status: 'applied' | 'stale'): Promise<void> {
    const job = ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviewJobs.find(item => item.id === jobId)
    if (job && job.status === 'submitted') await recordReview(ctx, agent, { ...job, revision: job.revision + 1, status })
  }

  async function pauseForReviewFailure(agent: Agent, expected: TaskSnapshot, error: unknown): Promise<TaskSnapshot | null> {
    const latest = current(agent)
    if (latest?.id !== expected.id || latest.revision !== expected.revision) return null
    const fault = faultFrom(error)
    if (!fault) throw error
    const paused: TaskSnapshot = { ...latest, revision: latest.revision + 1,
      phase: 'paused', pauseReason: 'review-fault', reviewFault: fault }
    appendTask(ctx, agent, paused)
    runtime(agent).armed = false
    await flush(agent)
    return paused
  }

  async function observeStep(agent: Agent, task: TaskSnapshot, signal: AbortSignal, atIdle = false): Promise<TaskSnapshot | null> {
    const life = runtime(agent)
    const planning = task.phase === 'planning'
    const ending = agent.session.snapshotEvents().map(controlEvent).findLast(event => event.type === 'turn/end')
    if (atIdle && planning && task.planning && (ending?.seq ?? -1) <= task.planning.cutoff) return null
    if ((planning ? config.planningSupervision === false : progressReviewMode === 'required-only')
      || (!atIdle && config.observeLongTurns === false) || !life.armed || !task.enabled || !['planning', 'active'].includes(task.phase)
      || reviewAbort.has(agent) || hasPending(agent)) return null
    const node = task.stages[task.stageIndex]
    const key = planning ? `${task.id}:planning:${task.requirementsVersion}`
      : `${task.id}:${task.planVersion}:${node?.id}:${runsOf(task).find(run => run.id === node?.id)?.attempt}`
    if (life.observation?.key !== key) {
      life.observation = { key, seq: agent.session.seq, time: Date.now() }
      if (!atIdle) return null
    }
    const reason = atIdle ? 'Planning turn ended without a submitted plan' : observationReason(agent.session.snapshotEvents().map(controlEvent), life.observation, observationPolicy, Date.now())
    if (reason === null) return null
    const stageId = planning ? 'planning' : node?.id ?? 'completion'
    const abort = new AbortController()
    reviewAbort.set(agent, abort)
    try {
      const reviewSignal = AbortSignal.any([signal, abort.signal])
      const decision = await reviewStage(ctx, agent, task, stageId,
        planning ? `Planning observation: ${reason}. Read actual investigation since the previous planning cutoff ${task.planning?.cutoff ?? 'none'}. No submitted DAG exists yet; separate confirmed facts from unknowns and propose one concrete next output. Duration/activity alone does not imply drift.`
          : `In-turn observation: ${reason}. Inspect actual progress across ready/running nodes, not just the selected node. Duration/activity triggers inspection and does not imply drift. Productive work should continue.`,
        reviewSignal, config.reviewerModel, planning ? 'planning' : 'progress', selectedReviewPolicy)
      reviewSignal.throwIfAborted()
      const latest = current(agent)
      if (disposed || latest?.id !== task.id || latest.revision !== task.revision || !latest.enabled || !life.armed || hasPending(agent)) { await finishReviewRecord(agent, decision.jobId, 'stale'); return null }
      const sameSummary = planning && latest.planning && decision.planning
        && JSON.stringify([...latest.planning.facts].sort()) === JSON.stringify([...decision.planning.facts].sort())
        && JSON.stringify([...latest.planning.unknowns].sort()) === JSON.stringify([...decision.planning.unknowns].sort())
      const planningProgress = decision.planning?.progress === true && !sameSummary
      const noProgress = planning && !planningProgress ? (latest.planning?.noProgress ?? 0) + 1 : 0
      const stalled = planning && noProgress >= planningLimit
      const next: TaskSnapshot = { ...latest, revision: latest.revision + 1,
        ...planning && decision.planning ? { planning: { ...decision.planning, progress: planningProgress, requirementsVersion: latest.requirementsVersion,
          cutoff: decision.cutoff, jobId: decision.jobId, evidenceSeqs: decision.evidenceSeqs, noProgress } } : {},
        phase: decision.verdict === 'needs-user' || stalled ? 'paused' : planning ? 'planning' : 'active', roundsSinceReview: 0,
        reviewFault: null, pauseReason: decision.verdict === 'needs-user' ? 'decision' : stalled ? 'planning-stalled' : null,
        lastReview: { jobId: decision.jobId, stageId, cutoff: decision.cutoff, verdict: decision.verdict, finding: decision.finding,
          imageSeqs: decision.imageSeqs, evidenceSeqs: decision.evidenceSeqs, reviewerSessionId: decision.reviewerSessionId, model: decision.model } }
      appendTask(ctx, agent, next)
      await finishReviewRecord(agent, decision.jobId, 'applied')
      await flush(agent)
      reviewSignal.throwIfAborted()
      if (disposed || current(agent)?.revision !== next.revision || hasPending(agent)) { life.armed = false; return null }
      life.armed = next.phase === 'active' || next.phase === 'planning'
      life.observation = { key, seq: agent.session.seq, time: Date.now() }
      return next
    } catch (error: unknown) {
      const latest = current(agent)
      if (!signal.aborted && !abort.signal.aborted && latest?.id === task.id && latest.revision === task.revision) {
        return pauseForReviewFailure(agent, task, error)
      }
      throw error
    } finally {
      reviewAbort.delete(agent)
    }
  }

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const task = taskOf(ctx, agent)
    if (task === null) return next()
    ownContinuation(agent)
    const owned = messages.some(message => message.source.kind === 'task-supervisor')
    const life = runtime(agent)
    if (owned) {
      if (!life.armed || !task.enabled || (task.phase !== 'active' && task.phase !== 'planning')
        || messages.some(message => message.source.kind === 'task-supervisor'
          && (message.source.taskId !== task.id || message.source.revision !== task.revision))) return { kind: 'reject' }
      life.ownedTurn = true
    }
    const observed = await observeStep(agent, task, signal)
    if (observed?.phase === 'paused') return { kind: 'reject' }
    const decision = await next()
    if (observed === null || decision.kind === 'reject') return decision
    const admitted = current(agent)
    if (disposed || signal.aborted || admitted?.id !== observed.id || admitted.revision !== observed.revision
      || !admitted.enabled || !life.armed || hasPending(agent)) return { kind: 'reject' }
    return { ...decision, messages: [...decision.messages, inputFor(observed,
      observed.phase === 'planning' ? `Continue planning: ${observed.planning?.nextAction}. This review does not approve implementation.`
        : `Continue in this same turn under the progress finding: ${observed.lastReview?.finding}. A progress pass does not complete a node.`)] }
  })

  /** Idle planning inspection shares native admission; delivery uses a separate maintenance job. */
  async function reviewPlanning(agent: Agent, expected: TaskSnapshot): Promise<void> {
    const observed = await agent.runMaintenance(async signal => {
      const actual = current(agent)
      if (disposed || actual?.id !== expected.id || actual.revision !== expected.revision || hasPending(agent)) return null
      return observeStep(agent, actual, signal, true)
    })
    if (!observed && current(agent)?.revision === expected.revision && !hasPending(agent)) runtime(agent).armed = false
    if (observed?.phase !== 'planning' || !runtime(agent).armed || config.automaticContinuation === false) return
    await commitAndWake(agent, observed, { ...observed, revision: observed.revision + 1 },
      `Continue planning from independently confirmed facts. Next action: ${observed.planning?.nextAction}. Submit task_submit_plan when ready; implementation is not approved.`)
  }

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
          signal, config.reviewerModel, 'progress', selectedReviewPolicy)
        signal.throwIfAborted()
        const latest = current(agent)
        if (latest?.id !== reviewing.id || latest.revision !== reviewing.revision
          || latest.phase !== 'reviewing') { await finishReviewRecord(agent, decision.jobId, 'stale'); return }
        const next: TaskSnapshot = { ...latest, revision: latest.revision + 1,
          phase: decision.verdict === 'needs-user' ? 'paused' : 'active',
          pendingReview: null, roundsSinceReview: 0,
          reviewFault: null, pauseReason: decision.verdict === 'needs-user' ? 'decision' : null,
        lastReview: { jobId: decision.jobId, stageId, cutoff: decision.cutoff, verdict: decision.verdict,
            finding: decision.finding, evidenceSeqs: decision.evidenceSeqs,
            reviewerSessionId: decision.reviewerSessionId, model: decision.model } }
        appendTask(ctx, agent, next)
        await finishReviewRecord(agent, decision.jobId, 'applied')
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
          await pauseForReviewFailure(agent, reviewing, error)
        }
        throw error
      } finally {
        reviewAbort.delete(agent)
      }
    })
  }

  function onIdle(agent: Agent): void {
    const life = runtime(agent)
    life.ownedTurn = false
    if (config.automaticContinuation === false && taskOf(ctx, agent)?.phase === 'planning'
      && !hasPending(agent) && !reviewAbort.has(agent)) life.armed = false
    if (disposed || config.automaticContinuation === false || scheduling.has(agent)
      || ctx.agents.get(agent.id) !== agent) return
    const task = taskOf(ctx, agent)
    if (task === null || !['active', 'planning'].includes(task.phase) || !task.enabled || !runtime(agent).armed
      || hasPending(agent) || reviewAbort.has(agent) || task.pendingReview !== null) return
    scheduling.add(agent)
    const admittedEnd = agent.session.snapshotEvents().map(controlEvent).findLast(event => event.type === 'turn/end')?.seq ?? -1
    void ctx.agents.withoutInitiator(async () => {
      try {
        const latest = current(agent)
        if (disposed || latest === null || latest.id !== task.id || latest.revision !== task.revision
          || !['active', 'planning'].includes(latest.phase) || !runtime(agent).armed || hasPending(agent) || reviewAbort.has(agent) || latest.pendingReview !== null) return
        const ending = agent.session.snapshotEvents().map(controlEvent).findLast(event => event.type === 'turn/end')
        if (ending?.type === 'turn/end' && !['completed', 'max-tokens'].includes(ending.data.reason.kind)) { runtime(agent).armed = false; return }
        const boundary = recoveryBoundary(agent.session.snapshotEvents().map(controlEvent), latest)
        if (boundary && config.truncationRecovery === false) { runtime(agent).armed = false; return }
        if (latest.phase === 'planning' && config.planningSupervision !== false && boundary && latest.recovery) {
          await reviewPlanning(agent, latest)
          return
        }
        if (config.truncationRecovery !== false) {
          if (boundary && latest.recovery?.endSeq !== boundary.endSeq) {
            const noProgress = latest.recovery?.progressFingerprint === boundary.progressFingerprint
              ? latest.recovery.noProgress + 1 : 0
            if (noProgress >= recoveryLimit) {
              appendTask(ctx, agent, { ...latest, revision: latest.revision + 1, phase: 'paused', pauseReason: 'recovery-stalled', ...latest.recovery ? { recovery: { ...latest.recovery, noProgress } } : {} })
              runtime(agent).armed = false
              await flush(agent)
              return
            }
            const instruction = `Generation reached its output limit; continue ${latest.phase === 'planning' ? 'planning and submit task_submit_plan; implementation is not approved' : 'the current approved node'}.\n`
              + `Confirmed evidence (bounded): ${boundary.summary}\nEvidence seqs: ${boundary.evidenceSeqs.join(', ')}. Read the original Session for omitted detail.\n`
              + 'Preserve existing investigation; do not repeat reads or uncertain side effects. Produce the next concrete deliverable, not another long reasoning-only response.'
            const provisional = { ...latest, revision: latest.revision + 1 }
            const delivery = inputFor(provisional, instruction)
            const next: TaskSnapshot = { ...provisional, recovery: { endSeq: boundary.endSeq, turn: boundary.turn, evidenceSeqs: boundary.evidenceSeqs, progressFingerprint: boundary.progressFingerprint, noProgress, messageId: delivery.id, instruction } }
            await commitAndWake(agent, latest, next, instruction, undefined, undefined, delivery)
            return
          }
        }
        if (latest.phase === 'planning') {
          if (config.planningSupervision !== false && ending?.type === 'turn/end' && ending.data.reason.kind === 'completed') await reviewPlanning(agent, latest)
          else runtime(agent).armed = false
          return
        }
        if (progressReviewMode !== 'required-only' && latest.roundsSinceReview >= maxAutomaticRoundsWithoutReport) {
          await reviewProgress(agent, latest)
          return
        }
        const next: TaskSnapshot = { ...latest, revision: latest.revision + 1,
          roundsSinceReview: latest.roundsSinceReview + 1 }
        await commitAndWake(agent, latest, next,
          executionPrompt(agent, next,
            'Continue the current approved stage. '
            + 'Report stage evidence with task_report_stage, or request completion after every stage passes.'))
      } catch (error: unknown) {
        runtime(agent).armed = false
        ctx.logger.warn(`Supervisor continuation for ${agent.id} failed: ${String(error)}`)
      } finally {
        scheduling.delete(agent)
        // A very short continuation can finish while the previous maintenance job releases.
        // Reinspect only a newer native ending; never re-drive the same idle notification.
        if (!disposed && ctx.agents.get(agent.id) === agent && agent.status === 'idle' && taskOf(ctx, agent)?.phase === 'planning'
          && (agent.session.snapshotEvents().map(controlEvent).findLast(event => event.type === 'turn/end')?.seq ?? -1) > admittedEnd) onIdle(agent)
      }
    })
  }
  ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') onIdle(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    reviewAbort.get(agent)?.abort()
    reviewAbort.delete(agent)
    knownAgents.delete(agent)
  })

  // Task controls retain their lifecycle guards. Planning uses guidance and the
  // native permission policy; a universal tool may inspect without implementing.
  ctx.tools.guard(exec => {
    if (exec.agent === undefined) return undefined
    const task = taskOf(ctx, exec.agent)
    if (task === null || task.phase === 'cleared') return undefined
    if (exec.name === 'task_status' || exec.name === 'task_create' && task.phase === 'complete' && task.enabled) return undefined
    if (task.phase === 'complete') {
      // A completed task has no execution grant, including before the model
      // proposes repair or after the user declines it. Generic executors can write.
      if (!['task_propose_repair', 'read', 'glob', 'grep', 'read_image'].includes(exec.name)) return exec.name === 'run_code'
        ? 'TASK_COMPLETED_TRANSPORT_BLOCKED: Call task_status, task_create, task_propose_repair or read/glob/grep/read_image directly through their supplied schemas, not through run_code. task_create requires latestUserMessage.seq from task_status. Arbitrary program execution cannot establish read-only diagnosis. Use /task <objective> for explicit new-task planning.'
        : 'REPAIR_CONFIRMATION_REQUIRED: This task is complete. Use the directly supplied read tools for diagnosis; for an original-objective defect propose repair and wait for impact confirmation. An explicit new task can be created with task_create after reading task_status. Generic executors cannot establish read-only diagnosis.'
      return undefined
    }
    if (!task.enabled || task.phase === 'paused' || task.phase === 'reviewing') {
      return 'Supervisor is stopped or awaiting review'
    }
    if (task.phase === 'active' && readOnlyGateRemaining(exec.agent, task) > 0
      && exec.name !== 'task_status' && exec.name !== 'task_approve' && !gateReadTools.has(exec.name)) {
      return `tool "${exec.name}" is unavailable until a post-approval read-only model turn completes`
    }
    return undefined
  })

  ctx.commands.register({
    name: 'task',
    description: 'Enter Task planning, plan an objective, or control the current task',
    input: { hint: '[<objective>|status|approve|auto-approve-on|auto-approve-off|edit <objective>|pause|resume|retry-review|clear|off|on]' },
    async handler({ agent, rawInput, signal }) {
      const binding = consultationBinding(agent)
      if (binding) {
        const main = ctx.agents.get(SessionId(binding.mainSessionId))
        if (!main) return { kind: 'error', text: '请先打开主会话，再操作任务。' }
        const boundTask = current(main)
        if (binding.taskId !== undefined && boundTask?.id !== binding.taskId) {
          return { kind: 'error', text: '这是历史任务的督导对话；请打开当前任务后再操作。' }
        }
        const result = await ctx.commands.execute(main, `/task${rawInput}`, [], signal)
        return result?.result ?? { kind: 'error', text: '主会话无法处理此任务命令。' }
      }
      let input = rawInput.trim()
      const bound = /^(approve|auto-approve-on|auto-approve-off|pause|resume|retry-review|clear|off|on) ([\w-]+) (\d+)$/u.exec(input)
      if (bound !== null) {
        const state = current(agent)
        if (state === null || state.id !== bound[2] || state.revision !== Number(bound[3])) {
          return { kind: 'error', text: '任务状态已变化，请刷新后操作。' }
        }
        input = bound[1]!
      }
      const task = current(agent)
      const life = runtime(agent)
      try {
        if (input === 'consult') return { kind: 'success', text: `Supervisor Session: ${(await consultation.open(agent)).id}` }
        if (input === '') {
          if (task && !['complete', 'cleared'].includes(task.phase)) return reply('当前任务督导', task, life.armed)
          if (task && !task.enabled) throw new Error('督导已关闭；先运行 /task on，再进入新任务规划。')
          await setEntry(agent, true)
          return { kind: 'success', text: '已进入任务规划。下一条消息作为任务目标；也可以直接输入 /task <目标>。提交计划后等待批准，不会自动实施。' }
        }
        if (input === 'status') return reply('Supervisor', task, life.armed)
        if (['off', 'clear'].includes(input) && (!task || ['complete', 'cleared'].includes(task.phase)) && entryActive(agent)) {
          await setEntry(agent, false)
          if (!task) return { kind: 'success', text: '已退出任务规划入口。' }
        }
        const controls = new Set(['new', 'status', 'consult', 'approve', 'auto-approve-on', 'auto-approve-off', 'edit', 'pause', 'resume', 'retry-review', 'clear', 'off', 'on'])
        const verb = input.split(/\s/u)[0]!
        if (!controls.has(verb)) {
          const next = await createTask(agent, input, undefined, `/task${rawInput}`)
          return reply('Task created', next, life.armed)
        }
        if (/^new\s/u.test(input)) {
          const next = await createTask(agent, input.slice(3).trim(), undefined, `/task${rawInput}`)
          return reply('Task created', next, life.armed)
        }
        if (task === null) throw new Error('no task exists; use /task <objective>')
        if (input === 'retry-review') {
          await retryReview(agent, task, signal)
          return reply('审查恢复完成；检查结果后批准计划或手动恢复任务。', current(agent), false)
        }
        if (input === 'auto-approve-on' || input === 'auto-approve-off') {
          const revoking = input === 'auto-approve-off'
          if (!task.enabled || !['planning', 'awaiting-approval', ...revoking ? ['reviewing'] : []].includes(task.phase) || task.everApproved || !revoking && reviewAbort.has(agent)) throw new Error('执行批准设置仅在首次规划或等待批准时修改；审查期间仍可撤销自动批准。')
          const configured = appendTask(ctx, agent, { ...task, revision: task.revision + 1,
            approvalPolicy: { mode: input === 'auto-approve-on' ? 'after-review' : 'manual', source: 'user-command',
              mainSessionId: agent.id, requirementsVersion: task.requirementsVersion, grantSeq: agent.session.seq } })
          await flush(agent)
          if (revoking) reviewAbort.get(agent)?.abort(new Error('用户撤销自动批准；原审查控制结论已过期'))
          const authorization = approvalFor(agent, configured)
          if (authorization && configured.phase === 'awaiting-approval' && !hasPending(agent)) {
            await verifyBeforeApproval(agent, configured, AbortSignal.timeout(reviewerPolicy.deadlineMs))
            const approved = { ...approvedTask(configured, agent.session.seq), lastApproval: { planVersion: configured.planVersion, userMessageSeq: null, ...authorization } }
            await commitAndWake(agent, configured, approved, executionPrompt(agent, approved, 'The user preauthorized execution after independent plan review. Execute the approved stage and report evidence.'))
            return reply('按任务预授权自动批准', approved, life.armed)
          }
          return reply(input === 'auto-approve-on' ? '已设置：计划通过独立审查后自动执行' : '已撤销自动批准；等待手动批准', configured, life.armed)
        }
        if (input === 'approve') {
          await verifyBeforeApproval(agent, task, AbortSignal.timeout(reviewerPolicy.deadlineMs))
          const next = approvedTask(task, agent.session.seq)
          await commitAndWake(agent, task, next,
            executionPrompt(agent, next,
              'Execute the current approved stage. Report stage evidence using task_report_stage.'))
          return reply('Plan approved', next, life.armed)
        }
        if (input === 'pause' || input === 'off' || input === 'clear') {
          if (input === 'pause' && (task.phase === 'complete' || task.phase === 'cleared')) {
            throw new Error('a finished task cannot be paused')
          }
          withdrawOwned(agent)
          const next: TaskSnapshot = { ...task, revision: task.revision + 1,
            enabled: input === 'off' ? false : task.enabled,
            phase: input === 'clear' ? 'cleared' : input === 'pause' ? 'paused' : task.phase,
            pauseReason: input === 'clear' ? null : 'user' }
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
          if (task.pauseReason === 'review-fault') throw new Error('审查故障尚未解决；请使用 /task retry-review，或编辑任务要求。')
          if (!task.enabled || task.phase === 'awaiting-approval' || task.phase === 'complete' || task.phase === 'cleared') {
            throw new Error('this task cannot resume in its current state')
          }
          if (reviewAbort.has(agent)) throw new Error('审查正在进行，请使用暂停而不是恢复。')
          if (life.armed) return reply('Supervisor already running', task, true)
          const interruptedReview = task.pendingReview
          const next: TaskSnapshot = { ...withRuns(task, recoverRuns(task, agent.session.seq)), revision: task.revision + 1,
            phase: task.phase === 'paused' || task.phase === 'reviewing'
              ? (task.everApproved ? 'active' : 'planning') : task.phase,
            pendingReview: null,
            ...task.planning ? { planning: { ...task.planning, noProgress: 0 } } : {},
            reviewFault: null, pauseReason: null, ...task.recovery ? { recovery: { ...task.recovery, noProgress: 0 } } : {} }
          await commitAndWake(agent, task, next,
            interruptedReview !== null
              ? `Review interrupted for ${interruptedReview.stageId}. Verify current state, then resubmit ${interruptedReview.kind === 'planning' ? 'task_submit_plan' : interruptedReview.kind === 'stage' ? 'task_report_stage' : 'task_request_completion'} with evidence: ${interruptedReview.evidence}`
              : next.phase === 'planning' ? `Resume planning: ${next.objective}. Submit the plan with task_submit_plan.`
                : executionPrompt(agent, next,
                  'Resume the approved task. Check the current workspace before repeating any uncertain effects.'))
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
            planVersion: task.planVersion + 1, criteria: [], stages: [], nodeRuns: [], stageIndex: 0, roundsSinceReview: 0,
            approvedPlanVersion: null, everApproved: false, lastApproval: undefined, approvalPolicy: undefined, readOnlyTurnsBeforeWrite: 0, readOnlyGateStartSeq: null,
            phase: 'planning', pendingReview: null, lastReview: null, reviewFault: null, pauseReason: null, recovery: undefined, planning: undefined }
          if (!next.enabled) {
            appendTask(ctx, agent, next)
            await flush(agent)
            return reply('Task edited; enable and resume the Supervisor to replan', next, false)
          }
          await replaceAndWake(agent, task, next,
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
    parameters: { task_id: { type: 'string', description: 'Optional completed historical task ID; selection does not change the executing task.' } }, output: textOutput,
    async execute(args, exec) {
      const agent = toolAgent(exec)
      const live = current(agent)
      const state = ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')
      const task = !args.task_id || args.task_id === live?.id ? live : state?.archivedTasks.find(entry => entry.task.id === args.task_id)?.task ?? null
      const latestUser = agent.session.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
      const source = latestUser?.type === 'user/message' ? { seq: latestUser.seq, text: latestUser.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n') } : null
      return task === null ? { task: null, supervision: entryActive(agent) ? 'awaiting-objective' : 'not-enabled', latestUserMessage: source, availableActions: ['task_create'] } : { ...taskJson({ ...task, nodeRuns: runsOf(task) }) as Record<string, import('@deepseek-ai/dsh-util-values').JsonValue>,
        currentTaskId: live?.id ?? null,
        latestUserMessage: source,
        continuationOwner: task.phase === 'cleared' ? 'native' : 'supervisor',
        reviewVerification: effectiveVerification,
        availableActions: task.phase === 'complete' ? [...task.enabled ? ['task_create'] : [], 'task_propose_repair', 'await-web-confirmation'] : controlActions(task, runtime(agent).armed, reviewAbort.has(agent)),
        executionAllowed: live?.id === task.id && task.enabled && task.phase === 'active' && runtime(agent).armed,
        executionBlockedReason: task.phase === 'complete' ? 'TASK_COMPLETED: Propose repair and wait for the user click; do not call execution tools.' : !task.enabled ? 'SUPERVISOR_DISABLED' : !runtime(agent).armed ? 'AWAITING_MANUAL_RESUME' : null,
        repairProposals: JSON.parse(JSON.stringify(state?.repairs.filter(p => p.taskId === task.id) ?? [])),
        historicalTasks: state?.archivedTasks.map(entry => ({ id: entry.task.id, revision: entry.task.revision, objective: entry.task.objective, phase: entry.task.phase })) ?? [],
        readyNodeIds: readyNodes(task),
        approvalUserMessageSeq: approvalMessage(toolAgent(exec).session.snapshotEvents().map(controlEvent), task) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_create', description: 'Create a Supervisor Task only from an explicit human request. Read task_status for latestUserMessage.seq first. Bind the original human message, preserve its requirements, and return the real Task ID. Native Goal/Plan and Todo do not create this Task. Creation does not authorize implementation.',
    parameters: { objective: { type: 'string', required: true }, user_message_seq: { type: 'integer', required: true } }, output: textOutput,
    async execute(args, exec) {
      const agent = toolAgent(exec)
      const latest = agent.session.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
      if (!latest || latest.type !== 'user/message' || latest.seq !== args.user_message_seq) throw new Error('Task creation requires the latest original human user/message seq; runtime and skill messages are not authorization.')
      if (!args.objective.trim()) throw new Error('Task objective is required')
      const original = latest.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      const objective = args.objective.trim() === original.trim() ? original.trim() : `${args.objective.trim()}\n\nOriginal user request:\n${original}`
      const task = await createTask(agent, objective, `main-task:${agent.id}:${latest.seq}`, undefined, { seq: latest.seq, signal: exec.signal })
      return { ...taskJson(task) as Record<string, import('@deepseek-ai/dsh-util-values').JsonValue>, executionAuthorized: false, nextAction: 'Inspect requirements and workspace, submit the plan with task_submit_plan, then wait for Task approval.' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_propose_repair', description: 'Propose repair of a completed task through its original DAG. Record defect evidence, root nodes and a short user-facing title. This only shows impact; the user must click confirmation before implementation. Read task_status first, then summarize the impact and wait without modifying files. Never call task_rework_node on a completed task.',
    parameters: { task_id: { type: 'string', required: true }, task_revision: { type: 'integer', required: true },
      title: { type: 'string', required: true }, reason: { type: 'string', required: true },
      root_node_ids: { type: 'array', required: true, items: { type: 'string' } },
      evidence_seqs: { type: 'array', required: true, items: { type: 'integer' } } }, output: textOutput,
    async execute(args, exec) {
      const proposal = await repairs.propose(toolAgent(exec), { source: 'main-agent', proposerSessionId: toolAgent(exec).id, taskId: args.task_id, taskRevision: args.task_revision,
        title: args.title, reason: args.reason, rootNodeIds: args.root_node_ids, evidenceSeqs: args.evidence_seqs }, exec.signal)
      return { proposal: JSON.parse(JSON.stringify(proposal)), executionAuthorized: false, nextAction: 'User clicks Confirm reopening in the impact panel.' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_approve',
    description: 'Apply a direct user approval of the current plan. Read task_status for task id, planVersion and approvalUserMessageSeq. Never invent user authorization; if the message is ambiguous ask the user to use the approval button.',
    parameters: { task_id: { type: 'string', required: true }, plan_version: { type: 'integer', required: true },
      user_message_seq: { type: 'integer', required: true } }, output: textOutput,
    async execute(args, exec) {
      const agent = toolAgent(exec)
      const task = current(agent)
      if (task === null || task.id !== args.task_id || task.planVersion !== args.plan_version) {
        throw new Error('approval refers to a stale task or plan')
      }
      if (task.lastApproval?.planVersion === args.plan_version
        && task.lastApproval.userMessageSeq === args.user_message_seq) return { approved: true, duplicate: true }
      if (approvalMessage(agent.session.snapshotEvents().map(controlEvent), task) !== args.user_message_seq) {
        throw new Error('a current, unambiguous direct user approval is required')
      }
      const next = approvedTask(task, agent.session.seq, args.user_message_seq)
      appendTask(ctx, agent, next)
      await flush(agent)
      runtime(agent).armed = true
      exec.concludeTurn()
      agent.followup(inputFor(next, executionPrompt(agent, next, 'Execute the approved stage and report its evidence.')))
      await flush(agent)
      return { approved: true, planVersion: next.planVersion }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_submit_plan', description: 'Submit or replace a pending DAG plan. Preserve requested node counts. dependsOn requires reviewed acceptance, not worker completion: integration checks needed to accept a worker belong inside its node, never in a blocked successor. Objective criteria use provenance {kind: user, reference: objective}.',
    parameters: {
      criteria: { type: 'array', required: true, items: {
        type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true }, text: { type: 'string', required: true },
          evidenceKind: { type: 'string', enum: ['text', 'runtime', 'visual'], description: 'Use runtime for behavior requiring execution or reproduction, visual for judging actual appearance, and text for static artifacts. Independent verification cannot accept runtime criteria using code reads alone.' },
          provenance: { type: 'object', required: true, additionalProperties: false, properties: {
            kind: { type: 'string', required: true, enum: ['user', 'project', 'implementation'] },
            reference: { type: 'string', required: true, description: 'Use objective for the current user objective; otherwise quote the user instruction, name the applicable project rule, or explain why this implementation choice is necessary.' },
            sourceSeq: { type: 'integer', description: 'Direct user-message seq for user additions; successful project-file read result seq for project rules. Omit for objective and implementation choices.' },
          } },
        },
      } },
      stages: { type: 'array', required: true, items: {
        type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true }, title: { type: 'string', required: true },
          description: { type: 'string', description: 'Implementation scope, deliverables, and validation for this stage.' },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'Dependency node IDs; [] is an independent root. Omission preserves legacy adjacent ordering. All dependencies must pass review before this node runs.' },
          writePaths: { type: 'array', items: { type: 'string' }, description: 'Exact workspace-relative files owned by this node; required for parallel delegation. Directories and overlapping targets are not admitted.' },
          criterionIds: { type: 'array', required: true, items: { type: 'string' } },
        },
      } },
      read_only_turns_before_write: { type: 'integer',
        description: 'Number of completed read-only model turns required after approval before any write. Use at least 1 when the objective requires a separate read-only turn before writing.' },
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = toolAgent(exec)
      const task = current(agent)
      if (task === null || (task.phase !== 'planning' && task.phase !== 'awaiting-approval')) {
        throw new Error('task is not planning or awaiting approval')
      }
      const parsed = planInput.parse(args)
      validatePlan(parsed.criteria, parsed.stages)
      validateProvenance(parsed.criteria, agent.session.snapshotEvents().map(controlEvent))
      const readOnlyTurnsBeforeWrite = parsed.read_only_turns_before_write ?? 0
      if (readOnlyTurnsBeforeWrite > 0 && gateReadTools.size === 0) {
        throw new Error('a read-only turn gate requires read, glob, or grep in planningReadTools')
      }
      let planDecision: Awaited<ReturnType<typeof reviewStage>> | undefined
      if (config.planCoverageReview !== false || task.approvalPolicy?.mode === 'after-review') {
        const abort = new AbortController()
        reviewAbort.set(agent, abort)
        try {
          planDecision = await reviewStage(ctx, agent,
            { ...task, criteria: parsed.criteria, stages: parsed.stages, readOnlyTurnsBeforeWrite },
            'plan', JSON.stringify(parsed.stages), AbortSignal.any([exec.signal, abort.signal]),
            config.reviewerModel, 'plan', selectedReviewPolicy)
        } catch (error) {
          await pauseForReviewFailure(agent, task, error)
          exec.concludeTurn()
          throw error
        } finally {
          reviewAbort.delete(agent)
        }
        const latest = current(agent)
        if (latest?.id !== task.id || latest.revision !== task.revision || !latest.enabled || hasPending(agent)) {
          await finishReviewRecord(agent, planDecision.jobId, 'stale')
          throw new Error('plan review became stale after a task change')
        }
        if (planDecision.verdict !== 'pass') {
          appendTask(ctx, agent, { ...task, revision: task.revision + 1,
            phase: planDecision.verdict === 'needs-user' ? 'paused' : 'planning',
            pauseReason: planDecision.verdict === 'needs-user' ? 'decision' : null, reviewFault: null,
            lastReview: { jobId: planDecision.jobId, stageId: 'plan', cutoff: planDecision.cutoff,
              verdict: planDecision.verdict, finding: planDecision.finding, evidenceSeqs: planDecision.evidenceSeqs,
              reviewerSessionId: planDecision.reviewerSessionId, model: planDecision.model } })
          await finishReviewRecord(agent, planDecision.jobId, 'applied')
          await flush(agent)
          if (planDecision.verdict === 'needs-user') { runtime(agent).armed = false; exec.concludeTurn() }
          return { verdict: planDecision.verdict, finding: planDecision.finding,
            reviewerSessionId: planDecision.reviewerSessionId,
            message: 'Revise the acceptance criteria and ordered stages, then resubmit the plan.' }
        }
      }
      const next: TaskSnapshot = { ...task, revision: task.revision + 1,
        planVersion: task.planVersion + 1, criteria: parsed.criteria, stages: parsed.stages,
        nodeRuns: parsed.stages.map(stage => ({ id: stage.id, attempt: 1, status: 'pending', evidenceAfterSeq: agent.session.seq })), stageIndex: 0,
        readOnlyTurnsBeforeWrite, readOnlyGateStartSeq: task.everApproved ? agent.session.seq : null,
        roundsSinceReview: 0,
        phase: task.everApproved ? 'active' : 'awaiting-approval',
        approvedPlanVersion: task.everApproved ? task.planVersion + 1 : null,
        lastReview: planDecision === undefined ? task.lastReview : {
          jobId: planDecision.jobId, stageId: 'plan', cutoff: planDecision.cutoff, verdict: planDecision.verdict,
          finding: planDecision.finding, evidenceSeqs: planDecision.evidenceSeqs,
          reviewerSessionId: planDecision.reviewerSessionId, model: planDecision.model } }
      let settled = appendTask(ctx, agent, withRuns(next, runsOf(next)))
      if (planDecision) await finishReviewRecord(agent, planDecision.jobId, 'applied')
      await flush(agent)
      exec.signal.throwIfAborted()
      const authorization = approvalFor(agent, settled)
      if (authorization && !disposed && current(agent)?.id === settled.id && current(agent)?.revision === settled.revision && runtime(agent).armed && !hasPending(agent)) {
        await verifyBeforeApproval(agent, settled, exec.signal)
        settled = appendTask(ctx, agent, { ...approvedTask(settled, agent.session.seq),
          lastApproval: { planVersion: settled.planVersion, userMessageSeq: null, ...authorization } })
        await flush(agent)
      }
      if (disposed || current(agent)?.id !== settled.id || current(agent)?.revision !== settled.revision || hasPending(agent)) { runtime(agent).armed = false; throw new Error('task changed during plan admission') }
      if (settled.phase === 'active') runtime(agent).armed = !authorization || config.automaticContinuation !== false
      closeWithResponse(agent, settled.revision)
      return { phase: settled.phase, planVersion: settled.planVersion,
        ...authorization && settled.lastApproval?.source === 'policy' ? { approvalSource: 'policy', authorizationSeq: authorization.authorizationSeq, reviewJobId: authorization.reviewJobId } : {},
        reviewVerification: effectiveVerification,
        ...planDecision === undefined ? {} : { reviewerSessionId: planDecision.reviewerSessionId,
          finding: planDecision.finding },
        message: settled.phase === 'awaiting-approval'
          ? `${planDecision ? 'The independent plan review passed. ' : ''}The user has not approved execution. Tell the user the plan is waiting for approval; do not claim no further decision is needed. ${CLOSING_MESSAGE}`
          : `${authorization && settled.lastApproval?.source === 'policy' ? 'Execution approved under the user task policy after independent plan review. ' : ''}${CLOSING_MESSAGE}` }
    },
  }))

  async function retryReview(agent: Agent, expected: TaskSnapshot, commandSignal: AbortSignal): Promise<void> {
    const job = ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviewJobs.find(item => item.id === expected.reviewFault?.jobId)
    if (!job || job.status !== 'failed' || !expected.enabled || expected.phase !== 'paused'
      || expected.pauseReason !== 'review-fault' || !job.fault?.retryable) throw new Error('no retryable review fault')
    if (job.taskId !== expected.id || job.planVersion !== expected.planVersion
      || job.input.requirementsVersion !== expected.requirementsVersion
      || job.nodeAttempt !== (runsOf(expected).find(run => run.id === job.stageId)?.attempt ?? null)) throw new Error('the original review is no longer valid')
    await agent.runMaintenance(async maintenanceSignal => {
      const latest = current(agent)
      if (latest?.id !== expected.id || latest.revision !== expected.revision || reviewAbort.has(agent)) throw new Error('task changed before review recovery')
      const reviewing: TaskSnapshot = { ...latest, revision: latest.revision + 1, phase: 'reviewing', reviewFault: null, pauseReason: null }
      appendTask(ctx, agent, reviewing)
      await flush(agent)
      const abort = new AbortController()
      reviewAbort.set(agent, abort)
      const signal = AbortSignal.any([commandSignal, maintenanceSignal, abort.signal])
      try {
        const decision = await reviewStage(ctx, agent, job.input, job.stageId, job.evidence, signal,
          config.reviewerModel, job.kind, selectedReviewPolicy, job)
        const actual = current(agent)
        if (signal.aborted || actual?.id !== reviewing.id || actual.revision !== reviewing.revision || !actual.enabled || hasPending(agent)) {
          await finishReviewRecord(agent, decision.jobId, 'stale')
          if (actual?.id === reviewing.id && actual.revision === reviewing.revision) {
            appendTask(ctx, agent, { ...actual, revision: actual.revision + 1, phase: 'paused', pauseReason: 'user', pendingReview: null, reviewFault: null })
            runtime(agent).armed = false
            await flush(agent)
          }
          throw new Error('review recovery became stale')
        }
        let next: TaskSnapshot = { ...actual, revision: actual.revision + 1, pendingReview: null, reviewFault: null,
          pauseReason: decision.verdict === 'needs-user' ? 'decision' : null, roundsSinceReview: 0,
          phase: decision.verdict === 'needs-user' ? 'paused' : job.kind === 'completion' && decision.verdict === 'pass' ? 'complete' : 'active',
          ...job.kind === 'completion' && decision.verdict === 'pass' ? { completedAt: new Date().toISOString() } : {},
          lastReview: { jobId: decision.jobId, stageId: job.stageId, cutoff: decision.cutoff,
            verdict: decision.verdict, finding: decision.finding, evidenceSeqs: decision.evidenceSeqs,
            imageSeqs: decision.imageSeqs, reviewerSessionId: decision.reviewerSessionId, model: decision.model } }
        if (job.kind === 'plan') {
          next = { ...next, phase: decision.verdict === 'needs-user' ? 'paused' : decision.verdict === 'revise' ? 'planning'
            : expected.everApproved ? 'active' : 'awaiting-approval' }
          if (decision.verdict === 'pass') next = { ...next, criteria: job.input.criteria, stages: job.input.stages,
            planVersion: expected.planVersion + 1, stageIndex: 0,
            nodeRuns: job.input.stages.map(stage => ({ id: stage.id, attempt: 1, status: 'pending', evidenceAfterSeq: agent.session.seq })),
            readOnlyTurnsBeforeWrite: job.input.readOnlyTurnsBeforeWrite ?? 0,
            approvedPlanVersion: expected.everApproved ? expected.planVersion + 1 : null }
        } else if (job.kind === 'planning') next = { ...next, phase: decision.verdict === 'needs-user' ? 'paused' : 'planning',
          ...decision.planning ? { planning: { ...decision.planning, requirementsVersion: next.requirementsVersion, cutoff: decision.cutoff, jobId: decision.jobId, evidenceSeqs: decision.evidenceSeqs, noProgress: 0 } } : {} }
        else if (job.kind === 'stage') next = finishNode(next, job.stageId, decision.verdict, agent.session.seq)
        appendTask(ctx, agent, next)
        await finishReviewRecord(agent, decision.jobId, 'applied')
        await flush(agent)
        // Retrying is review permission. Previously paused execution is resumed explicitly.
        runtime(agent).armed = false
      } catch (error) {
        await pauseForReviewFailure(agent, reviewing, error)
        throw error
      } finally { reviewAbort.delete(agent) }
    })
  }

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
      const decision = await reviewStage(ctx, agent, reviewing, stageId, evidence, signal, config.reviewerModel, kind, selectedReviewPolicy)
      signal.throwIfAborted()
      const latest = current(agent)
      if (latest?.id !== reviewing.id || latest.revision !== reviewing.revision || latest.phase !== 'reviewing') {
        await finishReviewRecord(agent, decision.jobId, 'stale')
        throw new Error('review is stale after a task change')
      }
      const next: TaskSnapshot = { ...latest, revision: latest.revision + 1,
        phase: decision.verdict === 'needs-user' ? 'paused'
          : kind === 'completion' && decision.verdict === 'pass' ? 'complete' : 'active',
        ...kind === 'completion' && decision.verdict === 'pass' ? { completedAt: new Date().toISOString() } : {},
        pendingReview: null,
        stageIndex: latest.stageIndex,
        roundsSinceReview: 0,
        reviewFault: null, pauseReason: decision.verdict === 'needs-user' ? 'decision' : null,
        lastReview: { jobId: decision.jobId, stageId, cutoff: decision.cutoff, verdict: decision.verdict, finding: decision.finding,
          imageSeqs: decision.imageSeqs, evidenceSeqs: decision.evidenceSeqs, reviewerSessionId: decision.reviewerSessionId, model: decision.model } }
      const settled = kind === 'stage' ? finishNode(next, stageId, decision.verdict, agent.session.seq) : next
      appendTask(ctx, agent, settled)
      await finishReviewRecord(agent, decision.jobId, 'applied')
      await flush(agent)
      runtime(agent).armed = settled.phase === 'active'
      const awaitsCompletion = kind === 'stage' && settled.phase === 'active'
        && acceptedNodes(settled).length === settled.stages.length
      if (awaitsCompletion) exec.concludeTurn()
      else closeWithResponse(agent, settled.revision)
      return { verdict: decision.verdict, finding: decision.finding,
        message: awaitsCompletion
          ? 'All stages passed. The controller will start a new turn with tools for whole-task completion review.'
          : CLOSING_MESSAGE,
        imageSeqs: decision.imageSeqs, evidenceSeqs: decision.evidenceSeqs, reviewerSessionId: decision.reviewerSessionId,
        nextStage: settled.stages[settled.stageIndex]?.id ?? null, phase: settled.phase }
    } catch (error: unknown) {
      const latest = current(agent)
      if (latest?.id === reviewing.id && latest.revision === reviewing.revision && latest.phase === 'reviewing') {
        await pauseForReviewFailure(agent, reviewing, error)
      }
      exec.concludeTurn()
      throw error
    } finally {
      reviewAbort.delete(agent)
    }
  }

  ctx.tools.register(defineTool({
    name: 'task_start_node',
    description: 'Record the main Agent starting a ready DAG node before implementation. Read task_status for the node and current attempt. Resuming the same running attempt is idempotent.',
    parameters: {
      stage_id: { type: 'string', required: true },
      attempt: { type: 'integer', required: true, description: 'Exact current node attempt from task_status.' },
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = toolAgent(exec)
      const task = current(agent)
      if (task === null || task.phase !== 'active' || !task.enabled || !runtime(agent).armed) throw taskExecutionError(task)
      const run = runsOf(task).find(item => item.id === args.stage_id)
      if (!run || run.attempt !== args.attempt) throw new Error('node attempt is stale; read task_status')
      if (run.status === 'running' && run.sessionId === agent.id) return { nodeId: run.id, attempt: run.attempt, status: 'running', sessionId: agent.id }
      if (runsOf(task).some(item => item.status === 'running' && item.sessionId === agent.id)) {
        throw new Error('report or rework the main Agent running node before starting another')
      }
      const next = { ...beginNode(task, run.id, agent.id), revision: task.revision + 1 }
      appendTask(ctx, agent, next)
      await flush(agent)
      return { nodeId: run.id, attempt: run.attempt, status: 'running', sessionId: agent.id }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_report_stage',
    description: 'Submit evidence for the current plan stage; an independent reviewer checks it.',
    parameters: {
      stage_id: { type: 'string', required: true },
      attempt: { type: 'integer', description: 'Current node attempt from task_status. Required after rework; initial attempt is 1.' },
      evidence: { type: 'string', required: true, description: 'Concrete artifact and test evidence, with Session references when known.' },
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = toolAgent(exec)
      const task = current(agent)
      if (task === null || task.phase !== 'active' || !task.enabled || !runtime(agent).armed) throw taskExecutionError(task)
      const stage = task.stages.find(stage => stage.id === args.stage_id)
      if (stage === undefined || !args.evidence.trim()) {
        throw new Error('report the current stage with concrete evidence')
      }
      requireIntegration(agent, stage.id, config.integrationTools ?? ['bash', 'read_image'], ctx)
      return settleReview(agent, reviewNode(task, stage.id, args.attempt), stage.id, args.evidence, 'stage', exec)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_rework_node', description: 'Rework a node only in an active, armed task and invalidate dependent acceptance. Completed tasks require task_propose_repair and user click confirmation. Inspect task_status for the new attempt IDs before executing.',
    parameters: { stage_id: { type: 'string', required: true }, reason: { type: 'string', required: true } }, output: textOutput,
    async execute(args, exec) {
      const agent = toolAgent(exec)
      const task = current(agent)
      if (task === null || task.phase !== 'active' || !task.enabled || !runtime(agent).armed) throw taskExecutionError(task)
      if (!args.reason.trim()) throw new Error('rework needs a reason')
      const next = { ...reworkNode(task, args.stage_id, agent.session.seq), revision: task.revision + 1, pendingReview: null, lastReview: null }
      appendTask(ctx, agent, next)
      await flush(agent)
      exec.concludeTurn()
      return { task: taskJson(next), readyNodeIds: readyNodes(next), reason: args.reason,
        rework: { nodes: changedAttempts(task, next) } }
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
      if (task === null || task.phase !== 'active' || !task.enabled || !runtime(agent).armed) throw taskExecutionError(task)
      if (task.stages.length === 0 || acceptedNodes(task).length !== task.stages.length || !args.evidence.trim()) {
        throw new Error('every stage must pass before requesting final completion')
      }
      return settleReview(agent, task, 'completion', args.evidence, 'completion', exec)
    },
  }))
}
