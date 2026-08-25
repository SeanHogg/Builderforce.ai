/**
 * The platform's shared vocabularies — company stages and countries
 * (PRD 19 §9).
 *
 * ── WHY REFERENCE DATA NEEDS A READER AT ALL ────────────────────────────────
 * `stage_lookup` and `countries` are the two tables in this schema with NO
 * `tenant_id` at all: they are the platform's own vocabulary, the axis that makes
 * two tenants' "Series A" the same thing and two tenants' "GB" the same place.
 * BurnRateOS's `lookups` and `system` modules read them; Builderforce declared
 * them and never did, which meant every surface that needed a stage list either
 * hardcoded one or shipped without.
 *
 * Hardcoding is the failure this closes. A stage list in a component and a stage
 * list in a report drift within one release, and then a filter silently excludes
 * a stage that exists.
 *
 * ── THE DISTINCTION `stage_lookup` EXISTS TO HOLD ───────────────────────────
 * Its docstring is explicit: this is the shared axis a tenant SELECTS FROM, while
 * a tenant's own stages are `pipeline_stages` rows. So this module offers no
 * per-tenant write path — a tenant that wants its own stage adds a
 * `pipeline_stages` row, and letting them add to the shared axis instead is
 * exactly how the axis stops being shared.
 *
 * ── `is_supported` IS A COMPLIANCE ANSWER, NOT A GEOGRAPHY ONE ──────────────
 * `countries.is_supported` says whether the platform SELLS there. {@link countries}
 * therefore returns every country with the flag rather than filtering, and
 * {@link supportedCountries} is the separate, explicit call — a signup form that
 * silently omits a country tells the visitor nothing, while one that shows it
 * disabled can offer the region waitlist instead.
 *
 * ── CACHED, BECAUSE THIS IS READ CONSTANTLY AND WRITTEN ALMOST NEVER ────────
 * Both vocabularies change a handful of times a year and are read on nearly every
 * form. They go through the canonical read-through cache, the same way
 * `termsAcceptance` serves the active terms version, rather than hitting Postgres
 * for a list of 250 rows that has not changed since the deploy.
 */

import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { countries as countriesTable, stageLookup } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';

/** Bump when a migration publishes new reference rows — SQL cannot invalidate KV,
 *  so a namespace change is what stops a deploy serving yesterday's vocabulary
 *  for up to a day. Same device `ACTIVE_TERMS_KEY` uses. */
const STAGES_KEY = 'vocab:stages:v1';
const COUNTRIES_KEY = 'vocab:countries:v1';

/** A day. These change a few times a year; the writer invalidates explicitly. */
const TTL_SECONDS = 86_400;

export type Stage = {
  key: string;
  label: string;
  category: string;
  position: number;
  description: string | null;
};

export type Country = {
  code: string;
  code3: string | null;
  name: string;
  region: string | null;
  currency: string | null;
  callingCode: string | null;
  isSupported: boolean;
};

async function loadStages(db: Db, category: string): Promise<Stage[]> {
  return db
    .select({
      key: stageLookup.key,
      label: stageLookup.label,
      category: stageLookup.category,
      position: stageLookup.position,
      description: stageLookup.description,
    })
    .from(stageLookup)
    .where(eq(stageLookup.category, category))
    .orderBy(asc(stageLookup.position), asc(stageLookup.key));
}

/**
 * The platform-wide stage vocabulary for a category.
 *
 * `category` defaults to `company`, which is what `companies.stage` selects from.
 * Pass `env` to serve from cache; omit it (tests, scripts) to always read through.
 */
export async function stages(db: Db, env?: Env, category = 'company'): Promise<Stage[]> {
  if (!env) return loadStages(db, category);
  return getOrSetCached<Stage[]>(
    env,
    `${STAGES_KEY}:${category}`,
    () => loadStages(db, category),
    { kvTtlSeconds: TTL_SECONDS },
  );
}

/** Resolve one stage key to its label, or null when the key is not in the
 *  vocabulary. Null rather than the key itself: rendering an unknown key as if it
 *  were a label is how a typo becomes a stage nobody can filter by. */
export async function stageLabel(db: Db, env: Env | undefined, key: string, category = 'company'): Promise<string | null> {
  const all = await stages(db, env, category);
  return all.find((s) => s.key === key)?.label ?? null;
}

async function loadCountries(db: Db): Promise<Country[]> {
  return db
    .select({
      code: countriesTable.code,
      code3: countriesTable.code3,
      name: countriesTable.name,
      region: countriesTable.region,
      currency: countriesTable.currency,
      callingCode: countriesTable.callingCode,
      isSupported: countriesTable.isSupported,
    })
    .from(countriesTable)
    .orderBy(asc(countriesTable.name));
}

/** Every country, each carrying whether the platform sells there. Unfiltered on
 *  purpose — see the module docstring. */
export async function countries(db: Db, env?: Env): Promise<Country[]> {
  if (!env) return loadCountries(db);
  return getOrSetCached<Country[]>(env, COUNTRIES_KEY, () => loadCountries(db), { kvTtlSeconds: TTL_SECONDS });
}

/** Only the countries the platform sells in — the explicit call, so that omitting
 *  a country is always a decision at the call site rather than a default. */
export async function supportedCountries(db: Db, env?: Env): Promise<Country[]> {
  return (await countries(db, env)).filter((c) => c.isSupported);
}

/** One country by ISO-3166 alpha-2, or null. */
export async function country(db: Db, env: Env | undefined, code: string): Promise<Country | null> {
  const needle = code.trim().toUpperCase();
  return (await countries(db, env)).find((c) => c.code === needle) ?? null;
}

/** Call after a migration or an operator edit publishes new reference rows.
 *  Best-effort, like every other cache invalidation in this codebase. */
export async function invalidateVocabulary(env: Env | undefined, category = 'company'): Promise<void> {
  if (!env) return;
  await Promise.all([
    invalidateCached(env, `${STAGES_KEY}:${category}`).catch(() => undefined),
    invalidateCached(env, COUNTRIES_KEY).catch(() => undefined),
  ]);
}
