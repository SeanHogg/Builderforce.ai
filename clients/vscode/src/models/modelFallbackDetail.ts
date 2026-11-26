import * as os from "node:os";
import type { ModelFallbackEvent } from "@seanhogg/builderforce-brain-embedded";
import { DEFAULT_SECRET_PATTERNS, redactText } from "@builderforce/secret-redaction";

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A secret-bearing key name (`api_key`, `accessToken`, `refresh-token`, `secret`, …). Used ONLY by the display backstop below. */
const SECRET_KEY = "(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password)";

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
  // The shared redactor (`@builderforce/secret-redaction`) owns every credential shape: provider tokens, JWTs,
  // `Authorization` / Bearer values, `key=value` and JSON secret fields.
  return redactText(out.replace(/(\bhttps?:\/\/[^\s?#"'<>)]*)\?[^\s"'<>)]*/gi, "$1"), DEFAULT_SECRET_PATTERNS, "strict", () => "[redacted]")
    // DISPLAY-ONLY BACKSTOP, not a second detector: it decides nothing and reports nothing, it only over-masks this one
    // notice. The shared set deliberately ignores a value too short to be a real secret (elsewhere that is prose or
    // source); in an error line persisted to a chat, a secret-NAMED pair or an `sk-` / `bfk_` word is hidden whatever
    // its length. A new credential SHAPE belongs in `@builderforce/secret-redaction`, never here.
    .replace(new RegExp(`(["']?\\b${SECRET_KEY}["']?\\s*[=:]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&"'}]+)`, "gi"), "$1[redacted]")
    .replace(/\b(?:sk|bfk)[-_]\S+/gi, "[redacted]");
}

/** Why a pick fell back, for the notice's second clause: the failure's message, redacted and clamped to one short line. */
export function fallbackDetail(event: ModelFallbackEvent): string {
  const line = redactFallbackText(event.reason).replace(/\s+/g, " ").trim();
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}
