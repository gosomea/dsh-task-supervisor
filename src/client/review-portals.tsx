/** Render native review conversations from the shell, into their inline anchors.
 * Native conversation factories cannot recursively nest. A React portal preserves
 * the review's own public Session scope while placing its DOM in the main log. */
import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { ReviewTranscript } from './review-session.tsx'

import { type ReviewPortals } from './review-portal-store.ts'
export { createReviewPortals } from './review-portal-store.ts'
export type ReviewPortalProps = PropsRuntime<'shell.overlay'> & PropsRenderSlots<'task-supervisor.review-session'>
export function ReviewPortalHost({ portals, sessions, ...props }: ReviewPortalProps & { portals: ReviewPortals; sessions: ISessions }) {
  const targets = useSyncExternalStore(portals.subscribe, portals.snapshot)
  return <>{targets.map(target => createPortal(<ReviewTranscript id={target.sessionId} parentId={target.parentSessionId} sessions={sessions}
    SessionProvider={props.SessionProvider} renderSlot={props.renderSlot} />, target.element, target.key))}</>
}
