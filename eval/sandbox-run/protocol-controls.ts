/** Evaluation-only deterministic controls; no model supervision or hidden tests. */
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-llm'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type {} from '../../src/state.ts'
import { appendControlRecord, controlEvent } from '../../src/session-records.ts'

export const name = 'long-horizon-evaluation-protocol'
export const inject = ['commands', 'agents', 'sessions', 'sessionProjections', 'llm']
interface Config { initialSha256: string; condition?: 'goal' | 'plan' | 'supervisor-independent'; revision?: { objective: string; sha256: string }; injectStageTimeout?: boolean }
const namespace = 'dsh-long-horizon-eval'
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

export function apply(ctx: Context, config: Config): void {
  const bound = new Set<string>()
  const writes = new Set<Promise<unknown>>()
  const questions = new Map<string, { agent: Agent; request: AskUserQuestionRequest; resolve(answer: AskUserQuestionAnswer): void; reject(error: Error): void }>()
  let disposed = false
  const projection = (agent: Agent) => ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')
  const records = (agent: Agent) => agent.session.snapshotEvents().map(controlEvent).filter(event => event.type === 'extension/record'
    && event.data.namespace === namespace)
  const persist = async (agent: Agent, kind: string, id: string, payload: Record<string, unknown>) => {
    appendControlRecord(agent, { namespace, schemaVersion: 1, kind, recordId: id, payload: JSON.parse(JSON.stringify(payload)) })
    const operation = ctx.sessions.flush(agent.session); writes.add(operation)
    try { if (!await operation) throw new Error('protocol record not durable') }
    finally { writes.delete(operation) }
  }
  ctx.effect(() => async () => {
    disposed = true; bound.clear()
    for (const pending of questions.values()) pending.reject(new Error('protocol disposed; no answer'))
    questions.clear(); await Promise.allSettled([...writes])
  })
  // The public answerer seam preserves native Plan's exact offered choice.
  // No Plan state mutation, browser click or additional model is involved.
  ctx.on('user-questions/request', async (request, next) => {
    const agent = request.agent
    if (!agent || !bound.has(agent.id)) return next()
    const id = randomUUID(), plan = config.condition === 'plan' && request.questions.length === 1
      && request.questions[0]?.intent?.kind === 'plan-review' ? request.questions[0] : null
    const row = { id, revision: 1, mainSessionId: agent.id, status: 'open',
      kind: plan ? 'native-plan-approval' : 'user-decision',
      callId: plan?.intent?.callId ?? null, planSha256: plan?.detail ? sha(plan.detail) : null,
      approve: plan?.intent?.approve ?? null, source: 'evaluation-protocol' }
    let abort: (() => void) | undefined
    try {
      const answer = new Promise<AskUserQuestionAnswer>((resolve, reject) => {
        questions.set(id, { agent, request, resolve, reject })
        abort = () => reject(new Error('native question cancelled; no answer'))
        request.signal?.addEventListener('abort', abort, { once: true })
        if (request.signal?.aborted) abort()
      })
      void answer.catch(() => {})
      await persist(agent, 'question', id, row)
      return await answer
    } finally {
      if (abort) request.signal?.removeEventListener('abort', abort)
      questions.delete(id)
      if (!disposed) await persist(agent, 'question', id, { ...row, revision: 2, status: 'closed' })
    }
  })
  ctx.commands.register({ name: 'eval-protocol', description: 'Frozen evaluation protocol control',
    async handler({ agent, rawInput, signal }) {
      try {
        const input = JSON.parse(rawInput)
        signal.throwIfAborted()
        if (input.action === 'bind') {
          if (records(agent).some(event => event.type === 'extension/record' && event.data.kind === 'bind')) throw new Error('already bound; do not redeliver')
          await persist(agent, 'bind', input.actionId, { source: 'evaluation-protocol', actionId: input.actionId,
            mainSessionId: agent.id, initialSha256: config.initialSha256, revisionSha256: config.revision?.sha256 ?? null })
          bound.add(agent.id)
          return { kind: 'success', text: 'Protocol bound; no task or model started' }
        }
        // Reopening a Session does not restore execution authority automatically.
        if (!bound.has(agent.id) || disposed) throw new Error('protocol requires original live binding')
        if (input.action === 'native-plan-approval') {
          const pending = questions.get(input.questionId), question = pending?.request.questions[0]
          if (config.condition !== 'plan' || pending?.agent !== agent || pending.request.signal?.aborted
            || pending.request.questions.length !== 1 || question?.intent?.kind !== 'plan-review'
            || !question.detail || sha(question.detail) !== input.planSha256 || question.intent.callId !== input.callId
            || records(agent).some(event => event.type === 'extension/record' && event.data.kind === 'native-plan-grant')) throw new Error('no matching first native Plan question')
          await persist(agent, 'native-plan-grant', input.actionId, { ...input, source: 'evaluation-protocol', mainSessionId: agent.id })
          signal.throwIfAborted()
          if (disposed || questions.get(input.questionId) !== pending || pending.request.signal?.aborted) throw new Error('native Plan question no longer active')
          pending.resolve({ answers: [{ id: question.id, selected: [question.intent.approve] }] })
          return { kind: 'success', text: 'One native Plan approval delivered through user-questions' }
        }
        const task = projection(agent)?.current
        if (!task || task.id !== input.taskId || task.revision !== input.revision
          || task.requirementsVersion !== input.requirementsVersion || task.planVersion !== input.planVersion) throw new Error('stale protocol action')
        if (records(agent).some(event => event.type === 'extension/record' && event.data.kind === 'action-intent'
          && typeof event.data.payload === 'object' && event.data.payload !== null && !Array.isArray(event.data.payload)
          && event.data.payload.action === input.action)) throw new Error('protocol action already reserved; reconcile native state')
        let command: string
        if (input.action === 'revision') {
          const barrier = records(agent).some(event => event.type === 'extension/record' && event.data.kind === 'revision-barrier')
          if (!config.revision || !barrier || task.requirementsVersion !== 1 || input.objective !== config.revision.objective
            || sha(input.objective) !== config.revision.sha256) throw new Error('revision outside frozen preauthorization')
          command = `/task edit ${config.revision.objective}`
        } else if (['initial-approval', 'revision-approval'].includes(input.action)) {
          const req = input.action === 'initial-approval' ? 1 : 2
          const job = projection(agent)?.reviewJobs.find(item => item.id === input.reviewJobId)
          if (task.requirementsVersion !== req || task.phase !== 'awaiting-approval' || task.everApproved
            || !job || job.taskId !== task.id || job.mainSessionId !== agent.id || job.status !== 'applied'
            || job.kind !== 'plan' || job.fault || job.input.requirementsVersion !== req
            || job.planVersion + 1 !== task.planVersion || job.decision?.verdict !== 'pass') throw new Error('no matching applied plan')
          if (req === 2 && (!config.revision || task.objective !== config.revision.objective)) throw new Error('revision authorization not applicable')
          command = `/task approve ${task.id} ${task.revision}`
        } else throw new Error('protocol action not allowed')
        await persist(agent, 'action-intent', input.actionId, { ...input, source: 'evaluation-protocol', mainSessionId: agent.id })
        signal.throwIfAborted()
        if (projection(agent)?.current?.revision !== task.revision) throw new Error('Task changed during protocol reservation')
        const result = await ctx.commands.execute(agent, command, [], signal)
        await persist(agent, 'action-result', input.actionId + ':result', { source: 'evaluation-protocol', actionId: input.actionId,
          mainSessionId: agent.id, taskId: task.id, action: input.action, kind: result?.result.kind ?? 'unavailable' })
        if (result?.result.kind !== 'success') throw new Error(`native protocol command not accepted: ${result?.result.text ?? 'unavailable'}`)
        return { kind: 'success', text: 'Protocol action handed to native Task controller' }
      } catch (error) { return { kind: 'error', text: String(error) } }
    },
  })
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    if (!config.revision || !bound.has(agent.id)) return next()
    const state = projection(agent), task = state?.current
    const first = task?.stages[0], run = task?.nodeRuns?.find(item => item.id === first?.id)
    if (!task || task.requirementsVersion !== 1 || sha(task.objective) !== config.initialSha256
      || !first || run?.status !== 'passed' || run.attempt !== 1) return next()
    if (task.nodeRuns?.some(item => item.id !== first.id && ['running', 'reviewing', 'passed'].includes(item.status))) throw new Error('missed revision barrier')
    const prior = records(agent).some(event => event.type === 'extension/record' && event.data.kind === 'revision-barrier')
    if (!prior) await persist(agent, 'revision-barrier', `${task.id}:revision-barrier`, { source: 'evaluation-protocol',
      mainSessionId: agent.id, taskId: task.id, requirementsVersion: 1, initialSha256: config.initialSha256,
      revisionSha256: config.revision.sha256, nodeId: first.id, nodeAttempt: 1, nextNodeStarted: false })
    // This native pre-step barrier holds even if outer observation takes 60s.
    // edit/pause/disposal aborts the native signal, so no old step is admitted.
    while (!disposed) {
      const current = projection(agent)?.current
      if (!current || current.id !== task.id || current.requirementsVersion !== 1
        || !current.enabled || current.phase === 'paused' || current.phase === 'cleared') break
      await delay(100, undefined, { signal })
    }
    signal.throwIfAborted()
    return { kind: 'reject' }
  })
  if (config.injectStageTimeout) ctx.on('llm/stream', (options, next) => ({
    async *[Symbol.asyncIterator]() {
      const main = [...bound].map(id => ctx.agents.get(id as Agent['id'])).find(agent => agent
        && projection(agent)?.reviewJobs.some(job => job.reviewerSessionId === options.sessionId && job.kind === 'stage'))
      const job = main && projection(main)?.reviewJobs.find(item => item.reviewerSessionId === options.sessionId && item.kind === 'stage')
      const reviewer = options.sessionId && ctx.agents.get(options.sessionId)
      const events = reviewer?.session.snapshotEvents() ?? []
      const reads = new Set(events.filter(event => event.type === 'tool/call'
        && /^(inspect_task_artifact|read_review_evidence)$/.test(event.data.name))
        .map(event => event.type === 'tool/call' ? event.data.callId : ''))
      const read = events.find(event => event.type === 'tool/result' && !event.data.message.isError
        && reads.has(event.data.message.toolCallId))
      const injected = main && records(main).some(event => event.type === 'extension/record' && event.data.kind === 'fault-injection')
      // Context/index reads carry no artifact read qualification. Hold only
      // after a real acquired page that recovery must preserve.
      if (main && job && read && !injected
        && (job.verification?.readFiles.length || job.verification?.readChecks.length)) {
        await persist(main, 'fault-injection', job.id + ':timeout', { source: 'evaluation-test-injection',
          type: 'stage-review-deadline', jobId: job.id, reviewerSessionId: job.reviewerSessionId,
          afterSuccessfulToolResult: true, successfulReadSeq: read.seq,
          cutoff: job.cutoff, snapshotId: job.verification?.snapshot.id ?? null })
        // No fabricated HTTP evidence: let the review's own deadline cancel the
        // real request boundary after an actual successful reviewer read.
        if (!options.signal) throw new Error('fault fixture requires native cancellation')
        await delay(3600000, undefined, { signal: options.signal })
      }
      yield* next()
    },
  }))
}
