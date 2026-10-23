/**
 * What makes two calls "the same call", and two file bodies "the same content" — the
 * ONE reading every guard here (and the post-hoc run report) uses, so a live advisory
 * and the report written about the same run can never disagree on what "identical" means.
 */
import { stableStringify } from "@builderforce/agent-tools";

/** Same tool, same arguments in any key order. Never throws (a cyclic argument object
 *  falls back to its string form). */
export function callFingerprint(tool: string, args: unknown): string {
  let text: string;
  try {
    text = stableStringify(args ?? {});
  } catch {
    text = String(args ?? "");
  }
  return `${tool}:${text}`;
}

/**
 * A short, stable digest of a text body (FNV-1a 32-bit plus the length). Enough to say
 * "this write restores bytes the file held before" without keeping the bytes — a run's
 * guard state rides durable storage between steps, so it must stay small.
 */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}.${h.toString(36)}`;
}

/** The `path` a call names, trimmed, or null. */
export function pathArgOf(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const path = (args as { path?: unknown }).path;
  return typeof path === "string" && path.trim() ? path.trim() : null;
}
