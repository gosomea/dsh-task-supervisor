/** Main-Agent initiated native workers with disjoint file ownership and a required integration handoff. */
import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { childSessionMeta } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { beginNode, readyNodes, runsOf, withRuns } from './graph.ts'
import { appendTask, taskOf } from './state.ts'
import { languagePolicy } from './task-context.ts'
import { reviewerOptions } from './reviewer.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'task-node-worker': { kind: 'task-node-worker'; taskId: string; nodeId: string; attempt: number } & ContextFormed }
}
const NAMESPACE = 'dsh-task-supervisor-worker'
interface Batch { abort: AbortController; handles: AgentHandle[] }
interface Ownership { main: Agent; revision: number; keys: Set<string> }

export function installDelegation(ctx: Context, armed: (agent: Agent) => boolean, maxParallelNodes = 2) {
  if (!Number.isSafeInteger(maxParallelNodes) || maxParallelNodes < 1 || maxParallelNodes > 8) throw new Error('maxParallelNodes must be between 1 and 8')
  const batches = new Map<Agent, Batch>()
  const owners = new Map<Agent, Ownership>()
  ctx.agents.registerSessionControlReader(NAMESPACE, [1])
  // Closed workers are evidence only. A new attempt must be dispatched by the main controller.
  ctx.on('agent/pre-step', ({ agent }, next) => {
    const worker = agent.session.snapshotEvents().some(e => e.type === 'extension/record' && e.data.namespace === NAMESPACE)
    return worker && !owners.has(agent) ? Promise.resolve({ kind: 'reject' as const }) : next()
  })
  function cancel(main: Agent) { batches.get(main)?.abort.abort(new Error('task control changed')) }
  ctx.effect(() => () => { for (const main of batches.keys()) cancel(main) })
  ctx.on('agent/disposed', ({ agent }) => cancel(agent))
  ctx.tools.guard(exec => {
    if (!exec.agent) return undefined
    if (batches.has(exec.agent) && exec.name !== 'task_status') return 'wait for dispatched nodes before other main-Agent tools'
    const owner = owners.get(exec.agent)
    if (!owner) return undefined
    const task = taskOf(ctx, owner.main)
    if (!task?.enabled || task.phase !== 'active' || task.revision !== owner.revision || !armed(owner.main)) return 'node execution is stale or stopped'
    return ['read', 'glob', 'grep', 'write', 'edit', 'task_worker_done'].includes(exec.name) ? undefined
      : 'node workers use read/glob/grep and owned-file write/edit only; the main Agent runs commands and integration checks after join'
  })
  function assertTarget(target: FsTarget, actor: object | undefined) {
    const agent = actor && 'agent' in actor ? actor.agent : undefined
    const entry = [...owners.entries()].find(([worker]) => worker === agent)
    if (entry && !entry[1].keys.has(target.targetKey)) throw new Error('write target is outside this node’s declared file ownership')
  }
  ctx.inject(['fs'], filesystem => {
    filesystem.on('fs/write-intent', async (target, actor, next) => { assertTarget(target, actor); return next() })
    filesystem.on('fs/edit-intent', async (target, actor, next) => { assertTarget(target, actor); return next() })
  })
  const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
  ctx.tools.register(defineTool({ name: 'task_delegate_nodes',
    description: `Execute up to ${maxParallelNodes} ready DAG nodes concurrently as native child Agents. Each must declare exact, disjoint workspace-relative writePaths (files, not directories). Workers can read and write owned files but cannot run shell commands or delegate. This call waits for all workers. Their results are unverified: the main Agent must inspect and run integration checks, then report each current attempt for independent review.`,
    parameters: { node_ids: { type: 'array', required: true, items: { type: 'string' } } }, output,
    async execute(args, exec) {
      const main = exec.agent
      if (!main) throw new Error('no main Agent')
      const task = taskOf(ctx, main)
      if (!task || task.phase !== 'active' || !task.enabled || !armed(main)) throw new Error('task is not executing')
      if (!args.node_ids.length || args.node_ids.length > maxParallelNodes || new Set(args.node_ids).size !== args.node_ids.length) throw new Error('invalid delegation batch')
      if (args.node_ids.some(id => !readyNodes(task).includes(id))) throw new Error('only dependency-ready nodes can be delegated')
      const fs = ctx.get('fs'); const cwd = main.session.header.cwd
      if (!fs || !cwd) throw new Error('node ownership requires a native filesystem and a bound workspace')
      // Reserve the main controller before async resolution so concurrent calls cannot overlap admission.
      const batch: Batch = { abort: new AbortController(), handles: [] }
      if (batches.has(main)) throw new Error('a batch is already active')
      batches.set(main, batch)
      const signal = AbortSignal.any([exec.signal, batch.abort.signal])
      const stop = () => { for (const handle of batch.handles) handle.agent.cancel({ kind: 'parent' }) }
      signal.addEventListener('abort', stop, { once: true })
      let revision: number | undefined
      try {
        const workspacePath = fs.processPath(await fs.resolve(cwd, { cwd, signal }))
        const claimed = new Set<string>()
        const nodes = []
        for (const id of args.node_ids) {
          const stage = task.stages.find(stage => stage.id === id)!
          if (!stage.writePaths?.length) throw new Error(`${id} needs exact writePaths before delegation`)
          const keys = new Set<string>()
          for (const path of stage.writePaths) {
            if (isAbsolute(path) || path.split(/[\\/]/u).includes('..') || path === '.' || path.trim() !== path || !path) throw new Error('writePaths must be workspace-relative files')
            const target = await fs.resolve(path, { cwd, signal })
            const actual = relative(resolve(workspacePath), fs.processPath(target))
            if (actual === '' || actual === '..' || actual.startsWith('../') || isAbsolute(actual)) throw new Error('write path escapes workspace')
            if ((await fs.stat(target, signal))?.type === 'directory') throw new Error('writePaths must name exact files, not directories')
            if (claimed.has(target.targetKey)) throw new Error('parallel nodes have overlapping file ownership; execute those nodes serially')
            claimed.add(target.targetKey); keys.add(target.targetKey)
          }
          nodes.push({ stage, keys, sessionId: SessionId(`task-node-${randomUUID()}`) })
        }
        signal.throwIfAborted()
        if (taskOf(ctx, main)?.revision !== task.revision) throw new Error('task changed during node admission')
        let started = { ...task, revision: task.revision + 1 }
        for (const node of nodes) started = beginNode(started, node.stage.id, node.sessionId)
        appendTask(ctx, main, started); revision = started.revision
        if (!await ctx.sessions.flush(main.session)) throw new Error('node identities are not durable')
        const { options } = reviewerOptions(ctx, main)
        const outcomes = await Promise.allSettled(nodes.map(async node => {
          const run = runsOf(started).find(run => run.id === node.stage.id)!
          let report: string | null = null
          const handle = await ctx.agents.create({ sessionId: node.sessionId, parentAgent: main, signal,
            meta: childSessionMeta(main, (main.session.header.delegationDepth ?? 0) + 1, false), agentOptions: options,
            setup(child) {
              child.tools.register(defineTool({ name: 'task_worker_done', description: 'Return produced files and limitations to the main Agent. This is not acceptance; integration and independent review still follow.',
                parameters: { report: { type: 'string', required: true } }, output,
                async execute(args, call) { if (!args.report.trim()) throw new Error('report required'); report = args.report; call.concludeTurn(); return { submitted: true } } }))
            } })
          batch.handles.push(handle)
          owners.set(handle.agent, { main, revision: started.revision, keys: node.keys })
          handle.agent.session.append('extension/record', { namespace: NAMESPACE, schemaVersion: 1, kind: 'binding', recordId: node.sessionId,
            payload: { mainSessionId: main.id, taskId: task.id, planVersion: task.planVersion, nodeId: node.stage.id, attempt: run.attempt } })
          signal.throwIfAborted()
          handle.agent.followup(createUserMessage({ source: { kind: 'task-node-worker', taskId: task.id, nodeId: node.stage.id, attempt: run.attempt },
            content: [{ type: 'text', text: `${languagePolicy(task)}\nExecute only node ${node.stage.id}: ${node.stage.title}. ${node.stage.description ?? ''}\nObjective: ${task.objective}\nCriteria: ${JSON.stringify(task.criteria.filter(c => node.stage.criterionIds.includes(c.id)))}\nYou are not alone in the workspace. Do not revert others’ edits. Own only these exact files: ${JSON.stringify(node.stage.writePaths)}. Other workers execute concurrently. Use native read/write/edit; no shell, spawning, or edits outside ownership. Report limitations and concrete outputs via task_worker_done. Main Agent performs shell tests and integration after all workers settle. Do not claim acceptance.` }] }))
          await handle.agent.whenIdle()
          signal.throwIfAborted()
          if (!await ctx.sessions.flush(handle.agent.session)) throw new Error('worker evidence is not durable')
          if (report === null) throw new Error(`node ${node.stage.id} ended without a worker report`)
          return { nodeId: node.stage.id, attempt: run.attempt, sessionId: node.sessionId, cutoff: handle.agent.session.seq - 1, report }
        }).map(promise => promise.catch(error => { batch.abort.abort(error); throw error })))
        const failure = outcomes.find(outcome => outcome.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
        const results = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : [])
        signal.throwIfAborted()
        const latest = taskOf(ctx, main)
        if (latest?.revision !== revision) throw new Error('node batch is stale')
        const finished = withRuns({ ...latest, revision: latest.revision + 1 }, runsOf(latest).map(run => {
          const result = results.find(result => result.nodeId === run.id)
          return result ? { ...run, status: 'awaiting-integration' as const, workerCutoff: result.cutoff,
            integrationAfterSeq: main.session.seq, finishedAt: new Date().toISOString() } : run
        }))
        appendTask(ctx, main, finished); await ctx.sessions.flush(main.session)
        return { results, message: 'Inspect outputs and run integration checks in the main Session, then task_report_stage for each node. Worker reports are not acceptance.' }
      } catch (error) {
        batch.abort.abort(error); stop()
        const latest = taskOf(ctx, main)
        if (revision !== undefined && latest?.revision === revision) {
          appendTask(ctx, main, withRuns({ ...latest, revision: latest.revision + 1, phase: 'paused' }, runsOf(latest).map(run =>
            args.node_ids.includes(run.id) ? { ...run, status: 'awaiting-user' } : run)))
          await ctx.sessions.flush(main.session)
        }
        throw error
      } finally {
        signal.removeEventListener('abort', stop)
        await Promise.all(batch.handles.map(async handle => { await handle.dispose(); owners.delete(handle.agent) }))
        batches.delete(main)
      }
    } }))
  return { cancel }
}

/** A successful main-session verification must follow worker settlement. */
export function requireIntegration(agent: Agent, nodeId: string, tools: readonly string[], ctx: Context) {
  const run = runsOf(taskOf(ctx, agent)!).find(run => run.id === nodeId)
  if (run?.integrationAfterSeq === undefined) return
  const events = agent.session.snapshotEvents().filter(e => e.seq >= run.integrationAfterSeq!)
  const calls = new Set(events.filter(e => e.type === 'tool/call' && tools.includes(e.data.name)).map(e => e.type === 'tool/call' ? e.data.callId : ''))
  if (!events.some(e => e.type === 'tool/result' && !e.data.message.isError && calls.has(e.data.message.source.callId))) {
    throw new Error('run a main-Session integration check after worker settlement before reporting this node')
  }
}
