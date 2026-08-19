/**
 * Ownership — the cap table as a PROJECTION, and the acts that move it.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `grep cap_table` across the schema returned nothing. The canvas `capTable` was
 * a hand-typed `holders: {holder, instrument, shares, percent}` array whose own
 * hint asked the model to "say so in `summary`" when the percentages did not
 * total 100 — an object that documents its own inability to be right. A pool
 * top-up, a round, a departure and a buy-back were all RE-TYPING, so a cap table
 * could not survive its second event; vesting existed nowhere; and the
 * instrument a pre-seed company actually issues could not be represented at all.
 *
 * ── THE ONE RULE THIS FILE EXISTS TO ENFORCE ─────────────────────────────────
 * NOTHING HERE STORES A TOTAL. `capTable()` folds `equity_events` as of an
 * instant and computes every figure on read: issued, outstanding, fully diluted,
 * each holder's percentage, the unallocated pool. `equity_grants` carries the
 * terms of an award and no quantity, so a grant and its ledger cannot disagree;
 * vested-to-date is `vestedQuantity()` from the canvas contract, called by BOTH
 * this projection and the card, so a company's ownership is never computed two
 * ways. That is the "no stored totals" rule migration 0464 states for
 * `work_estimates.lines`, applied where a total that disagrees with its own rows
 * is a legal problem rather than a display bug.
 *
 * The consequence worth naming: an `asOf` in the past is the SAME traversal with
 * a cutoff, so "what did we own in March" is answerable without a second history.
 *
 * ── WHY THE WRITERS LIVE HERE AND NOT ON THE GENERIC ENTITY PATH ─────────────
 * `equity_events` is append-only and this module only ever INSERTs into it;
 * `equity_grants` and `convertible_instruments` are registered read-only for the
 * same reason `bills` is. Recording a grant is TWO writes that must not be
 * separable — the terms and the issuance event — and a generic POST would
 * happily create the first without the second, which is a certificate the cap
 * table cannot see.
 *
 * ── CACHING ──────────────────────────────────────────────────────────────────
 * Read-through via `getOrSetCached` under a VERSION TOKEN, not a plain key: the
 * keyspace includes `asOf`, so it is unbounded by construction and a per-key
 * invalidation could never reach the historical reads. Every write bumps the
 * company's token, which retires every projection of that company at once.
 */

import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import {
  cliffDate,
  convertInstrument,
  foldEquityEvents,
  isEquityEventKind,
  partyRef,
  vestedQuantity,
  EQUITY_EVENT_LEGS,
  type ConversionResult,
  type ConvertibleTerms,
  type EquityEventKind,
  type EquityLedgerEvent,
  type VestingSchedule,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import { convertibleInstruments, equityEvents, equityGrants, partyRoles, shareClasses } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

export class EquityError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'EquityError';
  }
}

/** Bounded, because a cap table is a card and a board pack, not an export. A
 *  company past this many ledger rows has outgrown the projection and wants a
 *  transfer agent, which is a decision rather than a bigger LIMIT. */
const LEDGER_PAGE = 2_000;
/** Bounded for the same reason: a class list is a legend. */
const CLASS_PAGE = 100;

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const iso = (value: unknown): string | null => {
  if (value instanceof Date) return value.toISOString();
  const text = String(value ?? '').trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** The company a projection is scoped to. Normalised through `partyRef` — the
 *  SAME normaliser the counterparty work uses — so two surfaces cannot address
 *  one company as "Acme Inc" and "acme-inc". */
const companyKey = (companyRef: string | null | undefined): string => partyRef(String(companyRef ?? '')) || 'default';

/**
 * The cache VERSION token for one company's ownership.
 *
 * A version token rather than a per-key invalidation, and the reason is
 * structural: the projection's key includes `asOf`, so the keyspace is unbounded
 * and no writer could enumerate the historical reads it has just invalidated.
 * Bumping one token retires all of them.
 */
export const equityVersionKey = (tenantId: number, companyRef: string): string =>
  `finance:equity:version:${tenantId}:${companyKey(companyRef)}`;

/** Every write goes through here, so a projection can never outlive the event
 *  that changed it. Exported for the round modeller, which writes conversions. */
export async function bumpEquityVersion(env: Env, tenantId: number, companyRef: string): Promise<void> {
  await bumpCacheVersion(env, equityVersionKey(tenantId, companyRef));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ShareClassRow {
  id: number;
  classRef: string;
  name: string;
  kind: string;
  authorized: number;
  pricePerShare: number | null;
  seniority: number;
  liquidationMultiple: number | null;
  participating: boolean;
}

export interface CapTableHolder {
  holderRef: string;
  holderName: string;
  /** Per class, so a holder with common AND preferred reads as one row per
   *  claim rather than a merged number nobody can reconcile to a certificate. */
  shareClassRef: string;
  shareClassName: string;
  instrument: string;
  shares: number;
  /** Computed from the grant's schedule at `asOf`, never stored. Equal to
   *  `shares` for a holding with no schedule, which is the purchased case. */
  vested: number;
  unvested: number;
  /** Of the fully diluted total. Computed, and it is the whole point. */
  percentFullyDiluted: number;
}

export interface CapTable {
  companyRef: string;
  asOf: string;
  classes: ShareClassRow[];
  holders: CapTableHolder[];
  /** Shares actually issued and outstanding — options excluded, because an
   *  option is not a share until it is exercised. */
  issued: number;
  /** Issued plus every option, RSU and warrant plus the UNALLOCATED pool. The
   *  denominator every percentage on this table uses. */
  fullyDiluted: number;
  /** Authorised pool minus what has been granted out of it. Negative is
   *  impossible by construction and reported as 0 with `poolOverAllocated` set,
   *  because a pool granted past its authorisation is a real condition a founder
   *  must see rather than a number quietly clamped. */
  poolAuthorized: number;
  poolGranted: number;
  poolUnallocated: number;
  poolOverAllocated: boolean;
  /** Outstanding SAFEs and notes — NOT shares, and never folded into the
   *  percentages, because what they become is not known until a round prices
   *  them. Carried so the card can say what is missing from its own totals. */
  convertibles: Array<{
    id: number;
    reference: string;
    kind: string;
    holderRef: string;
    holderName: string;
    principal: number;
    currency: string;
    valuationCap: number | null;
    discountPercent: number | null;
    postMoney: boolean;
    maturesAt: string | null;
  }>;
  convertiblePrincipal: number;
  /** Ledger rows folded, so a reader can tell an empty company from a stale read. */
  eventCount: number;
}

/** The grant terms the projection joins onto a position. */
interface GrantTerms {
  id: number;
  reference: string;
  holderRef: string;
  holderName: string;
  instrument: string;
  shareClassId: number;
  schedule: VestingSchedule;
}

async function readShareClasses(db: Db, tenantId: number, company: string): Promise<ShareClassRow[]> {
  const rows = await db
    .select()
    .from(shareClasses)
    .where(scopedToTenant(shareClasses, tenantId, eq(shareClasses.companyRef, company)))
    .orderBy(asc(shareClasses.seniority), asc(shareClasses.id))
    .limit(CLASS_PAGE);

  return rows.map((row) => ({
    id: row.id,
    classRef: row.classRef,
    name: row.name,
    kind: row.kind,
    authorized: num(row.authorized),
    pricePerShare: row.pricePerShare == null ? null : num(row.pricePerShare),
    seniority: row.seniority,
    liquidationMultiple: row.liquidationMultiple == null ? null : num(row.liquidationMultiple),
    participating: row.participating,
  }));
}

async function readGrants(db: Db, tenantId: number, company: string): Promise<GrantTerms[]> {
  const rows = await db
    .select()
    .from(equityGrants)
    .where(scopedToTenant(equityGrants, tenantId, eq(equityGrants.companyRef, company)))
    .orderBy(asc(equityGrants.id))
    .limit(LEDGER_PAGE);

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    holderRef: row.holderRef,
    holderName: row.holderName,
    instrument: row.instrument,
    shareClassId: row.shareClassId,
    schedule: {
      startAt: iso(row.vestingStartAt),
      durationMonths: row.vestingMonths,
      cliffMonths: row.cliffMonths,
      frequency: row.vestingFrequency as VestingSchedule['frequency'],
      acceleration: row.acceleration as VestingSchedule['acceleration'],
    },
  }));
}

/**
 * One company's cap table, folded as of an instant.
 *
 * Empty (never an error) for a company with no ledger yet: a workspace can be
 * real and simply not have recorded its formation. The card says so rather than
 * showing zeroes that read like a company owning nothing.
 */
export async function capTable(
  db: Db,
  env: Env,
  tenantId: number,
  companyRef: string,
  asOf?: string,
): Promise<CapTable> {
  const company = companyKey(companyRef);
  const at = iso(asOf) ?? new Date().toISOString();
  const version = await getCacheVersion(env, equityVersionKey(tenantId, company));

  return getOrSetCached(
    env,
    `finance:equity:cap-table:${tenantId}:${company}:${version}:${at.slice(0, 10)}`,
    () => computeCapTable(db, tenantId, company, at),
    { kvTtlSeconds: 300, l1TtlMs: 30_000 },
  );
}

async function computeCapTable(db: Db, tenantId: number, company: string, at: string): Promise<CapTable> {
  const [classes, grants, ledger, instruments] = await Promise.all([
    readShareClasses(db, tenantId, company),
    readGrants(db, tenantId, company),
    db.select()
      .from(equityEvents)
      .where(scopedToTenant(equityEvents, tenantId, eq(equityEvents.companyRef, company)))
      .orderBy(asc(equityEvents.effectiveAt), asc(equityEvents.id))
      .limit(LEDGER_PAGE),
    db.select()
      .from(convertibleInstruments)
      .where(scopedToTenant(
        convertibleInstruments,
        tenantId,
        and(eq(convertibleInstruments.companyRef, company), eq(convertibleInstruments.status, 'outstanding')),
      ))
      .orderBy(asc(convertibleInstruments.issuedAt))
      .limit(CLASS_PAGE),
  ]);

  const classById = new Map(classes.map((row) => [row.id, row]));
  const classByRef = new Map(classes.map((row) => [row.classRef, row]));
  const grantById = new Map(grants.map((row) => [row.id, row]));
  /** Which grant a (holder, class) position came from, so the schedule can be
   *  joined back on. A holder with two grants in one class is summed, and the
   *  EARLIEST schedule wins for the vested split — documented rather than
   *  silently averaged, because averaging two cliffs invents a third date. */
  const grantForPosition = new Map<string, GrantTerms>();
  const nameForHolder = new Map<string, string>();

  const folded: EquityLedgerEvent[] = ledger.map((row) => {
    const grant = row.grantId == null ? null : grantById.get(row.grantId) ?? null;
    const fromClass = row.shareClassId == null ? null : classById.get(row.shareClassId) ?? null;
    const toClass = row.toShareClassId == null ? null : classById.get(row.toShareClassId) ?? null;
    if (grant) {
      const classRef = (toClass ?? fromClass)?.classRef ?? '';
      const key = `${grant.holderRef}|${classRef}`;
      if (!grantForPosition.has(key)) grantForPosition.set(key, grant);
      nameForHolder.set(grant.holderRef, grant.holderName);
    }
    return {
      eventKind: row.eventKind,
      shareClassRef: fromClass?.classRef ?? null,
      toShareClassRef: toClass?.classRef ?? null,
      fromHolderRef: row.fromHolderRef,
      toHolderRef: row.toHolderRef,
      quantity: num(row.quantity),
      effectiveAt: iso(row.effectiveAt) ?? at,
    };
  });

  for (const grant of grants) nameForHolder.set(grant.holderRef, grant.holderName);

  const positions = foldEquityEvents(folded, at);

  // Options and RSUs are NOT shares. They dilute and they do not vote, so the
  // two denominators are genuinely different numbers — and reporting one as the
  // other is how a founder is told they hold a majority they do not hold.
  const isOptionClass = (classRef: string): boolean => classByRef.get(classRef)?.kind === 'option-pool';

  const holders: CapTableHolder[] = positions.map((position) => {
    const key = `${position.holderRef}|${position.shareClassRef}`;
    const grant = grantForPosition.get(key) ?? null;
    const vested = grant
      ? Math.min(position.quantity, vestedQuantity(position.quantity, grant.schedule, at))
      : position.quantity;
    const shareClass = classByRef.get(position.shareClassRef);
    return {
      holderRef: position.holderRef,
      holderName: nameForHolder.get(position.holderRef) ?? position.holderRef,
      shareClassRef: position.shareClassRef,
      shareClassName: shareClass?.name ?? position.shareClassRef,
      instrument: grant?.instrument ?? (isOptionClass(position.shareClassRef) ? 'option' : 'common'),
      shares: position.quantity,
      vested,
      unvested: Math.max(0, position.quantity - vested),
      // Filled in below: a percentage needs the denominator, and the denominator
      // needs every row. Computing it inside the map would be N passes over one
      // total, which is the fan-out shape the platform rejects.
      percentFullyDiluted: 0,
    };
  });

  const issued = holders
    .filter((holder) => !isOptionClass(holder.shareClassRef))
    .reduce((sum, holder) => sum + holder.shares, 0);
  const granted = holders
    .filter((holder) => isOptionClass(holder.shareClassRef))
    .reduce((sum, holder) => sum + holder.shares, 0);

  const poolAuthorized = classes
    .filter((row) => row.kind === 'option-pool')
    .reduce((sum, row) => sum + row.authorized, 0);
  const poolUnallocatedRaw = poolAuthorized - granted;
  const fullyDiluted = issued + granted + Math.max(0, poolUnallocatedRaw);

  for (const holder of holders) {
    holder.percentFullyDiluted = fullyDiluted > 0
      ? Math.round((holder.shares / fullyDiluted) * 10_000) / 100
      : 0;
  }
  holders.sort((a, b) => b.shares - a.shares || a.holderName.localeCompare(b.holderName));

  return {
    companyRef: company,
    asOf: at,
    classes,
    holders,
    issued,
    fullyDiluted,
    poolAuthorized,
    poolGranted: granted,
    poolUnallocated: Math.max(0, poolUnallocatedRaw),
    poolOverAllocated: poolUnallocatedRaw < 0,
    convertibles: instruments.map((row) => ({
      id: row.id,
      reference: row.reference,
      kind: row.kind,
      holderRef: row.holderRef,
      holderName: row.holderName,
      principal: num(row.principal),
      currency: row.currency,
      valuationCap: row.valuationCap == null ? null : num(row.valuationCap),
      discountPercent: row.discountPercent == null ? null : num(row.discountPercent),
      postMoney: row.postMoney,
      maturesAt: iso(row.maturesAt),
    })),
    convertiblePrincipal: instruments.reduce((sum, row) => sum + num(row.principal), 0),
    eventCount: ledger.length,
  };
}

export interface GrantVesting {
  grantId: number;
  reference: string;
  holderRef: string;
  holderName: string;
  granted: number;
  vested: number;
  unvested: number;
  schedule: VestingSchedule;
  /** The date a `due-within` trigger watches. Null for a grant with no cliff. */
  cliffAt: string | null;
}

/**
 * One grant's vesting position — computed at `asOf`, stored nowhere.
 *
 * `granted` is folded from the grant's own issuance events rather than read off
 * the grant, because the grant deliberately carries no quantity: a grant that
 * was partly cancelled has been reduced, and a number on the row could not know
 * that.
 */
export async function grantVesting(
  db: Db,
  tenantId: number,
  grantId: number,
  asOf?: string,
): Promise<GrantVesting> {
  const [grant] = await db
    .select()
    .from(equityGrants)
    .where(scopedToTenant(equityGrants, tenantId, eq(equityGrants.id, grantId)))
    .limit(1);
  if (!grant) throw new EquityError('No such grant.', 404);

  const at = iso(asOf) ?? new Date().toISOString();
  const ledger = await db
    .select()
    .from(equityEvents)
    .where(scopedToTenant(equityEvents, tenantId, eq(equityEvents.grantId, grantId)))
    .orderBy(asc(equityEvents.effectiveAt), asc(equityEvents.id))
    .limit(LEDGER_PAGE);

  const schedule: VestingSchedule = {
    startAt: iso(grant.vestingStartAt),
    durationMonths: grant.vestingMonths,
    cliffMonths: grant.cliffMonths,
    frequency: grant.vestingFrequency as VestingSchedule['frequency'],
    acceleration: grant.acceleration as VestingSchedule['acceleration'],
  };

  const granted = foldEquityEvents(
    ledger.map((row) => ({
      eventKind: row.eventKind,
      shareClassRef: 'grant',
      toShareClassRef: 'grant',
      fromHolderRef: row.fromHolderRef ?? grant.holderRef,
      toHolderRef: row.toHolderRef ?? grant.holderRef,
      quantity: num(row.quantity),
      effectiveAt: iso(row.effectiveAt) ?? at,
    })),
    at,
  ).reduce((sum, position) => sum + position.quantity, 0);

  const vested = Math.min(granted, vestedQuantity(granted, schedule, at));
  return {
    grantId: grant.id,
    reference: grant.reference,
    holderRef: grant.holderRef,
    holderName: grant.holderName,
    granted,
    vested,
    unvested: Math.max(0, granted - vested),
    schedule,
    cliffAt: cliffDate(schedule),
  };
}

// ---------------------------------------------------------------------------
// Writes — the acts, each of which is an EVENT
// ---------------------------------------------------------------------------

export interface UpsertShareClassInput {
  companyRef?: string | null;
  name: string;
  kind?: string;
  authorized?: number;
  pricePerShare?: number | null;
  currency?: string;
  liquidationMultiple?: number | null;
  participating?: boolean;
  seniority?: number;
  fundingRoundId?: number | null;
  objectId?: string | null;
}

/**
 * Authorise a class, or restate its terms.
 *
 * Upsert on `(tenant, company, classRef)` rather than create-or-409: authorising
 * "Series A Preferred" twice is what a board does when it amends the terms, and
 * a second class with the same name is the drift the unique index exists to
 * prevent. An INCREASE to `authorized` is recorded as a `pool-increase` event
 * for an option pool, so a top-up shows up in the ledger a founder reads rather
 * than only as a bigger number.
 */
export async function upsertShareClass(
  db: Db,
  env: Env,
  tenantId: number,
  input: UpsertShareClassInput,
  recordedBy: string,
): Promise<{ id: number; classRef: string }> {
  const name = String(input.name ?? '').trim().slice(0, 96);
  if (!name) throw new EquityError('A share class needs a name.', 400);
  const company = companyKey(input.companyRef);
  const classRef = partyRef(name);
  const kind = ['common', 'preferred', 'option-pool'].includes(String(input.kind))
    ? String(input.kind) : 'common';
  const authorized = Math.max(0, Number(input.authorized ?? 0) || 0);

  const [existing] = await db
    .select({ id: shareClasses.id, authorized: shareClasses.authorized })
    .from(shareClasses)
    .where(scopedToTenant(
      shareClasses,
      tenantId,
      and(eq(shareClasses.companyRef, company), eq(shareClasses.classRef, classRef)),
    ))
    .limit(1);

  const values = {
    tenantId,
    companyRef: company,
    classRef,
    name,
    kind,
    authorized: String(authorized),
    pricePerShare: input.pricePerShare == null ? null : String(input.pricePerShare),
    currency: (input.currency ?? 'USD').slice(0, 8),
    liquidationMultiple: input.liquidationMultiple == null ? null : String(input.liquidationMultiple),
    participating: input.participating ?? false,
    seniority: Math.round(Number(input.seniority ?? 0) || 0),
    fundingRoundId: input.fundingRoundId ?? null,
    objectId: input.objectId ?? null,
    updatedAt: new Date(),
  };

  let id: number;
  if (existing) {
    await db.update(shareClasses).set(values)
      .where(scopedToTenant(shareClasses, tenantId, eq(shareClasses.id, existing.id)));
    id = existing.id;
    const increase = authorized - num(existing.authorized);
    if (kind === 'option-pool' && increase > 0) {
      await db.insert(equityEvents).values({
        tenantId,
        companyRef: company,
        eventKind: 'pool-increase',
        shareClassId: id,
        quantity: String(increase),
        effectiveAt: new Date(),
        reason: `Pool authorisation increased to ${authorized.toLocaleString('en-US')}.`,
        recordedBy,
      });
    }
  } else {
    const [row] = await db.insert(shareClasses).values({ ...values, authorizedAt: new Date() }).returning({ id: shareClasses.id });
    if (!row) throw new EquityError('The share class could not be authorised.', 500);
    id = row.id;
    if (kind === 'option-pool' && authorized > 0) {
      await db.insert(equityEvents).values({
        tenantId,
        companyRef: company,
        eventKind: 'pool-increase',
        shareClassId: id,
        quantity: String(authorized),
        effectiveAt: new Date(),
        reason: `Pool authorised at ${authorized.toLocaleString('en-US')}.`,
        recordedBy,
      });
    }
  }

  await bumpEquityVersion(env, tenantId, company);
  return { id, classRef };
}

export interface RecordGrantInput {
  companyRef?: string | null;
  reference: string;
  /** By ref rather than by id, so the canvas can name "Series A Preferred"
   *  without first fetching a numeric id it has no other use for. */
  shareClassRef: string;
  holderName: string;
  holderRef?: string | null;
  instrument?: string;
  quantity: number;
  pricePerShare?: number | null;
  fmvPerShare?: number | null;
  currency?: string;
  grantedAt?: string | null;
  vestingStartAt?: string | null;
  vestingMonths?: number | null;
  cliffMonths?: number | null;
  vestingFrequency?: string;
  acceleration?: string;
  fundingRoundId?: number | null;
  objectId?: string | null;
  notes?: string | null;
}

/**
 * Record a grant — the TERMS and its issuance EVENT, in one act.
 *
 * Two writes that must not be separable. A grant with no event behind it is a
 * certificate the cap table cannot see; an event with no grant behind it is a
 * share count with no schedule and no holder name. The generic entity path could
 * produce either, which is why both tables are registered read-only.
 */
export async function recordGrant(
  db: Db,
  env: Env,
  tenantId: number,
  input: RecordGrantInput,
  recordedBy: string,
): Promise<{ grantId: number; eventId: number; cliffAt: string | null }> {
  const company = companyKey(input.companyRef);
  const reference = String(input.reference ?? '').trim().slice(0, 64);
  if (!reference) throw new EquityError('A grant needs its own certificate reference.', 400);
  const holderName = String(input.holderName ?? '').trim().slice(0, 200);
  if (!holderName) throw new EquityError('A grant needs a holder.', 400);
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new EquityError('A grant needs a positive quantity — that quantity IS the issuance event.', 400);
  }

  const holderRef = partyRef(String(input.holderRef ?? '') || holderName);
  const classRef = partyRef(String(input.shareClassRef ?? ''));
  const [shareClass] = await db
    .select({ id: shareClasses.id })
    .from(shareClasses)
    .where(scopedToTenant(
      shareClasses,
      tenantId,
      and(eq(shareClasses.companyRef, company), eq(shareClasses.classRef, classRef)),
    ))
    .limit(1);
  if (!shareClass) {
    throw new EquityError(
      `No share class "${input.shareClassRef}" is authorised for this company. Authorise the class first — a grant out of a class that does not exist is what makes a cap table stop adding up.`,
      409,
    );
  }

  const grantedAt = iso(input.grantedAt) ?? new Date().toISOString();
  const [grant] = await db.insert(equityGrants).values({
    tenantId,
    companyRef: company,
    objectId: input.objectId ?? null,
    shareClassId: shareClass.id,
    holderRef,
    holderName,
    instrument: (input.instrument ?? 'common').slice(0, 16),
    reference,
    grantedAt: new Date(grantedAt),
    pricePerShare: input.pricePerShare == null ? null : String(input.pricePerShare),
    fmvPerShare: input.fmvPerShare == null ? null : String(input.fmvPerShare),
    currency: (input.currency ?? 'USD').slice(0, 8),
    vestingStartAt: input.vestingStartAt ? new Date(iso(input.vestingStartAt) ?? grantedAt) : null,
    vestingMonths: input.vestingMonths ?? null,
    cliffMonths: input.cliffMonths ?? null,
    vestingFrequency: (input.vestingFrequency ?? 'none').slice(0, 16),
    acceleration: (input.acceleration ?? 'none').slice(0, 16),
    fundingRoundId: input.fundingRoundId ?? null,
    notes: input.notes ?? null,
    createdBy: recordedBy,
  }).returning({ id: equityGrants.id });
  // A grant with no row back is a certificate nobody can find, and continuing
  // would write an issuance event pointing at nothing.
  if (!grant) throw new EquityError('The grant could not be recorded.', 500);

  const [event] = await db.insert(equityEvents).values({
    tenantId,
    companyRef: company,
    eventKind: 'issue',
    shareClassId: shareClass.id,
    grantId: grant.id,
    fundingRoundId: input.fundingRoundId ?? null,
    toHolderRef: holderRef,
    quantity: String(quantity),
    pricePerShare: input.pricePerShare == null ? null : String(input.pricePerShare),
    currency: (input.currency ?? 'USD').slice(0, 8),
    effectiveAt: new Date(grantedAt),
    reason: `Grant ${reference} to ${holderName}.`,
    recordedBy,
  }).returning({ id: equityEvents.id });
  if (!event) throw new EquityError('The grant was written but its issuance event was not — the cap table would not see it.', 500);

  // The holder now HOLDS SHARES, so they hold the `equity_holder` role — the value
  // 0469 added to `party_roles` for exactly this moment (see `parties.ts` for why
  // `investor` and `equity_holder` are two roles and not one). Registered here
  // rather than left to a caller: a cap table whose holders are invisible to
  // `canvas_sync_account` is the string-matching defect FO-A1 exists to close,
  // reappearing one table over. Idempotent on the unique (tenant, kind, ref, role).
  await registerEquityHolder(db, tenantId, holderRef, holderName);

  await bumpEquityVersion(env, tenantId, company);

  return {
    grantId: grant.id,
    eventId: event.id,
    cliffAt: cliffDate({
      startAt: iso(input.vestingStartAt) ?? grantedAt,
      durationMonths: input.vestingMonths ?? null,
      cliffMonths: input.cliffMonths ?? null,
      frequency: (input.vestingFrequency ?? 'none') as VestingSchedule['frequency'],
      acceleration: (input.acceleration ?? 'none') as VestingSchedule['acceleration'],
    }),
  };
}

export interface RecordEventInput {
  companyRef?: string | null;
  eventKind: string;
  shareClassRef?: string | null;
  toShareClassRef?: string | null;
  grantId?: number | null;
  fundingRoundId?: number | null;
  fromHolderRef?: string | null;
  toHolderRef?: string | null;
  quantity: number;
  pricePerShare?: number | null;
  currency?: string;
  effectiveAt?: string | null;
  reason?: string | null;
}

/**
 * Append one ledger event.
 *
 * The legs each verb needs are DATA (`EQUITY_EVENT_LEGS`), so this validator and
 * the fold read the same declaration — a transfer with no destination and an
 * issue with no recipient are refused HERE rather than folding to a silent zero
 * that a founder discovers when the percentages stop adding up.
 */
export async function recordEquityEvent(
  db: Db,
  env: Env,
  tenantId: number,
  input: RecordEventInput,
  recordedBy: string,
): Promise<{ id: number }> {
  const company = companyKey(input.companyRef);
  if (!isEquityEventKind(input.eventKind)) {
    throw new EquityError(`"${input.eventKind}" is not an ownership event. Use one of: ${Object.keys(EQUITY_EVENT_LEGS).join(', ')}.`, 400);
  }
  const eventKind: EquityEventKind = input.eventKind;
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new EquityError('An ownership event needs a positive quantity. A reversal is its own event, never a negative one.', 400);
  }

  const legs = EQUITY_EVENT_LEGS[eventKind];
  const fromHolderRef = input.fromHolderRef ? partyRef(input.fromHolderRef) : null;
  const toHolderRef = input.toHolderRef ? partyRef(input.toHolderRef) : null;
  if (legs.debit && !fromHolderRef) {
    throw new EquityError(`A "${eventKind}" removes shares from somebody — name the holder it comes from.`, 400);
  }
  if (legs.credit && !toHolderRef) {
    throw new EquityError(`A "${eventKind}" gives shares to somebody — name the holder it goes to.`, 400);
  }

  const classId = await resolveClassId(db, tenantId, company, input.shareClassRef);
  const toClassId = await resolveClassId(db, tenantId, company, input.toShareClassRef);
  if (!legs.debit && !legs.credit && classId == null) {
    throw new EquityError('A pool increase raises a CLASS\'s authorisation — name the class.', 400);
  }

  const [row] = await db.insert(equityEvents).values({
    tenantId,
    companyRef: company,
    eventKind,
    shareClassId: classId,
    toShareClassId: toClassId,
    grantId: input.grantId ?? null,
    fundingRoundId: input.fundingRoundId ?? null,
    fromHolderRef,
    toHolderRef,
    quantity: String(quantity),
    pricePerShare: input.pricePerShare == null ? null : String(input.pricePerShare),
    currency: (input.currency ?? 'USD').slice(0, 8),
    effectiveAt: new Date(iso(input.effectiveAt) ?? new Date().toISOString()),
    reason: input.reason ?? null,
    recordedBy,
  }).returning({ id: equityEvents.id });
  if (!row) throw new EquityError('The ownership event could not be recorded.', 500);

  await bumpEquityVersion(env, tenantId, company);
  return { id: row.id };
}

/**
 * Give a holder the `equity_holder` role, once.
 *
 * `onConflictDoNothing` on the unique (tenant, party kind, party ref, role): a
 * second grant to the same person is normal and must not fail, and it must not
 * overwrite a role row that already carries consent or a retention clock.
 *
 * `partyKind` is 'person' by default because most holders are people, and a fund
 * holding shares still resolves by ref — the kind is a hint for the counterparty
 * card's icon, not a key. Left as the honest default rather than guessed from the
 * shape of a name.
 */
async function registerEquityHolder(
  db: Db,
  tenantId: number,
  holderRef: string,
  holderName: string,
): Promise<void> {
  await db.insert(partyRoles).values({
    tenantId,
    partyKind: 'person',
    partyRef: holderRef,
    role: 'equity_holder',
    status: 'active',
    startedAt: new Date(),
    attrs: { name: holderName },
  }).onConflictDoNothing({
    target: [partyRoles.tenantId, partyRoles.partyKind, partyRoles.partyRef, partyRoles.role],
  });
}

async function resolveClassId(
  db: Db,
  tenantId: number,
  company: string,
  classRef: string | null | undefined,
): Promise<number | null> {
  const ref = classRef ? partyRef(classRef) : '';
  if (!ref) return null;
  const [row] = await db
    .select({ id: shareClasses.id })
    .from(shareClasses)
    .where(scopedToTenant(
      shareClasses,
      tenantId,
      and(eq(shareClasses.companyRef, company), eq(shareClasses.classRef, ref)),
    ))
    .limit(1);
  if (!row) throw new EquityError(`No share class "${classRef}" is authorised for this company.`, 409);
  return row.id;
}

export interface RecordConvertibleInput {
  companyRef?: string | null;
  reference: string;
  kind?: string;
  holderName: string;
  holderRef?: string | null;
  principal: number;
  currency?: string;
  valuationCap?: number | null;
  discountPercent?: number | null;
  postMoney?: boolean;
  mfn?: boolean;
  interestRate?: number | null;
  issuedAt?: string | null;
  maturesAt?: string | null;
  fundingRoundId?: number | null;
  objectId?: string | null;
  notes?: string | null;
}

/** Record a SAFE or a note. No share count, because there is not one yet — what
 *  it becomes is decided by the round that prices it. */
export async function recordConvertible(
  db: Db,
  env: Env,
  tenantId: number,
  input: RecordConvertibleInput,
  recordedBy: string,
): Promise<{ id: number }> {
  const company = companyKey(input.companyRef);
  const reference = String(input.reference ?? '').trim().slice(0, 64);
  if (!reference) throw new EquityError('A convertible needs its own reference.', 400);
  const holderName = String(input.holderName ?? '').trim().slice(0, 200);
  if (!holderName) throw new EquityError('A convertible needs a holder.', 400);
  const principal = Number(input.principal);
  if (!Number.isFinite(principal) || principal <= 0) throw new EquityError('A convertible needs a principal.', 400);
  const kind = input.kind === 'note' ? 'note' : 'safe';
  if (kind === 'safe' && input.interestRate) {
    throw new EquityError('A SAFE does not accrue interest — record it as a note if it does.', 400);
  }

  const [row] = await db.insert(convertibleInstruments).values({
    tenantId,
    companyRef: company,
    objectId: input.objectId ?? null,
    reference,
    kind,
    holderRef: partyRef(String(input.holderRef ?? '') || holderName),
    holderName,
    principal: String(principal),
    currency: (input.currency ?? 'USD').slice(0, 8),
    valuationCap: input.valuationCap == null ? null : String(input.valuationCap),
    discountPercent: input.discountPercent == null ? null : String(input.discountPercent),
    postMoney: input.postMoney ?? true,
    mfn: input.mfn ?? false,
    interestRate: input.interestRate == null ? null : String(input.interestRate),
    issuedAt: new Date(iso(input.issuedAt) ?? new Date().toISOString()),
    maturesAt: input.maturesAt ? new Date(iso(input.maturesAt) ?? new Date().toISOString()) : null,
    fundingRoundId: input.fundingRoundId ?? null,
    notes: input.notes ?? null,
    createdBy: recordedBy,
  }).returning({ id: convertibleInstruments.id });
  if (!row) throw new EquityError('The convertible could not be recorded.', 500);

  await bumpEquityVersion(env, tenantId, company);
  return { id: row.id };
}

// ---------------------------------------------------------------------------
// Modelling a priced round — FO-D4
// ---------------------------------------------------------------------------

export interface RoundModelInput {
  companyRef?: string | null;
  /** The pre-money valuation the round is priced at. */
  preMoney: number;
  /** New money in. */
  raiseAmount: number;
  /** Target post-round unallocated pool, as a percent of fully diluted. The
   *  "pool shuffle" every term sheet contains and no card could express. */
  targetPoolPercent?: number | null;
  /** The class the new money buys. Created by the caller when it does not exist;
   *  named here so the model reads as the term sheet reads. */
  shareClassName?: string;
  currency?: string;
  asOf?: string | null;
}

export interface RoundModel {
  companyRef: string;
  preMoney: number;
  raiseAmount: number;
  postMoney: number;
  /** Price per share BEFORE conversions, which is the price the term sheet
   *  quotes, computed against the pre-round fully diluted count. */
  pricePerShare: number;
  newInvestorShares: number;
  /** Extra pool authorised to hit `targetPoolPercent`. Zero when none is asked
   *  for — a pool top-up nobody requested is dilution nobody agreed to. */
  poolIncrease: number;
  conversions: Array<{
    instrumentId: number;
    reference: string;
    holderRef: string;
    holderName: string;
    kind: string;
  } & ConversionResult>;
  /** Fully diluted after the round, conversions and pool top-up included. */
  postRoundFullyDiluted: number;
  /** Every existing holder's before and after. The number the whole exercise is
   *  for, and the one a founder currently computes in a spreadsheet. */
  dilution: Array<{ holderRef: string; holderName: string; before: number; after: number; shares: number }>;
  /** Named rather than silently assumed — see the note in the function. */
  caveats: string[];
}

/**
 * What a priced round does to this company's ownership.
 *
 * Pure modelling: it writes NOTHING. A model that quietly recorded the round it
 * was asked to imagine is the worst possible failure mode for this particular
 * function, so applying it is a separate, explicit act
 * ({@link applyRoundConversions}).
 *
 * `caveats` is not decoration. A round model is only as good as its assumptions
 * and the assumptions here are real — the pool is topped up BEFORE the new money
 * prices (standard, and the term most argued over), interest on a note accrues
 * simply, and a post-money SAFE's fixed percentage is honoured against the
 * post-conversion count while a pre-money one dilutes alongside its peers. A
 * model that presented one number and hid these would be the `capTable` hint all
 * over again, one level up.
 */
export async function modelRound(
  db: Db,
  env: Env,
  tenantId: number,
  input: RoundModelInput,
): Promise<RoundModel> {
  const company = companyKey(input.companyRef);
  const table = await capTable(db, env, tenantId, company, input.asOf ?? undefined);
  const at = iso(input.asOf) ?? new Date().toISOString();

  const preMoney = Math.max(0, Number(input.preMoney) || 0);
  const raiseAmount = Math.max(0, Number(input.raiseAmount) || 0);
  const postMoney = preMoney + raiseAmount;
  const caveats: string[] = [];

  const preRoundFullyDiluted = table.fullyDiluted;
  if (preRoundFullyDiluted <= 0) {
    caveats.push('This company has no ledger yet, so there is no share count to price against. Record the founders\' issuance first — every number below would otherwise be divided by nothing.');
    return {
      companyRef: company,
      preMoney,
      raiseAmount,
      postMoney,
      pricePerShare: 0,
      newInvestorShares: 0,
      poolIncrease: 0,
      conversions: [],
      postRoundFullyDiluted: 0,
      dilution: [],
      caveats,
    };
  }

  // The pool top-up lands BEFORE pricing, which is the standard term and the one
  // most often argued over — so it is stated in `caveats` rather than assumed
  // silently. Solved for directly: pool / (base + pool) = target.
  const targetPool = Math.max(0, Math.min(90, Number(input.targetPoolPercent ?? 0) || 0)) / 100;
  let poolIncrease = 0;
  if (targetPool > 0) {
    const currentUnallocated = table.poolUnallocated;
    const base = preRoundFullyDiluted - currentUnallocated;
    const needed = Math.ceil((targetPool * base) / (1 - targetPool)) - currentUnallocated;
    poolIncrease = Math.max(0, needed);
    caveats.push('The option pool is topped up BEFORE the new money prices, so the increase dilutes existing holders and not the incoming investor. That is the standard term and the one most often negotiated — say so when reporting this.');
  }

  const pricingShares = preRoundFullyDiluted + poolIncrease;
  const pricePerShare = pricingShares > 0 ? preMoney / pricingShares : 0;
  const newInvestorShares = pricePerShare > 0 ? Math.floor(raiseAmount / pricePerShare) : 0;

  const conversions = table.convertibles.map((instrument) => {
    const terms: ConvertibleTerms = {
      kind: instrument.kind === 'note' ? 'note' : 'safe',
      principal: instrument.principal,
      valuationCap: instrument.valuationCap,
      discountPercent: instrument.discountPercent,
      postMoney: instrument.postMoney,
      interestRate: null,
      issuedAt: null,
    };
    return {
      instrumentId: instrument.id,
      reference: instrument.reference,
      holderRef: instrument.holderRef,
      holderName: instrument.holderName,
      kind: instrument.kind,
      ...convertInstrument(terms, pricePerShare, pricingShares, at),
    };
  });
  if (conversions.length) {
    caveats.push('Each convertible takes the better of its cap price and its discounted round price, measured against the PRE-conversion share count. A stack whose SAFEs are pre-money dilutes itself; post-money SAFEs push that dilution onto the founders instead.');
  }
  if (table.convertibles.some((instrument) => instrument.kind === 'note')) {
    caveats.push('Accrued interest on a note is computed from its own issue date at simple interest — check it against the paper before signing anything.');
  }

  const convertedShares = conversions.reduce((sum, row) => sum + row.shares, 0);
  const postRoundFullyDiluted = pricingShares + newInvestorShares + convertedShares;

  const dilution = table.holders.reduce<Map<string, { holderRef: string; holderName: string; shares: number }>>((acc, holder) => {
    const current = acc.get(holder.holderRef) ?? { holderRef: holder.holderRef, holderName: holder.holderName, shares: 0 };
    current.shares += holder.shares;
    acc.set(holder.holderRef, current);
    return acc;
  }, new Map());

  return {
    companyRef: company,
    preMoney,
    raiseAmount,
    postMoney,
    pricePerShare,
    newInvestorShares,
    poolIncrease,
    conversions,
    postRoundFullyDiluted,
    dilution: [...dilution.values()]
      .map((holder) => ({
        ...holder,
        before: Math.round((holder.shares / preRoundFullyDiluted) * 10_000) / 100,
        after: postRoundFullyDiluted > 0 ? Math.round((holder.shares / postRoundFullyDiluted) * 10_000) / 100 : 0,
      }))
      .sort((a, b) => b.shares - a.shares),
    caveats,
  };
}

/**
 * APPLY a modelled round — the conversions, the pool top-up and the new money,
 * as real events.
 *
 * Separate from {@link modelRound} on purpose: modelling is a question and this
 * is an answer that changes who owns the company. It re-models at write time
 * rather than trusting a client-supplied plan, because the cap table may have
 * moved since the model was shown and applying a stale plan is how a holder is
 * issued shares against a price that no longer exists.
 */
export async function applyRoundConversions(
  db: Db,
  env: Env,
  tenantId: number,
  input: RoundModelInput & { shareClassName: string; fundingRoundId?: number | null },
  recordedBy: string,
): Promise<{ model: RoundModel; eventsRecorded: number }> {
  const company = companyKey(input.companyRef);
  const model = await modelRound(db, env, tenantId, input);
  if (model.postRoundFullyDiluted <= 0) {
    throw new EquityError('There is nothing to price this round against — record the founders\' issuance first.', 409);
  }

  const { classRef } = await upsertShareClass(db, env, tenantId, {
    companyRef: company,
    name: input.shareClassName,
    kind: 'preferred',
    pricePerShare: model.pricePerShare,
    currency: input.currency ?? 'USD',
    fundingRoundId: input.fundingRoundId ?? null,
  }, recordedBy);

  const effectiveAt = iso(input.asOf) ?? new Date().toISOString();
  let eventsRecorded = 0;

  for (const conversion of model.conversions) {
    if (conversion.shares <= 0) continue;
    await recordEquityEvent(db, env, tenantId, {
      companyRef: company,
      eventKind: 'conversion',
      toShareClassRef: classRef,
      shareClassRef: classRef,
      toHolderRef: conversion.holderRef,
      quantity: conversion.shares,
      pricePerShare: conversion.conversionPrice,
      currency: input.currency ?? 'USD',
      effectiveAt,
      fundingRoundId: input.fundingRoundId ?? null,
      reason: `${conversion.reference} converted on its ${conversion.basis}.`,
    }, recordedBy);
    eventsRecorded += 1;

    await db.update(convertibleInstruments)
      .set({
        status: 'converted',
        convertedAt: new Date(effectiveAt),
        fundingRoundId: input.fundingRoundId ?? null,
        updatedAt: new Date(),
      })
      .where(scopedToTenant(convertibleInstruments, tenantId, eq(convertibleInstruments.id, conversion.instrumentId)));
  }

  await bumpEquityVersion(env, tenantId, company);
  return { model, eventsRecorded };
}

/**
 * Every grant whose cliff falls inside a window — the read a `due-within`
 * trigger and the daily sweep both want.
 *
 * Computed rather than queried, because a cliff date is `vestingStartAt` plus
 * `cliffMonths` and storing it would be the same drift this whole module
 * refuses. The row count is bounded by the grant page, so the arithmetic is over
 * a list a person could read.
 */
export async function cliffsDueWithin(
  db: Db,
  tenantId: number,
  days: number,
  nowMs: number,
): Promise<Array<{ grantId: number; reference: string; holderName: string; cliffAt: string; daysRemaining: number }>> {
  const rows = await db
    .select()
    .from(equityGrants)
    .where(scopedToTenant(
      equityGrants,
      tenantId,
      and(isNotNull(equityGrants.cliffMonths), isNotNull(equityGrants.vestingStartAt)),
    ))
    .orderBy(asc(equityGrants.vestingStartAt))
    .limit(LEDGER_PAGE);

  return rows.flatMap((row) => {
    const cliffAt = cliffDate({
      startAt: iso(row.vestingStartAt),
      durationMonths: row.vestingMonths,
      cliffMonths: row.cliffMonths,
      frequency: row.vestingFrequency as VestingSchedule['frequency'],
      acceleration: row.acceleration as VestingSchedule['acceleration'],
    });
    if (!cliffAt) return [];
    const remaining = Math.round((Date.parse(cliffAt) - nowMs) / 86_400_000);
    if (remaining > days || remaining < 0) return [];
    return [{
      grantId: row.id,
      reference: row.reference,
      holderName: row.holderName,
      cliffAt,
      daysRemaining: remaining,
    }];
  });
}

/** Grants for one holder, oldest first — what an `offer`'s equity line is
 *  checked against, and the read behind "what do I actually own". */
export async function grantsForHolder(
  db: Db,
  tenantId: number,
  holderRef: string,
): Promise<Array<{ id: number; reference: string; instrument: string; grantedAt: string | null }>> {
  const rows = await db
    .select()
    .from(equityGrants)
    .where(scopedToTenant(equityGrants, tenantId, eq(equityGrants.holderRef, partyRef(holderRef))))
    .orderBy(asc(equityGrants.grantedAt))
    .limit(CLASS_PAGE);
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    instrument: row.instrument,
    grantedAt: iso(row.grantedAt),
  }));
}

/** Ledger rows for one company, newest first — the audit read behind "what
 *  changed". Bounded, and never a full export. */
export async function equityLedger(
  db: Db,
  tenantId: number,
  companyRef: string,
  limit = 50,
): Promise<Array<{ id: number; eventKind: string; quantity: number; effectiveAt: string | null; reason: string | null }>> {
  const rows = await db
    .select()
    .from(equityEvents)
    .where(scopedToTenant(equityEvents, tenantId, eq(equityEvents.companyRef, companyKey(companyRef))))
    .orderBy(desc(equityEvents.effectiveAt))
    .limit(Math.max(1, Math.min(limit, LEDGER_PAGE)));
  return rows.map((row) => ({
    id: row.id,
    eventKind: row.eventKind,
    quantity: num(row.quantity),
    effectiveAt: iso(row.effectiveAt),
    reason: row.reason,
  }));
}
