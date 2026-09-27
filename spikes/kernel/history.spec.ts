import { expect, it } from 'vitest'
import { controlActions } from '../../src/decisions.ts'
import { createTaskHistoryCollector, newTask, taskJson } from '../../src/state.ts'

it('rebuilds completed and cleared task details from the main Session log', () => {
  const first = newTask('First task')
  const second = newTask('Second task')
  const third = newTask('Current task')
  const collector = createTaskHistoryCollector()
  let seq = 0
  const append = (task: typeof first) => collector.add({ type: 'extension/record', seq: ++seq, time: seq,
    data: { namespace: 'dsh-task-supervisor', schemaVersion: 7, recordId: `record-${seq}`,
      kind: 'state', payload: taskJson(task) } } as Parameters<typeof collector.add>[0])

  append(first)
  append({ ...first, revision: 2, phase: 'complete', lastReview: {
    stageId: 'completion', cutoff: 1, verdict: 'pass', finding: 'accepted' } })
  append(second)
  append({ ...second, revision: 2, phase: 'cleared' })
  append(third)

  expect(collector.finish().map(entry => [entry.task.id, entry.task.phase, entry.lastSeq]))
    .toEqual([[second.id, 'cleared', 4], [first.id, 'complete', 2]])
  expect(collector.finish()[1]?.reviews[0]?.finding).toBe('accepted')
  expect(controlActions({ ...first, phase: 'complete' }, false, false)).toEqual([])
})
