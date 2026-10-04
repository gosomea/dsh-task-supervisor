/** Native preset ownership replaces the private Host's record-reader admission API. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { controlEvent } from './session-records.ts'

const PREFIX = 'dsh-task-supervisor:'
const GATE = 'dsh-task-supervisor-session'
const competingDrivers = new Set(['@deepseek-ai/dsh-goal-round-driver', '@deepseek-ai/dsh-command-goal', '@deepseek-ai/dsh-tool-goal', '@deepseek-ai/dsh-plan-mode'])

declare module '@deepseek-ai/cordis' {
  interface Context { supervisorAdmission: SupervisorAdmission }
}

/** A lifecycle-owned capability, read by retained native preset generations. */
class SupervisorAdmission extends Service {
  available = true
  constructor(ctx: Context) {
    super(ctx, 'supervisorAdmission')
    ctx.effect(() => () => { this.available = false })
  }
}

const gate = {
  name: GATE,
  inject: ['tools'],
  apply(ctx: Context) {
    ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
      if (messages.some(message => message.source.kind === 'task-supervisor-record')) {
        for (const message of messages) if (message.source.kind === 'task-supervisor-record') agent.inbox.remove(message.id)
        return { kind: 'reject' as const }
      }
      if (ctx.get('supervisorAdmission')?.available) return next()
      const controlled = agent.session.snapshotEvents().map(controlEvent).some(e => e.type === 'extension/record'
        && e.data.namespace.startsWith('dsh-task-supervisor'))
      return controlled ? { kind: 'reject' as const } : next()
    })
    ctx.tools.guard(exec => {
      if (exec.agent && !ctx.get('supervisorAdmission')?.available) return 'Supervisor is unavailable; restore the plugin before executing this Session.'
      return undefined
    })
  },
}

/** Copy deployment-owned preset rows, retaining configuration and disabling a competing round driver. */
function supervisedRows(rows: PresetDefinition['plugins']): PresetDefinition['plugins'] {
  return rows.map(row => ({ ...row,
    ...competingDrivers.has(row.name) ? { disabled: true } : {},
    ...row.group ? { config: supervisedRows(row.config as PresetDefinition['plugins']) } : {} }))
}

/** Install native preset declarations and bind new Sessions before their first turn.
 * @param ctx The root Supervisor fiber; owns definitions and the admission capability.
 * @returns An async binder used before a task can acquire execution ownership.
 */
export async function installStandardHost(ctx: Context): Promise<(agent: Agent) => Promise<void>> {
  new SupervisorAdmission(ctx)
  const registering = new Map<string, Promise<void>>()
  const disposers: (() => Promise<void>)[] = []
  let stopped = false
  ctx.effect(() => async () => {
    stopped = true
    await Promise.allSettled(registering.values())
    for (const dispose of disposers.splice(0).reverse()) await dispose()
  })
  const prepare = async (base: string): Promise<string> => {
    if (stopped) throw new Error('Supervisor is unloaded.')
    const presets = ctx.get('agentPresets'), loader = ctx.get('loader')
    if (!presets || !loader) throw new Error('Supervisor requires the standard DSH Agent preset registry and Loader; enable them in this profile.')
    const id = PREFIX + base
    let pending = registering.get(base)
    if (!pending) {
      pending = (async () => {
        const entry = [...loader.entries()].find(e => ['@deepseek-ai/dsh-agent-preset', 'cordis:agent-preset'].includes(e.options.name)
          && !e.disabled && (e.options.config as Partial<PresetDefinition> | undefined)?.id === base)
        if (!entry) throw new Error(`Supervisor cannot find the native preset declaration '${base}'.`)
        const definition: PresetDefinition = entry.options.config
        const previous = loader.builtins[GATE]
        if (previous !== undefined && previous !== gate) throw new Error('Supervisor preset gate is already owned by another plugin.')
        loader.builtins[GATE] = gate
        ctx.effect(() => () => { if (loader.builtins[GATE] === gate) delete loader.builtins[GATE] })
        const rows = supervisedRows(definition.plugins)
        const owner = ctx.extend({ baseUrl: entry.context.baseUrl })
        const dispose = await owner.agentPresets.register({ id, name: `Supervisor · ${definition.name ?? base}`,
          plugins: [...rows, { name: `cordis:${GATE}` }] })
        disposers.push(dispose)
      })()
      registering.set(base, pending)
    }
    await pending
    if (stopped) throw new Error('Supervisor unloaded during preset preparation.')
    return id
  }
  const presets = ctx.get('agentPresets'), loader = ctx.get('loader')
  if (!presets || !loader) throw new Error('Supervisor requires the standard DSH Agent preset registry and Loader.')
  const bases = [...loader.entries()].filter(e => ['@deepseek-ai/dsh-agent-preset', 'cordis:agent-preset'].includes(e.options.name) && !e.disabled)
  for (const entry of bases) {
    const definition: PresetDefinition = entry.options.config
    if (!definition.id.startsWith(PREFIX)) await prepare(definition.id)
  }
  const bind = async (agent: Agent): Promise<void> => {
    const current = presets.composedPreset(agent.ctx)
    if (current?.startsWith(PREFIX)) {
      const resolved = await presets.resolve(current)
      if (resolved.broken) throw new Error(`Supervisor preset cannot load: ${resolved.broken}`)
      return
    }
    const id = await prepare(current ?? presets.defaultId)
    const resolved = await presets.resolve(id)
    if (resolved.broken) throw new Error(`Supervisor preset cannot load: ${resolved.broken}`)
    const boundary = ctx.sessionProjections.stateOf(agent.session, 'turnBoundary')
    if (boundary && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)) throw new Error('此会话已开始，DSH 不允许改换 Agent preset。请在新的会话中先运行 /task new，或选择 Supervisor 模式后开始讨论。')
    await presets.select(agent, id)
    if (!await ctx.sessions.flush(agent.session)) throw new Error('Supervisor preset selection is not durable.')
  }
  return bind
}
