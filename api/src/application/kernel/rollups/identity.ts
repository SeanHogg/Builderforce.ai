/**
 * The WRITER for `identity.*` metric facts.
 *
 * ── A SIGNUP IS A JOIN, NOT A ROW IN `users` ────────────────────────────────
 * `users` has no `tenant_id` — a person is a platform-level identity who may
 * belong to several workspaces — so counting `users.created_at` per tenant is
 * not a query that exists. `tenant_members.joined_at` is the fact this seat
 * actually charts: somebody joined THIS workspace, on this day. It is also the
 * honest one, because a user who is invited to a second workspace is a signup
 * for that workspace and not a new person anywhere.
 *
 * ── ACTIVE MEANS SEEN, NOT REGISTERED ───────────────────────────────────────
 * `sessions.last_seen_at` is refreshed on use, so a DISTINCT count of user ids
 * per day is the number of people who actually turned up. Counting `is_active`
 * membership rows instead would report a headcount that never moves and call it
 * engagement.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup } from '../metricRollup';

const WINDOW_DAYS = 90;
const since = sql`DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')`;

export const IDENTITY_ROLLUP: DomainRollup = {
  domain: 'identity',
  metrics: [
    {
      key: 'identity.signups',
      requires: ['tenant_members'],
      build: () => fact({
        metric: 'identity.signups',
        bucket: 'day',
        unit: 'people',
        tenant: sql`m.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', m.joined_at)`,
        value: sql`COUNT(*)`,
        tail: sql`
            FROM tenant_members m
           WHERE m.tenant_id IS NOT NULL
             AND m.joined_at IS NOT NULL
             AND m.joined_at >= ${since}
           GROUP BY m.tenant_id, DATE_TRUNC('day', m.joined_at)
        `,
      }),
    },
    {
      key: 'identity.active_users',
      requires: ['sessions'],
      build: () => fact({
        metric: 'identity.active_users',
        bucket: 'day',
        unit: 'people',
        tenant: sql`s.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', s.last_seen_at)`,
        // DISTINCT: a person with a browser session, a VS Code session and a
        // device token is one active user, and summing sessions would report a
        // daily-active figure that rises when somebody buys a laptop.
        value: sql`COUNT(DISTINCT s.user_id)`,
        tail: sql`
            FROM sessions s
           WHERE s.tenant_id IS NOT NULL
             AND s.user_id IS NOT NULL
             AND s.last_seen_at IS NOT NULL
             AND s.revoked_at IS NULL
             AND s.last_seen_at >= ${since}
           GROUP BY s.tenant_id, DATE_TRUNC('day', s.last_seen_at)
        `,
      }),
    },
  ],
};
