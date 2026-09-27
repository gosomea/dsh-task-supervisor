import { expect, it } from 'vitest'
import { continuationContext, languagePolicy, resolveLanguage } from '../../src/task-context.ts'
import { newTask, taskJson, taskSchema, taskProjection } from '../../src/state.ts'

it('keeps Chinese prose authoritative over English code and supports explicit profile choices', () => {
  expect(resolveLanguage('请修复以下代码：```js\nthrow new Error("failure")\n```')).toBe('zh-CN')
  expect(resolveLanguage('Fix the parser')).toBe('en')
  expect(resolveLanguage('日本語で修正してください')).toBe('ja')
  expect(resolveLanguage('请修复', 'en')).toBe('en')
  expect(resolveLanguage('123', 'auto', 'zh-CN')).toBe('zh-CN')
  expect(() => resolveLanguage('task', 'not_a_locale')).toThrow()
})

it('persists language and stage detail and retains the full objective in bounded continuation summaries', () => {
  const task = { ...newTask('请实现场景，不能添加 UI'), responseLanguage: 'zh-CN', planVersion: 1,
    criteria: [{ id: 'C1', text: '无 UI' }],
    stages: [{ id: 'S1', title: '创建场景', criterionIds: ['C1'] },
      { id: 'S2', title: '验收', description: '检查场景截图', criterionIds: ['C1'] }], stageIndex: 1,
    lastReview: { stageId: 'S1', cutoff: 32, verdict: 'pass' as const, finding: '已确认'.repeat(1000) } }
  const restored = taskSchema.parse(taskJson(task))
  expect(restored.responseLanguage).toBe('zh-CN')
  const prompt = continuationContext(restored, '检查截图后汇报')
  expect(prompt).toContain('Accepted nodes: S1')
  expect(prompt).toContain('Current node: S2 — 验收')
  expect(prompt).toContain('不能添加 UI')
  expect(prompt).toContain('summary truncated; use task_status')
  expect(prompt.length).toBeLessThan(3500)
  expect(languagePolicy(restored)).toContain('zh-CN')
})

it('reads legacy records while refusing unknown future record versions', () => {
  const task = newTask('旧中文任务')
  const record = (schemaVersion: number) => ({ type: 'extension/record', seq: 0, time: 0,
    data: { namespace: 'dsh-task-supervisor', schemaVersion, recordId: 'legacy', kind: 'state', payload: taskJson(task) } })
  // Exercise the wire parser without constructing unrelated Session fixtures.
  const legacy = taskProjection.apply(taskProjection.init(), record(1) as Parameters<typeof taskProjection.apply>[1])
  expect(legacy.failure).toBeNull()
  expect(languagePolicy(legacy.current!)).toContain('zh-CN')
  expect(taskProjection.apply(taskProjection.init(), record(99) as Parameters<typeof taskProjection.apply>[1]).failure).toContain('unsupported')
})
