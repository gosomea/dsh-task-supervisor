/** Source-only experiment; never rebuilds or launches the user's DSH checkout. */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const project = fileURLToPath(new URL('../..', import.meta.url))
const source = resolve(process.env.DSH_SOURCE ?? resolve(project, '../../deepseek-harness'))
const requireFromDsh = createRequire(resolve(source, 'package.json'))
const ts = requireFromDsh('typescript')
const loaded = ts.readConfigFile(resolve(source, 'tsconfig.base.json'), ts.sys.readFile)
if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'))
const { standardDecoratorPlugin, vitestExecArgv } = await import(pathToFileURL(resolve(source, 'vitest.shared.ts')).href)
const aliases = Object.entries(loaded.config.compilerOptions.paths).map(([name, paths]) => ({
  find: new RegExp(`^${name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)')}$`),
  replacement: resolve(source, paths[0]).replace('*', '$1'),
}))
const requireFromChat = createRequire(resolve(source, 'packages/client/ui-chat/package.json'))
aliases.push({ find: /^react-dom\/server$/, replacement: requireFromChat.resolve('react-dom/server') })
aliases.push({ find: /^vitest$/, replacement: resolve(requireFromDsh.resolve('vitest/package.json'), '../dist/index.js') })

export default {
  root: project,
  cacheDir: resolve(project, '.cache/vite'),
  plugins: [standardDecoratorPlugin()],
  resolve: { alias: aliases },
  test: {
    include: ['spikes/kernel/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 10000,
    hookTimeout: 10000,
    fileParallelism: false,
    maxWorkers: 1,
    execArgv: vitestExecArgv,
  },
}
