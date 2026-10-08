/** Retain only an expanded review; native Chat owns streaming, process rows and replay. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReviewJob } from '../review-records.ts'
import { DisclosureRow, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SupervisorTranslate } from './locales.ts'
import { taskStore } from './task-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap { 'task-supervisor.review-session': { kind: 'single'; scope: 'session' } }
}
export type ReviewNodeProps = PropsRuntime<'conversation.chat.node'> & ChatNodeOwnerProps &
  { node: { data: ReviewJob } } & PropsRenderSlots<'task-supervisor.review-session'>
export function ReviewConversation({ renderSlot }: PropsRuntime<'task-supervisor.review-session'> & PropsRenderSlots<'conversation.session'>) {
  return renderSlot('conversation.session', { view: 'chat' })
}

function ReviewTranscript({ id, sessions, SessionProvider, renderSlot }: { id: string; sessions: ISessions } &
  Pick<ReviewNodeProps, 'SessionProvider' | 'renderSlot'>) {
  const [reference, setReference] = useState<SessionReference | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const ref = sessions.retain(id as SessionId, { source: 'taskSupervisor' })
    void ref.ready.then(() => { if (active) setReference(ref) }, error => { if (active) setError(String(error)) })
    return () => { active = false; ref.release() }
  }, [id, sessions])
  return <div className="dsh-task-review-transcript">
    {error && <p role="alert">{error}</p>}
    {reference && <SessionProvider session={reference}>{renderSlot('task-supervisor.review-session', {})}</SessionProvider>}
  </div>
}
export function ReviewSession({ sessions, t, ...props }: ReviewNodeProps & { sessions: ISessions; t: SupervisorTranslate }) {
  const job = props.node.data
  const active = ['queued', 'started', 'repairing', 'submitted'].includes(job.status)
  const store = useMemo(() => taskStore(props.sessionId), [props.sessionId])
  const { state } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const ready = active ? state?.reviewActivity?.jobId === job.id : job.model !== null
  const [expanded, setExpanded] = useState<boolean | undefined>()
  useEffect(() => { setExpanded(undefined) }, [active])
  const open = expanded ?? active
  const title = job.input.stages.find(stage => stage.id === job.stageId)?.title
  if (props.sessionId !== job.mainSessionId) return null
  return <section id={`task-review-${job.id}`} className="dsh-task-review-session" data-review-job={job.id} data-review-status={job.status}>
    <strong>Supervisor · {t(`reviewKind.${job.kind}`)}{title ? ` · ${title}` : ''}</strong>
    <p className="dsh-task-meta">{t(active ? 'reviewRunning' : 'reviewEnded')} · {t('reviewAttempt')} {job.attempt}</p>
    {job.decision && <p>{job.decision.finding}</p>}
    {job.fault && <p role="status">{job.fault.message}</p>}
    <DisclosureRow className="dsh-task-disclosure" titleClassName="dsh-task-disclosure-title" icon={<IconChevronDownOutlineRegular />}
      title={t('reviewProcess')} open={open} expandable expandOnRowClick onToggle={() => setExpanded(!open)}>
      {open && !ready && <p className="dsh-task-meta">{t('reviewQueued')}</p>}
      {open && ready && job.reviewerSessionId && <ReviewTranscript id={job.reviewerSessionId} sessions={sessions}
        SessionProvider={props.SessionProvider} renderSlot={props.renderSlot} />}
    </DisclosureRow>
  </section>
}
