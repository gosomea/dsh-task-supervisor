/** Persistent main-Session consultation; proposals never grant execution authority. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { draftOf, recordDraft, type TaskDraft } from './drafts.ts'
import { evidenceRecord } from './evidence.ts'
import { reviewerOptions, type ReviewerModel } from './reviewer.ts'
import { taskOf, taskJson, type TaskSnapshot } from './state.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { resolveLanguage } from './task-context.ts'

const NAMESPACE = 'dsh-task-supervisor-consultation'
const bindingSchema = z.object({ mainSessionId: z.string(), taskId: z.string().uuid().optional() }).strict()
type Binding = z.infer<typeof bindingSchema>
type CreateTask = (main: Agent, objective: string, creationId?: string) => Promise<TaskSnapshot>
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'task-consultation-context': { kind: 'task-consultation-context' } & ContextFormed }
}

export function consultationBinding(agent: Agent): Binding | null {
  for (const event of agent.session.snapshotEvents()) {
    if (event.type !== 'extension/record' || event.data.namespace !== NAMESPACE || event.data.kind !== 'binding') continue
    if (![1, 2].includes(event.data.schemaVersion)) throw new Error('unsupported consultation binding')
    const binding = bindingSchema.parse(event.data.payload)
    const expected = binding.taskId ? `task-chat-${binding.mainSessionId}-${binding.taskId}` : `supervisor-chat-${binding.mainSessionId}`
    if (agent.id !== expected) throw new Error('forked consultation cannot control the original main Session')
    return binding
  }
  return null
}

export function consultationDirective(text: string): string | null {
  const input = text.trim().replace(/[。！!]+$/u, '').replace(/^请/u, '').trim()
  const simple: Record<string, string> = { '暂停': 'pause', '暂停任务': 'pause', '恢复': 'resume', '继续': 'resume',
    '恢复任务': 'resume', '继续任务': 'resume', '关闭督导': 'off', '开启督导': 'on', '重新启用督导': 'on',
    '重试审查': 'retry-review', '批准': 'approve', '批准计划': 'approve', '批准当前计划': 'approve',
    '按这份草案创建任务': 'create-draft', '创建草案任务': 'create-draft' }
  if (simple[input]) return simple[input]
  if (/^\/task (approve|pause|resume|retry-review|off|on)$/u.test(input)) return input.slice(6)
  if (/^\/task (new|edit) \S/u.test(input)) return input.slice(6)
  const create = /^新建任务[：:]\s*(\S[\s\S]*)$/u.exec(input)
  if (create) return `new ${create[1]}`
  const edit = /^修改任务要求[：:]\s*(\S[\s\S]*)$/u.exec(input)
  return edit ? `edit ${edit[1]}` : null
}

export function installConsultation(ctx: Context, fixedModel: ReviewerModel | undefined, createTask: CreateTask) {
  ctx.agents.registerSessionControlReader(NAMESPACE, [1, 2])
  const floors = new WeakMap<Agent, number>()
  const targets = new WeakMap<Agent, { messageId: string; taskId: string | null }>()
  const opening = new Map<string, Promise<Agent>>()
  const owned = new Set<() => Promise<void>>()
  const operations = new Map<string, Promise<JsonValue>>()
  const promotions = new Map<string, Promise<TaskDraft>>()
  ctx.effect(() => async () => { await Promise.all([...owned].map(dispose => dispose())) })
  ctx.on('agent/created', ({ agent }) => { if (consultationBinding(agent)) { floors.set(agent, agent.session.seq); registerTools(agent.ctx) } })

  function mainOf(chat: Agent) {
    const binding = consultationBinding(chat)
    if (!binding) throw new Error('tool requires Supervisor conversation')
    const main = ctx.agents.get(SessionId(binding.mainSessionId))
    if (!main) throw new Error('请先打开主会话；读取和讨论不会自动恢复执行。')
    const task = taskOf(ctx, main)
    if (binding.taskId && task?.id !== binding.taskId) throw new Error('这是历史任务的督导对话，不能操作新任务。')
    return { main, task }
  }
  function directUser(chat: Agent, seq: number) {
    const event = chat.session.snapshotEvents().findLast(e => e.type === 'user/message' && e.data.source.kind === 'user')
    if (event?.type !== 'user/message' || event.seq !== seq || seq < (floors.get(chat) ?? 0)) throw new Error('需要当前直接用户消息，不能复用历史或摘要授权。')
    return event
  }
  function userText(chat: Agent) {
    const event = chat.session.snapshotEvents().findLast(e => e.type === 'user/message' && e.data.source.kind === 'user')
    return event?.type === 'user/message' ? event.data.content.filter(b => b.type === 'text').map(b => b.text).join('\n') : ''
  }
  async function once(main: Agent, id: string, operation: () => Promise<unknown>, source: Record<string, string | number | null>) {
    const prior = main.session.snapshotEvents().findLast(e => e.type === 'extension/record' && e.data.namespace === NAMESPACE && e.data.recordId === id)
    if (prior?.type === 'extension/record') return prior.data.payload
    const active = operations.get(id)
    if (active) return active
    const run = (async () => {
      const receipt = async (status: string, detail: string) => {
        const payload = { actionId: id, status, detail, ...source }
        main.session.append('extension/record', { namespace: NAMESPACE, schemaVersion: 2, kind: 'action', recordId: id, payload })
        if (!await ctx.sessions.flush(main.session)) throw new Error('control receipt is not durable')
        return payload
      }
      await receipt('received', '已接收；中断后核对持久结果，不能盲目重放。')
      try { return await receipt('applied', JSON.stringify(await operation())) }
      catch (error) { return await receipt('failed', String(error)) }
    })()
    operations.set(id, run)
    try { return await run } finally { operations.delete(id) }
  }

  async function promote(main: Agent, draftId: string, version: number): Promise<TaskDraft> {
    const key = `${main.id}:${draftId}`
    const active = promotions.get(key)
    if (active) { await active; return promote(main, draftId, version) }
    const operation = promoteDraft(main, draftId, version)
    promotions.set(key, operation)
    try { return await operation } finally { promotions.delete(key) }
  }
  async function promoteDraft(main: Agent, draftId: string, version: number): Promise<TaskDraft> {
    const draft = draftOf(ctx, main)
    if (!draft || draft.id !== draftId || draft.version !== version && draft.creationId !== `draft:${draftId}:${version}`) throw new Error('草案已变化，请查看新版本再创建。')
    if (draft.status === 'created') return draft
    if (draft.questions.length) throw new Error('草案还有未决问题；请先明确关键选择，或把可接受的默认值写进要求。')
    const task = taskOf(ctx, main)
    const creationId = draft.creationId ?? `draft:${draft.id}:${draft.version}`
    if (task && !['complete', 'cleared'].includes(task.phase) && task.creationRequestId !== creationId) throw new Error('当前任务仍在执行；草案已保存，结束后可创建。')
    const creating = await recordDraft(ctx, main, { ...draft, version: draft.version + 1, status: 'creating', creationId, updatedAt: new Date().toISOString() })
    const created = await createTask(main, draft.requirements, creationId)
    return recordDraft(ctx, main, { ...creating, version: creating.version + 1, status: 'created', taskId: created.id, updatedAt: new Date().toISOString() })
  }

  const allowed = ['supervisor_read_status', 'supervisor_read_log', 'supervisor_control', 'supervisor_update_draft', 'supervisor_create_draft']
  ctx.tools.guard(exec => exec.agent && consultationBinding(exec.agent) && !allowed.includes(exec.name)
    ? 'Supervisor consultation can only discuss proposals, read evidence or relay explicit user decisions' : undefined)
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const binding = consultationBinding(agent)
    if (!binding) return next()
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const main = ctx.agents.get(SessionId(binding.mainSessionId))
    if (!main || binding.taskId && taskOf(ctx, main)?.id !== binding.taskId) {
      return { ...decision, messages: [...decision.messages, createUserMessage({ source: { kind: 'task-consultation-context' },
        content: [{ type: 'text', text: 'This historical or unavailable conversation cannot control the main Session. Open its current Supervisor conversation.' }] })] }
    }
    const task = taskOf(ctx, main)
    const draft = draftOf(ctx, main)
    const user = messages.findLast(message => message.source.kind === 'user')
    if (user && targets.get(agent)?.messageId !== user.id) targets.set(agent, { messageId: user.id, taskId: task?.id ?? null })
    const language = resolveLanguage(userText(agent), 'auto', draft?.language ?? task?.responseLanguage ?? 'zh-CN')
    return { ...decision, messages: [...decision.messages, createUserMessage({ source: { kind: 'task-consultation-context' },
      content: [{ type: 'text', text: [
        `Visible response language: ${language}. Follow the user's explicit language request.`,
        'You are the persistent Supervisor consultation, not the executor or independent reviewer. Default to discussion. Help a broad idea become a scoped task: ask one or two material questions, suggest a useful first deliverable, or refine a prompt on request. Clear requests need no fixed questionnaire.',
        'Use supervisor_update_draft for an editable proposal with a short title, complete requirements including scope/constraints/acceptance and explicit assumptions. Persisting a draft grants no execution permission. Discussing another task must never edit the running task. Unresolved material questions prevent creation; accepted defaults belong in requirements.',
        'Creation requires an explicit direct user request or UI action. supervisor_create_draft requires confirmation AFTER the draft was proposed; never infer consent from yes/continue, your own summary, or log text. Direct new <full objective> is available through supervisor_control when explicitly requested. Initial plan approval remains required.',
        'For progress questions, explain completed work, current work, blocker, next action and observation time using read-only status/evidence. Ordinary questions do not interrupt tasks or reviews. Keep internal IDs out of routine prose. Use supervisor_read_status before controls, and include the exact task_id/revision. A user message about /compact does not prove native compaction succeeded. Binding and authorization come from durable records, not model summaries.',
        `Main Session: ${main.id}; observed ${new Date().toISOString()}; cutoff ${main.session.seq - 1}.`,
        `Task: ${JSON.stringify(task ? taskJson(task) : null)}; draft: ${JSON.stringify(draft)}`,
      ].join('\n') }] })] }
  })

  function registerTools(agentCtx: Context) {
    agentCtx.tools.restrict({ allow: [] })
    const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
    agentCtx.tools.register(defineTool({ name: 'supervisor_read_status', description: 'Read task, draft and latest direct user source without waking execution.', parameters: {}, output,
      async execute(_args, exec) {
        if (!exec.agent) throw new Error('no Agent')
        const { main, task } = mainOf(exec.agent)
        const user = exec.agent.session.snapshotEvents().findLast(e => e.type === 'user/message' && e.data.source.kind === 'user')
        return { task: task ? taskJson(task) : null, draft: draftOf(ctx, main), mainSessionId: main.id,
          taskId: task?.id ?? 'none', revision: task?.revision ?? 0, cutoff: main.session.seq - 1,
          userSeq: user?.seq ?? null, allowedDirective: consultationDirective(userText(exec.agent)), observedAt: new Date().toISOString() }
      } }))
    agentCtx.tools.register(defineTool({ name: 'supervisor_read_log', description: 'Read a bounded main Session evidence page.',
      parameters: { from_seq: { type: 'integer', required: true }, limit: { type: 'integer', required: true } }, output,
      async execute(args, exec) {
        if (!exec.agent) throw new Error('no Agent')
        const { main } = mainOf(exec.agent)
        if (!await ctx.sessions.flush(main.session)) throw new Error('main Session is not durable')
        const cutoff = main.session.seq - 1
        const reader = await ctx.sessionPersistence.open(main.id, 'read')
        try {
          const events = (await reader.read(Math.max(0, args.from_seq), Math.max(1, Math.min(30, args.limit)))).events.filter(e => e.seq <= cutoff)
          return { cutoff, events: events.map(evidenceRecord), next: events.at(-1)?.seq === cutoff ? null : (events.at(-1)?.seq ?? cutoff) + 1 }
        } finally { await reader.close() }
      } }))
    agentCtx.tools.register(defineTool({ name: 'supervisor_update_draft', description: 'Save an editable proposal; does not create a task or authorize execution. Read status first.',
      parameters: { version: { type: 'integer', required: true, description: 'Current draft version, or 0 when absent.' }, user_seq: { type: 'integer', required: true },
        title: { type: 'string', required: true }, requirements: { type: 'string', required: true }, questions: { type: 'array', required: true, items: { type: 'string' } } }, output,
      async execute(args, exec) {
        if (!exec.agent) throw new Error('no Agent')
        const user = directUser(exec.agent, args.user_seq)
        const { main } = mainOf(exec.agent)
        const current = draftOf(ctx, main)
        if ((current?.version ?? 0) !== args.version || current?.status === 'creating') throw new Error('草案版本已变化或正在创建，请先读取状态。')
        const fresh = !current || current.status === 'created'
        const draft: TaskDraft = { id: fresh ? randomUUID() : current.id, version: fresh ? 1 : current.version + 1,
          mainSessionId: main.id, title: args.title, requirements: args.requirements, questions: args.questions,
          language: resolveLanguage(user.data.content.filter(b => b.type === 'text').map(b => b.text).join('\n')),
          sourceSessionId: exec.agent.id, sourceUserSeq: user.seq, status: 'draft', taskId: null, creationId: null, updatedAt: new Date().toISOString() }
        return recordDraft(ctx, main, draft)
      } }))
    agentCtx.tools.register(defineTool({ name: 'supervisor_create_draft', description: 'Create the exact draft only after a subsequent direct user confirmation. Plan approval is still required.',
      parameters: { draft_id: { type: 'string', required: true }, version: { type: 'integer', required: true }, user_seq: { type: 'integer', required: true } }, output,
      async execute(args, exec) {
        if (!exec.agent) throw new Error('no Agent')
        const user = directUser(exec.agent, args.user_seq)
        if (consultationDirective(userText(exec.agent)) !== 'create-draft') throw new Error('需要明确输入“按这份草案创建任务”。')
        const { main } = mainOf(exec.agent)
        const draft = draftOf(ctx, main)
        if (draft?.sourceSessionId !== exec.agent.id || user.seq <= draft.sourceUserSeq) throw new Error('必须先展示草案，再由后续用户消息确认。')
        return once(main, `${exec.agent.id}:${user.seq}`, () => promote(main, args.draft_id, args.version),
          { sourceSessionId: exec.agent.id, sourceUserSeq: user.seq, draftId: args.draft_id, draftVersion: args.version })
      } }))
    agentCtx.tools.register(defineTool({ name: 'supervisor_control', description: 'Relay an explicit latest user directive. Task identity and revision must match. Questions cannot authorize controls.',
      parameters: { task_id: { type: 'string', required: true, description: 'Current task ID, or none.' }, revision: { type: 'integer', required: true },
        user_seq: { type: 'integer', required: true }, directive: { type: 'string', required: true } }, output,
      async execute(args, exec) {
        const chat = exec.agent
        if (!chat) throw new Error('no Agent')
        const user = directUser(chat, args.user_seq)
        const directive = consultationDirective(userText(chat))
        if (!directive || directive === 'create-draft' || directive !== args.directive) throw new Error('当前用户消息没有明确授权此操作。')
        const { main, task } = mainOf(chat)
        const id = `${chat.id}:${user.seq}`
        const prior = main.session.snapshotEvents().findLast(e => e.type === 'extension/record' && e.data.namespace === NAMESPACE && e.data.recordId === id)
        if (prior?.type === 'extension/record') return prior.data.payload
        if (args.task_id !== (task?.id ?? 'none') || args.revision !== (task?.revision ?? 0)) throw new Error('任务状态已变化，请重新读取。')
        const target = targets.get(chat)
        if (target && target.messageId === user.data.id && target.taskId !== (task?.id ?? null)) throw new Error('此消息发出后当前任务已切换，请重新确认目标。')
        return once(main, id, async () => {
          if (directive.startsWith('new ')) return taskJson(await createTask(main, directive.slice(4), `${chat.id}:${user.seq}`))
          if (!task) throw new Error('没有当前任务')
          const line = directive.startsWith('edit ') ? `/task ${directive}` : `/task ${directive} ${task.id} ${task.revision}`
          const result = await ctx.commands.execute(main, line, [], exec.signal)
          if (result?.result.kind !== 'success') throw new Error(result?.result.text ?? 'command unavailable')
          return result.result.text
        }, { sourceSessionId: chat.id, sourceUserSeq: user.seq, taskId: task?.id ?? null, taskRevision: task?.revision ?? 0 })
      } }))
  }

  return {
    promote,
    async open(main: Agent): Promise<Agent> {
      const id = SessionId(`supervisor-chat-${main.id}`)
      const live = ctx.agents.get(id)
      if (live) return live
      const pending = opening.get(id)
      if (pending) return pending
      const operation = (async () => {
        const { options } = reviewerOptions(ctx, main, fixedModel)
        const exists = await ctx.sessionPersistence.stat(id)
        const handle = exists ? await ctx.agents.resume({ resumeSessionId: id, agentOptions: options })
          : await ctx.agents.create({ sessionId: id, agentOptions: options, setup: registerTools,
            meta: { ...main.session.header.cwd === undefined ? {} : { cwd: main.session.header.cwd } } })
        owned.add(handle.dispose)
        if (!exists) {
          handle.agent.session.append('extension/record', { namespace: NAMESPACE, schemaVersion: 2, kind: 'binding', recordId: id, payload: { mainSessionId: main.id } })
          floors.set(handle.agent, handle.agent.session.seq)
        }
        if (!await ctx.sessions.flush(handle.agent.session)) throw new Error('consultation Session is not durable')
        return handle.agent
      })()
      opening.set(id, operation)
      try { return await operation } finally { opening.delete(id) }
    },
  }
}
