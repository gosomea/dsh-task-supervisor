import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { beginNode, reworkNode, runsOf, withRuns } from '../../src/graph.ts'
import { taskProjection, taskJson, newTask, type TaskSnapshot } from '../../src/state.ts'
import { changedAttempts } from '../../src/rework-records.ts'
import { nodeLabel } from '../../src/client/presentation.ts'
import { milestoneDefinition } from '../../src/client/milestones.ts'

function accepted(): TaskSnapshot {
  const task = { ...newTask('开发一个我的世界'), planVersion: 1, phase: 'active' as const,
    criteria: [{ id: 'c', text: '可玩' }], stages: [
      { id: 'n1', title: '世界核心与玩家物理', criterionIds: ['c'], dependsOn: [] },
      { id: 'n2', title: '网格构建', criterionIds: ['c'], dependsOn: [] },
      { id: 'n3', title: '集成', criterionIds: ['c'], dependsOn: ['n1', 'n2'] },
    ] }
  return withRuns(task, runsOf(task).map(run => ({ ...run, status: 'passed', reviewSeq: 1 })))
}
const record = (task: TaskSnapshot, seq: number): SessionEvent => ({ type: 'extension/record', seq, time: seq,
  data: { namespace: 'dsh-task-supervisor', schemaVersion: 7, recordId: String(seq), kind: 'state', payload: taskJson(task) } } as SessionEvent)
const call: SessionEvent = { type: 'tool/call', seq: 2, time: 2,
  data: { turn: 1, step: 1, callId: ToolCallId('rework'), name: 'task_rework_node',
    arguments: JSON.stringify({ stage_id: 'n1', reason: '发现斜向射线拾取错误' }) } } as SessionEvent
function result(task: TaskSnapshot, error = false, structured = false): SessionEvent {
  return { type: 'tool/result', seq: 4, time: 4, data: { turn: 1, step: 1, message: {
    role: 'tool', source: { kind: 'tool', callId: ToolCallId('rework') }, toolCallId: ToolCallId('rework'),
    id: 'result', isError: error,
    content: [{ type: 'text', text: JSON.stringify({ task: taskJson(task),
      ...structured ? { rework: { nodes: changedAttempts(accepted(), task) } } : {} }) }],
  } } } as SessionEvent
}

it.each([false, true])('rebuilds old and new rework results without losing prior attempts: structured=%s', structured => {
  const before = accepted()
  const after = { ...reworkNode(before, 'n1', 3), revision: 2 }
  let state = taskProjection.apply(taskProjection.init(), record(before, 1))
  state = taskProjection.apply(state, call)
  state = taskProjection.apply(state, record(after, 3))
  expect(state.reworks).toHaveLength(0)
  state = taskProjection.apply(state, result(after, false, structured))
  expect(state.failure).toBeNull()
  expect(state.reworks[0]).toMatchObject({ stageId: 'n1', reason: '发现斜向射线拾取错误',
    nodes: [{ id: 'n1', attempt: 1, nextAttempt: 2, status: 'passed' }, { id: 'n3', attempt: 1, nextAttempt: 2, status: 'passed' }] })
  const panel = { task: after, armed: true, live: true, reviewing: false, actions: [], reworks: state.reworks }
  expect(nodeLabel(after, 'n1', panel)).toBe('待返工')
  expect(nodeLabel(after, 'n3', panel)).toBe('等待依赖')
  expect(nodeLabel(after, 'n2', panel)).toBe('已通过')
  const running = beginNode(after, 'n1', 'main')
  expect(nodeLabel(running, 'n1', { ...panel, task: running })).toBe('返工中')
  expect(nodeLabel(running, 'n1', { ...panel, task: running, reworks: [] })).toBe('执行中')
  const ended = { ...after, revision: 3, phase: 'cleared' as const }
  state = taskProjection.apply(state, record(ended, 5))
  state = taskProjection.apply(state, record(newTask('下一项任务'), 6))
  expect(state.reworks).toEqual([])
})

it('does not publish a rework from a rejected call', () => {
  const task = accepted()
  let state = taskProjection.apply(taskProjection.init(), record(task, 1))
  state = taskProjection.apply(state, call)
  state = taskProjection.apply(state, result(task, true))
  expect(state.reworks).toEqual([])
  expect(state.pendingReworks).toEqual([])
})

it('projects an applied rework as a main-session control notice from legacy tool events', () => {
  const task = accepted()
  const after = reworkNode(task, 'n1', 3)
  let state = milestoneDefinition.start({ state: undefined }, { event: { type: 'turn/start', seq: 0, data: { turn: 1 } } })
  state = milestoneDefinition.update({ state }, { event: call })
  state = milestoneDefinition.update({ state }, { event: { ...result(after), surfaceOp: 'append' } })
  expect(state.milestones[0]).toMatchObject({ kind: 'rework', nodeId: 'n1', title: '主 Agent 发起返工' })
  expect(state.milestones[0]?.summary).toContain('第 2 次')
})
