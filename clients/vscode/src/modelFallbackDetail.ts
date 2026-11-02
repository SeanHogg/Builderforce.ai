import * as os from "node:os";
import type { ModelFallbackEvent } from "@seanhogg/builderforce-brain-embedded";

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A secret-bearing key name (`api_key`, `accessToken`, `refresh-token`, `secret`, …). */
const SECRET_KEY = "(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|authorization)";

/**
 * The failure's message made safe to PERSIST in a chat (it is shown in the notice and kept
 * with the transcript): the home directory becomes `~` (either slash form, any case - a
 * Windows path is case-insensitive), URL query strings go, and so does anything
 * token-shaped: a Bearer value, a `key=value` pair, a JSON `"key":"value"` pair (quotes
 * optional), or a bare `sk-` / `bfk_` key.
 */
export function redactFallbackText(text: string, home: string = os.homedir()): string {
  let out = text;
  if (home.length > 1) {
    const forms = new Set([home, home.replace(/\\/g, "/"), home.replace(/\//g, "\\")]);
    for (const form of forms) out = out.replace(new RegExp(escape(form), "gi"), "~");
  }
  return out
    .replace(/(\bhttps?:\/\/[^\s?#"'<>)]*)\?[^\s"'<>)]*/gi, "$1")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(new RegExp(`(["']?\\b${SECRET_KEY}["']?\\s*[=:]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&"'}]+)`, "gi"), "$1[redacted]")
    .replace(/\b(?:sk|bfk)[-_]\S+/gi, "[redacted]");
}

/** Why a pick fell back, for the notice's second clause: the failure's message, redacted and clamped to one short line. */
export function fallbackDetail(event: ModelFallbackEvent): string {
  const line = redactFallbackText(event.reason).replace(/\s+/g, " ").trim();
  return line.length > 160 ? `${line.slice(0, 159)}...` : line;
}
