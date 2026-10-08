/** Retain only an expanded review; native Chat owns streaming, process rows and replay. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderSlots, PropsRuntime, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNodeOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReviewJob } from '../review-records.ts'
import { DisclosureRow, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SupervisorTranslate } from './locales.ts'
import { taskStore } from './task-store.ts'
import type { ReviewPortals } from './review-portal-store.ts'
import { ReviewProgress } from './review-progress.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap { 'task-supervisor.review-session': { kind: 'single'; scope: 'session' } }
}
export type ReviewNodeProps = PropsRuntime<'conversation.chat.node'> & ChatNodeOwnerProps &
  { node: { data: ReviewJob } }
function ReviewView({ renderSlot }: ConversationViewsProps) { return renderSlot('conversation.session', { view: 'chat' }) }
export function ReviewConversation({ renderFactorySlot }: PropsRuntime<'task-supervisor.review-session'> & PropsRenderFactories) {
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: ReviewView } })
}

export function ReviewTranscript({ id, parentId, sessions, SessionProvider, renderSlot }: { id: string; parentId: string; sessions: ISessions } &
  Pick<PropsRenderSlots<'task-supervisor.review-session'>, 'SessionProvider' | 'renderSlot'>) {
  const [reference, setReference] = useState<SessionReference | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const ref = sessions.retain({ childSessionId: id as SessionId, parentSessionId: parentId as SessionId, mode: 'unknown' }, { source: 'taskSupervisor' })
    void ref.ready.then(() => { if (active) setReference(ref) }, error => { if (active) setError(String(error)) })
    return () => { active = false; ref.release() }
  }, [id, parentId, sessions])
  return <div className="dsh-task-review-transcript">
    {error && <p role="alert">{error}</p>}
    {reference && <SessionProvider session={reference}>{renderSlot('task-supervisor.review-session', {})}</SessionProvider>}
  </div>
}
export function ReviewSession({ portals, t, ...props }: ReviewNodeProps & { portals: ReviewPortals; t: SupervisorTranslate }) {
  const job = props.node.data
  const store = useMemo(() => taskStore(props.sessionId), [props.sessionId])
  const { state } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const pending = ['queued', 'started', 'repairing', 'submitted'].includes(job.status)
  const active = pending && state?.live !== false && (!state || state.task?.id === job.taskId && (state.reviewing || state.task.phase === 'reviewing'))
  const ready = active ? state?.reviewActivity?.jobId === job.id && state.reviewActivity.lastSeq !== null || !!job.recovery?.failures.length : job.model !== null
  const [expanded, setExpanded] = useState<boolean | undefined>()
  useEffect(() => { setExpanded(undefined) }, [active])
  const open = expanded ?? active
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (open && ready && target && job.reviewerSessionId) return portals.attach({ key: job.id, sessionId: job.reviewerSessionId, parentSessionId: job.mainSessionId, element: target })
    return undefined
  }, [portals, open, ready, target, job.id, job.mainSessionId, job.reviewerSessionId])
  const title = job.input.stages.find(stage => stage.id === job.stageId)?.title
  if (props.sessionId !== job.mainSessionId) return null
  return <section id={`task-review-${job.id}`} className="dsh-task-review-session" data-review-job={job.id} data-review-status={job.status}>
    <strong>Supervisor · {t(`reviewKind.${job.kind}`)}{title ? ` · ${title}` : ''}</strong>
    <p className="dsh-task-meta">{t(active ? 'reviewRunning' : pending ? 'reviewWaitingRecovery' : 'reviewEnded')}
      {job.nodeAttempt !== null && <> · {t('reviewNodeAttempt')} {job.nodeAttempt}</>} · {t('reviewAttempt')} {job.attempt}</p>
    {active && state?.reviewActivity?.jobId === job.id && <ReviewProgress state={state} t={t} />}
    {job.decision && <>
      <p><strong>{t(`reviewVerdict.${job.decision.verdict}`)}</strong> · {job.decision.finding.split(/\r?\n/u)[0]?.slice(0, 240)}</p>
      <p className="dsh-task-meta">{t(job.decision.verdict === 'needs-user' ? 'reviewUserNext' : job.decision.verdict === 'revise' ? 'reviewRevisionNext' : job.kind === 'completion' ? 'reviewTaskComplete' : job.kind === 'plan' ? 'reviewNextPlan' : job.kind === 'planning' ? 'reviewNextPlanning' : 'reviewNextNode')}</p>
    </>}
    {job.fault && <p role="status">{job.fault.message}</p>}
    {job.recovery && job.recovery.failures.length > 0 && <p className="dsh-task-meta">{t('reviewFaultHistory')} · {job.recovery.failures.length} · {t('reviewFaultRetries')} {job.recovery.consumed}/{job.recovery.retryLimit}</p>}
    <DisclosureRow className="dsh-task-disclosure" titleClassName="dsh-task-disclosure-title" icon={<IconChevronDownOutlineRegular />}
      title={t('reviewProcess')} open={open} expandable expandOnRowClick onToggle={() => setExpanded(!open)}>
      {open && !ready && <p className="dsh-task-meta">{t('reviewQueued')}</p>}
      {open && ready && job.reviewerSessionId && <div ref={setTarget} className="dsh-task-review-transcript" />}
    </DisclosureRow>
  </section>
}
