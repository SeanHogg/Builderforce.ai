/**
 * The shared TARGETING vocabulary — who a campaign's money is spent on, in one shape
 * across every network.
 *
 * This is the same argument {@link ./adsNormalize}.mapObjective makes about what a
 * campaign is BUYING, applied to who it is buying it FROM. An objective that quietly
 * degrades to an adjacent one wastes a budget; a targeting dimension that is quietly
 * DROPPED does something worse — it spends the whole budget correctly, on the wrong
 * people, and every number downstream looks healthy while it happens. "Under-25s in
 * Germany" silently becoming "everyone, everywhere" is not a smaller campaign, it is a
 * different campaign, and nothing in a spend report can tell you it happened.
 *
 * So the contract here is the objective contract, drawn per DIMENSION:
 *
 *   1. ONE vocabulary. Geography, age, gender, interests, placements and devices, named
 *      once, so the canvas form, the MCP tool and the CMO agent all say the same words.
 *   2. Each adapter declares the dimensions it can actually PLACE, and
 *      {@link requireTargetingSupport} REFUSES by name anything else — before the call,
 *      not after the spend.
 *   3. A value outside the vocabulary is rejected at the edge by {@link parseTargeting},
 *      so "GB " or "AGE 18-24" cannot reach an adapter and be interpreted by six of
 *      them in five different ways.
 *
 * ── WHY THIS SET AND NOT MORE ────────────────────────────────────────────────
 * Six dimensions is the intersection every one of the nine networks can express in its
 * own words without an account-scoped id lookup this port cannot perform. Custom
 * audiences, pixel retargeting, lookalikes and keyword match types are all deliberately
 * ABSENT: each is an id on every network, so a shared NAME for it would be a name with
 * nothing behind it. Absent is honest; present-and-ignored is the failure above.
 */

import { AdsProviderError } from './adsNormalize';

/** The dimensions of a targeting spec, as a vocabulary an adapter can refuse by name. */
export const AD_TARGETING_DIMENSIONS = ['geo', 'age', 'gender', 'interests', 'placements', 'devices'] as const;
export type AdTargetingDimension = typeof AD_TARGETING_DIMENSIONS[number];

/** Which surfaces an ad may appear on — normalized to the five every network has a name
 *  for. A network that groups two of them together maps both onto its own one. */
export const AD_PLACEMENTS = ['feed', 'search', 'stories', 'video', 'audience_network'] as const;
export type AdPlacement = typeof AD_PLACEMENTS[number];

export const AD_DEVICES = ['mobile', 'desktop', 'tablet'] as const;
export type AdDevice = typeof AD_DEVICES[number];

/** Absent means "everyone", which is what every network does with no gender filter. */
export const AD_GENDERS = ['male', 'female'] as const;
export type AdGender = typeof AD_GENDERS[number];

/**
 * The youngest age any of these networks will let an advertiser ask for.
 *
 * Not a normalization convenience: below this the request is unlawful in most markets
 * these networks operate in, and every one of them rejects it. Refusing here means the
 * refusal names the reason instead of arriving as a vendor error code.
 */
export const AD_MIN_AGE = 13;
/** The top of every network's age model. At it, "65" means "65 and over". */
export const AD_MAX_AGE = 65;

/** Who a campaign's money is spent on. Every field optional; absent means unrestricted. */
export interface AdTargeting {
  /** ISO 3166-1 alpha-2, upper case — the one geographic unit all nine accept by NAME
   *  rather than by an account-scoped location id. */
  countries?: readonly string[];
  ageMin?: number;
  ageMax?: number;
  /** Absent means every gender. Never stored as an empty array, which would read as
   *  "no gender" — an audience of nobody. */
  genders?: readonly AdGender[];
  /** Interest or keyword PHRASES. Networks that need interest ids resolve them; those
   *  that cannot refuse the dimension rather than sending a phrase as an id. */
  interests?: readonly string[];
  placements?: readonly AdPlacement[];
  devices?: readonly AdDevice[];
}

export const EMPTY_TARGETING: AdTargeting = {};

const isPlacement = (value: unknown): value is AdPlacement =>
  typeof value === 'string' && (AD_PLACEMENTS as readonly string[]).includes(value);
const isDevice = (value: unknown): value is AdDevice =>
  typeof value === 'string' && (AD_DEVICES as readonly string[]).includes(value);
const isGender = (value: unknown): value is AdGender =>
  typeof value === 'string' && (AD_GENDERS as readonly string[]).includes(value);

export function isAdTargetingDimension(value: unknown): value is AdTargetingDimension {
  return typeof value === 'string' && (AD_TARGETING_DIMENSIONS as readonly string[]).includes(value);
}

/**
 * Which dimensions this spec actually CONSTRAINS.
 *
 * An absent key or an empty list is not a constraint, so it is not a dimension the
 * network has to support — asking Snapchat for "no device filter" must not be refused
 * for lacking device targeting it was never asked to apply.
 */
export function targetingDimensionsUsed(targeting: AdTargeting): AdTargetingDimension[] {
  const used: AdTargetingDimension[] = [];
  if (targeting.countries?.length) used.push('geo');
  if (targeting.ageMin != null || targeting.ageMax != null) used.push('age');
  if (targeting.genders?.length) used.push('gender');
  if (targeting.interests?.length) used.push('interests');
  if (targeting.placements?.length) used.push('placements');
  if (targeting.devices?.length) used.push('devices');
  return used;
}

/** True when nothing at all is constrained — the caller asked for everyone. */
export const isUntargeted = (targeting: AdTargeting): boolean =>
  targetingDimensionsUsed(targeting).length === 0;

/**
 * Refuse, by name, any dimension this network cannot place.
 *
 * The exact counterpart of `mapObjective`'s refusal, for the exact same reason: the
 * alternative is an adapter that builds its own targeting shape out of the fields it
 * recognises and leaves the rest on the floor, which is invisible at every layer above
 * it and only shows up as a bad month.
 */
export function requireTargetingSupport(
  provider: { label: string; targetingDimensions: readonly AdTargetingDimension[] },
  targeting: AdTargeting,
): void {
  const unsupported = targetingDimensionsUsed(targeting)
    .filter((dimension) => !provider.targetingDimensions.includes(dimension));
  if (unsupported.length === 0) return;
  throw new AdsProviderError(
    `${provider.label} cannot target by ${unsupported.join(', ')}. It can target by: `
    + `${provider.targetingDimensions.join(', ') || 'nothing this port can express'}. `
    + 'Drop that dimension or choose another network — it will not be applied silently.',
    400,
    false,
  );
}

/**
 * Map one dimension's VALUES onto a network's own enum, refusing any it has no name for.
 *
 * `requireTargetingSupport` answers "can this network target by placement at all"; this
 * answers "can it target the STORIES placement", which is a different question with the
 * same consequence. Meta has device platforms but no tablet; Reddit has placements but
 * no search results page. Mapping `tablet` onto `mobile` because it is nearby is the
 * silent-drop failure wearing a different hat — a request for tablet users answered
 * with a phone campaign, at full price.
 */
export function mapTargetingValues<T>(
  provider: { label: string },
  dimension: AdTargetingDimension,
  table: Readonly<Record<string, T | undefined>>,
  values: readonly string[],
): T[] {
  const mapped: T[] = [];
  for (const value of values) {
    const native = table[value];
    if (native === undefined) {
      throw new AdsProviderError(
        `${provider.label} has no "${value}" ${dimension}. It supports: `
        + `${Object.keys(table).join(', ')}. Choose one of those or another network — `
        + 'it will not be swapped for something nearby.',
        400,
        false,
      );
    }
    mapped.push(native);
  }
  return mapped;
}

/** The age window, defaulted to the network-legal bounds. Only reachable once the
 *  adapter has declared it supports `age`, so a default can never widen a refusal. */
export function ageWindow(targeting: AdTargeting): { min: number; max: number } {
  return {
    min: targeting.ageMin ?? AD_MIN_AGE,
    max: targeting.ageMax ?? AD_MAX_AGE,
  };
}

// ---------------------------------------------------------------------------
// Shared mechanics — the parts every adapter was writing out longhand
// ---------------------------------------------------------------------------

/**
 * One age bucket a network sells, with the real ages it covers.
 *
 * Six of the nine networks price age in FIXED BUCKETS rather than as a free window, and
 * every one of them names them differently (`AGE_18_24`, `18-24`, `AGE_RANGE_18_24`).
 * The NAMES are the network's business; the arithmetic over them is not, and it was
 * being retyped per adapter — four copies, one of which had quietly grown a different
 * rule than the other three.
 */
export interface AgeBucket {
  /** The network's own name for this bucket — the value that goes on the wire. */
  readonly key: string;
  readonly min: number;
  /** Inclusive top. A bucket that is open at the top uses {@link AD_MAX_AGE}. */
  readonly max: number;
}

/**
 * An age WINDOW → the buckets that are EXACTLY it, or a refusal naming the boundaries.
 *
 * This is the whole argument of this module applied to one dimension. A network that
 * sells 18-24 and 25-34 cannot express "20 to 30". The tempting move — send every bucket
 * that OVERLAPS — silently buys 18-34: a wider and more expensive audience than the one
 * asked for, invisible in every report afterwards, and indistinguishable from the
 * campaign simply performing poorly.
 *
 * So the window must LAND on bucket boundaries, and the refusal says which ones do.
 * Buckets are assumed contiguous and ascending, which is how every network's set is
 * declared; the slice between the matched ends is therefore the exact cover.
 */
export function bucketedAgeKeys(
  provider: { label: string },
  buckets: readonly AgeBucket[],
  targeting: AdTargeting,
): string[] {
  const { min, max } = ageWindow(targeting);
  const first = buckets.findIndex((bucket) => bucket.min === min);
  const last = buckets.findIndex((bucket) => bucket.max === max);
  if (first === -1 || last === -1 || first > last) {
    throw new AdsProviderError(
      `${provider.label} sells age in fixed buckets, so it cannot target exactly ${min}-${max}. `
      + `Use a window starting on one of ${buckets.map((b) => b.min).join(', ')} and `
      + `ending on one of ${buckets.map((b) => b.max).join(', ')} — it will not be rounded outwards.`,
      400,
      false,
    );
  }
  return buckets.slice(first, last + 1).map((bucket) => bucket.key);
}

/**
 * The buckets a network reports back → the window they cover.
 *
 * The READ counterpart, and deliberately forgiving where the write path is strict: a
 * campaign built in the network's own console may use buckets this port would refuse to
 * write, and reporting the window they add up to is better than reporting no age
 * targeting on an audience that is in fact narrowed. Null when none are recognised.
 */
export function ageFromBuckets(
  buckets: readonly AgeBucket[],
  keys: readonly string[],
): { min: number; max: number } | null {
  const known = buckets.filter((bucket) => keys.includes(bucket.key));
  if (known.length === 0) return null;
  return {
    min: Math.min(...known.map((bucket) => bucket.min)),
    max: Math.min(AD_MAX_AGE, Math.max(...known.map((bucket) => bucket.max))),
  };
}

/**
 * A mapping table read BACKWARDS — the network's value → our word.
 *
 * Every adapter that maps a dimension onto a native enum with {@link mapTargetingValues}
 * also has to read it back, and each was building the same inverted Map by hand. Entries
 * the network cannot express are declared `undefined` and dropped here, so a table is
 * written once, in one direction, and used in both.
 */
export function invertNativeTable<T extends string>(
  table: Readonly<Record<T, string | undefined>>,
): Map<string, T> {
  return new Map(
    (Object.entries(table) as Array<[T, string | undefined]>)
      .filter((entry): entry is [T, string] => entry[1] != null)
      .map(([ours, theirs]) => [theirs.toUpperCase(), ours]),
  );
}

/**
 * The network's reported values → our vocabulary, dropping anything unrecognised.
 *
 * The read-path partner of {@link mapTargetingValues}: that one REFUSES an unmappable
 * value because it is about to spend money on it, this one DISCARDS it because it is
 * only describing what already exists. Same table, opposite postures, both deliberate.
 */
export function readNativeValues<T extends string>(
  table: Readonly<Record<T, string | undefined>>,
  values: readonly string[],
): T[] {
  const byNative = invertNativeTable(table);
  return values
    .map((value) => byNative.get(value.toUpperCase()))
    .filter((value): value is T => value != null);
}

export type ParseTargetingResult =
  | { ok: true; targeting: AdTargeting }
  | { ok: false; error: string };

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
    .map((entry) => String(entry).trim())
    .filter(Boolean);

/**
 * Parse loose input — a JSON body, a query string, an MCP tool argument — into the
 * vocabulary, or say exactly what was wrong.
 *
 * ONE parser, for the reason `adCampaignQueryFrom` is one parser: a second copy is how
 * `countries: "gb"` comes to mean Great Britain on the canvas and nothing at all to an
 * agent. Returns a result rather than throwing, so a route answers 400 with the reason
 * — the same shape `resolveAdAccount` already uses.
 */
export function parseTargeting(input: unknown): ParseTargetingResult {
  if (input == null) return { ok: true, targeting: {} };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      error: 'Targeting must be an object with any of: countries, ageMin, ageMax, genders, interests, placements, devices.',
    };
  }
  const raw = input as Record<string, unknown>;
  const targeting: {
    countries?: string[]; ageMin?: number; ageMax?: number;
    genders?: AdGender[]; interests?: string[]; placements?: AdPlacement[]; devices?: AdDevice[];
  } = {};

  const countries = strings(raw.countries).map((entry) => entry.toUpperCase());
  const badCountry = countries.find((entry) => !/^[A-Z]{2}$/.test(entry));
  if (badCountry) {
    return { ok: false, error: `"${badCountry}" is not a country code. Use ISO 3166-1 alpha-2, e.g. US, GB, DE.` };
  }
  // Deduped: a country listed twice is one country, and several networks reject a
  // repeated location outright rather than ignoring the duplicate.
  if (countries.length) targeting.countries = [...new Set(countries)];

  for (const key of ['ageMin', 'ageMax'] as const) {
    if (raw[key] == null || raw[key] === '') continue;
    const age = Number(raw[key]);
    if (!Number.isInteger(age) || age < AD_MIN_AGE || age > AD_MAX_AGE) {
      return { ok: false, error: `${key} must be a whole number between ${AD_MIN_AGE} and ${AD_MAX_AGE}.` };
    }
    targeting[key] = age;
  }
  if (targeting.ageMin != null && targeting.ageMax != null && targeting.ageMin > targeting.ageMax) {
    // An inverted window is an EMPTY audience on every network: it delivers nothing and
    // reports nothing, which is indistinguishable from a campaign nobody happened to see.
    return { ok: false, error: 'ageMin cannot be greater than ageMax — that targets nobody.' };
  }

  const genders = strings(raw.genders).map((entry) => entry.toLowerCase());
  const badGender = genders.find((entry) => !isGender(entry));
  if (badGender) {
    return { ok: false, error: `"${badGender}" is not a gender. Use ${AD_GENDERS.join(' or ')}, or omit it for everyone.` };
  }
  // Every gender listed is not a constraint — it is the default, and storing it as one
  // would make an unrestricted set look targeted on every panel that reads it back.
  if (genders.length > 0 && genders.length < AD_GENDERS.length) targeting.genders = genders as AdGender[];

  const interests = strings(raw.interests);
  if (interests.length) targeting.interests = [...new Set(interests)];

  const placements = strings(raw.placements).map((entry) => entry.toLowerCase());
  const badPlacement = placements.find((entry) => !isPlacement(entry));
  if (badPlacement) {
    return { ok: false, error: `"${badPlacement}" is not a placement. Use one of: ${AD_PLACEMENTS.join(', ')}.` };
  }
  if (placements.length) targeting.placements = [...new Set(placements)] as AdPlacement[];

  const devices = strings(raw.devices).map((entry) => entry.toLowerCase());
  const badDevice = devices.find((entry) => !isDevice(entry));
  if (badDevice) {
    return { ok: false, error: `"${badDevice}" is not a device. Use one of: ${AD_DEVICES.join(', ')}.` };
  }
  if (devices.length) targeting.devices = [...new Set(devices)] as AdDevice[];

  return { ok: true, targeting };
}

/**
 * Read a spec back out of what we stored, or out of what a network reported.
 *
 * `ad_sets.targeting` is JSONB and a set created in the network's own console has a
 * shape this vocabulary has no name for — so this NEVER throws. It keeps what it
 * recognises and discards the rest, because on the READ path a partially understood
 * spec is strictly better than none, while on the WRITE path (above) a partially
 * understood spec is the entire bug this module exists to prevent.
 */
export function readTargeting(stored: unknown): AdTargeting {
  const parsed = parseTargeting(stored);
  return parsed.ok ? parsed.targeting : {};
}
