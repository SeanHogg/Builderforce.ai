/**
 * THE SPAWN FREE TRIAL — seven days, the free plan's tokens, no card, once per person.
 *
 * A player who has cleared the age line can start it from their account page by
 * naming a grown-up's email. Starting it:
 *   1. claims the PERSON's one trial (`users.spawn_trial_at`, set only while NULL,
 *      so two tabs or two workspaces cannot both win) — after checking the named
 *      grown-up has not already been given one for another account;
 *   2. writes the workspace's membership as `trial` with the week's window — the
 *      record that also stops this workspace ever trialling again;
 *   3. credits `SPAWN_TRIAL_TOKENS` (Builderforce's free-plan monthly allowance) to
 *      the Spawn wallet under a per-workspace reference, so a retry cannot double it;
 *   4. emails the grown-up, with the link that lets them join without the
 *      player's password (`spawnParentLink.ts`).
 *
 * The week closes by the clock (`getSpawnMembership` derives `trial_ended`). The
 * daily sweep sends the rest of the grown-up's emails — halfway, the last day, the
 * end — each at most once, and persists `trial_ended`. Joining at any point is the
 * ordinary membership checkout; the trial record stays on the row.
 *
 * Unused trial tokens stay in the wallet after the week, spendable once the
 * workspace joins — the same "credit does not expire" rule as every prepaid wallet.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { settings, users } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { sendSpawnParentEmail } from '../../infrastructure/email/spawnParentEmail';
import { sendLifecycleEmail } from '../email/sendEmail';
import { SPAWN_PLAN, SPAWN_TRIAL_DAYS, SPAWN_TRIAL_TOKENS, TYPICAL_BUILD_TOKENS } from './spawnCatalog';
import { assertSpawnAge } from './spawnAge';
import { SpawnError } from './spawnErrors';
import {
  getSpawnMembership, writeMembership,
  type SpawnMembership, type SpawnTrial, type SpawnTrialNotice,
} from './spawnMembership';
import { spawnParentUrl } from './spawnParentLink';
import { spawnWallet } from './spawnWallet';

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** What the account page and the desktop app show about the trial. */
export interface SpawnTrialView {
  /** May this player start one now? */
  available: boolean;
  /** Is one running now? */
  live: boolean;
  endsAt: string | null;
  daysLeft: number | null;
  parentEmail: string | null;
  days: number;
  tokens: number;
  /** About how many builds the trial's tokens make — the estimate the pack cards use. */
  builds: number;
}

const personKey = (userId: string) => `spawn:trial:u:${userId}`;

/** Has this person already had their trial (in any workspace)? */
export function personHadTrial(db: Db, env: Env | undefined, userId: string): Promise<boolean> {
  return getOrSetCached(env, personKey(userId), async () => {
    const [row] = await db.select({ at: users.spawnTrialAt }).from(users).where(eq(users.id, userId)).limit(1);
    return Boolean(row?.at);
  }, { kvTtlSeconds: 3600 });
}

export function spawnTrialView(membership: SpawnMembership, personUsed: boolean, now: Date = new Date()): SpawnTrialView {
  const trial = membership.trial;
  const live = membership.status === 'trial' && trial !== null;
  return {
    available: membership.status === 'none' && trial === null && !personUsed,
    live,
    endsAt: trial?.endsAt ?? null,
    daysLeft: live && trial ? Math.max(0, Math.ceil((Date.parse(trial.endsAt) - now.getTime()) / DAY_MS)) : null,
    parentEmail: trial?.parentEmail ?? null,
    days: SPAWN_TRIAL_DAYS,
    tokens: SPAWN_TRIAL_TOKENS,
    builds: Math.floor(SPAWN_TRIAL_TOKENS / TYPICAL_BUILD_TOKENS),
  };
}

/**
 * The grown-up email due now, or null. Only the LATEST due one: a sweep that missed
 * a day sends "ends tomorrow", not a stale "halfway" as well.
 */
export function dueTrialNotice(trial: SpawnTrial, now: Date): SpawnTrialNotice | null {
  const t = now.getTime();
  const end = Date.parse(trial.endsAt);
  const due: SpawnTrialNotice | null = t >= end ? 'ended'
    : t >= end - DAY_MS ? 'lastDay'
      : t >= Date.parse(trial.startedAt) + Math.floor(SPAWN_TRIAL_DAYS / 2) * DAY_MS ? 'midway'
        : null;
  return due && !trial.sent.includes(due) ? due : null;
}

interface Player { name: string; locale: string | null }

async function readPlayer(db: Db, userId: string): Promise<Player & { email: string }> {
  const [row] = await db.select({
    email: users.email, displayName: users.displayName, username: users.username, locale: users.locale,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new SpawnError('Sign in again to continue', 403, 'age_required');
  return {
    email: row.email,
    name: row.displayName?.trim() || row.username?.trim() || row.email.split('@')[0]!,
    locale: row.locale,
  };
}

function appUrlOf(env: Env): string {
  return env.APP_URL ?? 'https://builderforce.ai';
}

/** Email the grown-up one notice. True when it is settled (sent or opted out), false to retry. */
async function sendTrialNotice(
  db: Db, env: Env, input: { tenantId: number; trial: SpawnTrial; notice: SpawnTrialNotice; player: Player; now: Date },
): Promise<boolean> {
  const { trial, notice, player, now } = input;
  const parentUrl = await spawnParentUrl(env.JWT_SECRET, appUrlOf(env), { tenantId: input.tenantId, userId: trial.userId });
  const result = await sendLifecycleEmail(env, db, trial.parentEmail, 'onboarding_tips', (ctx) => {
    const number = new Intl.NumberFormat(ctx.locale);
    return sendSpawnParentEmail(env, trial.parentEmail, notice, {
      player: player.name,
      endDate: new Intl.DateTimeFormat(ctx.locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(trial.endsAt)),
      daysLeft: Math.max(0, Math.ceil((Date.parse(trial.endsAt) - now.getTime()) / DAY_MS)),
      trialDays: SPAWN_TRIAL_DAYS,
      tokens: number.format(SPAWN_TRIAL_TOKENS),
      builds: number.format(Math.floor(SPAWN_TRIAL_TOKENS / TYPICAL_BUILD_TOKENS)),
      price: new Intl.NumberFormat(ctx.locale, { style: 'currency', currency: SPAWN_PLAN.currency }).format(SPAWN_PLAN.monthlyCents / 100),
      parentUrl,
    }, ctx.unsubscribeUrl, ctx.locale);
  }, { storedLocale: player.locale, deliveryType: `spawn:trial:${notice}`, onDeliveryFailure: 'return' });
  return result !== 'failed';
}

export async function startSpawnTrial(
  db: Db, env: Env, input: { tenantId: number; userId: string; parentEmail: string }, now: Date = new Date(),
): Promise<SpawnTrialView> {
  await assertSpawnAge(db, env, input.userId);
  const parentEmail = input.parentEmail.trim().toLowerCase();
  const player = await readPlayer(db, input.userId);
  if (!EMAIL.test(parentEmail) || parentEmail === player.email.toLowerCase()) {
    throw new SpawnError('Enter a grown-up’s email address', 400, 'parent_email_invalid');
  }

  // Read fresh, not from the cache: this is the check that decides whether a free
  // week is handed out, and a five-minute-old 'none' must not be trusted for it.
  const membership = await getSpawnMembership(db, undefined, input.tenantId, now);
  if (membership.status !== 'none' || membership.trial) {
    throw new SpawnError('This workspace has already had its free trial', 409, 'trial_used');
  }
  // One trial per grown-up as well as per person: a fresh account with a fresh
  // email is easy for a player to make, a second grown-up much less so. A
  // uniqueness check has no tenant to filter by, so it is declared as such.
  const [familyHadOne] = await db.select({ id: settings.id }).from(settings)
    .where(acrossTenants(
      settings, 'global_uniqueness',
      and(eq(settings.feature, 'spawn_membership'), sql`${settings.value}->'trial'->>'parentEmail' = ${parentEmail}`)!,
    ))
    .limit(1);
  if (familyHadOne) throw new SpawnError('That grown-up’s email has already been used for a free trial', 409, 'trial_used');

  const claimed = await db.update(users).set({ spawnTrialAt: now })
    .where(and(eq(users.id, input.userId), isNull(users.spawnTrialAt)))
    .returning({ id: users.id });
  await invalidateCached(env, personKey(input.userId));
  if (claimed.length === 0) throw new SpawnError('You have already had your free trial', 409, 'trial_used');

  const trial: SpawnTrial = {
    startedAt: now.toISOString(),
    endsAt: new Date(now.getTime() + SPAWN_TRIAL_DAYS * DAY_MS).toISOString(),
    userId: input.userId,
    parentEmail,
    sent: [],
  };
  await writeMembership(db, env, input.tenantId, { status: 'trial', trial });
  await spawnWallet.credit(db, env, {
    tenantId: input.tenantId,
    amount: SPAWN_TRIAL_TOKENS,
    reference: `spawn:trial:t:${input.tenantId}`,
    memo: 'Free trial tokens',
    metadata: { kind: 'trial', userId: input.userId },
  });

  if (await sendTrialNotice(db, env, { tenantId: input.tenantId, trial, notice: 'start', player, now })) {
    trial.sent = ['start'];
    await writeMembership(db, env, input.tenantId, { trial });
  }
  return spawnTrialView(await getSpawnMembership(db, env, input.tenantId, now), true, now);
}

export interface TrialReminderResult { checked: number; sent: number; ended: number }

/** The daily sweep: each live trial's due grown-up email, and `trial_ended` once the week is over. */
export async function runSpawnTrialReminderSweep(db: Db, env: Env, now: Date = new Date()): Promise<TrialReminderResult> {
  const result: TrialReminderResult = { checked: 0, sent: 0, ended: 0 };
  // Every workspace's trial, DECLARED: the grown-up emails are owed to all of them.
  const rows = await db.select({ tenantId: settings.tenantId, value: settings.value })
    .from(settings)
    .where(acrossTenants(
      settings, 'scheduled_sweep',
      and(
        eq(settings.scope, 'tenant'),
        eq(settings.feature, 'spawn_membership'),
        sql`${settings.value}->>'status' = 'trial'`,
      )!,
    ));

  for (const row of rows) {
    const trial = (row.value as { trial?: SpawnTrial }).trial;
    if (!trial) continue;
    result.checked += 1;
    const notice = dueTrialNotice(trial, now);
    let sent = trial.sent;
    if (notice) {
      const player = await readPlayer(db, trial.userId);
      if (await sendTrialNotice(db, env, { tenantId: row.tenantId, trial, notice, player, now })) {
        sent = [...trial.sent, notice];
        result.sent += 1;
      }
    }
    const over = now.getTime() >= Date.parse(trial.endsAt);
    // Persist `trial_ended` only once its email is settled, so a failed send retries.
    const ended = over && sent.includes('ended');
    if (sent !== trial.sent || ended) {
      // Status named explicitly: left out, the write would keep the DERIVED
      // `trial_ended` of an expired week even when its email failed.
      await writeMembership(db, env, row.tenantId, { status: ended ? 'trial_ended' : 'trial', trial: { ...trial, sent } });
      if (ended) result.ended += 1;
    }
  }
  return result;
}

export function describeTrialReminders(result: TrialReminderResult): string | null {
  if (result.sent === 0 && result.ended === 0) return null;
  return `trials=${result.checked} emails=${result.sent} ended=${result.ended}`;
}
