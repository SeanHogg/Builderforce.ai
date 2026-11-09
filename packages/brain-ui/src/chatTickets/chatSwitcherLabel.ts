import { displayChatProgressPct } from '@builderforce/agent-loop';

/**
 * Label for a conversation in a plain-text picker (the merge picker, any native
 * `<select>`). The history ROW does not use it — it shows a clean title and renders
 * the linked-ticket column itself (`ChatTicketStats`).
 *
 * Live-run glyphs (`❓` awaiting confirm, `●` running) already tell the user
 * the chat is busy. Linked-ticket progress is the other come-back signal:
 * a chat at 67% still has open work, even when nothing is running right now.
 * Open/done counts are added only when the server sent them (absent = unknown).
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
  return `${glyph}${count} tickets · ${pct}% · ${title}`;
}
