/** Validate the origin of newly submitted criteria; old snapshots stay readable. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TaskCriterion } from './state.ts'

export function validateProvenance(criteria: readonly TaskCriterion[], events: readonly SessionEvent[]): void {
  const bySeq = new Map<number, SessionEvent>(events.map(event => [event.seq, event]))
  for (const criterion of criteria) {
    const source = criterion.provenance
    if (source === undefined) throw new Error(`criterion ${criterion.id} needs provenance`)
    if (source.kind === 'user' && source.sourceSeq === undefined && source.reference === 'objective') continue
    if (source.kind === 'user' && source.sourceSeq === undefined) throw new Error(`criterion ${criterion.id}: for the task objective use provenance {kind: "user", reference: "objective"} exactly, without sourceSeq. Only additional direct-user requirements need their message seq.`)
    if (source.kind === 'implementation' && source.sourceSeq === undefined) continue
    const event = source.sourceSeq === undefined ? undefined : bySeq.get(source.sourceSeq)
    const userSource = event?.type === 'user/message' && event.data.source.kind === 'user'
    const projectSource = event?.type === 'tool/result' && event.data.message.isError !== true
    if (source.kind === 'user' ? !userSource : source.kind === 'project' ? !projectSource : event === undefined) {
      throw new Error(`criterion ${criterion.id} has no valid ${source.kind} source; objective-derived criteria use {kind: "user", reference: "objective"} with sourceSeq omitted. Additional user instructions need a direct user-message seq; project rules need a successful file-read result seq`)
    }
  }
}
