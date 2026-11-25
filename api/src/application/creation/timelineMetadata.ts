/**
 * The metadata a board's transcript message may carry — what is KEPT of whatever the
 * caller sent.
 *
 * The transcript is shared by everyone on the board and read by the Brain, so a message
 * never stores arbitrary client JSON: a scope tag, the objects it is about, the model that
 * answered, an error flag, and WHO wrote it. A person's message is always attributed to
 * that person (never to a name the body claims); an assistant or system message may name
 * the Brain or an agent. One definition for `POST /:id/timeline` and the sync importer for
 * a canvas transcript message (`creation/sync/importSyncedCanvasTimeline.ts`).
 */

import { CREATION_UUID_RE } from './creationGraphWriter';

export type TimelineRole = 'user' | 'assistant' | 'system';

export function timelineRole(raw: unknown): TimelineRole {
  return raw === 'assistant' || raw === 'system' ? raw : 'user';
}

export function sanitizeTimelineMetadata(
  raw: unknown,
  role: TimelineRole,
  human: { userId: string; name: string | null | undefined },
): Record<string, unknown> {
  const meta = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const author = meta.authoredBy && typeof meta.authoredBy === 'object' && !Array.isArray(meta.authoredBy)
    ? meta.authoredBy as Record<string, unknown>
    : null;
  return {
    ...(typeof meta.scope === 'string' ? { scope: meta.scope.slice(0, 32) } : {}),
    ...(Array.isArray(meta.objectIds)
      ? { objectIds: meta.objectIds.filter((id): id is string => typeof id === 'string' && CREATION_UUID_RE.test(id)).slice(0, 100) }
      : {}),
    ...(typeof meta.model === 'string' ? { model: meta.model.slice(0, 120) } : {}),
    ...(typeof meta.error === 'boolean' ? { error: meta.error } : {}),
    ...(role === 'user'
      ? { authoredBy: { kind: 'human', ref: human.userId, name: human.name || 'Collaborator' } }
      : author
        ? {
            authoredBy: {
              kind: author.kind === 'agent' ? 'agent' : 'brain',
              ref: String(author.ref || '').slice(0, 128),
              name: String(author.name || '').slice(0, 160),
            },
          }
        : {}),
  };
}
