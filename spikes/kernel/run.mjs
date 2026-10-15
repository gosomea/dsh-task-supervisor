/** Run the bounded source experiment using an already-installed DSH checkout. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../..', import.meta.url))
const source = resolve(process.env.DSH_SOURCE ?? resolve(project, '../../deepseek-harness'))
const requireFromDsh = createRequire(resolve(source, 'package.json'))
const vitest = resolve(requireFromDsh.resolve('vitest/package.json'), '../vitest.mjs')
const team = process.argv.includes('--team-compat')
const result = spawnSync(process.execPath, [vitest, 'run', '--config', resolve(project, team ? 'spikes/team-compat/vitest.config.mjs' : 'spikes/kernel/vitest.config.mjs'), ...process.argv.slice(2).filter(arg => arg !== '--team-compat')], {
  cwd: project,
  env: { ...process.env, DSH_SOURCE: source },
  stdio: 'inherit',
  timeout: 60000,
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
