import fs from "node:fs/promises";
import type { ToolContentBlock } from "@builderforce/agent-tools";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { detectMime } from "../../media/mime.js";
import type { ImageSanitizationLimits } from "../image-sanitization.js";
import { sanitizeToolResultImages } from "../tool-images.js";

// oxlint-disable-next-line typescript/no-explicit-any
export type AnyAgentTool = AgentTool<any, unknown>;
export type { AgentToolResult };

export type StringParamOptions = {
  required?: boolean;
  trim?: boolean;
  label?: string;
  allowEmpty?: boolean;
};

export type ActionGate<T extends Record<string, boolean | undefined>> = (
  key: keyof T,
  defaultValue?: boolean,
) => boolean;

export class ToolInputError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export function createActionGate<T extends Record<string, boolean | undefined>>(
  actions: T | undefined,
): ActionGate<T> {
  return (key, defaultValue = true) => {
    const value = actions?.[key];
    if (value === undefined) {
      return defaultValue;
    }
    return value !== false;
  };
}

export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true },
): string;
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions,
): string | undefined;
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {},
) {
  const { required = false, trim = true, label = key, allowEmpty = false } = options;
  const raw = params[key];
  if (typeof raw !== "string") {
    if (required) {
      throw new ToolInputError(`${label} required`);
    }
    return undefined;
  }
  const value = trim ? raw.trim() : raw;
  if (!value && !allowEmpty) {
    if (required) {
      throw new ToolInputError(`${label} required`);
    }
    return undefined;
  }
  return value;
}

export function readStringOrNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; label?: string } = {},
): string | undefined {
  const { required = false, label = key } = options;
  const raw = params[key];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (value) {
      return value;
    }
  }
  if (required) {
    throw new ToolInputError(`${label} required`);
  }
  return undefined;
}

export function readNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; label?: string; integer?: boolean } = {},
): number | undefined {
  const { required = false, label = key, integer = false } = options;
  const raw = params[key];
  let value: number | undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    value = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      const parsed = Number.parseFloat(trimmed);
      if (Number.isFinite(parsed)) {
        value = parsed;
      }
    }
  }
  if (value === undefined) {
    if (required) {
      throw new ToolInputError(`${label} required`);
    }
    return undefined;
  }
  return integer ? Math.trunc(value) : value;
}

export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true },
): string[];
export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions,
): string[] | undefined;
export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {},
) {
  const { required = false, label = key } = options;
  const raw = params[key];
  if (Array.isArray(raw)) {
    const values = raw
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (values.length === 0) {
      if (required) {
        throw new ToolInputError(`${label} required`);
      }
      return undefined;
    }
    return values;
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) {
      if (required) {
        throw new ToolInputError(`${label} required`);
      }
      return undefined;
    }
    return [value];
  }
  if (required) {
    throw new ToolInputError(`${label} required`);
  }
  return undefined;
}

export type ReactionParams = {
  emoji: string;
  remove: boolean;
  isEmpty: boolean;
};

export function readReactionParams(
  params: Record<string, unknown>,
  options: {
    emojiKey?: string;
    removeKey?: string;
    removeErrorMessage: string;
  },
): ReactionParams {
  const emojiKey = options.emojiKey ?? "emoji";
  const removeKey = options.removeKey ?? "remove";
  const remove = typeof params[removeKey] === "boolean" ? params[removeKey] : false;
  const emoji = readStringParam(params, emojiKey, {
    required: true,
    allowEmpty: true,
  });
  if (remove && !emoji) {
    throw new ToolInputError(options.removeErrorMessage);
  }
  return { emoji, remove, isEmpty: !emoji };
}

export function jsonResult(payload: unknown): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

/**
 * Extract the JSON payload from a {@link jsonResult}-shaped tool result for the shared
 * native `ToolDefinition` path (whose `ToolResult.data` is the JSON object the model
 * reads). Lets a legacy tool's `run*` keep returning an `AgentToolResult` so the pi
 * wrapper and the native def share ONE body (DRY) — `jsonResult` stores the payload
 * verbatim on `.details`, so there is no re-serialize/parse round-trip.
 */
export function detailsData(result: AgentToolResult<unknown>): Record<string, unknown> {
  const details = (result as { details?: unknown }).details;
  if (details && typeof details === "object") {
    return details as Record<string, unknown>;
  }
  // Fall back to the text block when a tool didn't use jsonResult.
  const text = result.content?.find((b) => b.type === "text");
  return { text: text && "text" in text ? (text as { text: string }).text : "" };
}

/**
 * Throw-safe bridge for the native `ToolDefinition` path: runs a legacy tool body
 * and returns its JSON payload, converting a thrown error into an `{ error }` object
 * (the shared engine surfaces tool errors as data, never as a thrown run failure).
 */
export async function nativeToolData(
  run: () => Promise<AgentToolResult<unknown>>,
): Promise<Record<string, unknown>> {
  try {
    return detailsData(await run());
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Map a legacy `AgentToolResult.content` array to the shared {@link ToolContentBlock}s
 *  the native engine surfaces — text passes through; image blocks become `media`. */
function mapContentBlocks(content: AgentToolResult<unknown>["content"] | undefined): ToolContentBlock[] {
  if (!Array.isArray(content)) return [];
  const out: ToolContentBlock[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as unknown as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      out.push({ type: "text", text: b.text });
    } else if (b.type === "image" && typeof b.data === "string") {
      out.push({
        type: "media",
        mediaType: "image",
        base64: b.data,
        mimeType: typeof b.mimeType === "string" ? b.mimeType : undefined,
      });
    }
  }
  return out;
}

/**
 * Throw-safe bridge for native MEDIA tools: returns both the model-readable `data`
 * (from `.details`) AND the rich `content` blocks (images/MEDIA tokens) mapped to the
 * shared {@link ToolContentBlock} shape, so a media tool runs under the one contract.
 */
export async function nativeToolResult(
  run: () => Promise<AgentToolResult<unknown>>,
): Promise<{ data: Record<string, unknown>; content?: ToolContentBlock[] }> {
  let result: AgentToolResult<unknown>;
  try {
    result = await run();
  } catch (err) {
    return { data: { error: err instanceof Error ? err.message : String(err) } };
  }
  const content = mapContentBlocks(result.content);
  return content.length ? { data: detailsData(result), content } : { data: detailsData(result) };
}

export async function imageResult(params: {
  label: string;
  path: string;
  base64: string;
  mimeType: string;
  extraText?: string;
  details?: Record<string, unknown>;
  imageSanitization?: ImageSanitizationLimits;
}): Promise<AgentToolResult<unknown>> {
  const content: AgentToolResult<unknown>["content"] = [
    {
      type: "text",
      text: params.extraText ?? `MEDIA:${params.path}`,
    },
    {
      type: "image",
      data: params.base64,
      mimeType: params.mimeType,
    },
  ];
  const result: AgentToolResult<unknown> = {
    content,
    details: { path: params.path, ...params.details },
  };
  return await sanitizeToolResultImages(result, params.label, params.imageSanitization);
}

export async function imageResultFromFile(params: {
  label: string;
  path: string;
  extraText?: string;
  details?: Record<string, unknown>;
  imageSanitization?: ImageSanitizationLimits;
}): Promise<AgentToolResult<unknown>> {
  const buf = await fs.readFile(params.path);
  const mimeType = (await detectMime({ buffer: buf.slice(0, 256) })) ?? "image/png";
  return await imageResult({
    label: params.label,
    path: params.path,
    base64: buf.toString("base64"),
    mimeType,
    extraText: params.extraText,
    details: params.details,
    imageSanitization: params.imageSanitization,
  });
}
