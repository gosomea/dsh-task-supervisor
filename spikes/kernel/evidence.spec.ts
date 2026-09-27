import { expect, it } from 'vitest'
import { redact, textPage } from '../../src/evidence.ts'
import { validateProvenance } from '../../src/provenance.ts'
import { newTask, taskJson, taskSchema, type TaskCriterion } from '../../src/state.ts'

it('reconstructs redacted evidence across arbitrary page boundaries without losing the tail', () => {
  const raw = 'x'.repeat(699) + 'Bearer super-secret-credential\n' + 'y'.repeat(7300) + '\nFAILED at the end'
  let offset: number | null = 0
  let full = ''
  while (offset !== null) {
    const page = textPage(raw, offset, 700)
    full += page.text
    offset = page.nextOffset
  }
  expect(full).toBe(redact(raw))
  expect(full).toContain('FAILED at the end')
  expect(full).not.toContain('super-secret-credential')
  expect(textPage(raw, 0, 99999).text).toHaveLength(6000)
  expect(() => textPage(raw, -1)).toThrow('offset')
})

it('requires provenance for new plans while preserving old snapshots and implementation origins', () => {
  const legacy: TaskCriterion = { id: 'c1', text: 'greeting exists' }
  const task = { ...newTask('Write a greeting'), criteria: [legacy] }
  expect(taskSchema.parse(taskJson(task)).criteria).toEqual([legacy])
  expect(() => validateProvenance([legacy], [])).toThrow('needs provenance')
  const criterion = { ...legacy, provenance: { kind: 'user' as const, reference: 'objective' } }
  expect(() => validateProvenance([criterion], [])).not.toThrow()
  expect(() => validateProvenance([{ ...criterion, provenance: { kind: 'project', reference: 'leftover verify.mjs' } }], [])).toThrow('no valid project source')
  expect(() => validateProvenance([{ ...criterion, provenance: { kind: 'user', reference: 'assistant said so', sourceSeq: 999 } }], [])).toThrow('no valid user source')
  expect(taskSchema.parse(taskJson({ ...task, criteria: [criterion] })).criteria).toEqual([criterion])
})
