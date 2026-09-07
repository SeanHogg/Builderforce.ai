import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { stringEnum } from "@seanhogg/builderforce-agents/plugin-sdk";
import { Type } from "@sinclair/typebox";
// Rich-menu API wrappers live in core (src/line/rich-menu.ts); the plugin runtime bridge does
// not expose them, so import them the same way llm-task/feishu reach core helpers.
import {
  cancelDefaultRichMenu,
  getDefaultRichMenuId,
  getRichMenuIdOfUser,
  getRichMenuList,
  linkRichMenuToUser,
  setDefaultRichMenu,
  unlinkRichMenuFromUser,
} from "../../../src/line/rich-menu.js";

export const LINE_RICH_MENU_ACTIONS = [
  "list",
  "status",
  "link",
  "unlink",
  "set_default",
  "cancel_default",
] as const;

export type LineRichMenuAction = (typeof LINE_RICH_MENU_ACTIONS)[number];

export interface LineRichMenuActionParams {
  action: LineRichMenuAction;
  /** LINE user id (U...). Required for status/link/unlink. */
  userId?: string;
  /** Rich menu id, menu name, or "default". Required for link/set_default. */
  menu?: string;
  accountId?: string;
}

export type LineRichMenuActionResult = Record<string, unknown>;

function menuSummary(entry: { richMenuId: string; name: string; chatBarText: string }) {
  return { richMenuId: entry.richMenuId, name: entry.name, chatBarText: entry.chatBarText };
}

/** Accepts a rich menu id, a menu name (case-insensitive), or "default". */
export async function resolveRichMenuRef(
  ref: string | undefined,
  opts: { accountId?: string },
): Promise<string> {
  const trimmed = ref?.trim();
  if (!trimmed) {
    throw new Error('rich menu reference required (id, name, or "default")');
  }
  if (trimmed.toLowerCase() === "default") {
    const id = await getDefaultRichMenuId(opts);
    if (!id) {
      throw new Error("no default rich menu is set");
    }
    return id;
  }
  const menus = await getRichMenuList(opts);
  const byId = menus.find((entry) => entry.richMenuId === trimmed);
  if (byId) {
    return byId.richMenuId;
  }
  const byName = menus.find((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) {
    return byName.richMenuId;
  }
  throw new Error(`unknown rich menu "${trimmed}"`);
}

function requireUserId(userId: string | undefined, action: string): string {
  const trimmed = userId?.trim();
  if (!trimmed) {
    throw new Error(`${action} requires a LINE user id`);
  }
  return trimmed;
}

/** ONE dispatcher shared by the agent tool and the /menu command. */
export async function runLineRichMenuAction(
  params: LineRichMenuActionParams,
): Promise<LineRichMenuActionResult> {
  const opts = { accountId: params.accountId };
  switch (params.action) {
    case "list": {
      const [menus, defaultRichMenuId] = await Promise.all([
        getRichMenuList(opts),
        getDefaultRichMenuId(opts),
      ]);
      return { defaultRichMenuId, menus: menus.map(menuSummary) };
    }
    case "status": {
      const userId = requireUserId(params.userId, "status");
      const [richMenuId, defaultRichMenuId] = await Promise.all([
        getRichMenuIdOfUser(userId, opts),
        getDefaultRichMenuId(opts),
      ]);
      return { userId, richMenuId, defaultRichMenuId };
    }
    case "link": {
      const userId = requireUserId(params.userId, "link");
      const richMenuId = await resolveRichMenuRef(params.menu, opts);
      await linkRichMenuToUser(userId, richMenuId, opts);
      return { userId, richMenuId, linked: true };
    }
    case "unlink": {
      const userId = requireUserId(params.userId, "unlink");
      await unlinkRichMenuFromUser(userId, opts);
      return { userId, linked: false };
    }
    case "set_default": {
      const richMenuId = await resolveRichMenuRef(params.menu, opts);
      await setDefaultRichMenu(richMenuId, opts);
      return { defaultRichMenuId: richMenuId };
    }
    case "cancel_default": {
      await cancelDefaultRichMenu(opts);
      return { defaultRichMenuId: null };
    }
    default:
      throw new Error(`unknown rich menu action: ${String((params as { action: unknown }).action)}`);
  }
}

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

export const LineRichMenuToolSchema = Type.Object({
  action: stringEnum(LINE_RICH_MENU_ACTIONS, {
    description:
      "list: all menus + current default. status: menu linked to a user. link/unlink: per-user menu. set_default/cancel_default: channel-wide default.",
  }),
  user_id: Type.Optional(Type.String({ description: "LINE user id (U...). status/link/unlink." })),
  menu: Type.Optional(
    Type.String({ description: 'Rich menu id, menu name, or "default". link/set_default.' }),
  ),
  account_id: Type.Optional(
    Type.String({
      description: "LINE account id for multi-account setups (default account when omitted).",
    }),
  ),
});

/** Agent-callable `line_rich_menu` tool; registered only when a LINE account is configured. */
export function registerLineRichMenuTool(api: BuilderForceAgentsPluginApi): void {
  const accountIds = api.config ? api.runtime.channel.line.listLineAccountIds(api.config) : [];
  if (accountIds.length === 0) {
    api.logger.debug?.("line_rich_menu: no LINE accounts configured, skipping tool");
    return;
  }
  api.registerTool(
    {
      name: "line_rich_menu",
      label: "LINE Rich Menu",
      description:
        "Manage LINE rich menus: list menus, check a user's menu, link/unlink a menu to a user, set or cancel the channel default.",
      parameters: LineRichMenuToolSchema,
      async execute(_toolCallId, params) {
        const p = params as {
          action: LineRichMenuAction;
          user_id?: string;
          menu?: string;
          account_id?: string;
        };
        try {
          return json(
            await runLineRichMenuAction({
              action: p.action,
              userId: p.user_id,
              menu: p.menu,
              accountId: p.account_id,
            }),
          );
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "line_rich_menu", optional: true },
  );
}
