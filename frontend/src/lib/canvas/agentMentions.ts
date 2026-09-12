import { uniqueBoardAgents, type BoardAgent } from './boardAgents';

/**
 * WHO A PROMPT ADDRESSES — the one reading of "@Name" on a canvas.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * Seating a teammate writes "@CMO " into the prompt, and the group-chat runtime read
 * "@name" to narrow a turn — but the canvas never read it to decide WHO took part. A
 * turn reached the agents that were selected or wired to Brain, capped at three, and
 * the mention itself only reached the model. So "@Manager @CFO @Counsel" with Counsel
 * selected asked Counsel alone, and Brain — handed three names and none of their
 * replies — wrote all three parts itself. One matcher now answers "is this agent named
 * here" for the canvas and for the group chat, so the two cannot disagree.
 *
 * ── HOW A NAME MATCHES ───────────────────────────────────────────────────────────
 * Case-insensitively, spaced ("@Product Designer") or run together
 * ("@ProductDesigner"), against the card's name, its seat and its roster ref — and only
 * as a whole word, so "@CFO" is not also a mention of an agent called "CF". Letters and
 * digits in any script count, so a name written in Chinese matches like one in English.
 */

/**
 * The most agents one turn fans out to. Each is a model call of its own before Brain's
 * summary, so a board with a whole department on it cannot turn one sentence into a
 * twenty-call turn by accident. Eight seats a full leadership table.
 */
export const MAX_ADDRESSED_AGENTS = 8;

const NOT_WORD = /[^\p{L}\p{N}]+/gu;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `prompt` @-mentions any of `labels`. Empty and missing labels never match. */
export function mentionsAny(prompt: string, labels: readonly (string | null | undefined)[]): boolean {
  if (!prompt.includes('@')) return false;
  const lower = prompt.toLowerCase();
  return labels.some((label) => {
    const spaced = (label ?? '').toLowerCase().replace(NOT_WORD, ' ').trim();
    if (!spaced) return false;
    const forms = [...new Set([spaced, spaced.replaceAll(' ', '')])].map(escapeRegExp);
    return new RegExp(`@(?:${forms.join('|')})(?![\\p{L}\\p{N}])`, 'u').test(lower);
  });
}

/** The board's agents this prompt names — one per agent, in board order, capped. */
export function mentionedBoardAgents(prompt: string, agents: readonly BoardAgent[]): BoardAgent[] {
  return uniqueBoardAgents(agents)
    .filter((agent) => mentionsAny(prompt, [agent.name, agent.seat, agent.ref]))
    .slice(0, MAX_ADDRESSED_AGENTS);
}

/** "@CMO @ChiefCounsel" — a set of agents addressed the way a person would type it. */
export function mentionTokens(agents: readonly Pick<BoardAgent, 'name'>[]): string {
  return agents.map((agent) => `@${agent.name.replace(/\s+/g, '')}`).join(' ');
}
