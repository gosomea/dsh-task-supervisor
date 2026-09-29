import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { newTask, taskJson, RECORD_VERSION, type TaskSnapshot } from '../../src/state.ts'
import { recoveryBoundary } from '../../src/recovery.ts'

function log() {
  const events: SessionEvent[] = []
  function add(type: string, data: unknown) {
    const event = { type, seq: events.length + 1, time: events.length + 1, data } as SessionEvent
    events.push(event)
    return event
  }
  const state = (task: TaskSnapshot) => add('extension/record', { namespace: 'dsh-task-supervisor',
    schemaVersion: RECORD_VERSION, recordId: String(events.length + 1), kind: 'state', payload: taskJson(task) })
  const assistant = (turn: number, step: number, reason = 'max-tokens') => add('assistant/message', {
    turn, step, message: { role: 'assistant', content: [{ type: 'reasoning', text: '未完成的推理' }],
      source: { provider: 'fake', model: 'fake' } },
    stream: [{ type: 'chunk', time: events.length + 1, chunk: { type: 'finish', reason: { kind: reason } } }],
  })
  function result(turn: number, step: number, id: string, name: string, text: string, isError = false) {
    add('tool/call', { turn, step, callId: id, name, arguments: '{"path":"README.md"}' })
    return add('tool/result', { turn, step, message: { role: 'tool', source: { kind: 'tool', callId: id },
      content: [{ type: 'text', text }], isError } })
  }
  function turn(turn: number, output?: string, error = false, name = 'read') {
    add('turn/start', { turn })
    add('step/start', { turn, step: 1 })
    if (output !== undefined) {
      assistant(turn, 1, 'tool-calls')
      result(turn, 1, `read-${turn}`, name, output, error)
      add('step/end', { turn, step: 1 })
      add('step/start', { turn, step: 2 })
    }
    const step = output === undefined ? 1 : 2
    assistant(turn, step)
    add('step/end', { turn, step })
    add('turn/end', { turn, reason: { kind: 'max-tokens' } })
  }
  return { events, add, state, assistant, result, turn }
}

function fixture(output?: string) {
  const task = newTask('读取现有项目，提交中文计划')
  const logs = log()
  logs.state(task)
  logs.turn(1, output)
  return { task, ...logs }
}

it('recognizes reasoning-only truncation without inventing tool progress', () => {
  const { task, events } = fixture()
  const value = recoveryBoundary(events, task)
  expect(value).toMatchObject({ turn: 1, endSeq: events.at(-1)?.seq, evidenceSeqs: [] })
  expect(value?.summary).toContain('不代表工具已执行')
})

it('keeps successful evidence, but repeated identical reads and empty later rounds do not add progress', () => {
  const logs = fixture('配置入口位于 src/main.ts')
  const first = recoveryBoundary(logs.events, logs.task)!
  expect(first.summary).toContain('read: 配置入口位于 src/main.ts')
  expect(first.evidenceSeqs).toHaveLength(1)
  logs.turn(2, '配置入口位于 src/main.ts')
  const repeated = recoveryBoundary(logs.events, logs.task)!
  expect(repeated.progressFingerprint).toBe(first.progressFingerprint)
  expect(repeated.evidenceSeqs).toHaveLength(1)
  expect(repeated.evidenceSeqs[0]).toBeGreaterThan(first.evidenceSeqs[0]!)
  logs.turn(3)
  expect(recoveryBoundary(logs.events, logs.task)?.progressFingerprint).toBe(first.progressFingerprint)
  logs.turn(4, '入口调用 bootstrap()')
  expect(recoveryBoundary(logs.events, logs.task)?.progressFingerprint).not.toBe(first.progressFingerprint)
})

it('does not count failed tools or task status polling as progress', () => {
  const logs = fixture()
  const before = recoveryBoundary(logs.events, logs.task)!
  logs.turn(2, 'ENOENT', true)
  logs.turn(3, '当前仍在规划', false, 'task_status')
  expect(recoveryBoundary(logs.events, logs.task)?.progressFingerprint).toBe(before.progressFingerprint)
})

it.each(['completed', 'aborted', 'error', 'interrupted', 'blocked', 'forked'])('does not recover %s as truncation', reason => {
  const { task, events } = fixture()
  const end = events.at(-1)!
  if (end.type === 'turn/end') end.data.reason = { kind: reason } as typeof end.data.reason
  expect(recoveryBoundary(events, task)).toBeNull()
})

it.each(['stop', 'tool-calls', 'error'])('does not revive a sticky max-tokens turn after a later %s response', reason => {
  const logs = fixture()
  logs.events.pop()
  logs.add('step/start', { turn: 1, step: 2 })
  logs.assistant(1, 2, reason)
  if (reason === 'tool-calls') logs.result(1, 2, 'submit', 'task_submit_plan', '计划已提交')
  logs.add('step/end', { turn: 1, step: 2 })
  logs.add('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
  expect(recoveryBoundary(logs.events, logs.task)).toBeNull()
})

it('rejects tools or a successful submission arriving after the purported truncated response', () => {
  const logs = fixture()
  logs.events.pop()
  logs.result(1, 1, 'submit', 'task_submit_plan', '计划已提交')
  logs.add('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
  expect(recoveryBoundary(logs.events, logs.task)).toBeNull()
})

it.each(['user/message', 'turn/start', 'step/start', 'assistant/attempt'])('rejects post-boundary %s activity', type => {
  const logs = fixture()
  logs.add(type, { turn: 2, step: 1, source: { kind: 'user' }, content: [{ type: 'text', text: '先停下' }] })
  expect(recoveryBoundary(logs.events, logs.task)).toBeNull()
})

it('requires matching task state before the turn and rejects edits or foreign state', () => {
  const logs = fixture()
  const state = logs.events[0]!
  expect(recoveryBoundary(logs.events.slice(1), logs.task)).toBeNull()
  const edited = { ...logs.task, requirementsVersion: 2, revision: 2 }
  expect(recoveryBoundary(logs.events, edited)).toBeNull()
  logs.state(edited)
  expect(recoveryBoundary(logs.events, edited)).toBeNull()
  if (state.type === 'extension/record') state.data.payload = taskJson(newTask('其他任务'))
  expect(recoveryBoundary(logs.events, logs.task)).toBeNull()
})

it.each(['paused', 'reviewing', 'awaiting-approval', 'complete', 'cleared'] as const)('never recovers phase %s', phase => {
  const { task, events } = fixture()
  expect(recoveryBoundary(events, { ...task, phase })).toBeNull()
})

it('requires enabled state and approved execution; controller-only recovery revision may advance after the end', () => {
  const logs = fixture()
  expect(recoveryBoundary(logs.events, { ...logs.task, enabled: false })).toBeNull()
  const active = { ...logs.task, phase: 'active' as const, everApproved: false }
  const second = log()
  second.state(active)
  second.turn(1)
  expect(recoveryBoundary(second.events, active)).toBeNull()
  const approved = { ...active, everApproved: true }
  const third = log()
  third.state(approved)
  third.turn(1, '当前节点产物已经读取')
  expect(recoveryBoundary(third.events, approved)?.turn).toBe(1)
  const next = { ...logs.task, revision: logs.task.revision + 1 }
  logs.state(next)
  expect(recoveryBoundary(logs.events, next)?.turn).toBe(1)
})

it('rejects foreign-turn activity and native tools outside an open step', () => {
  const logs = fixture('事实')
  const call = logs.events.find(event => event.type === 'tool/call')!
  if (call.type === 'tool/call') call.data.turn = 2
  expect(recoveryBoundary(logs.events, logs.task)).toBeNull()
  if (call.type === 'tool/call') call.data.turn = 1
  const firstStep = logs.events.find(event => event.type === 'step/start')!
  expect(recoveryBoundary(logs.events.filter(event => event !== firstStep), logs.task)).toBeNull()
})

it('does not reuse a settled native call identity', () => {
  const logs = fixture('事实')
  logs.turn(2, '新事实')
  for (const event of logs.events) {
    if (event.type === 'tool/call' && event.data.turn === 2) event.data.callId = 'read-1' as typeof event.data.callId
    if (event.type === 'tool/result' && event.data.turn === 2) event.data.message.source.callId = 'read-1' as typeof event.data.message.source.callId
  }
  expect(recoveryBoundary(logs.events, logs.task)).toBeNull()
})

it('starts a new evidence epoch after requirements change instead of carrying forward old observations', () => {
  const logs = fixture('旧要求的工具输出')
  const edited = { ...logs.task, requirementsVersion: 2, revision: 2 }
  logs.state(edited)
  logs.turn(2)
  const value = recoveryBoundary(logs.events, edited)!
  expect(value.evidenceSeqs).toEqual([])
  expect(value.summary).not.toContain('旧要求的工具输出')
})

it('requires an actual terminal stream finish and an uninterrupted assistant', () => {
  const logs = fixture()
  const message = logs.events.findLast(event => event.type === 'assistant/message')!
  if (message.type !== 'assistant/message') throw new Error('fixture assistant missing')
  message.data.stream = []
  expect(recoveryBoundary(logs.events, logs.task)).toBeNull()
  message.data.stream = [{ type: 'chunk', time: 4, chunk: { type: 'finish', reason: { kind: 'max-tokens' } } }]
  message.data.interrupted = true
  expect(recoveryBoundary(logs.events, logs.task)).toBeNull()
})

it('requires every step and native tool obligation to have a matching settlement', () => {
  const logs = fixture('事实')
  const result = logs.events.find(event => event.type === 'tool/result')!
  const withoutResult = logs.events.filter(event => event !== result)
  expect(recoveryBoundary(withoutResult, logs.task)).toBeNull()
  const stepEnd = logs.events.findLast(event => event.type === 'step/end')!
  expect(recoveryBoundary(logs.events.filter(event => event !== stepEnd), logs.task)).toBeNull()
  if (result.type === 'tool/result') result.data.step = 99
  expect(recoveryBoundary(logs.events, logs.task)).toBeNull()
})

it('bounds and redacts output context without copying truncated reasoning', () => {
  const logs = fixture('api_key="secret-token-example"\n' + '文件内容'.repeat(500))
  for (let turn = 2; turn <= 12; turn++) logs.turn(turn, `不同文件 ${turn} ` + '内容'.repeat(500))
  const value = recoveryBoundary(logs.events, logs.task)!
  expect(value.evidenceSeqs).toHaveLength(8)
  expect(value.summary.length).toBeLessThan(2400)
  expect(value.summary).toContain('省略')
  expect(value.summary).not.toContain('未完成的推理')
  const secret = fixture('api_key="secret-token-example"')
  const summary = recoveryBoundary(secret.events, secret.task)!.summary
  expect(summary).toContain('[redacted]')
  expect(summary).not.toContain('secret-token-example')
})

it('rejects unordered or duplicate sequence positions instead of changing the Session order', () => {
  const { events, task } = fixture()
  expect(recoveryBoundary([...events].reverse(), task)).toBeNull()
  expect(recoveryBoundary([events[0]!, ...events], task)).toBeNull()
})
