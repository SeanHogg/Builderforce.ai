/**
 * THE 13+ LINE — Spawn is for players 13 and older.
 *
 * Asked once, as a birth MONTH (year + month), never a full date of birth: the
 * month is all an age check needs, and the day is personal data about a young
 * person that nothing here would ever read. It is stored on the person, not the
 * workspace, because age belongs to whoever is building — one workspace can hold
 * a parent and a teenager.
 *
 * The check is conservative on purpose. A birth month says the person was born
 * somewhere inside it, so they are treated as born on its LAST day: someone born in
 * March 2013 passes from April 2026, never in March, and nobody under 13 slips
 * through on the rounding.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { users } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { SPAWN_MIN_AGE } from './spawnCatalog';
import { SpawnError } from './spawnErrors';

export type SpawnAgeStatus = 'unknown' | 'ok' | 'too_young';

const ageKey = (userId: string) => `spawn:age:u:${userId}`;

/** Old enough, given a birth month and today? Pure — the rule, testable alone. */
export function isOldEnough(birthYear: number, birthMonth: number, today: Date, minAge = SPAWN_MIN_AGE): boolean {
  // The first day of the month AFTER the birth month, `minAge` years on: the first
  // day on which even someone born on the last day of the month has turned `minAge`.
  const clearsOn = Date.UTC(birthYear + minAge, birthMonth, 1); // month is 1-based → next month, 0-based
  return today.getTime() >= clearsOn;
}

/** A birth month a person could actually have, or null. */
export function readBirthMonth(year: unknown, month: unknown, today: Date): { year: number; month: number } | null {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  if (y < 1900 || Date.UTC(y, m - 1, 1) > today.getTime()) return null;
  return { year: y, month: m };
}

async function storedBirthMonth(db: Db, env: Env | undefined, userId: string): Promise<{ year: number; month: number } | null> {
  return getOrSetCached(env, ageKey(userId), async () => {
    const [row] = await db.select({ birthMonth: users.birthMonth }).from(users).where(eq(users.id, userId)).limit(1);
    if (!row?.birthMonth) return null;
    const born = new Date(row.birthMonth);
    return { year: born.getUTCFullYear(), month: born.getUTCMonth() + 1 };
  }, { kvTtlSeconds: 3600 });
}

export async function spawnAgeStatus(db: Db, env: Env | undefined, userId: string, today = new Date()): Promise<SpawnAgeStatus> {
  const born = await storedBirthMonth(db, env, userId);
  if (!born) return 'unknown';
  return isOldEnough(born.year, born.month, today) ? 'ok' : 'too_young';
}

/**
 * Record the person's birth month. Once recorded it is not editable here — a
 * check a player can answer again until it says yes is not a check. A mistake is
 * corrected by support, which is a person looking at it.
 */
export async function recordBirthMonth(
  db: Db,
  env: Env,
  input: { userId: string; year: unknown; month: unknown },
  today = new Date(),
): Promise<SpawnAgeStatus> {
  const existing = await spawnAgeStatus(db, env, input.userId, today);
  if (existing !== 'unknown') return existing;
  const born = readBirthMonth(input.year, input.month, today);
  if (!born) throw new SpawnError('Enter the month and year you were born', 400, 'age_required');
  const value = `${born.year}-${String(born.month).padStart(2, '0')}-01`;
  await db.update(users).set({ birthMonth: value }).where(eq(users.id, input.userId));
  await invalidateCached(env, ageKey(input.userId));
  return isOldEnough(born.year, born.month, today) ? 'ok' : 'too_young';
}

/** Refuse unless the person has said their age and it clears the line. */
export async function assertSpawnAge(db: Db, env: Env | undefined, userId: string): Promise<void> {
  const status = await spawnAgeStatus(db, env, userId);
  if (status === 'unknown') throw new SpawnError('Tell us your age before you start', 403, 'age_required');
  if (status === 'too_young') throw new SpawnError('Spawn is for players 13 and older', 403, 'too_young');
}
