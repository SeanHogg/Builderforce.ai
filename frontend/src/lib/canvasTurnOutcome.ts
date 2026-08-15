/**
 * How a Creation Canvas turn is CLASSIFIED — what the user asked for, and whether the
 * answer that came back honours it.
 *
 * Split out of `creationCanvasAi.ts`, which runs the bounded tool loop. These are pure
 * predicates over a prompt, a snapshot or an answer: no transport, no model, no state.
 * Keeping them here is what lets the loop be read as a loop, and lets every rule below
 * be tested directly against the wording that defeated it.
 */

import type { CanvasNotices } from '@/lib/canvasNotices';

/** Words a drafted page is assumed to hold when verifying a page count. */
export const WORDS_PER_DRAFT_PAGE = 300;

export const RESEARCH_TOOL_NAMES = new Set(['builtin_web_search', 'builtin_web_fetch', 'builtin_geo_geocode']);

/**
 * Tools that cannot advance an AUTHORING phase, so they are withdrawn once the turn
 * has nothing left to do but write to the canvas.
 *
 * Research is the obvious half. The board snapshot is the other: it already travels in
 * the turn's context, every call returns the same payload, and a stalled model reaches
 * for it because it is the safest-looking action available. Measured 2026-08-14 (ui
 * 2026.8.15): asked to draft an email, the model read the snapshot, answered in prose,
 * was told to act, read the IDENTICAL snapshot again, answered again, and the turn was
 * abandoned with nothing on the canvas.
 */
export const NON_AUTHORING_TOOL_NAMES = new Set([...RESEARCH_TOOL_NAMES, 'canvas_read_snapshot']);

export function isNarrowSearchResult(value: unknown): boolean {
  return !!value && typeof value === 'object'
    && (value as { coverage?: unknown }).coverage === 'encyclopedic';
}

export function isWebsiteRedesignRequest(prompt: string): boolean {
  return /\b(?:website|web\s*site|homepage|landing page)\b/i.test(prompt)
    && /\b(?:design|redesign|improve|ui\s*\/\s*ux|comparison|compare)\b/i.test(prompt);
}

/**
 * The landing canvas exposes C-suite agents as clickable teammates. A model can
 * otherwise read "bring the CTO in" as a request to invite a real person, then
 * ask what "this" means on a brand-new board. Keep this narrow so ordinary
 * questions about executive roles remain ordinary chat.
 */
export function isExecutiveTeammateRequest(prompt: string): boolean {
  const namesExecutiveRole = /\b(?:CEO|CFO|CMO|COO|CTO|CISO)\b/i.test(prompt);
  const asksToAddRole = /(?:\b(?:add|bring|create|invite|ajoute|am[eè]ne|invit[eé]|trae|invita|crea|hol|f[uü]ge)\b|邀请|添加|创建)/i.test(prompt);
  return namesExecutiveRole && asksToAddRole;
}

export function requestedDocumentPages(prompt: string): number | null {
  if (!/\b(?:create|generate|make|write|author|draft)\b/i.test(prompt)) return null;
  if (!/\b(?:document|doc|manuscript|book|report)\b/i.test(prompt)) return null;
  const match = prompt.match(/\b(\d[\d,]*)\s*(?:-|\s)?pages?\b/i);
  if (!match) return null;
  const pages = Number(match[1]!.replaceAll(',', ''));
  return Number.isInteger(pages) && pages > 0 ? pages : null;
}

export function authoredDocumentWords(args: unknown): number | null {
  if (!args || typeof args !== 'object') return null;
  const input = args as { kind?: unknown; fields?: unknown };
  if (input.kind !== 'document' || !input.fields || typeof input.fields !== 'object') return null;
  const fields = input.fields as { markdown?: unknown; content?: unknown };
  const authored = [fields.markdown, fields.content].find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  return authored ? (authored.match(/\S+/g) || []).length : 0;
}

export function documentWordsInSnapshot(snapshot: string): number | null {
  try {
    const parsed = JSON.parse(snapshot) as { objects?: unknown };
    if (!Array.isArray(parsed.objects)) return null;
    const counts = parsed.objects.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const object = value as { kind?: unknown; markdown?: unknown; content?: unknown };
      if (object.kind !== 'document') return [];
      const authored = [object.markdown, object.content].find((item) => typeof item === 'string' && item.trim()) as string | undefined;
      return [(authored?.match(/\S+/g) || []).length];
    });
    return counts.length ? Math.max(...counts) : null;
  } catch {
    return null;
  }
}

/** The prompt plus the prior turns a page count may have been stated in. Structural on
 *  purpose: this rule needs two fields, not the whole turn's options. */
export interface PageRequestContext {
  prompt: string;
  conversation?: ReadonlyArray<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

export function requestedPagesForTurn(options: PageRequestContext): number | null {
  const direct = requestedDocumentPages(options.prompt);
  if (direct != null) return direct;
  if (!/\b(?:creating|created|done|finished|complete|status|progress|working)\b/i.test(options.prompt)) return null;
  for (const message of [...(options.conversation || [])].reverse()) {
    if (message.role !== 'user') continue;
    const pages = requestedDocumentPages(message.content);
    if (pages != null) return pages;
  }
  return null;
}

export function incompleteDocumentAnswer(notices: CanvasNotices, requestedPages: number, authoredWords: number, exact: boolean): string {
  if (!exact) return notices.documentUnverified(requestedPages);
  return notices.documentIncomplete(authoredWords, Math.max(1, Math.ceil(authoredWords / WORDS_PER_DRAFT_PAGE)), requestedPages);
}

const CREATION_CLAIM = /\b(?:i(?:'ve| have)?\s+(?:created|added|built|generated|updated|made|produced)|here(?:'s| is)\s+(?:the|a|your)|the\s+\w+\s+(?:has been|is now)\s+(?:created|added|updated))\b/i;
const CREATED_ARTIFACT = /\b(table|chart|graph|dashboard|kpi|visuali[sz]ation|report|document|slide|drawing|diagram|widget|object|card)\b/i;
/** Values the model may only state when a tool actually computed them. */
const FABRICATED_DATA = /\b(?:placeholder|sample|example|illustrative|dummy|mock|assumed|estimated|representative)\s+(?:value|number|figure|data|count|metric|row)s?\b/i;

/**
 * A canvas turn is only honest if the artifact it describes exists. The model
 * occasionally narrates a finished table or chart without calling a tool, which
 * previously reached the user as a success message beside an unchanged canvas.
 */
export function unverifiedCreationClaim(notices: CanvasNotices, text: string, mutated: boolean, hasTabularData: boolean, enforceCreationClaim = true): string | null {
  const answer = text.trim();
  if (!answer) return null;
  if (enforceCreationClaim && !mutated && CREATION_CLAIM.test(answer) && CREATED_ARTIFACT.test(answer)) {
    return notices.unverifiedCreation(hasTabularData);
  }
  if (hasTabularData && FABRICATED_DATA.test(answer)) return notices.fabricatedData(answer);
  return null;
}

/** True when the canvas holds an object with imported rows Brain could query. */
export function snapshotHasTabularRows(snapshot: string): boolean {
  try {
    const parsed = JSON.parse(snapshot) as { objects?: unknown };
    if (!Array.isArray(parsed.objects)) return false;
    return parsed.objects.some((value) => {
      if (!value || typeof value !== 'object') return false;
      const object = value as { kind?: unknown; rowCount?: unknown; sampleRows?: unknown };
      return ['dataset', 'table', 'spreadsheet'].includes(String(object.kind))
        && (Number(object.rowCount) > 0 || (Array.isArray(object.sampleRows) && object.sampleRows.length > 0));
    });
  } catch {
    return false;
  }
}

/** Imperative canvas turns must not degrade into a prose-only answer. */
export function requestsCanvasMutation(prompt: string): boolean {
  // VISUAL verbs are first-class instructions, not conversation. "draw me a coniferous
  // landscape at <address>" was classified as small talk because `draw` was absent here,
  // so the no-tool-call recovery never armed for the one request shape the canvas most
  // obviously exists to serve, and a prose apology counted as a completed turn
  // (measured 2026-08-12, ui 2026.7.213).
  const verb = '(?:create|build|design|redesign|improve|make|add|insert|update|change|edit|revise|replace|remove|delete|use|set|turn|convert|arrange|align|move|resize|connect|apply|implement|write|draft|generate|research|compare|show|provide|run|launch|start|plan|organi[sz]e|schedule|send'
    + '|draw|sketch|illustrate|render|paint|visuali[sz]e|mock\\s?up|diagram|chart|graph|map)';
  // A request is routinely phrased as a WANT rather than an order — "I want to connect
  // my email and run a marketing campaign" is an instruction, not small talk, and the
  // clause-boundary matcher below cannot see it because the verb sits after "to".
  // Missing it meant the no-tool-call recovery never armed for exactly the kind of
  // request the canvas exists to serve (measured 2026-08-12, ui 2026.7.210: one model
  // round, zero tool calls, no retry).
  const intent = '(?:i(?:\'d| would)?\\s+(?:want|need|would\\s+like)(?:\\s+you)?\\s+to|i\'m\\s+(?:trying|looking)\\s+to|can\\s+you|could\\s+you|would\\s+you|please|let\'?s|help\\s+me(?:\\s+to)?)';
  return new RegExp(`^(?:please\\s+)?${verb}\\b`, 'i').test(prompt.trim())
    // Real requests commonly begin with context ("I have an existing website …")
    // and put the imperative in the next sentence or bullet. The old start-only
    // classifier missed exactly that shape and allowed a prose summary to count as
    // completion. Keep the boundary narrow so "How do I design…?" remains a question.
    || new RegExp(`(?:^|[.!?;:]\\s+|\\n\\s*|[-*]\\s+)(?:please\\s+)?${verb}\\b`, 'i').test(prompt)
    // Still verb-anchored, so "I want a coffee" and "can you explain SEO?" stay
    // ordinary conversation.
    || new RegExp(`(?:^|[.!?;:]\\s+|\\n\\s*|[-*]\\s+)${intent}\\s+${verb}\\b`, 'i').test(prompt)
    || /\b(?:change|update|edit|revise|replace|apply)\s+(?:this|the|selected|its)\b/i.test(prompt);
}
