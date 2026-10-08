import { expect, it } from 'vitest'
import { createReviewPortals } from '../../src/client/review-portal-store.ts'

it('keeps one inline destination per job through rebinds and stale cleanup', () => {
  const portals = createReviewPortals()
  const target = { key: 'job', sessionId: 'review', parentSessionId: 'main', element: {} as HTMLElement }
  const first = portals.attach(target)
  const second = portals.attach({ ...target, element: {} as HTMLElement })
  first()
  expect(portals.snapshot()).toHaveLength(1)
  expect(portals.snapshot()[0]?.sessionId).toBe('review')
  second()
  expect(portals.snapshot()).toEqual([])
})

it('drops only the collapsed job and disposes every remaining destination on unload', () => {
  const portals = createReviewPortals()
  const detach = portals.attach({ key: 'old', sessionId: 'r1', parentSessionId: 'main', element: {} as HTMLElement })
  portals.attach({ key: 'new', sessionId: 'r2', parentSessionId: 'main', element: {} as HTMLElement })
  detach()
  expect(portals.snapshot().map(item => item.key)).toEqual(['new'])
  portals.dispose()
  portals.attach({ key: 'late', sessionId: 'r3', parentSessionId: 'main', element: {} as HTMLElement })
  expect(portals.snapshot()).toEqual([])
})
