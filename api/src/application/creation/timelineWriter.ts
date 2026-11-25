/**
 * THE transcript append — one message onto a board's timeline.
 *
 * The timeline is append-only and keyed by `(session, clientMessageId)`, so a retry of the
 * same message is a no-op that answers the row already there. The board's activity clock
 * moves with it. `POST /:id/timeline` and the sync importer for a canvas transcript message
 * both write through here.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { creationSessionTimeline, creationSessions } from '../../infrastructure/database/schema';

export interface TimelineAppend {
  sessionId: string;
  tenantId: number;
  clientMessageId: string;
  role: string;
  body: string;
  metadata: Record<string, unknown>;
  createdBy: string;
  /** When the message was written, if the writer knows (a device's own clock, clamped); default now. */
  createdAt?: Date;
}

export async function appendTimelineMessage(db: Db, input: TimelineAppend) {
  const [inserted] = await db.insert(creationSessionTimeline).values({
    sessionId: input.sessionId,
    clientMessageId: input.clientMessageId,
    messageRole: input.role,
    body: input.body,
    metadata: input.metadata,
    createdBy: input.createdBy,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  }).onConflictDoNothing({ target: [creationSessionTimeline.sessionId, creationSessionTimeline.clientMessageId] }).returning();
  const message = inserted ?? (await db.select().from(creationSessionTimeline).where(and(
    eq(creationSessionTimeline.sessionId, input.sessionId), eq(creationSessionTimeline.clientMessageId, input.clientMessageId),
  )).limit(1))[0];
  await db.update(creationSessions).set({ lastActivityAt: new Date(), updatedAt: new Date(), updatedBy: input.createdBy }).where(and(
    eq(creationSessions.id, input.sessionId), eq(creationSessions.tenantId, input.tenantId),
  ));
  return { message, inserted: Boolean(inserted) };
}
