/**
 * FORWARDING — this LRS relaying the statements it accepts to somebody else's.
 *
 * The source product had an `external_lrs_targets` table for this; the coverage
 * map folds it into a sibling, and the sibling is `connections` (see
 * `lrsCredentials`). This module is the behaviour that makes that row mean
 * something: a workspace that already reports into a corporate LRS can point this
 * one at it, and every statement an authoring tool sends here arrives there too.
 *
 * ── WHY IT RUNS AFTER THE RESPONSE, NOT BEFORE IT ───────────────────────────
 * The statement is already durably stored by the time this is called. Making the
 * POST that accepted it wait on a third party's availability would mean an
 * authoring tool sees a timeout for a statement we successfully recorded — and
 * xAPI clients respond to that by RETRYING, so a slow forwarding target would turn
 * into duplicate traffic against the store. So the route hands this to
 * `waitUntil`: the client's answer reflects OUR durability, and forwarding is a
 * consequence of it.
 *
 * ── WHY A FAILURE IS RECORDED AND NOT RETRIED ───────────────────────────────
 * A retry queue for a fan-out to an arbitrary external endpoint is a subsystem,
 * not a function, and the platform already has one shape for "this connection is
 * not working": `connections.last_error` plus the `expired` status the settings
 * listing renders as "reconnect". A target that is down therefore SHOWS as down,
 * on the same screen as every other broken connection, instead of accumulating
 * silent backlog. Statements are never lost — they are in `activity_log`, and the
 * remedy for a fixed target is a re-send from there rather than a queue that has
 * been draining into a 500 for a week.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { XapiStatement } from '../../domain/learning/xapiStatement';
import { outboundTargets, recordForwardOutcome } from './lrsCredentials';

/** The version header every conformant LRS requires on every request. */
export const XAPI_VERSION = '1.0.3';

/** A forwarding POST that has not answered by now is treated as failed. The
 *  request is already off the critical path, but an isolate does not live
 *  forever and a hung socket must not be what ends it. */
export const FORWARD_TIMEOUT_MS = 10_000;

export interface ForwardOutcome {
  targets: number;
  delivered: number;
  failed: number;
}

/**
 * Send these statements to every connected outbound target.
 *
 * Targets run CONCURRENTLY and independently: one corporate LRS being down must
 * not delay or cancel delivery to another, and each records its own outcome.
 */
export async function forwardStatements(
  db: Db, env: Env, tenantId: number, statements: XapiStatement[],
): Promise<ForwardOutcome> {
  if (statements.length === 0) return { targets: 0, delivered: 0, failed: 0 };

  const targets = await outboundTargets(db, env, tenantId);
  if (targets.length === 0) return { targets: 0, delivered: 0, failed: 0 };

  // The documents exactly as they arrived. A forwarded statement must be the one
  // the authoring tool wrote, not our projection of it — the receiving LRS is
  // entitled to the same bytes, including extensions we do not model.
  const body = JSON.stringify(statements.map((s) => s.raw));

  const results = await Promise.all(targets.map(async (target) => {
    const failure = await postToTarget(target, body);
    await recordForwardOutcome(db, tenantId, target.connectionId, failure);
    return failure === null;
  }));

  const delivered = results.filter(Boolean).length;
  return { targets: targets.length, delivered, failed: results.length - delivered };
}

/** The failure reason, or null for success. Never throws — a rejected fetch is a
 *  target that is down, which is a recorded state and not an exception the
 *  statement path should see. */
async function postToTarget(
  target: { endpoint: string; key: string; secret: string },
  body: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${target.endpoint}/statements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Experience-API-Version': XAPI_VERSION,
        Authorization: `Basic ${btoa(`${target.key}:${target.secret}`)}`,
      },
      body,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    if (response.ok) return null;

    // A conformant LRS answers 409 to a statement id it already holds. That is
    // the forwarding path working — the target has the statement — so it is not
    // a failure and must not put the connection into an error state.
    if (response.status === 409) return null;
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    return `HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 300) : 'forwarding failed';
  }
}
