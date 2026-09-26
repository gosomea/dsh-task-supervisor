/** Durable Supervisor checkpoints projected into DSH's completed-Turn tail. */

export interface Milestone {
  readonly seq: number
  readonly kind: 'plan' | 'stage' | 'completion'
  readonly title: string
  readonly summary: string
  readonly detail: string
  readonly report?: string
  readonly verdict?: 'pass' | 'revise' | 'needs-user'
}

interface Call {
  readonly name: 'task_submit_plan' | 'task_report_stage' | 'task_request_completion'
  readonly stageId?: string
  readonly evidence?: string
  readonly stageTitles?: readonly string[]
  readonly criteriaCount?: number
}

interface State {
  readonly turn: number
  readonly calls: ReadonlyMap<string, Call>
  readonly milestones: readonly Milestone[]
}

/** Local wire subset keeps Host and Client Cordis types in separate programs. */
interface Event {
  readonly type: string
  readonly seq: number
  readonly surfaceOp?: string
  readonly data: {
    readonly turn?: number
    readonly callId?: string
    readonly name?: string
    readonly arguments?: string
    readonly message?: {
      readonly isError?: boolean
      readonly source?: { readonly callId?: string }
      readonly content?: readonly { readonly type: string; readonly text?: string }[]
    }
  }
}

interface Match { readonly event: Event }
interface Context { readonly state: State | undefined }
interface LocationData { readonly kind: 'turn'; readonly turn: number;
  readonly key: 'task-supervisor-milestones'; readonly value: readonly Milestone[] }

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function parsedObject(raw: string): Record<string, unknown> | null {
  try { return object(JSON.parse(raw) as unknown) } catch { return null }
}

function call(name: string, argsRaw: string): Call | null {
  if (name !== 'task_submit_plan' && name !== 'task_report_stage' && name !== 'task_request_completion') return null
  const args = parsedObject(argsRaw)
  if (name === 'task_submit_plan') {
    const stages = Array.isArray(args?.stages) ? args.stages : []
    const criteria = Array.isArray(args?.criteria) ? args.criteria : []
    return { name, stageTitles: stages.map(stage => object(stage)?.title).filter((title): title is string => typeof title === 'string'),
      criteriaCount: criteria.length }
  }
  if (name === 'task_report_stage') return {
    name,
    ...typeof args?.stage_id === 'string' ? { stageId: args.stage_id } : {},
    ...typeof args?.evidence === 'string' ? { evidence: args.evidence } : {},
  }
  return { name, ...typeof args?.evidence === 'string' ? { evidence: args.evidence } : {} }
}

function firstParagraph(value: string): string {
  const paragraph = value.trim().split(/\n\s*\n|\n/)[0]?.trim() ?? ''
  return paragraph.length <= 220 ? paragraph : `${paragraph.slice(0, 219).trimEnd()}…`
}

function milestone(source: Call, raw: string, seq: number): Milestone | null {
  const result = parsedObject(raw)
  if (result === null) return null
  if (source.name === 'task_submit_plan') {
    if (result.phase !== 'awaiting-approval' && result.phase !== 'active') return null
    const stages = source.stageTitles ?? []
    const criteriaCount = source.criteriaCount ?? 0
    return { seq, kind: 'plan', title: result.phase === 'awaiting-approval' ? '计划待批准' : '计划已修订',
      summary: `${stages.length} 个阶段 · ${criteriaCount} 项验收标准${result.phase === 'awaiting-approval' ? ' · 等待你批准' : ''}`,
      detail: stages.map((title, index) => `${index + 1}. ${title}`).join('\n') }
  }
  if (result.verdict !== 'pass' && result.verdict !== 'revise' && result.verdict !== 'needs-user') return null
  const kind = source.name === 'task_request_completion' ? 'completion' : 'stage'
  const finding = typeof result.finding === 'string' ? result.finding : ''
  const label = result.verdict === 'pass' ? '通过' : result.verdict === 'revise' ? '需要修订' : '等待用户决策'
  return { seq, kind, verdict: result.verdict,
    title: kind === 'completion' ? `完成审查 · ${label}` : `阶段 ${source.stageId ?? ''} 审查 · ${label}`,
    summary: firstParagraph(finding) || (kind === 'completion' ? '最终审查已给出结论。' : '阶段审查已给出结论。'),
    detail: finding,
    ...source.evidence === undefined ? {} : { report: firstParagraph(source.evidence) } }
}

/** Only a successful logged tool result creates a visible card. */
export const milestoneDefinition = {
  kind: 'task-supervisor-milestones',
  match: (event: Event) => {
    if (event.type === 'turn/start' && event.data.turn !== undefined) {
      return { id: String(event.data.turn), role: 'start' as const }
    }
    if ((event.type === 'tool/call' || event.type === 'tool/result') && event.data.turn !== undefined) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context: Context, match: Match): State => {
    if (match.event.type !== 'turn/start' || match.event.data.turn === undefined) {
      throw new Error('Supervisor milestone requires turn/start')
    }
    return { turn: match.event.data.turn, calls: new Map(), milestones: [] }
  },
  update: (context: { readonly state: State }, match: Match): State => {
    if (match.event.type === 'tool/call') {
      const source = call(match.event.data.name ?? '', match.event.data.arguments ?? '')
      if (source === null) return context.state
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId ?? ''), source)
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result' || match.event.surfaceOp !== 'append'
      || match.event.data.message?.isError === true) return context.state
    const source = context.state.calls.get(String(match.event.data.message?.source?.callId ?? ''))
    if (source === undefined) return context.state
    const text = match.event.data.message?.content?.find(block => block.type === 'text')
    if (text?.type !== 'text' || text.text === undefined) return context.state
    const item = milestone(source, text.text, match.event.seq)
    return item === null ? context.state : { ...context.state, milestones: [...context.state.milestones, item] }
  },
  buildLocationData: (context: Context, scope: 'turn' | 'step', previous: LocationData | null): LocationData | null => {
    if (scope !== 'turn' || context.state === undefined || context.state.milestones.length === 0) return null
    if (previous?.kind === 'turn' && previous.turn === context.state.turn
      && previous.key === 'task-supervisor-milestones' && previous.value === context.state.milestones) return previous
    return { kind: 'turn', turn: context.state.turn, key: 'task-supervisor-milestones',
      value: context.state.milestones }
  },
}
