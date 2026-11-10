/**
 * The ignored `.builderforce/delta.json` entries of a stored delta, as the card contract's {@link RunDeltaOverrides}
 * (PRD 41 §C11.2 "Overrides ignored"). Read from the record's REDACTED codes (`redactDropped`, `runDeltaRecords.ts`) — the
 * same strings whether the card is posted live or answered by `run-delta/get` — so nothing the repo named, and no pattern,
 * reaches the card: only the code, the file section, and a fixed reason code.
 *
 * Redacted forms: `unknown-key:<key>`, `invalid:<section>`, `invalid:<section>#<hash>` (an entry), `invalid:root`,
 * `invalid:json`, `unsafe-regex:<section>.<reason>` (`<section>#<hash>` on records written before the reason was kept),
 * `unreadable:<cause>`, `truncated:<count>`.
 */

import type { DroppedOverride, RunDeltaOverrides } from "@builderforce/run-delta";

const FIXED_CODE = /^[a-z][a-z-]{0,31}$/;

function parse(redacted: string): DroppedOverride | undefined {
  const colon = redacted.indexOf(":");
  const head = colon < 0 ? redacted : redacted.slice(0, colon);
  const rest = colon < 0 ? "" : redacted.slice(colon + 1);
  const section = rest.split(/[#.]/, 1)[0]!.slice(0, 32);
  switch (head) {
    case "unknown-key":
      return { code: "unknown-key", section };
    case "invalid":
      if (rest === "json") return { code: "invalid-json", section: "" };
      if (rest === "root") return { code: "invalid-root", section: "" };
      return { code: "invalid", section };
    case "unsafe-regex": {
      const dot = rest.indexOf(".");
      const reason = dot < 0 ? "" : rest.slice(dot + 1);
      return { code: "unsafe-regex", section, ...(FIXED_CODE.test(reason) ? { reason } : {}) };
    }
    case "unreadable":
      return { code: "unreadable", section: "", ...(FIXED_CODE.test(rest) ? { reason: rest } : {}) };
    case "truncated": {
      const count = Number.parseInt(rest, 10);
      return { code: "truncated", section: "", ...(Number.isFinite(count) && count > 0 ? { count } : {}) };
    }
    default:
      return undefined; // a code this build does not know: never shown raw
  }
}

/** The redacted codes → the card's overrides; undefined when there are none. */
export function droppedOverrides(redacted: readonly string[] | undefined): RunDeltaOverrides | undefined {
  const dropped = (redacted ?? []).flatMap((code) => parse(code) ?? []);
  return dropped.length > 0 ? { dropped } : undefined;
}
