/**
 * Label for a conversation in a picker (VSIX `<select>`, Sessions tree).
 *
 * Live-run glyphs (`❓` awaiting confirm, `●` running) already tell the user
 * the chat is busy. Linked-ticket progress is the other come-back signal:
 * a chat at 67% still has open work, even when nothing is running right now.
 */
export function chatSwitcherLabel(input: {
  title: string;
  id: number;
  ticketCount?: number | null;
  ticketProgressPct?: number | null;
  runGlyph?: string;
}): string {
  const title = input.title.trim() || `Chat ${input.id}`;
  const glyph = input.runGlyph ?? '';
  const count = input.ticketCount ?? 0;
  if (count <= 0 || input.ticketProgressPct == null || !Number.isFinite(input.ticketProgressPct)) {
    return `${glyph}${title}`;
  }
  const pct = Math.max(0, Math.min(100, Math.round(input.ticketProgressPct)));
  return `${glyph}${pct}% · ${title}`;
}
