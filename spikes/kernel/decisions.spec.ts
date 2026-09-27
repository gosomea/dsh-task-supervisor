import { expect, it } from 'vitest'
import { controlActions, isApprovalText } from '../../src/decisions.ts'
import { newTask } from '../../src/state.ts'

it('accepts explicit short approvals without interpreting quoted or conditional text as permission', () => {
  for (const text of ['批准', '批准当前计划。', '同意计划', '可以，开始吧', 'approve the current plan']) expect(isApprovalText(text)).toBe(true)
  for (const text of ['不要批准', '他说“批准”', '如果测试通过就批准', '解释一下批准按钮', '> 批准', '批准\n但先不要执行']) expect(isApprovalText(text)).toBe(false)
})

it('offers pause during live review and resume only after review settlement or interruption', () => {
  const task = { ...newTask('Test'), phase: 'reviewing' as const }
  expect(controlActions(task, false, true)).toEqual(['pause', 'off'])
  expect(controlActions(task, false, false)).toEqual(['resume', 'off'])
  expect(controlActions({ ...task, enabled: false }, false, false)).toEqual(['on'])
})
