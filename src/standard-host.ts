/** Native preset ownership replaces the private Host's record-reader admission API. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { entrySchema, taskSchema, NAMESPACE } from './state.ts'
import { controlEvent } from './session-records.ts'

const PREFIX = 'dsh-task-supervisor:'
const GATE = 'dsh-task-supervisor-session'

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
      const controlled = protectsSession(agent)
      return controlled ? { kind: 'reject' as const } : next()
    })
    ctx.tools.guard(exec => {
      if (exec.agent && protectsSession(exec.agent) && !ctx.get('supervisorAdmission')?.available) return 'Supervisor is unavailable; restore the plugin before executing this Session.'
      return undefined
    })
  },
}

/** Read the last task state even after its projection provider unloads. */
function protectsSession(agent: Agent): boolean {
  const records = agent.session.snapshotEvents().map(controlEvent)
  const state = records.findLast(event => event.type === 'extension/record'
    && event.data.namespace === NAMESPACE && event.data.kind === 'state')
  if (state?.type === 'extension/record') {
    const task = taskSchema.safeParse(state.data.payload)
    if (!task.success || task.data.phase !== 'cleared') return true
  }
  const record = records.findLast(event => event.type === 'extension/record'
    && event.data.namespace === NAMESPACE && ['state', 'entry'].includes(event.data.kind))
  if (record?.type !== 'extension/record' || record.data.kind !== 'entry') return false
  const entry = entrySchema.safeParse(record.data.payload)
  return !entry.success || entry.data.active && entry.data.mainSessionId === agent.id
}

/** Attach task admission to the live Agent without changing its native preset.
 * @param ctx Supervisor lifetime, owning the availability service.
 * @param legacyPresets Whether to expose 0.1.1 compatibility presets for old Sessions.
 * @returns Admission installer called before Task creation.
 */
export async function installStandardHost(ctx: Context, legacyPresets = false): Promise<(agent: Agent) => Promise<void>> {
  new SupervisorAdmission(ctx)
  if (legacyPresets) await installLegacyPresets(ctx)
  const installed = new WeakMap<Agent, Promise<void>>()
  return async agent => {
    if (!ctx.get('supervisorAdmission')?.available) throw new Error('Supervisor is unloaded.')
    const previous = installed.get(agent)
    if (previous) return previous
    // Agent-owned: retain admission if Supervisor hot-unloads; retire with the Agent.
    const pending = Promise.resolve(agent.ctx.plugin(gate)).then(() => undefined)
    installed.set(agent, pending)
    try { await pending } catch (error) { installed.delete(agent); throw error }
  }
}

/** Register old identities only for deployments explicitly restoring 0.1.1 Sessions. */
async function installLegacyPresets(ctx: Context): Promise<void> {
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
        const rows = definition.plugins
        const owner = ctx.extend({ baseUrl: entry.context.baseUrl })
        const ownerPresets = owner.get('agentPresets')
        if (!ownerPresets) throw new Error('Legacy preset registry unloaded during registration.')
        const dispose = await ownerPresets.register({ id, name: `Supervisor · ${definition.name ?? base}`,
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
}
