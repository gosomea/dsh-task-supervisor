/** Keyless acceptance command; excluded from formal model profiles. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

export const name = 'deepswe-profile-probe'
export const inject = ['commands', 'tools']
export interface Config { output: string }

/** Capture the actual calling Agent's tool surface without sending a model request. */
export function apply(ctx: Context, config: Config): void {
  ctx.commands.register({
    name: 'eval-capabilities', description: 'Capture keyless evaluation acceptance evidence',
    async handler({ agent }) {
      const schemas = ctx.tools.schemas(agent)
      const result = { sessionId: agent.session.id, cwd: agent.session.header.cwd,
        modelRequests: 0, tools: schemas.map(schema => ({ name: schema.name,
          sha256: createHash('sha256').update(JSON.stringify(schema)).digest('hex') })).sort((a, b) => a.name.localeCompare(b.name)) }
      await writeFile(config.output, JSON.stringify(result), { flag: 'wx', mode: 0o600 })
      return { kind: 'success', text: 'Keyless capability evidence recorded' }
    },
  })
}
