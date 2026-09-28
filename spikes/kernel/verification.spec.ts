/** Pure acceptance admission uses independently inspected, complete and bound evidence. */
import { expect, it } from 'vitest'
import { complete, validateFindings, verificationPolicy } from '../../src/verification.ts'
import type { VerificationState, CriterionFinding } from '../../src/verification-schema.ts'

function state(): VerificationState {
  return { snapshot: { id: '00000000-0000-4000-8000-000000000001', workspace: '/source', digest: 'digest', root: '/evidence', baseline: '/evidence/baseline', check: '/evidence/check', excluded: [], entries: [] },
    phase: 'independent', observations: [], checks: [], readFiles: [{ path: 'code.js', ranges: [[0, 10]], total: 10 }], readChecks: [] }
}
const read: CriterionFinding = { criterionId: 'c', status: 'satisfied', method: 'read', finding: '实现与约束一致', evidenceIds: ['file:code.js'] }
it('requires complete contiguous pages and exactly one finding per applicable criterion', () => {
  expect(complete([[5, 10]], 10)).toBe(false)
  expect(complete([[5, 10], [0, 6]], 10)).toBe(true)
  expect(() => validateFindings(state(), ['c'], [read], true)).not.toThrow()
  expect(() => validateFindings(state(), ['c', 'd'], [read], true)).toThrow('exactly once')
  expect(() => validateFindings(state(), ['c'], [read, read], true)).toThrow('exactly once')
  const partial = state(); partial.readFiles[0]!.ranges = [[5, 10]]
  expect(() => validateFindings(partial, ['c'], [read], true)).toThrow('fully inspected')
})
it('retains limitations but cannot promote an unverified criterion to pass', () => {
  const unverified: CriterionFinding = { ...read, status: 'unverified', evidenceIds: [] }
  expect(() => validateFindings(state(), ['c'], [unverified], false)).not.toThrow()
  expect(() => validateFindings(state(), ['c'], [unverified], true)).toThrow('cannot pass')
  expect(() => validateFindings(state(), ['c'], [{ ...read, evidenceIds: [] }], true)).toThrow('independent evidence')
  expect(() => validateFindings(state(), ['c'], [{ ...read, method: 'run' }], true)).toThrow('independent check')
  expect(() => validateFindings(state(), ['c'], [{ ...read, method: 'visual' }], true)).toThrow('not available')
})
it('rejects foreign, modified, incomplete, failed or timed-out execution as acceptance evidence', () => {
  const value = state(), id = '00000000-0000-4000-8000-000000000002'
  value.checks.push({ id, snapshotId: value.snapshot.id, argv: ['node'], cwd: 'tree', startedAt: '', finishedAt: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, outputIncomplete: false, changed: [] })
  const finding: CriterionFinding = { ...read, method: 'run', evidenceIds: [id] }
  expect(() => validateFindings(value, ['c'], [finding], true)).toThrow('complete check')
  value.readChecks = [{ id, stream: 'stdout', ranges: [[0, 0]], total: 0 }, { id, stream: 'stderr', ranges: [[0, 0]], total: 0 }]
  expect(() => validateFindings(value, ['c'], [finding], true)).not.toThrow()
  const check = value.checks[0]!
  check.exitCode = 1
  expect(() => validateFindings(value, ['c'], [finding], true)).toThrow('failed check')
  check.exitCode = 0; check.changed = ['code.js']
  expect(() => validateFindings(value, ['c'], [finding], true)).toThrow('modified')
  check.changed = []; check.timedOut = true
  expect(() => validateFindings(value, ['c'], [finding], true)).toThrow('timed out')
  check.timedOut = false; check.outputIncomplete = true
  expect(() => validateFindings(value, ['c'], [finding], true)).toThrow('incomplete')
  check.outputIncomplete = false; check.snapshotId = 'other'
  expect(() => validateFindings(value, ['c'], [finding], true)).toThrow('foreign')
})
it('bounds trusted deployment configuration before model tools become available', () => {
  const container = { context: 'test', image: 'sha256:' + 'a'.repeat(64), cpus: 1, memoryMiB: 512, pids: 64 }
  expect(() => verificationPolicy({ storageRoot: '/private/evidence', container: { ...container, image: 'node:latest' } })).toThrow('immutable')
  expect(() => verificationPolicy({ storageRoot: '/private/evidence', container, deadlineMs: Infinity })).toThrow('deadlineMs')
  expect(verificationPolicy({ storageRoot: '/private/evidence', container }).deadlineMs).toBe(1800000)
})
