import type { AgentToolResult } from "../../builderforce/model/agent-types.js";
import type { BuilderForceAgentsConfig } from "../../config/config.js";
import { getChannelPlugin, listChannelPlugins } from "./index.js";
import type { ChannelMessageActionContext, ChannelMessageActionName } from "./types.js";

export function listChannelMessageActions(cfg: BuilderForceAgentsConfig): ChannelMessageActionName[] {
  const actions = new Set<ChannelMessageActionName>(["send", "broadcast"]);
  for (const plugin of listChannelPlugins()) {
    const list = plugin.actions?.listActions?.({ cfg });
    if (!list) {
      continue;
    }
    for (const action of list) {
      actions.add(action);
    }
  }
  return Array.from(actions);
}

export function supportsChannelMessageButtons(cfg: BuilderForceAgentsConfig): boolean {
  for (const plugin of listChannelPlugins()) {
    if (plugin.actions?.supportsButtons?.({ cfg })) {
      return true;
    }
  }
  return false;
}

export function supportsChannelMessageButtonsForChannel(params: {
  cfg: BuilderForceAgentsConfig;
  channel?: string;
}): boolean {
  if (!params.channel) {
    return false;
  }
  const plugin = getChannelPlugin(params.channel as Parameters<typeof getChannelPlugin>[0]);
  return plugin?.actions?.supportsButtons?.({ cfg: params.cfg }) === true;
}

export function supportsChannelMessageCards(cfg: BuilderForceAgentsConfig): boolean {
  for (const plugin of listChannelPlugins()) {
    if (plugin.actions?.supportsCards?.({ cfg })) {
      return true;
    }
  }
  return false;
}

export function supportsChannelMessageCardsForChannel(params: {
  cfg: BuilderForceAgentsConfig;
  channel?: string;
}): boolean {
  if (!params.channel) {
    return false;
  }
  const plugin = getChannelPlugin(params.channel as Parameters<typeof getChannelPlugin>[0]);
  return plugin?.actions?.supportsCards?.({ cfg: params.cfg }) === true;
}

export async function dispatchChannelMessageAction(
  ctx: ChannelMessageActionContext,
): Promise<AgentToolResult<unknown> | null> {
  const plugin = getChannelPlugin(ctx.channel);
  if (!plugin?.actions?.handleAction) {
    return null;
  }
  if (plugin.actions.supportsAction && !plugin.actions.supportsAction({ action: ctx.action })) {
    return null;
  }
  return await plugin.actions.handleAction(ctx);
}
