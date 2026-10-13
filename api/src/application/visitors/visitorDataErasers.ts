/**
 * VISITOR_DATA_ERASERS — everything an anonymous visitor leaves behind, erased
 * through ONE registry (PRD 33 §6 "Privacy").
 *
 * A visitor is an opaque browser-minted id with no user row, so no account deletion
 * or foreign-key cascade ever reaches their data; the one erase route
 * (`DELETE /api/admin/guest-sessions/:visitorId/prompts`, via
 * `GuestPromptService.forgetVisitor`) runs every eraser here. A new store of visitor
 * data is one entry in this list — the route, its audit row and the erase count all
 * pick it up — rather than a second erase path somebody has to remember.
 *
 * Erasers run one after another and each reports its own count, so the audit row
 * says what each store actually lost.
 */

import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { marketingSessionPrompts } from '../../infrastructure/database/schema';
import { activityDatabase } from '../activity/activityLog';
import { forgetVisitorActivity } from '../marketing/visitorActivity';
import { eraseReplayVisitor } from '../replay/replayVisitorEraser';

export interface VisitorDataEraser {
  /** Stable id — the key of this eraser's count in the audit metadata. */
  id: string;
  /** Delete this store's data for the visitor; returns rows (or recordings) removed. */
  erase(env: Env, db: Db, visitorId: string): Promise<number>;
}

export const VISITOR_DATA_ERASERS: readonly VisitorDataEraser[] = [
  {
    // What the visitor typed into the composer (migration 0434).
    id: 'prompts',
    erase: async (_env, db, visitorId) => {
      const removed = await db
        .delete(marketingSessionPrompts)
        .where(eq(marketingSessionPrompts.visitorId, visitorId))
        .returning({ id: marketingSessionPrompts.id });
      return removed.length;
    },
  },
  {
    // Where they went and what broke — `activity_log` visitor rows (1111), on the
    // endpoint the journey is actually written to.
    id: 'journey',
    erase: (env, db, visitorId) => forgetVisitorActivity(activityDatabase(env, db), visitorId),
  },
  {
    // Their kept Insights recordings: rows, summaries and R2 bytes.
    id: 'replay',
    erase: (env, db, visitorId) => eraseReplayVisitor(env, db, visitorId),
  },
];

export interface VisitorErasure {
  /** Total removed across every eraser. */
  erased: number;
  /** Removed per eraser id. */
  byEraser: Record<string, number>;
}

/** Run every registered eraser for one visitor. */
export async function eraseVisitorData(
  env: Env,
  db: Db,
  visitorId: string,
  erasers: readonly VisitorDataEraser[] = VISITOR_DATA_ERASERS,
): Promise<VisitorErasure> {
  const byEraser: Record<string, number> = {};
  let erased = 0;
  for (const eraser of erasers) {
    const n = await eraser.erase(env, db, visitorId);
    byEraser[eraser.id] = n;
    erased += n;
  }
  return { erased, byEraser };
}
