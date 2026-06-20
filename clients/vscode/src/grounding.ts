/** Single source of truth for the current workspace grounding summary, shared by the
 *  webview chat and the native chat participant (so neither holds its own copy). */
let groundingSummary: string | undefined;

export function setGroundingSummary(summary: string | undefined): void {
  groundingSummary = summary;
}

export function getGroundingSummary(): string | undefined {
  return groundingSummary;
}
