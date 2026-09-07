import type {
  WebhookEvent,
  TextMessage,
  ImageMessage,
  VideoMessage,
  AudioMessage,
  StickerMessage,
  LocationMessage,
} from "@line/bot-sdk";
import type { BaseProbeResult } from "../channels/plugins/types.js";

export type LineTokenSource = "config" | "env" | "file" | "none";

interface LineAccountBaseConfig {
  enabled?: boolean;
  channelAccessToken?: string;
  channelSecret?: string;
  tokenFile?: string;
  secretFile?: string;
  name?: string;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  groupPolicy?: "open" | "allowlist" | "disabled";
  /** Outbound response prefix override for this account. */
  responsePrefix?: string;
  mediaMaxMb?: number;
  webhookPath?: string;
  /** Rich menu created + set as the channel default on startup. */
  richMenu?: LineRichMenuConfig;
  groups?: Record<string, LineGroupConfig>;
}

export type LineRichMenuActionConfig =
  | { type: "message"; label: string; text?: string }
  | { type: "uri"; label: string; uri: string }
  | { type: "postback"; label: string; data: string; displayText?: string }
  | {
      type: "datetimepicker";
      label: string;
      data: string;
      mode: "date" | "time" | "datetime";
      initial?: string;
      min?: string;
      max?: string;
    };

export interface LineRichMenuAreaConfig {
  bounds: { x: number; y: number; width: number; height: number };
  action: LineRichMenuActionConfig;
}

export interface LineRichMenuConfig {
  /** Set false to keep a configured menu without applying it on startup. */
  enabled?: boolean;
  /** Menu name; also the idempotency key used to find an existing menu. */
  name?: string;
  /** Chat bar label (max 14 chars). */
  chatBarText?: string;
  /** Menu height; width is always 2500. */
  height?: 1686 | 843;
  /** Whether the menu opens expanded by default. */
  selected?: boolean;
  /** Local JPEG/PNG (2500 x height, <= 1MB) uploaded when the menu is created. */
  imagePath?: string;
  /** Tap areas; omit to use the 2x3 default grid (help/status/settings/...). */
  areas?: LineRichMenuAreaConfig[];
}

export interface LineConfig extends LineAccountBaseConfig {
  /** Per-account overrides keyed by account id. */
  accounts?: Record<string, LineAccountConfig>;
}

export interface LineAccountConfig extends LineAccountBaseConfig {}

export interface LineGroupConfig {
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  requireMention?: boolean;
  systemPrompt?: string;
  skills?: string[];
}

export interface ResolvedLineAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  channelAccessToken: string;
  channelSecret: string;
  tokenSource: LineTokenSource;
  config: LineConfig & LineAccountConfig;
}

export type LineMessageType =
  | TextMessage
  | ImageMessage
  | VideoMessage
  | AudioMessage
  | StickerMessage
  | LocationMessage;

export interface LineWebhookContext {
  event: WebhookEvent;
  replyToken?: string;
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineSendResult {
  messageId: string;
  chatId: string;
}

export type LineProbeResult = BaseProbeResult<string> & {
  bot?: {
    displayName?: string;
    userId?: string;
    basicId?: string;
    pictureUrl?: string;
  };
};

export type LineFlexMessagePayload = {
  altText: string;
  contents: unknown;
};

export type LineTemplateMessagePayload =
  | {
      type: "confirm";
      text: string;
      confirmLabel: string;
      confirmData: string;
      cancelLabel: string;
      cancelData: string;
      altText?: string;
    }
  | {
      type: "buttons";
      title: string;
      text: string;
      actions: Array<{
        type: "message" | "uri" | "postback";
        label: string;
        data?: string;
        uri?: string;
      }>;
      thumbnailImageUrl?: string;
      altText?: string;
    }
  | {
      type: "carousel";
      columns: Array<{
        title?: string;
        text: string;
        thumbnailImageUrl?: string;
        actions: Array<{
          type: "message" | "uri" | "postback";
          label: string;
          data?: string;
          uri?: string;
        }>;
      }>;
      altText?: string;
    };

export type LineChannelData = {
  quickReplies?: string[];
  location?: {
    title: string;
    address: string;
    latitude: number;
    longitude: number;
  };
  flexMessage?: LineFlexMessagePayload;
  templateMessage?: LineTemplateMessagePayload;
};
