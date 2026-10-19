/** Explicit connection opens controls without granting task continuation. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SupervisorTranslate } from './locales.ts'
import type { PanelState } from './task-store.ts'

/**
 * Use the Host command path to activate a persisted Session without a model prompt.
 * @param sessions - native Session service, which owns Agent admission.
 * @param id - current main Session.
 * @returns completion of the status command; transport and admission failures propagate.
 */
export async function connectSupervisorSession(sessions: ISessions, id: SessionId): Promise<void> {
  const reference = sessions.retain(id, { source: 'taskSupervisor' })
  try {
    const binding = await reference.ready
    const result = await binding.session.command('/task status')
    if (!result.ok) throw new Error(result.error.message)
    if (!result.value.matched) throw new Error('Supervisor command unavailable: /task status')
  } finally { reference.release() }
}

/** Current cold state has an explicit connection action; history remains read-only. */
export function SessionConnection({ state, connect, t }: { state: PanelState; connect: () => Promise<void>; t: SupervisorTranslate }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const pending = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  if (state.live || !state.task || ['complete', 'closed', 'cleared'].includes(state.task.phase)) return null
  async function activate() {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await connect() }
    catch (error) { if (mounted.current) setError(String(error)) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  return <div className="dsh-task-review-recovery" role="status">
    <span>{t('reviewConnectNeeded')}</span>
    <Button size="sm" variant="primary" disabled={busy} onClick={() => { void activate() }}>{t(busy ? 'reviewConnecting' : 'reviewConnect')}</Button>
    {error && <p role="alert">{t('reviewConnectFailed')} {error}</p>}
  </div>
}
