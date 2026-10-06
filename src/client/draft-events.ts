/** Rebuild proposal cards only from paired, successful consultation tool results. */
export interface DraftCard {
  id: string
  version: number
  mainSessionId: string
  sourceSessionId: string
  title: string
  requirements: string
  questions: string[]
  status: 'draft' | 'creating' | 'created'
}
interface Event {
  type: string; seq: number; surfaceOp?: string
  data: { turn?: number; callId?: string; name?: string; message?: {
    isError?: boolean; source?: { callId?: string }; content?: readonly { type: string; text?: string }[]
  } }
}
interface State { turn: number; calls: ReadonlySet<string>; drafts: readonly DraftCard[] }
interface LocationData { kind: 'turn'; turn: number; key: 'task-supervisor-drafts'; value: readonly DraftCard[] }
function card(raw: string): DraftCard | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const fields = value as Record<string, unknown>
  if (typeof fields.id !== 'string' || typeof fields.version !== 'number' || !Number.isInteger(fields.version) || fields.version < 1
    || typeof fields.mainSessionId !== 'string' || typeof fields.sourceSessionId !== 'string'
    || typeof fields.title !== 'string' || typeof fields.requirements !== 'string'
    || !Array.isArray(fields.questions) || !fields.questions.every((question): question is string => typeof question === 'string')
    || !['draft', 'creating', 'created'].includes(String(fields.status))) return null
  return { id: fields.id, version: fields.version, mainSessionId: fields.mainSessionId, sourceSessionId: fields.sourceSessionId,
    title: fields.title, requirements: fields.requirements, questions: fields.questions, status: fields.status as DraftCard['status'] }
}
/** Native turn placement keeps drafts in conversation history rather than above the transcript. */
export const draftDefinition = {
  kind: 'task-supervisor-drafts',
  match(event: Event) {
    if (event.data.turn === undefined) return null
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' as const }
    if (event.type === 'tool/call' || event.type === 'tool/result') return { id: String(event.data.turn), role: 'update' as const }
    return null
  },
  start(_context: { state: State | undefined }, match: { event: Event }): State {
    if (match.event.type !== 'turn/start' || match.event.data.turn === undefined) throw new Error('Draft cards require turn/start')
    return { turn: match.event.data.turn, calls: new Set(), drafts: [] }
  },
  update(context: { state: State }, match: { event: Event }): State {
    const event = match.event
    if (event.type === 'tool/call') {
      if (event.data.name !== 'supervisor_update_draft' && event.data.name !== 'supervisor_create_draft') return context.state
      return { ...context.state, calls: new Set([...context.state.calls, String(event.data.callId)]) }
    }
    const result = event.data.message
    if (event.type !== 'tool/result' || event.surfaceOp !== 'append' || result?.isError
      || !context.state.calls.has(String(result?.source?.callId))) return context.state
    const text = result?.content?.find(block => block.type === 'text')?.text
    const draft = text ? card(text) : null
    if (!draft) return context.state
    return { ...context.state, drafts: [...context.state.drafts.filter(item => item.id !== draft.id), draft] }
  },
  buildLocationData(context: { state: State | undefined }, scope: 'turn' | 'step', previous: LocationData | null): LocationData | null {
    if (scope !== 'turn' || !context.state?.drafts.length) return null
    if (previous?.turn === context.state.turn && previous.value === context.state.drafts) return previous
    return { kind: 'turn', turn: context.state.turn, key: 'task-supervisor-drafts', value: context.state.drafts }
  },
}
