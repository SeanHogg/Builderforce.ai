import type { CanvasTranscriptMessage } from '@/lib/canvasTranscript';
import { boardAgentOccupantId, sameAgentName, type BoardAgent } from './boardAgents';

/**
 * WHAT EACH AGENT AT THE TABLE IS SAYING — read off the conversation, for the room.
 *
 * ── WHY THE ROOM READS THE TRANSCRIPT ────────────────────────────────────────────
 * When several agents answer one turn, each reply lands in the Brain transcript under
 * its author's name. In the room those same agents are standing at a table, so the
 * reply belongs over the head of the one who said it — otherwise six people "meet" and
 * the only sign any of them spoke is a scroll of text in a side panel. There is no
 * second record of who said what: this is a reading of the transcript, keyed to the
 * seat the room already gives each agent (`boardAgentOccupantId`).
 *
 * ── WHICH REPLIES ────────────────────────────────────────────────────────────────
 * Only the latest turn's — everything after the last message a person sent. A new
 * question clears the table, so a bubble is always an answer to what was just asked,
 * and an agent still working on its answer shows as pending rather than repeating
 * what it said last time.
 */

export interface RoomSpeech {
  /** What the agent said this turn, as plain text clipped for a bubble. Null while it works. */
  text: string | null;
  /** Working on its reply right now. */
  pending: boolean;
  /**
   * WHICH message in the transcript this bubble is an excerpt OF — the id the Brain
   * surface gives that same turn, so clicking the bubble can take the reader to the
   * full reply instead of leaving them to hunt for it in the scroll.
   *
   * It is the message's 1-based position in the timeline, because that is exactly how
   * the host mints `BrainMessage.id` for the transcript (`brainMessages` in
   * `CreationCanvas`). Deriving it the same way from the same array is what keeps the
   * two surfaces pointing at one message; a bubble is otherwise the only thing on
   * screen that knows what was said but not where it was said.
   *
   * Null while an agent is still working — there is no message to jump to yet.
   */
  messageId: number | null;
}

/** Longest bubble. The full reply is in the transcript; a bubble is the gist. */
export const ROOM_SPEECH_MAX_CHARS = 220;

/** A reply as a bubble reads it: markdown dropped, whitespace collapsed, clipped at a word. */
export function speechExcerpt(body: string, max = ROOM_SPEECH_MAX_CHARS): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Which agent at the table wrote this — by roster ref, card id (a draft persona), or name.
 *
 * ── WHY THIS IS RANKED, NOT THE FIRST CARD THAT MATCHES ──────────────────────────
 * The four ways a reply names its author are not equally trustworthy, and taking the
 * first card that satisfied ANY of them handed a bubble to the wrong head whenever a
 * weak match sat earlier in board order than the strong one. A card whose NAME is the
 * seat title of a later card ("Security" on a draft persona, "Security Lead" seated
 * from the roster) consumed that agent's reply, and the real speaker — matched only by
 * an exact ref further down the board — was then left with nothing to say, so its head
 * stayed silent through a standup it had answered. Two heads wrong per collision: the
 * one wearing someone else's words, and the one wearing none.
 *
 * So identity beats resemblance. An exact `ref`/`objectId` match is the author saying
 * who it is; a name or seat match is a guess from a title that two cards can share.
 * Every candidate is scored and the strongest wins, board order only breaking ties.
 */
function speakerOf(author: { ref: string; name: string }, agents: readonly BoardAgent[]): BoardAgent | undefined {
  /** 3 = the author's own id, 2 = its card, 1 = a shared title. 0 = not this agent. */
  const rank = (agent: BoardAgent): number => {
    if (agent.ref && agent.ref === author.ref) return 3;
    if (agent.objectId === author.ref) return 2;
    if (sameAgentName(agent.name, author.name) || sameAgentName(agent.seat, author.name)) return 1;
    return 0;
  };
  let best: BoardAgent | undefined;
  let bestRank = 0;
  for (const agent of agents) {
    const score = rank(agent);
    // Strictly greater: the first card at a given strength keeps it, so board order
    // still decides between two cards the author names equally well.
    if (score > bestRank) { best = agent; bestRank = score; }
  }
  return best;
}

/**
 * Each seat's speech for the latest turn, keyed by room occupant id. Agents in
 * `pendingObjectIds` (their card ids) are working; a reply replaces that.
 */
export function roomSpeech(
  timeline: readonly CanvasTranscriptMessage[],
  agents: readonly BoardAgent[],
  pendingObjectIds: ReadonlySet<string>,
): Map<string, RoomSpeech> {
  const speech = new Map<string, RoomSpeech>();
  for (const agent of agents) {
    if (pendingObjectIds.has(agent.objectId)) speech.set(boardAgentOccupantId(agent), { text: null, pending: true, messageId: null });
  }
  let turnStart = timeline.length - 1;
  while (turnStart >= 0 && timeline[turnStart]!.messageRole !== 'user') turnStart -= 1;
  // Indexed over the WHOLE timeline, not the sliced turn: `messageId` has to be the
  // message's position in the array the transcript was built from, so an offset into
  // the slice would point the reader at some earlier, unrelated turn.
  for (let index = turnStart + 1; index < timeline.length; index += 1) {
    const message = timeline[index]!;
    const author = message.metadata?.authoredBy;
    if (message.messageRole !== 'assistant' || author?.kind !== 'agent' || message.metadata?.error === true) continue;
    const agent = speakerOf(author, agents);
    const text = agent ? speechExcerpt(message.body) : '';
    if (agent && text) speech.set(boardAgentOccupantId(agent), { text, pending: false, messageId: index + 1 });
  }
  return speech;
}
