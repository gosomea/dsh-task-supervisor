/** Embed the existing DSH conversation factory with its own retained Session scope. */
import { useEffect, useState } from 'react'
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRuntime, PropsRenderFactories, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { taskSupervisor: unknown }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap { 'task-supervisor.consultation': { kind: 'single'; scope: 'session' } }
}
export type ConsultationPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<'task-supervisor.consultation'>
function Chat(props: ConversationViewsProps) { return <>{props.renderSlot('conversation.session', { view: 'chat' })}</> }
export function ConsultationConversation({ renderFactorySlot }: PropsRuntime<'task-supervisor.consultation'> & PropsRenderFactories) {
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: Chat } })
}
export function ConsultationHost({ id, sessions, SessionProvider, renderSlot }: {
  id: string; sessions: ISessions
} & Pick<ConsultationPanelProps, 'SessionProvider' | 'renderSlot'>) {
  const [reference, setReference] = useState<SessionReference | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const ref = sessions.retain(id as SessionId, { source: 'taskSupervisor' })
    void ref.ready.then(() => { if (active) setReference(ref) }, failure => { if (active) setError(String(failure)) })
    return () => { active = false; ref.release(); setReference(null) }
  }, [id, sessions])
  return <section aria-label="Supervisor 持久对话" className="dsh-task-consultation">
    <p className="dsh-task-muted">Supervisor · 持久督导对话。普通问询不打断任务；明确输入“暂停任务”“恢复任务”可介入，修改要求可输入“修改任务要求：完整目标”。压缩使用宿主提供的原生 /compact 命令。</p>
    {error && <p role="alert">{error}</p>}
    <div style={{ height: '60vh', minHeight: 360, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {reference && <SessionProvider session={reference}>{renderSlot('task-supervisor.consultation', {})}</SessionProvider>}
    </div>
  </section>
}
