/** Real native preset declarations for stock-Host integration fixtures. */
import type { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'

export async function installNativePresets(ctx: Context): Promise<void> {
  await ctx.plugin(Loader)
  await ctx.plugin(AgentPresets, { default: 'standard' })
  ctx.loader.builtins['agent-preset'] = AgentPreset
  await ctx.loader.create({ name: 'cordis:agent-preset', config: { id: 'standard', plugins: [] } })
}
