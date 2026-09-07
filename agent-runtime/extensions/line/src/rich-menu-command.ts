import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { runLineRichMenuAction, type LineRichMenuAction } from "./rich-menu-tool.js";

const MENU_USAGE = `Usage: /menu <action> [args]

Actions:
  list                      List rich menus and the channel default
  status [userId]           Show the menu linked to you (or userId)
  link <menu> [userId]      Link a menu (id, name, or "default") to you (or userId)
  unlink [userId]           Remove the per-user menu (falls back to the default)
  default <menu>            Set the channel-wide default menu
  default off               Cancel the channel-wide default menu

Examples:
  /menu link "Support Menu"
  /menu link default U1234567890abcdef
  /menu default off`;

/** Parses `/menu <action> [quoted-or-bare menu] [userId]`. */
export function parseMenuArgs(argsStr: string): {
  action: LineRichMenuAction | null;
  menu?: string;
  userId?: string;
} {
  const tokens: string[] = [];
  const tokenRegex = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(argsStr)) !== null) {
    tokens.push(match[1] ?? match[2]);
  }
  const [verb = "", first, second] = tokens;
  switch (verb.toLowerCase()) {
    case "list":
      return { action: "list" };
    case "status":
      return { action: "status", userId: first };
    case "link":
      return { action: "link", menu: first, userId: second };
    case "unlink":
      return { action: "unlink", userId: first };
    case "default":
      if (!first) {
        return { action: null };
      }
      return first.toLowerCase() === "off"
        ? { action: "cancel_default" }
        : { action: "set_default", menu: first };
    default:
      return { action: null };
  }
}

function formatMenuResult(action: LineRichMenuAction, result: Record<string, unknown>): string {
  switch (action) {
    case "list": {
      const menus = (result.menus ?? []) as Array<{
        richMenuId: string;
        name: string;
        chatBarText: string;
      }>;
      if (menus.length === 0) {
        return "No rich menus exist for this channel.";
      }
      const lines = menus.map(
        (menu) =>
          `${menu.richMenuId === result.defaultRichMenuId ? "* " : "  "}${menu.name} (${menu.richMenuId}) - "${menu.chatBarText}"`,
      );
      return `Rich menus (* = default):\n${lines.join("\n")}`;
    }
    case "status":
      return result.richMenuId
        ? `Linked menu: ${String(result.richMenuId)}`
        : `No per-user menu linked; channel default: ${String(result.defaultRichMenuId ?? "none")}`;
    case "link":
      return `Linked rich menu ${String(result.richMenuId)} to ${String(result.userId)}.`;
    case "unlink":
      return `Unlinked rich menu from ${String(result.userId)}.`;
    case "set_default":
      return `Default rich menu set to ${String(result.defaultRichMenuId)}.`;
    case "cancel_default":
      return "Default rich menu cancelled.";
  }
}

export function registerLineRichMenuCommand(api: BuilderForceAgentsPluginApi): void {
  api.registerCommand({
    name: "menu",
    description: "Manage LINE rich menus (list, link, unlink, default).",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      if (ctx.channel !== "line") {
        return { text: "Rich menus are only available on LINE." };
      }
      const parsed = parseMenuArgs(ctx.args?.trim() ?? "");
      if (!parsed.action) {
        return { text: MENU_USAGE };
      }
      try {
        const result = await runLineRichMenuAction({
          action: parsed.action,
          menu: parsed.menu,
          userId: parsed.userId ?? ctx.senderId,
          accountId: ctx.accountId,
        });
        return { text: formatMenuResult(parsed.action, result) };
      } catch (err) {
        return { text: `Rich menu error: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}
