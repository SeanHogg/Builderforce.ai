import type { ModelFallbackEvent } from "@seanhogg/builderforce-brain-embedded";

/** Why a pick fell back, for the notice's second clause: the failure's message, clamped to one short line. */
export function fallbackDetail(event: ModelFallbackEvent): string {
  const line = event.reason.replace(/\s+/g, " ").trim();
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}
