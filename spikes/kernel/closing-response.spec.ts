import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { installClosingResponse } from '../../src/closing-response.ts'

function fixture() {
  let revision = 1
  const hooks = new Map<string, (...args: any[]) => any>()
  let guard: (...args: any[]) => any
  const ctx = { on: (name: string, hook: (...args: any[]) => any) => hooks.set(name, hook),
    tools: { guard: (hook: (...args: any[]) => any) => { guard = hook } },
    sessionProjections: { stateOf: () => ({ current: { revision }, failure: null }) } } as unknown as Context
  const agent = { status: 'running', session: {} } as Agent
  return { agent, close: installClosingResponse(ctx), hooks,
    change: () => { revision++ }, guard: () => guard({ agent }) }
}

it('a prior unused checkpoint cannot reject planning or hide tools after an edit', async () => {
  const f = fixture(); f.close(f.agent, 1)
  expect(f.guard()).toContain('checkpoint')
  f.change()
  const result = { kind: 'continue', messages: [] }
  expect(await f.hooks.get('agent/pre-step')!({ agent: f.agent }, () => result)).toBe(result)
  expect(f.guard()).toBeUndefined()
  const prompt = { tools: ['task_submit_plan'] }
  expect(await f.hooks.get('system-prompt/assemble')!({}, { scope: f.agent }, () => prompt)).toBe(prompt)
})

it('a current checkpoint still permits only one tool-free answer', async () => {
  const f = fixture(); f.close(f.agent, 1)
  const next = () => ({ kind: 'continue' })
  expect(await f.hooks.get('agent/pre-step')!({ agent: f.agent }, next)).toEqual({ kind: 'continue' })
  expect(await f.hooks.get('agent/pre-step')!({ agent: f.agent }, next)).toEqual({ kind: 'reject' })
  expect(await f.hooks.get('system-prompt/assemble')!({}, { scope: f.agent }, () => ({ tools: ['bash'] }))).toEqual({ tools: [] })
  f.hooks.get('agent/status')!({ agent: f.agent, status: 'idle' })
  expect(f.guard()).toBeUndefined()
})

it('an idle edited checkpoint retires before the next planning step', () => {
  const f = fixture(); f.close(f.agent, 1); f.change()
  f.hooks.get('agent/status')!({ agent: f.agent, status: 'idle' })
  expect(f.close.isPending(f.agent, 2)).toBe(false)
  expect(f.guard()).toBeUndefined()
})
