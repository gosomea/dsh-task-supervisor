/** Diagnostic-only regression: no Docker, model, profile activation or process capture is performed. */
import { expect, it } from 'vitest'
import { summarizeProbeFailure } from '../../eval/independent-verification/process-provenance-probe.ts'

it('retains nested aggregate cleanup and cause reasons while omitting arbitrary scope fields', () => {
  const command = Object.assign(new Error('Cannot unpause /private/secret/capture at C:\\control\\secret'), { code: 'EIO', scope: { secret: 'scope-secret' } })
  const result = summarizeProbeFailure(new AggregateError([command, new Error('native range remains active')], 'capture release failed', { cause: new Error('capture verification failed') }))
  expect(result).toMatchObject({ name: 'AggregateError', cause: { message: 'capture verification failed' }, errors: [{ name: 'Error', code: 'EIO' }, { message: 'native range remains active' }] })
  expect(result.errors?.[0]?.message).toContain('[path]')
  expect(JSON.stringify(result)).not.toMatch(/private|control|secret|scope/)
})

it('bounds cycles, deep causes, aggregate width and diagnostic strings', () => {
  const cycle = new Error('cycle'); cycle.cause = cycle
  expect(summarizeProbeFailure(cycle).cause?.name).toBe('TruncatedError')
  let deep: Error = new Error('deep')
  for (let i = 0; i < 100; i++) deep = new Error('deep', { cause: deep })
  const bounded = summarizeProbeFailure(deep)
  expect(bounded.cause?.cause?.cause?.cause?.name).toBe('TruncatedError')
  const wide = summarizeProbeFailure(new AggregateError(Array.from({ length: 100 }, () => new Error('x'.repeat(10000))), 'wide'))
  expect(wide.errors).toHaveLength(6)
  expect(wide.errors?.[0]?.message).toHaveLength(512)
  expect(JSON.stringify(wide).length).toBeLessThan(4000)
})

it('omits non-errors and throwing diagnostic getters without preventing result sealing', () => {
  expect(summarizeProbeFailure({ message: 'scope-secret', scope: { credential: 'secret' } })).toEqual({ name: 'NonError', message: 'Non-error failure omitted' })
  const error = new Error()
  for (const key of ['name', 'message', 'cause', 'code']) Object.defineProperty(error, key, { get() { throw new Error('getter-secret') } })
  expect(summarizeProbeFailure(error)).toEqual({ name: 'Error', message: 'Unreadable error diagnostics' })
})
