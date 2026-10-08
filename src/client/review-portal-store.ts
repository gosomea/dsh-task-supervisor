/** Expanded transcript anchors; stale cleanup cannot detach a newer owner. */
export interface ReviewPortalTarget { key: string; sessionId: string; parentSessionId: string; element: HTMLElement }
export function createReviewPortals() {
  let targets: readonly ReviewPortalTarget[] = []
  let disposed = false
  const listeners = new Set<() => void>()
  const publish = () => { for (const listener of listeners) listener() }
  return {
    snapshot: () => targets,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    attach(target: ReviewPortalTarget) {
      if (disposed) return () => {}
      targets = [...targets.filter(item => item.key !== target.key), target]; publish()
      return () => { targets = targets.filter(item => item !== target); publish() }
    },
    dispose() { disposed = true; targets = []; publish(); listeners.clear() },
  }
}
export type ReviewPortals = ReturnType<typeof createReviewPortals>
