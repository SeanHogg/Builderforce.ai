import { displayChatProgressPct } from '@builderforce/agent-loop';

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
  // The ONE display rule the Sessions tree and the ticket rail share.
  const pct = displayChatProgressPct(input.ticketProgressPct);
  if (count <= 0 || pct == null) return `${glyph}${title}`;
  return `${glyph}${pct}% · ${title}`;
}
