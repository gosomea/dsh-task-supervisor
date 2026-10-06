import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { consultationDirective } from '../../src/consultation.ts'
import { draftDefinition } from '../../src/client/draft-events.ts'

it.each([
  ['/task 用中文统计当前目录', 'new 用中文统计当前目录'],
  ['/task new 用中文统计当前目录', 'new 用中文统计当前目录'],
  ['创建任务：只读检查数据', 'new 只读检查数据'],
  ['建立任务：只读检查数据', 'new 只读检查数据'],
  ['按这份方案建立任务', 'create-draft'],
  ['修改任务要求：输出改为中文，仍然不修改文件', 'edit 输出改为中文，仍然不修改文件'],
  ['现在进度如何？', null], ['我要开发一个我的世界', null],
  ['为什么要创建任务？', null], ['/task status', null], ['/task', null],
])('distinguishes a direct action from conversation: %s', (input, directive) => {
  expect(consultationDirective(input)).toBe(directive)
})

it('places only successful paired draft records in their native turn and retains the latest revision in that turn', () => {
  let state = draftDefinition.start({ state: undefined }, { event: { type: 'turn/start', seq: 0, data: { turn: 1 } } })
  const draft = { id: 'draft-1', version: 1, mainSessionId: 'main', sourceSessionId: 'supervisor-chat-main', title: '只读统计',
    requirements: '读取数据后输出统计，不修改文件', questions: ['统计哪些列？'], status: 'draft' }
  const result = (callId: string, value: object, isError = false) => ({ type: 'tool/result', seq: 2, surfaceOp: 'append',
    data: { turn: 1, message: { isError, source: { callId }, content: [{ type: 'text', text: JSON.stringify(value) }] } } })
  expect(draftDefinition.update({ state }, { event: result('unpaired', draft) })).toBe(state)
  state = draftDefinition.update({ state }, { event: { type: 'tool/call', seq: 1, data: { turn: 1, callId: 'proposal', name: 'supervisor_update_draft' } } })
  expect(draftDefinition.update({ state }, { event: result('proposal', draft, true) })).toBe(state)
  expect(draftDefinition.update({ state }, { event: result('proposal', { title: 'invalid' }) })).toBe(state)
  state = draftDefinition.update({ state }, { event: result('proposal', draft) })
  expect(draftDefinition.buildLocationData({ state }, 'step', null)).toBeNull()
  expect(draftDefinition.buildLocationData({ state }, 'turn', null)?.value).toEqual([draft])
  const revised = { ...draft, version: 2, questions: [] }
  state = draftDefinition.update({ state }, { event: result('proposal', revised) })
  expect(draftDefinition.buildLocationData({ state }, 'turn', null)?.value).toEqual([revised])
})

it('replays a recorded native consultation draft into the original turn location', () => {
  type Event = Parameters<typeof draftDefinition.match>[0]
  const events: Event[] = JSON.parse(readFileSync(new URL('./fixtures/consultation-draft.json', import.meta.url), 'utf8'))
  let state = draftDefinition.start({ state: undefined }, { event: events[0]! })
  for (const event of events.slice(1)) state = draftDefinition.update({ state }, { event })
  const location = draftDefinition.buildLocationData({ state }, 'turn', null)!
  expect(location.key).toBe('task-supervisor-drafts')
  expect(location.turn).toBe(1)
  expect(location.value).toHaveLength(1)
  expect(location.value[0]?.mainSessionId).toBe('fixture-main')
  expect(location.value[0]?.questions).toEqual([])
})
