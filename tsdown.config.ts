import { defineConfig } from 'tsdown'

export default defineConfig([{
  entry: ['src/index.ts', 'src/check-gateway.ts', 'src/process-provenance.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: true,
  sourcemap: false,
  deps: { neverBundle: ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-tools'] },
}, {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: false,
  deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-task-supervisor", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}])
