/** Keyless actual DSH capability probe; never included in model profiles. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'sandbox-run-native-probe'
export const inject = ['commands', 'shell', 'sandboxPolicy', 'tools']
export interface Config { output: string; outsidePath: string }

/** Read, write and boundary denial all use the calling Session's policy. */
export function apply(ctx: Context, config: Config): void {
  ctx.commands.register({ name: 'eval-native', description: 'Run keyless native permission checks',
    async handler({ agent }) {
      const cwd = agent.session.header.cwd
      const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('native probe deadline')), 60000)
      const results: Record<string, unknown> = { modelRequests: 0, sessionId: agent.session.id, cwd, policy }
      try {
        const execute = async (command: string) => {
          const execution = await ctx.shell.execute(ctx.shell.resolve({ command, workdir: cwd,
            sandboxPolicy: policy, signal: controller.signal, timeoutMs: 20000 }))
          return execution.result()
        }
        results.read = await execute('cat README.md')
        results.nativeRead = await ctx.tools.execute({ name: 'read', callId: ToolCallId('eval-native-read'),
          arguments: { file_path: 'README.md' }, agent, signal: controller.signal })
        results.write = await execute("printf 'native workspace write\\n' > .native-probe")
        results.written = await readFile(join(cwd!, '.native-probe'), 'utf8')
        // Fixed administrator path, shell-quoted; outside /workspace and /tmp.
        results.denied = await execute(`printf 'unauthorized\\n' > '${config.outsidePath.replaceAll("'", "'\\''")}'`)
        results.outsideUnchanged = await readFile(config.outsidePath, 'utf8') === 'administrator sentinel\n'
      } catch (error) { results.error = String(error).slice(0, 2048) }
      finally { clearTimeout(timer) }
      await writeFile(config.output, JSON.stringify(results), { flag: 'wx', mode: 0o600 })
      return { kind: 'success', text: 'Keyless native capability probe recorded' }
    },
  })
}
