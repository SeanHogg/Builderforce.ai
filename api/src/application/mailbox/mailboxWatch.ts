/**
 * Mailbox push — ONE watch, cursor and renewal machine, consumed by both callers.
 *
 * ── WHAT WAS MISSING ────────────────────────────────────────────────────────
 * A connected mailbox could only ever be PULLED from. Two separate gaps said so:
 *   • a workflow could not start from "an email arrived" — `inbound-email` covers
 *     a private address we own, never the mailbox somebody actually reads;
 *   • a canvas inbox tile stamped `fetchedAt` and then sat there until a human or
 *     a model asked it to re-read.
 *
 * Those are one gap. Both need a provider subscription, a cursor, a renewal and an
 * exactly-once guarantee, and building that twice — once per consumer — is the
 * duplication this codebase's guards exist to catch. So this module owns it once:
 * {@link ensureMailboxWatch} arms it, {@link runMailboxWatchSweep} keeps it alive,
 * {@link drainMailboxWatch} turns a notification into a set of NEW messages, and
 * both consumers are fan-out at the end of that one function.
 *
 * ── WHY PUSH, AND WHAT HAPPENS WITHOUT IT ───────────────────────────────────
 * A per-tenant, per-tile background poll is the shape this deployment cannot
 * afford: this is a Cloudflare Worker on a Neon Free budget whose whole cron path
 * is gated by a KV work-signal precisely so an idle platform never wakes Postgres.
 * A push does not have that shape — an idle mailbox sends nothing and costs
 * nothing, and the only recurring work is renewing a subscription, which is a
 * bounded index seek on the frequent tick.
 *
 * Gmail push additionally needs an operator artifact (a Pub/Sub topic). Where that
 * is absent the mailbox is armed in `poll` mode — the SAME cursor, the SAME
 * `history.list` delta, drained by the renewal sweep instead of by a notification.
 * That is one mechanism woken two ways, not two mechanisms.
 *
 * ── EXACTLY ONCE ────────────────────────────────────────────────────────────
 * Both providers guarantee at-least-once. The cursor cannot prevent a double-fire
 * because it advances AFTER the work; `mailbox_push_receipts` can, because its
 * unique index is checked BEFORE it. Only messages whose receipt insert actually
 * produced a row reach a workflow trigger or a canvas tile.
 */

import { and, asc, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { buildDatabase } from '../../infrastructure/database/connection';
import {
  creationSessionObjects,
  creationSessions,
  mailboxConnections,
  mailboxPushReceipts,
  mailboxWatches,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { broadcastRoom, creationSessionRoomName } from '../../infrastructure/relay/broadcastRoom';
import { fireEventTriggers } from '../workflow/eventTriggers';
import { generateTriggerToken } from '../../domain/workflowTriggers';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { signalPendingWork } from '../runtime/cronWorkSignal';
import { freshMailboxToken, toTriageMessages } from './mailboxService';
import {
  applyClientSideFilters,
  type MailboxMessage,
  type MailboxProvider,
  type MailboxQuery,
  type MailboxWatchRegistration,
  type MailboxWatchTarget,
} from './mailboxProviders';

type WatchRow = typeof mailboxWatches.$inferSelect;

/** The mount point of the push endpoints. Shared with the route so the URL handed
 *  to a provider and the URL the Worker answers on cannot drift. */
export const MAILBOX_PUSH_PATH = '/api/mailbox/push';

/**
 * How many messages one drain will carry.
 *
 * A notification says "something changed", not "here is your mail", so the drain
 * decides its own ceiling. 50 is enough that a normal burst lands in one pass and
 * low enough that a mailbox being restored from backup cannot spend a Worker's
 * whole budget in one tick — the cursor simply stays behind and the next drain
 * picks up where this one stopped.
 */
const DELTA_LIMIT = 50;

/** Renew this far ahead of expiry. Comfortably more than the 5-minute tick, so a
 *  single missed tick can never let a subscription lapse. */
const RENEW_LEAD_MS = 6 * 60 * 60 * 1000;

/** How many watches one sweep touches. Bounds the tick, not the backlog — the
 *  next tick takes the next slice, ordered by how soon they expire. */
const SWEEP_BATCH = 25;

/** How long a receipt is worth keeping. Past the longest replay window either
 *  provider has (Gmail keeps roughly a week of history), a receipt can only ever
 *  say "no" to a message that can no longer be delivered. */
const RECEIPT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** Where a provider should send notifications for one watch. */
export function mailboxPushUrl(env: Env, provider: string, token: string): string {
  const base = (env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai').replace(/\/$/, '');
  return `${base}${MAILBOX_PUSH_PATH}/${encodeURIComponent(provider)}/${encodeURIComponent(token)}`;
}

/**
 * The Gmail push endpoint is addressed by a DEPLOYMENT secret, not a per-mailbox
 * token, because one Pub/Sub subscription serves every connected Gmail mailbox and
 * the notification names the mailbox in its payload (`emailAddress`). This is the
 * URL an operator points that subscription at.
 */
export function gmailPushUrl(env: Env): string | null {
  return env.GMAIL_PUSH_TOKEN ? mailboxPushUrl(env, 'google', env.GMAIL_PUSH_TOKEN) : null;
}

function watchTarget(env: Env, provider: string, pushToken: string): MailboxWatchTarget {
  return {
    // Gmail ignores this (it publishes to a topic); Graph puts it on the
    // subscription and validates it before the subscription exists.
    notifyUrl: provider === 'google' ? (gmailPushUrl(env) ?? '') : mailboxPushUrl(env, provider, pushToken),
    clientState: pushToken,
    ...(provider === 'google' && env.GMAIL_PUBSUB_TOPIC ? { pubsubTopic: env.GMAIL_PUBSUB_TOPIC } : {}),
  };
}

function registrationOf(row: WatchRow): MailboxWatchRegistration {
  return {
    mode: row.mode === 'poll' ? 'poll' : 'push',
    subscriptionId: row.subscriptionId,
    cursor: row.cursor ?? '',
    expiresAtMs: row.expiresAt ? row.expiresAt.getTime() : null,
  };
}

export interface MailboxWatchView {
  connectionId: number;
  provider: string;
  mode: 'push' | 'poll';
  status: string;
  expiresAtISO: string | null;
  lastDeltaAtISO: string | null;
  lastError: string | null;
}

function toWatchView(row: WatchRow): MailboxWatchView {
  return {
    connectionId: row.connectionId,
    provider: row.provider,
    mode: row.mode === 'poll' ? 'poll' : 'push',
    status: row.status,
    expiresAtISO: row.expiresAt ? row.expiresAt.toISOString() : null,
    lastDeltaAtISO: row.lastDeltaAt ? row.lastDeltaAt.toISOString() : null,
    lastError: row.lastError,
  };
}

export type EnsureWatchResult =
  | { ok: true; watch: MailboxWatchView }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Arming and tearing down
// ---------------------------------------------------------------------------

/**
 * Arm (or re-arm) the push subscription for one connected mailbox.
 *
 * Idempotent: the row is keyed by connection, so calling it twice re-arms the
 * clock rather than creating a second subscription that would double-deliver every
 * message. The `pushToken` is preserved across a re-arm for the same reason a
 * webhook trigger preserves its token — the URL an operator or a provider already
 * holds must keep working.
 */
export async function ensureMailboxWatch(
  db: Db,
  env: Env,
  tenantId: number,
  connectionId: number,
): Promise<EnsureWatchResult> {
  const token = await freshMailboxToken(db, env, tenantId, connectionId);
  if (!token.ok) return { ok: false, error: token.error };

  const [existing] = await db
    .select()
    .from(mailboxWatches)
    .where(scopedToTenant(mailboxWatches, tenantId, eq(mailboxWatches.connectionId, connectionId)))
    .limit(1);
  const pushToken = existing?.pushToken ?? generateTriggerToken();
  const target = watchTarget(env, token.provider.name, pushToken);

  let armed: MailboxWatchRegistration;
  try {
    armed = await token.provider.startWatch(token.accessToken, target);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The mailbox could not be watched.';
    reportCaughtError(error, { source: 'application/mailbox/mailboxWatch.ts', operation: 'ensureMailboxWatch' });
    await recordWatchError(db, tenantId, connectionId, message);
    return { ok: false, error: message };
  }

  const now = new Date();
  const values = {
    tenantId,
    connectionId,
    provider: token.provider.name,
    mode: armed.mode,
    subscriptionId: armed.subscriptionId,
    pushToken,
    // An EXISTING cursor always wins. Re-arming must not skip the mail that
    // arrived between the last drain and this call.
    cursor: existing?.cursor || armed.cursor || null,
    expiresAt: armed.expiresAtMs ? new Date(armed.expiresAtMs) : null,
    status: 'active',
    lastError: null,
    updatedAt: now,
  };
  const [row] = await db
    .insert(mailboxWatches)
    .values(values)
    .onConflictDoUpdate({ target: [mailboxWatches.connectionId], set: values })
    .returning();
  return { ok: true, watch: toWatchView(row!) };
}

/** Best-effort teardown. A failure here is never fatal: every subscription
 *  expires on its own, and the row is gone either way. */
export async function stopMailboxWatch(db: Db, env: Env, tenantId: number, connectionId: number): Promise<void> {
  const [row] = await db
    .select()
    .from(mailboxWatches)
    .where(scopedToTenant(mailboxWatches, tenantId, eq(mailboxWatches.connectionId, connectionId)))
    .limit(1);
  if (!row) return;
  try {
    const token = await freshMailboxToken(db, env, tenantId, connectionId);
    if (token.ok) await token.provider.stopWatch(token.accessToken, registrationOf(row));
  } catch (error) {
    reportCaughtError(error, { source: 'application/mailbox/mailboxWatch.ts', operation: 'stopMailboxWatch' });
  }
  await db
    .delete(mailboxWatches)
    .where(scopedToTenant(mailboxWatches, tenantId, eq(mailboxWatches.connectionId, connectionId)));
}

/** Read the watch behind one mailbox, for the connections surface. */
export async function getMailboxWatch(db: Db, tenantId: number, connectionId: number): Promise<MailboxWatchView | null> {
  const [row] = await db
    .select()
    .from(mailboxWatches)
    .where(scopedToTenant(mailboxWatches, tenantId, eq(mailboxWatches.connectionId, connectionId)))
    .limit(1);
  return row ? toWatchView(row) : null;
}

async function recordWatchError(db: Db, tenantId: number, connectionId: number, message: string): Promise<void> {
  await db
    .update(mailboxWatches)
    .set({ status: 'error', lastError: message.slice(0, 1_000), updatedAt: new Date() })
    .where(scopedToTenant(mailboxWatches, tenantId, eq(mailboxWatches.connectionId, connectionId)))
    .catch((error: unknown) => {
      reportCaughtError(error, { source: 'application/mailbox/mailboxWatch.ts', operation: 'recordWatchError' });
    });
}

// ---------------------------------------------------------------------------
// The drain — one notification becomes a set of NEW messages
// ---------------------------------------------------------------------------

export interface DrainResult {
  /** How many messages the provider reported since the cursor. */
  seen: number;
  /** How many of those were genuinely new (survived the receipt ledger). */
  fresh: number;
  /** Workflow runs started. */
  fired: number;
  /** Canvas inbox tiles pushed to. */
  tiles: number;
  error?: string;
}

const EMPTY_DRAIN: DrainResult = { seen: 0, fresh: 0, fired: 0, tiles: 0 };

/**
 * Read everything that arrived since this watch's cursor and fan it out.
 *
 * The order is deliberate and load-bearing:
 *   1. fetch the delta from the provider;
 *   2. CLAIM each message in `mailbox_push_receipts` — only the inserts that
 *      produced a row are new, and everything after this point sees that set;
 *   3. advance the cursor;
 *   4. fire `mailbox-received` workflow triggers, one run per new email;
 *   5. push the same messages into every open canvas inbox tile bound to this
 *      mailbox, through the creation-session relay.
 *
 * Claiming BEFORE the cursor advances is what makes a crash between the two
 * harmless: the next drain re-reads the same window and the ledger swallows it.
 * The reverse order would lose mail.
 */
export async function drainMailboxWatch(db: Db, env: Env, row: WatchRow): Promise<DrainResult> {
  const token = await freshMailboxToken(db, env, row.tenantId, row.connectionId);
  if (!token.ok) {
    await recordWatchError(db, row.tenantId, row.connectionId, token.error);
    return { ...EMPTY_DRAIN, error: token.error };
  }

  let delta;
  try {
    delta = await token.provider.fetchDelta(token.accessToken, row.cursor, DELTA_LIMIT);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The mailbox delta could not be read.';
    reportCaughtError(error, { source: 'application/mailbox/mailboxWatch.ts', operation: 'drainMailboxWatch' });
    await recordWatchError(db, row.tenantId, row.connectionId, message);
    return { ...EMPTY_DRAIN, error: message };
  }

  const fresh = delta.messages.length
    ? await claimNewMessages(db, row.tenantId, row.connectionId, delta.messages)
    : [];

  await db
    .update(mailboxWatches)
    .set({
      cursor: delta.cursor,
      lastDeltaAt: new Date(),
      status: 'active',
      lastError: null,
      updatedAt: new Date(),
    })
    .where(scopedToTenant(mailboxWatches, row.tenantId, eq(mailboxWatches.id, row.id)));

  if (fresh.length === 0) return { ...EMPTY_DRAIN, seen: delta.messages.length };

  const [fired, tiles] = await Promise.all([
    fireMailboxReceived(db, env, row, token.accountEmail, fresh),
    pushToInboxTiles(db, env, row, token.accountEmail, token.provider, fresh),
  ]);

  return { seen: delta.messages.length, fresh: fresh.length, fired, tiles };
}

/**
 * The exactly-once gate.
 *
 * `onConflictDoNothing().returning()` gives back only the rows that were actually
 * inserted, which is precisely the set of messages nothing has acted on yet. Two
 * concurrent notifications racing on the same message therefore produce one winner
 * and one empty result, without a lock and without a read-then-write window.
 */
async function claimNewMessages(
  db: Db,
  tenantId: number,
  connectionId: number,
  messages: MailboxMessage[],
): Promise<MailboxMessage[]> {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const claimed = await db
    .insert(mailboxPushReceipts)
    .values(messages.map((m) => ({
      tenantId,
      connectionId,
      messageId: m.id.slice(0, 512),
      receivedAt: new Date(m.receivedAtISO),
    })))
    .onConflictDoNothing({
      target: [mailboxPushReceipts.tenantId, mailboxPushReceipts.connectionId, mailboxPushReceipts.messageId],
    })
    .returning({ messageId: mailboxPushReceipts.messageId });
  return claimed
    .map((r) => byId.get(r.messageId))
    .filter((m): m is MailboxMessage => !!m)
    .sort((a, b) => a.receivedAtISO.localeCompare(b.receivedAtISO));
}

/**
 * One workflow run per new email.
 *
 * The payload is deliberately the same four fields `inbound-email` delivers —
 * `from`, `to`, `subject`, `text` — so a workflow written against one reads the
 * other unchanged. Everything past those four is additive context a workflow can
 * ignore.
 */
async function fireMailboxReceived(
  db: Db,
  env: Env,
  row: WatchRow,
  accountEmail: string,
  messages: MailboxMessage[],
): Promise<number> {
  let fired = 0;
  for (const message of messages) {
    const result = await fireEventTriggers(db, {
      tenantId: row.tenantId,
      eventType: 'mailbox-received',
      env,
      match: {
        // Either identifier the author could reasonably have typed into the
        // builder: the address they connected, or the connection id the UI shows.
        mailboxAccount: [accountEmail, String(row.connectionId)],
        mailboxSender: message.from,
      },
      payload: {
        from: message.from,
        to: message.to.join(', '),
        subject: message.subject,
        text: message.bodyText || message.snippet,
        // Additive context. `messageId` is what lets a workflow go back and read
        // the attachments without a second search.
        messageId: message.id,
        threadId: message.threadId,
        fromName: message.fromName,
        receivedAt: message.receivedAtISO,
        hasAttachments: message.hasAttachments,
        provider: row.provider,
        accountEmail,
        connectionId: row.connectionId,
      },
    });
    fired += result.fired;
  }
  // A fired run is queued work the cloud executor has to pick up; without this the
  // next idle tick would skip the fan-out and the run would sit until the floor.
  if (fired > 0) await signalPendingWork(env).catch(() => undefined);
  return fired;
}

// ---------------------------------------------------------------------------
// Reaching the open board
// ---------------------------------------------------------------------------

/**
 * Push the delta into every open canvas inbox tile bound to this mailbox.
 *
 * The tile stores the `filter` it was created with, which is what makes it a
 * reproducible view rather than a screenshot — so the delta is re-filtered PER
 * TILE before it is sent. A tile that says "unread from Acme" must not start
 * showing everything just because the transport changed from a pull to a push.
 *
 * Sent over the creation-session relay the board is already listening on. No new
 * channel, and explicitly no browser poll: a poll per open tile per tenant is the
 * recurring cost this whole design exists to avoid.
 */
async function pushToInboxTiles(
  db: Db,
  env: Env,
  row: WatchRow,
  accountEmail: string,
  provider: MailboxProvider,
  messages: MailboxMessage[],
): Promise<number> {
  const tiles = await db
    .select({
      sessionId: creationSessions.id,
      tenantId: creationSessions.tenantId,
      objectId: creationSessionObjects.id,
      canvasData: creationSessionObjects.canvasData,
    })
    .from(creationSessionObjects)
    .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
    .where(and(
      eq(creationSessions.tenantId, row.tenantId),
      eq(creationSessions.status, 'active'),
      eq(creationSessionObjects.kind, 'inbox'),
      sql`${creationSessionObjects.canvasData} ->> 'connectionId' = ${String(row.connectionId)}`,
    ))
    .limit(200);
  if (tiles.length === 0) return 0;

  let pushed = 0;
  for (const tile of tiles) {
    const data = (tile.canvasData ?? {}) as Record<string, unknown>;
    const matching = applyClientSideFilters(messages, tileQuery(data.filter));
    if (matching.length === 0) continue;
    await broadcastRoom(
      env.SESSION_ROOM,
      creationSessionRoomName(tile.tenantId, tile.sessionId),
      JSON.stringify({
        type: 'inbox.delta',
        objectId: tile.objectId,
        connectionId: row.connectionId,
        accountEmail,
        provider: provider.name,
        // The TRIAGE projection, exactly as `canvas_add_inbox` stores — the tile
        // must not end up holding two differently-shaped messages depending on
        // whether one arrived by push or by refresh.
        messages: toTriageMessages(matching),
        unread: matching.filter((m) => m.unread).length,
        fetchedAt: new Date().toISOString(),
      }),
    );
    pushed += 1;
  }
  return pushed;
}

/**
 * The tile's saved filter, in the shape the shared filter pass takes.
 *
 * Keys come from `canvas_add_inbox` (`q`/`unread`/`hasAttachments`/…) and are
 * mapped here rather than at the tile, because this is the only place the two
 * vocabularies meet and mapping it twice is how they would come to disagree.
 */
function tileQuery(raw: unknown): MailboxQuery {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (key: string): string | undefined => {
    const v = f[key];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  return {
    search: str('q'),
    from: str('from'),
    subject: str('subject'),
    unreadOnly: f.unread === true,
    hasAttachments: f.hasAttachments === true,
    afterISO: str('after'),
    beforeISO: str('before'),
  };
}

// ---------------------------------------------------------------------------
// Inbound notifications
// ---------------------------------------------------------------------------

export type PushOutcome =
  | { ok: true; drained: DrainResult[] }
  | { ok: false; status: 401 | 404 | 202; error: string };

/**
 * A Gmail Pub/Sub push.
 *
 * Addressed by a DEPLOYMENT secret rather than a per-mailbox token, because one
 * subscription serves every connected Gmail mailbox. The mailbox is named in the
 * base64 payload, so the token proves the caller and the payload picks the row.
 *
 * A payload naming a mailbox nobody has connected is answered 202 and not 404:
 * Pub/Sub retries a non-2xx for days, and there is nothing to retry for.
 */
export async function handleGmailPush(
  db: Db,
  env: Env,
  token: string,
  body: unknown,
): Promise<PushOutcome> {
  if (!env.GMAIL_PUSH_TOKEN || token !== env.GMAIL_PUSH_TOKEN) {
    return { ok: false, status: 401, error: 'Unrecognised push token.' };
  }
  const message = (body && typeof body === 'object' ? (body as { message?: { data?: string } }).message : undefined);
  const emailAddress = decodeGmailNotification(message?.data);
  if (!emailAddress) return { ok: false, status: 202, error: 'Notification named no mailbox.' };

  const rows = await db
    .select({ watch: mailboxWatches })
    .from(mailboxWatches)
    .innerJoin(mailboxConnections, eq(mailboxConnections.id, mailboxWatches.connectionId))
    .where(and(
      eq(mailboxWatches.provider, 'google'),
      eq(mailboxConnections.accountEmail, emailAddress),
    ));
  if (rows.length === 0) return { ok: false, status: 202, error: 'No watch for that mailbox.' };

  return { ok: true, drained: await drainAll(db, env, rows.map((r) => r.watch)) };
}

/**
 * Gmail's notification body is `{ message: { data: <base64 JSON> } }` and the JSON
 * is `{ emailAddress, historyId }`. The historyId is deliberately IGNORED: our own
 * stored cursor is the only one that knows what we have already read, and adopting
 * theirs would skip everything between the two.
 */
export function decodeGmailNotification(data: string | undefined): string | null {
  if (!data) return null;
  try {
    const padded = data.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const parsed = JSON.parse(json) as { emailAddress?: string };
    const email = String(parsed.emailAddress ?? '').trim().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

/**
 * A Microsoft Graph change notification.
 *
 * Addressed by the per-mailbox `pushToken`, and additionally required to echo it
 * as `clientState` — Graph guarantees that field is exactly what we set at
 * subscription time, so a caller who merely guessed the URL cannot produce it.
 * A mismatch is 401 rather than a silent skip; it means either a stale
 * subscription or somebody probing.
 */
export async function handleGraphPush(
  db: Db,
  env: Env,
  token: string,
  body: unknown,
): Promise<PushOutcome> {
  const notifications = (body && typeof body === 'object'
    ? (body as { value?: Array<{ clientState?: string; subscriptionId?: string }> }).value
    : undefined) ?? [];
  const [row] = await db
    .select()
    .from(mailboxWatches)
    .where(and(eq(mailboxWatches.pushToken, token), eq(mailboxWatches.provider, 'microsoft')))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: 'Unknown subscription.' };
  if (notifications.some((n) => String(n.clientState ?? '') !== row.pushToken)) {
    return { ok: false, status: 401, error: 'clientState did not match.' };
  }
  await db
    .update(mailboxWatches)
    .set({ lastNotifiedAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(mailboxWatches, row.tenantId, eq(mailboxWatches.id, row.id)));
  return { ok: true, drained: await drainAll(db, env, [row]) };
}

/** Drain a set of watches, isolated: one broken mailbox never stops the others. */
async function drainAll(db: Db, env: Env, rows: WatchRow[]): Promise<DrainResult[]> {
  const results: DrainResult[] = [];
  for (const row of rows) {
    try {
      results.push(await drainMailboxWatch(db, env, row));
    } catch (error) {
      reportCaughtError(error, { source: 'application/mailbox/mailboxWatch.ts', operation: 'drainAll' });
      results.push({ ...EMPTY_DRAIN, error: error instanceof Error ? error.message : 'drain failed' });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// The renewal sweep
// ---------------------------------------------------------------------------

export interface MailboxWatchSweepResult {
  renewed: number;
  rearmed: number;
  polled: number;
  fresh: number;
  failed: number;
  pruned: number;
}

/**
 * Keep every armed mailbox alive, and drain the ones nothing can notify.
 *
 * Runs on the frequent tick BEHIND the shared KV work-gate, which is the whole
 * cost argument: on an idle platform the tick never reaches Postgres at all, and
 * when it does this sweep is a single index seek over `(status, expires_at)` that
 * returns nothing. A tenant with no connected mailbox costs zero either way.
 *
 * Three jobs, in one scan because they select on the same column:
 *   • a subscription near expiry is PATCHed (Graph) or re-armed (Gmail);
 *   • one that cannot be extended is re-created from scratch;
 *   • a `poll`-mode watch — a Gmail mailbox on a deployment with no Pub/Sub topic —
 *     is DRAINED here, through the identical cursor and delta the push path uses.
 */
export async function runMailboxWatchSweep(env: Env, db: Db): Promise<MailboxWatchSweepResult> {
  const result: MailboxWatchSweepResult = { renewed: 0, rearmed: 0, polled: 0, fresh: 0, failed: 0, pruned: 0 };
  const renewBefore = new Date(Date.now() + RENEW_LEAD_MS);

  const due = await db
    .select()
    .from(mailboxWatches)
    .where(and(
      eq(mailboxWatches.status, 'active'),
      or(
        eq(mailboxWatches.mode, 'poll'),
        lt(mailboxWatches.expiresAt, renewBefore),
        // A push watch with no recorded expiry is one we cannot reason about;
        // re-arming it is the only way to learn when it dies.
        sql`${mailboxWatches.expiresAt} IS NULL`,
      ),
    ))
    .orderBy(asc(mailboxWatches.expiresAt))
    .limit(SWEEP_BATCH);

  for (const row of due) {
    try {
      if (row.mode === 'poll') {
        const drained = await drainMailboxWatch(db, env, row);
        result.polled += 1;
        result.fresh += drained.fresh;
        if (drained.error) result.failed += 1;
        continue;
      }
      const renewed = await renewOne(db, env, row);
      if (renewed === 'renewed') result.renewed += 1;
      else if (renewed === 'rearmed') result.rearmed += 1;
      else result.failed += 1;
    } catch (error) {
      result.failed += 1;
      reportCaughtError(error, { source: 'application/mailbox/mailboxWatch.ts', operation: 'runMailboxWatchSweep' });
    }
  }

  result.pruned = await pruneReceipts(db);
  return result;
}

/** Extend one subscription; fall back to a fresh registration when the provider
 *  says it cannot be extended (a lapsed Graph subscription 404s a PATCH). */
async function renewOne(db: Db, env: Env, row: WatchRow): Promise<'renewed' | 'rearmed' | 'failed'> {
  const token = await freshMailboxToken(db, env, row.tenantId, row.connectionId);
  if (!token.ok) {
    await recordWatchError(db, row.tenantId, row.connectionId, token.error);
    return 'failed';
  }
  const target = watchTarget(env, row.provider, row.pushToken);
  const extended = await token.provider.renewWatch(token.accessToken, registrationOf(row), target);
  if (extended) {
    await db
      .update(mailboxWatches)
      .set({
        subscriptionId: extended.subscriptionId,
        mode: extended.mode,
        expiresAt: extended.expiresAtMs ? new Date(extended.expiresAtMs) : null,
        status: 'active',
        lastError: null,
        updatedAt: new Date(),
      })
      .where(scopedToTenant(mailboxWatches, row.tenantId, eq(mailboxWatches.id, row.id)));
    return 'renewed';
  }
  const rearmed = await ensureMailboxWatch(db, env, row.tenantId, row.connectionId);
  return rearmed.ok ? 'rearmed' : 'failed';
}

/**
 * Drop receipts past the horizon either provider can replay across.
 *
 * Bounded per sweep rather than "delete everything old": an unbounded DELETE on a
 * table this write-heavy is exactly the statement that turns a five-minute tick
 * into a long-running transaction on a Free-tier endpoint.
 */
async function pruneReceipts(db: Db): Promise<number> {
  const horizon = new Date(Date.now() - RECEIPT_RETENTION_MS);
  const stale = await db
    .select({ id: mailboxPushReceipts.id })
    .from(mailboxPushReceipts)
    .where(lt(mailboxPushReceipts.createdAt, horizon))
    .orderBy(asc(mailboxPushReceipts.id))
    .limit(500);
  if (stale.length === 0) return 0;
  await db.delete(mailboxPushReceipts).where(inArray(mailboxPushReceipts.id, stale.map((r) => r.id)));
  return stale.length;
}

/**
 * Arm every connected mailbox that has no watch yet.
 *
 * The connect flow arms one directly, so this only ever picks up mailboxes
 * connected before push existed — and it is bounded and ordered so a deployment
 * with hundreds of them converges over a few ticks instead of spending one tick
 * entirely on backfill.
 */
export async function armUnwatchedMailboxes(env: Env, db: Db, limit = 10): Promise<number> {
  const rows = await db
    .select({ id: mailboxConnections.id, tenantId: mailboxConnections.tenantId })
    .from(mailboxConnections)
    .leftJoin(mailboxWatches, eq(mailboxWatches.connectionId, mailboxConnections.id))
    .where(and(eq(mailboxConnections.status, 'connected'), sql`${mailboxWatches.id} IS NULL`))
    .orderBy(desc(mailboxConnections.id))
    .limit(limit);

  let armed = 0;
  for (const row of rows) {
    const result = await ensureMailboxWatch(db, env, row.tenantId, row.id);
    if (result.ok) armed += 1;
  }
  return armed;
}

/** The cron entry point: arm what is unarmed, renew what is expiring, drain what
 *  nobody can notify. One sweep, because they are one machine. */
export async function runMailboxPushSweep(env: Env): Promise<MailboxWatchSweepResult & { armed: number }> {
  const db = buildDatabase(env);
  const armed = await armUnwatchedMailboxes(env, db);
  const swept = await runMailboxWatchSweep(env, db);
  return { ...swept, armed };
}

/** Re-exported so the routes can answer "is this mailbox live?" without importing
 *  the schema directly. */
export async function listWatchedConnections(db: Db, tenantId: number): Promise<MailboxWatchView[]> {
  const rows = await db
    .select()
    .from(mailboxWatches)
    .where(scopedToTenant(mailboxWatches, tenantId, isNotNull(mailboxWatches.id)))
    .orderBy(asc(mailboxWatches.connectionId));
  return rows.map(toWatchView);
}
