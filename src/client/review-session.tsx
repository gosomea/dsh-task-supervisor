/** Retain only an expanded review; native Chat owns streaming, process rows and replay. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderSlots, PropsRuntime, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNodeOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReviewJob } from '../review-records.ts'
import { Button, DisclosureRow } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SupervisorTranslate } from './locales.ts'
import { taskStore } from './task-store.ts'
import type { ReviewPortals } from './review-portal-store.ts'
import { ReviewProgress } from './review-progress.tsx'
import { reviewPresentation, reviewFaultDescription, type createReviewDisclosureState } from './review-presentation.ts'

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
export function ReviewSession({ portals, disclosures, t, ...props }: ReviewNodeProps & { portals: ReviewPortals; disclosures: ReturnType<typeof createReviewDisclosureState>; t: SupervisorTranslate }) {
  const job = props.node.data
  const store = useMemo(() => taskStore(props.sessionId), [props.sessionId])
  const { state, busy, error } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const summary = reviewPresentation(job, state)
  const { active } = summary
  const ready = active ? state?.reviewActivity?.jobId === job.id && state.reviewActivity.lastSeq !== null || !!job.recovery?.failures.length : job.model !== null
  const [, refresh] = useState(0)
  const open = disclosures.open(job.id, active)
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (open && ready && target && job.reviewerSessionId) return portals.attach({ key: job.id, sessionId: job.reviewerSessionId, parentSessionId: job.mainSessionId, element: target })
    return undefined
  }, [portals, open, ready, target, job.id, job.mainSessionId, job.reviewerSessionId])
  const title = job.input.stages.find(stage => stage.id === job.stageId)?.title
  if (props.sessionId !== job.mainSessionId) return null
  return <section id={`task-review-${job.id}`} className="dsh-task-review-session" data-review-job={job.id} data-review-status={job.status} data-review-tone={summary.tone}>
    <DisclosureRow className="dsh-task-review-heading" titleClassName="dsh-task-review-title"
      icon={<span className="dsh-task-review-indicator" aria-hidden="true" />}
      title={`Supervisor · ${t(`reviewKind.${job.kind}`)}${title ? ` · ${title}` : ''}`}
      open={open} expandable expandOnRowClick running={active} keepContentWhenOpen
      collapsedContent={<strong className="dsh-task-review-badge">{t(summary.label)}</strong>} onToggle={() => { disclosures.set(job.id, active, !open); refresh(value => value + 1) }} />
    <p className="dsh-task-meta">
      {job.nodeAttempt !== null && <>{t('reviewNodeAttempt')} {job.nodeAttempt} · </>}{t('reviewAttempt')} {job.attempt}
      {summary.duration !== null && <> · {t('reviewElapsed')} {Math.floor(summary.duration / 60)}{t('minute')} {summary.duration % 60}{t('second')}</>}</p>
    {active && state?.reviewActivity?.jobId === job.id && <ReviewProgress state={state} t={t} />}
    {job.decision && <>
      <p><strong>{t(`reviewVerdict.${job.decision.verdict}`)}</strong> · {job.decision.finding.split(/\r?\n/u)[0]?.slice(0, 240)}</p>
      {job.status === 'applied' && <p className="dsh-task-meta">{t(job.decision.verdict === 'needs-user' ? 'reviewUserNext' : job.decision.verdict === 'revise' ? 'reviewRevisionNext' : job.kind === 'completion' ? 'reviewTaskComplete' : job.kind === 'plan' ? 'reviewNextPlan' : job.kind === 'planning' ? 'reviewNextPlanning' : 'reviewNextNode')}</p>}
      {job.status === 'stale' && <p className="dsh-task-meta">{t('reviewStale')}</p>}
    </>}
    {job.fault && <p role={summary.canRetry ? 'alert' : 'status'}>{t(reviewFaultDescription(job.fault))}</p>}
    {job.status === 'failed' && <div className="dsh-task-review-recovery">
      <span>{t(summary.canRetry ? 'reviewRetryNeeded' : summary.currentFault ? 'reviewManualRecovery' : 'reviewHistoricalFault')}</span>
      {summary.canRetry && <Button size="sm" variant="primary" disabled={busy} onClick={() => { void store.act('retry-review') }}>{t('reviewRetry')}</Button>}
    </div>}
    {job.recovery && job.recovery.failures.length > 0 && <p className="dsh-task-meta">{t('reviewFaultHistory')} · {job.recovery.failures.length} · {t('reviewFaultRetries')} {job.recovery.consumed}/{job.recovery.retryLimit}</p>}
    {!!job.recovery?.protocolRepairs && <p className="dsh-task-meta">{t('reviewProtocolRepairs')} {job.recovery.protocolRepairs}/{job.repairLimit}</p>}
    {summary.canRetry && error && <p role="alert">{error}</p>}
    {open && <div className="dsh-task-review-process">
      {job.fault && <p className="dsh-task-meta">{job.fault.message}</p>}
      {open && !ready && <p className="dsh-task-meta">{t('reviewQueued')}</p>}
      {open && ready && job.reviewerSessionId && <div ref={setTarget} className="dsh-task-review-transcript" />}
    </div>}
  </section>
}
