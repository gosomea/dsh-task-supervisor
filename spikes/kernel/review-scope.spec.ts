import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { newTask } from '../../src/state.ts'
import { buildReviewScope } from '../../src/review-scope.ts'
import { taskEvidenceIndex } from '../../src/evidence-index.ts'
import { originalEvidenceRead, EvidenceReadError, readCorrectionDetail } from '../../src/evidence-read.ts'

it('prefers the bound task/attempt while retaining earlier sources with explicit uncertain attribution', () => {
  const old = newTask('Previous Task'), task = { ...newTask('Current Task'), creationRequestId: 'main-task:main:9',
    criteria: [{ id: 'c', text: 'Keep the earlier language constraint', provenance: { kind: 'user' as const, reference: 'seq:1', sourceSeq: 1 } }],
    nodeRuns: [{ id: 'n', attempt: 2, status: 'pending' as const, evidenceAfterSeq: 15 }] }
  const user = (seq: number, text: string): SessionEvent => ({ seq, time: seq, type: 'user/message', data: { id: `m-${seq}`, source: { kind: 'user' }, content: [{ type: 'text', text }] } }) as unknown as SessionEvent
  const state = (seq: number, value: typeof task | typeof old): SessionEvent => ({ seq, time: seq, type: 'extension/record', data: { namespace: 'dsh-task-supervisor', kind: 'state', schemaVersion: 15, recordId: `${value.id}:1`, payload: value } }) as unknown as SessionEvent
  const events = [user(1, 'Chinese language'), user(2, 'Old task only'), state(3, old), user(9, 'Current Task'), state(10, task), user(16, 'Current work')]
  const scope = buildReviewScope(events, task, 'n', 16, 'main')
  expect(scope).toMatchObject({ taskFromSeq: 9, attemptFromSeq: 15, nodeAttempt: 2, sources: [
    { seq: 1, relation: 'referenced-constraint', attribution: 'bound' }, { seq: 2, relation: 'earlier-context', attribution: 'needs-check' },
    { seq: 9, relation: 'request', attribution: 'bound' },
  ] })
  expect(taskEvidenceIndex(events, 16, {}, scope).entries.map(item => item.seq)).toEqual([9, 10, 16])
  expect(taskEvidenceIndex(events, 16, { scope: 'current-attempt' }, scope).entries.map(item => item.seq)).toEqual([16])
  expect(taskEvidenceIndex(events, 16, { scope: 'earlier-context' }, scope).entries.map(item => item.seq)).toEqual([1, 2, 3])
  expect(() => taskEvidenceIndex(events, 16, { taskId: old.id }, scope)).toThrow('EVIDENCE_READ_CORRECTION')
  expect(buildReviewScope([], task, 'n', -1, 'main').taskFromSeq).toBeNull()
})
it('exposes actual redacted page ranges and correctable bounds without treating unknown/permission errors as corrections', () => {
  const event = { seq: 8, time: 0, type: 'tool/call', data: { turn: 1, step: 1, name: 'read', arguments: '{"apiKey":"FAKE_KEY_123456","file":"report.txt"}' } } as SessionEvent
  const value = originalEvidenceRead(event, { seq: 8, limit: 10 }, 20, true)
  expect(value).toMatchObject({ offset: 0, nextOffset: 10, truncated: true })
  expect(value.text).not.toContain('FAKE_KEY')
  for (const input of [{ seq: 999 }, { seq: 8, offset: -1 }, { seq: 8, limit: 0 }]) {
    try { originalEvidenceRead(event, input, 20, true); throw new Error('expected read failure') }
    catch (error) { expect(error).toBeInstanceOf(EvidenceReadError); expect(readCorrectionDetail(String(error))).not.toBeNull() }
  }
  expect(readCorrectionDetail('permission denied')).toBeNull()
  expect(readCorrectionDetail('SNAPSHOT_STALE')).toBeNull()
  expect(() => originalEvidenceRead(event, { seq: 8 }, 20, false)).toThrow('NOT_LOCATED')
})
