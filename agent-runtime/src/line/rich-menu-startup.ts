import { logVerbose } from "../globals.js";
import { datetimePickerAction, messageAction, postbackAction, uriAction } from "./actions.js";
import {
  createDefaultMenuConfig,
  createRichMenu,
  getDefaultRichMenuId,
  getRichMenuList,
  setDefaultRichMenu,
  uploadRichMenuImage,
  type CreateRichMenuParams,
  type RichMenuAreaRequest,
} from "./rich-menu.js";
import type { LineRichMenuActionConfig, LineRichMenuConfig } from "./types.js";

export interface EnsureDefaultRichMenuResult {
  richMenuId: string;
  /** True when this call created the menu; false when an existing menu (same name) was reused. */
  created: boolean;
  /** True when this call changed the channel default (already-default menus are left alone). */
  setDefault: boolean;
}

function toAction(action: LineRichMenuActionConfig) {
  switch (action.type) {
    case "message":
      return messageAction(action.label, action.text);
    case "uri":
      return uriAction(action.label, action.uri);
    case "postback":
      return postbackAction(action.label, action.data, action.displayText);
    case "datetimepicker":
      return datetimePickerAction(action.label, action.data, action.mode, {
        initial: action.initial,
        min: action.min,
        max: action.max,
      });
  }
}

/**
 * Turn the `channels.line.richMenu` config section into a create request.
 * Missing fields fall back to the built-in default menu (2x3 command grid).
 */
export function buildRichMenuParamsFromConfig(config: LineRichMenuConfig): CreateRichMenuParams {
  const defaults = createDefaultMenuConfig();
  const height = config.height ?? defaults.size.height;
  const areas: RichMenuAreaRequest[] = config.areas?.length
    ? config.areas.map((area) => ({ bounds: { ...area.bounds }, action: toAction(area.action) }))
    : height === defaults.size.height
      ? defaults.areas
      : defaults.areas.map((area) => ({
          ...area,
          bounds: {
            ...area.bounds,
            y: area.bounds.y * 2,
            height: area.bounds.height * 2,
          },
        }));
  return {
    size: { width: 2500, height },
    selected: config.selected ?? defaults.selected,
    name: config.name?.trim() || defaults.name,
    chatBarText: config.chatBarText?.trim() || defaults.chatBarText,
    areas,
  };
}

/**
 * Create (once) and set the channel default rich menu from config.
 * Idempotent across restarts: an existing menu with the same name is reused, and
 * `setDefault` is skipped when that menu already is the default.
 * Returns null when no menu is configured or `richMenu.enabled` is false.
 */
export async function ensureDefaultRichMenu(params: {
  richMenu: LineRichMenuConfig | undefined;
  accountId?: string;
  channelAccessToken?: string;
  verbose?: boolean;
}): Promise<EnsureDefaultRichMenuResult | null> {
  const { richMenu } = params;
  if (!richMenu || richMenu.enabled === false) {
    return null;
  }
  const opts = {
    accountId: params.accountId,
    channelAccessToken: params.channelAccessToken,
    verbose: params.verbose,
  };
  const menu = buildRichMenuParamsFromConfig(richMenu);

  const existing = (await getRichMenuList(opts)).find((entry) => entry.name === menu.name);
  let richMenuId = existing?.richMenuId;
  let created = false;
  if (!richMenuId) {
    richMenuId = await createRichMenu(menu, opts);
    created = true;
    if (richMenu.imagePath) {
      await uploadRichMenuImage(richMenuId, richMenu.imagePath, opts);
    } else if (params.verbose) {
      logVerbose(
        `line: rich menu "${menu.name}" has no imagePath; LINE hides a menu until its image is uploaded`,
      );
    }
  }

  const currentDefault = await getDefaultRichMenuId(opts);
  const setDefault = currentDefault !== richMenuId;
  if (setDefault) {
    await setDefaultRichMenu(richMenuId, opts);
  }
  if (params.verbose) {
    logVerbose(
      `line: rich menu "${menu.name}" (${richMenuId}) ${created ? "created" : "reused"}${
        setDefault ? ", set as default" : ", already default"
      }`,
    );
  }
  return { richMenuId, created, setDefault };
}
