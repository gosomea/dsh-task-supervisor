/** Run the bounded source experiment using an already-installed DSH checkout. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../..', import.meta.url))
const source = resolve(process.env.DSH_SOURCE ?? resolve(project, '../../deepseek-harness'))
const requireFromDsh = createRequire(resolve(source, 'package.json'))
const vitest = resolve(requireFromDsh.resolve('vitest/package.json'), '../vitest.mjs')
const result = spawnSync(process.execPath, [vitest, 'run', '--config', resolve(project, 'spikes/kernel/vitest.config.mjs'), ...process.argv.slice(2)], {
  cwd: project,
  env: { ...process.env, DSH_SOURCE: source },
  stdio: 'inherit',
  timeout: 60000,
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
