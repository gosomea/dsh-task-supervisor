import { expect, it } from 'vitest'
import { executionActors, executorLabel } from '../../src/client/presentation.ts'
import { acceptedNodes, dependencies, finishNode, readyNodes, reworkNode, reviewNode, runsOf, validateGraph, withRuns, recoverRuns } from '../../src/graph.ts'
import { newTask, taskJson, taskSchema, type TaskSnapshot } from '../../src/state.ts'

function diamond(): TaskSnapshot {
  return { ...newTask('Build two branches and integrate'), phase: 'active', criteria: [{ id: 'c', text: 'works' }], stages: [
    { id: 'a', title: 'A', criterionIds: ['c'], dependsOn: [] },
    { id: 'b', title: 'B', criterionIds: ['c'], dependsOn: [] },
    { id: 'join', title: 'Join', criterionIds: ['c'], dependsOn: ['a', 'b'] },
  ] }
}

it('resubmits interrupted review with settled worker evidence, but invalidates interrupted execution', () => {
  const task = { ...diamond(), nodeRuns: [
    { id: 'a', attempt: 1, status: 'reviewing' as const, sessionId: 'worker-a', workerCutoff: 20, integrationAfterSeq: 50, evidenceAfterSeq: 5 },
    { id: 'b', attempt: 1, status: 'running' as const, sessionId: 'worker-b' },
    { id: 'join', attempt: 1, status: 'pending' as const },
  ] }
  const resumed = withRuns(task, recoverRuns(task, 80))
  expect(resumed.nodeRuns?.[0]).toEqual({ ...task.nodeRuns[0], status: 'awaiting-integration' })
  expect(resumed.nodeRuns?.[1]).toEqual({ id: 'b', attempt: 2, status: 'pending', evidenceAfterSeq: 80 })
  expect(() => reviewNode(resumed, 'a', 1)).not.toThrow()
  expect(() => reviewNode(resumed, 'join', 1)).toThrow('not ready')
})

it('releases a join only after both independent branches pass review', () => {
  let task = diamond()
  expect(readyNodes(task)).toEqual(['a', 'b'])
  expect(() => reviewNode(task, 'join', 1)).toThrow('not ready')
  task = reviewNode(task, 'b', 1)
  expect(readyNodes(task)).toEqual(['a'])
  task = finishNode(task, 'b', 'pass', 10)
  expect(acceptedNodes(task)).toEqual(['b'])
  expect(task.stageIndex).toBe(0)
  task = finishNode(reviewNode(task, 'a', 1), 'a', 'pass', 20)
  expect(readyNodes(task)).toEqual(['join'])
  expect(task.stageIndex).toBe(2)
})

it('invalidates only reworked descendants and rejects results from old attempts', () => {
  let task = diamond()
  task = withRuns(task, runsOf(task).map(run => ({ ...run, status: 'passed' })))
  task = reworkNode(task, 'a')
  expect(acceptedNodes(task)).toEqual(['b'])
  expect(readyNodes(task)).toEqual(['a'])
  expect(runsOf(task).map(run => [run.id, run.attempt])).toEqual([['a', 2], ['b', 1], ['join', 2]])
  expect(() => reviewNode(task, 'a', 1)).toThrow('stale')
  expect(() => reviewNode(task, 'a', undefined)).toThrow('stale')
  expect(taskSchema.parse(taskJson(task))).toEqual(task)
})

it('rejects missing dependencies and cycles, and preserves the legacy chain', () => {
  const task = diamond()
  expect(() => validateGraph(task.stages.map(stage => ({ ...stage, dependsOn: ['missing'] })))).toThrow('unknown')
  expect(() => validateGraph([{ ...task.stages[0]!, dependsOn: ['b'] }, { ...task.stages[1]!, dependsOn: ['a'] }])).toThrow('cycle')
  const legacy = { ...task, stageIndex: 1, stages: task.stages.map(({ dependsOn: _, ...stage }) => stage) }
  expect(dependencies(legacy.stages, 1)).toEqual(['a'])
  expect(acceptedNodes(legacy)).toEqual(['a'])
  expect(readyNodes(legacy)).toEqual(['b'])
})

it('shows only recorded worker Sessions and deduplicates shared executors in the overview', () => {
  const planned = diamond()
  planned.stages[0]!.title = 'Worker A will implement this'
  expect(executionActors(planned, 'main')).toEqual([])
  const task = { ...planned, nodeRuns: [
    { id: 'a', attempt: 1, status: 'passed' as const, sessionId: 'child-one' },
    { id: 'b', attempt: 1, status: 'reviewing' as const, sessionId: 'child-one' },
    { id: 'join', attempt: 1, status: 'pending' as const, sessionId: 'main' },
  ] }
  expect(executionActors(task, 'main')).toEqual([{ sessionId: 'child-one', label: 'Worker 1', nodeIds: ['a', 'b'] }])
  expect(executorLabel(task, 'main', 'b')).toBe('Worker 1')
  expect(executorLabel(task, 'main', 'join')).toBe('主 Agent')
  expect(executionActors(reworkNode(task, 'a', 50), 'main')).toEqual([{ sessionId: 'child-one', label: 'Worker 1', nodeIds: ['b'] }])
})
