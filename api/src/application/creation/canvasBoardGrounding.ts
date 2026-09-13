/**
 * What a Creation Canvas board holds, told to an agent that is answering FROM it.
 *
 * A canvas group turn reaches a seated agent (the built-in CMO, CFO…) through the
 * ordinary team-chat reply, `BrainService.agentReply`, which grounds on the project —
 * its tasks, files and knowledge — and never saw the board. Measured (session
 * `bf886fc1`, 2026-09-13): asked to "combine all the competitive analysis research into
 * one document" on a board holding nine `competitor` cards, the CMO replied "I don't see
 * any existing competitive analysis documents or tasks in this project", then explained
 * it had checked attachments, project files and tasks. Every word was true of the
 * project and false of the board the question was asked on.
 *
 * The canvas already tags the message it sends with `creationSessionId` (via
 * `withDirectedMetadata`), so the server resolves the board itself — through the ONE
 * membership rule (`resolveSessionAccess`), never trusting a client-supplied snapshot —
 * and hands the agent a bounded digest of it.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { readPublicBoardGraph } from '../publicApi/publicCanvasBoardService';
import { CREATION_UUID_RE, type GraphObjectInput } from './creationGraphWriter';
import { resolveSessionAccess } from './sessionAccess';

/** Whole-digest ceiling. A board is summarised, not dumped: this is a system-prompt
 *  section beside the transcript, and a big board must not crowd the conversation out. */
export const CANVAS_DIGEST_MAX_CHARS = 16_000;

/** One field's ceiling — enough for a summary or a list of strengths, not a document. */
const FIELD_MAX_CHARS = 400;

/** Kinds that are the conversation or the chrome rather than the work on the board. */
const SKIPPED_KINDS = new Set(['chat']);

/** Fields every line already shows, and fields that are identity or rendering plumbing. */
const HEADLINE_FIELDS = new Set(['kind', 'title', 'status', 'summary']);
const PLUMBING_FIELD = /(^|[a-z])(Id|Ids|Ref|Url)$|^(resourceId|agentRef|frameable|httpStatus|frameBlockedBy|frameCheckedUrl|viewport|builtinAgent|model|accent|locations)$/;

/** The board a message was sent from, when the canvas tagged it with one. */
export function creationSessionIdFromMetadata(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const id = (JSON.parse(metadata) as { creationSessionId?: unknown }).creationSessionId;
    return typeof id === 'string' && CREATION_UUID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A field value as one short line, or null when it carries nothing worth reading. */
function fieldText(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return clip(value, FIELD_MAX_CHARS);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items = value
      .map((item) => {
        if (typeof item === 'string' || typeof item === 'number') return String(item);
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          const head = [record.title, record.name, record.label, record.channel].find((part) => typeof part === 'string');
          const tail = [record.detail, record.expected, record.url].find((part) => typeof part === 'string');
          return [head, tail].filter(Boolean).join(': ') || null;
        }
        return null;
      })
      .filter((item): item is string => !!item);
    return items.length ? clip(items.join('; '), FIELD_MAX_CHARS) : null;
  }
  return null;
}

/**
 * The board as prompt text: one entry per object with its kind, title, status, summary
 * and readable fields. Pure, so what an agent is told is testable without a database.
 */
export function canvasBoardDigest(boardTitle: string | null | undefined, objects: readonly GraphObjectInput[]): string | null {
  const work = objects.filter((object) => !SKIPPED_KINDS.has(object.kind));
  if (!work.length) return null;
  const entries: string[] = [];
  let used = 0;
  for (const object of work) {
    const content = (object.content && typeof object.content === 'object' ? object.content : {}) as Record<string, unknown>;
    const title = typeof content.title === 'string' && content.title.trim() ? clip(content.title, 120) : '(untitled)';
    const status = typeof content.status === 'string' && content.status.trim() ? ` — ${clip(content.status, 80)}` : '';
    const lines = [`- [${object.kind}] ${title}${status}`];
    const summary = fieldText(content.summary);
    if (summary) lines.push(`  ${summary}`);
    for (const [key, value] of Object.entries(content)) {
      if (HEADLINE_FIELDS.has(key) || PLUMBING_FIELD.test(key)) continue;
      const text = fieldText(value);
      if (text) lines.push(`  ${key}: ${text}`);
    }
    const entry = lines.join('\n');
    if (used + entry.length > CANVAS_DIGEST_MAX_CHARS) break;
    entries.push(entry);
    used += entry.length + 1;
  }
  const shown = entries.length < work.length ? `, the first ${entries.length} shown` : '';
  return [
    `This conversation is taking place on the Creation Canvas board "${clip(boardTitle || 'Untitled board', 120)}". `,
    'The board IS the team\'s current work: answer from it first, and never say something does not exist when it is listed below. ',
    'You cannot change the board from this reply — Brain on the canvas does that — so say what should be made and let it build.\n\n',
    `Board objects (${work.length}${shown}):\n`,
    entries.join('\n'),
  ].join('');
}

/**
 * The digest of the board a message came from, for the person asking — or null when
 * the message carries no board, or the asker is not a member of it (answered exactly
 * like "no board", so an id cannot be probed through an agent's reply).
 */
export async function loadCanvasBoardGrounding(
  db: Db,
  env: Env,
  tenantId: number,
  userId: string,
  metadata: string | null | undefined,
): Promise<string | null> {
  const sessionId = creationSessionIdFromMetadata(metadata);
  if (!sessionId) return null;
  const access = await resolveSessionAccess(db, sessionId, tenantId, userId);
  if (!access || access.session.status === 'deleted') return null;
  const graph = await readPublicBoardGraph(db, env, access.session);
  return canvasBoardDigest(access.session.title, graph.objects);
}
