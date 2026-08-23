/**
 * THE TWO LEVELS BENEATH A CAMPAIGN — ad sets, and the ads inside them.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────────
 * Every one of the nine ad networks implements `listAdSets` / `createAdSet` /
 * `updateAdSet` / `listAds` / `createAd` / `updateAd`, and the `ad_sets` and `ads`
 * tables have existed since 0470 — and NOTHING CONSUMED ANY OF IT. A grep for those
 * six methods outside `networks/` returned exactly one hit: the default ad set
 * `adsService.createAdCampaign` composes so a campaign on Reddit or X can deliver at
 * all. So a campaign could be created and then targeted only through that one default
 * set, and the audience a caller named in `AdSetDraft.targeting` had no surface that
 * could name it.
 *
 * It is a SEPARATE module rather than more of `adsService.ts` deliberately. That file
 * owns the account and the campaign; this one owns the two levels below. One reason to
 * change each: a new targeting dimension touches this file and not that one, and the
 * campaign service does not grow every time the ad level gains a field.
 *
 * ── WHAT IT OWNS THAT THE ADAPTERS MUST NOT ─────────────────────────────────────
 * **UTM stamping.** `AdDraft.destinationUrl` is tagged HERE, before it reaches any
 * adapter, so no adapter has to know about attribution and none of them can forget to.
 * That is the whole reason `adUtm.ts` was written and the reason it had zero callers
 * until now. The alternative — each of nine adapters tagging its own URLs — is nine
 * chances to ship an untagged campaign, and the one that forgets is discovered a month
 * later as a gap in a report.
 *
 * The tag itself belongs to the CAMPAIGN, not to the ad: `utm_campaign` is minted once
 * from the campaign's immutable identity and stored (migration 1113), so a rename
 * cannot split one campaign's history in two. An ad adds `utm_content` naming itself,
 * which is what lets one campaign's creatives be compared without a second tag scheme.
 *
 * ── LOCAL ROWS ARE A PROJECTION OF THE NETWORK ──────────────────────────────────
 * Reads go to the network and are mirrored into `ad_sets` / `ads` on the way past, the
 * same shape `adInsightsSync` uses for campaigns: the network is the source of truth
 * for everything a network owns, and a local edit that was never pushed is not a fact.
 * The mirror exists so `ad_insights` can hang off a real foreign key and so a panel can
 * render without a provider round trip.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { adCampaigns, adSets, ads } from '../../infrastructure/database/schema';
import type {
  AdCreativeRemote, AdDraft, AdPatch, AdSetDraft, AdSetPatch, AdSetRemote,
} from './adsProviders';
import {
  callerFor, write,
  type AdWriteOutcome, type ResolvedAdAccount,
} from './adsService';
import { appendUtmParams, utmCampaignFor, utmParamsFor, slugify } from './adUtm';

// ---------------------------------------------------------------------------
// The campaign's owned tag
// ---------------------------------------------------------------------------

/**
 * The stored tag for a campaign, minting and persisting it the first time it is
 * needed.
 *
 * WRITE-ONCE, and the `where` clause is what enforces it rather than a read-then-write
 * that two concurrent ad creates would both win. A campaign whose tag already exists
 * keeps it, whatever its name has become since.
 *
 * Returns `null` when the campaign is not one of ours to tag — an external id we have
 * never seen, or a row in another tenant. A null tag means the ad is created with the
 * caller's own URL untouched, which is the honest outcome: better an untagged click
 * than a click tagged to a campaign we cannot prove it belongs to.
 */
export async function ensureCampaignUtmTag(
  db: Db, tenantId: number, network: string, externalCampaignId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: adCampaigns.id, name: adCampaigns.name, utmCampaign: adCampaigns.utmCampaign })
    .from(adCampaigns)
    .where(scopedToTenant(
      adCampaigns, tenantId,
      and(eq(adCampaigns.platform, network), eq(adCampaigns.externalId, externalCampaignId)),
    ))
    .limit(1);
  if (!row) return null;
  if (row.utmCampaign) return row.utmCampaign;

  const tag = utmCampaignFor(network, externalCampaignId, row.name);
  await db
    .update(adCampaigns)
    .set({ utmCampaign: tag, updatedAt: new Date() })
    // `utm_campaign IS NULL` in the predicate, not just in the read above: two ads
    // created at once both see null, and only one of these updates may take effect.
    // The loser re-reads below rather than overwriting a tag that is already live on
    // somebody's destination URL.
    .where(scopedToTenant(adCampaigns, tenantId, and(eq(adCampaigns.id, row.id), isNull(adCampaigns.utmCampaign))));

  const [after] = await db
    .select({ utmCampaign: adCampaigns.utmCampaign })
    .from(adCampaigns)
    .where(scopedToTenant(adCampaigns, tenantId, eq(adCampaigns.id, row.id)))
    .limit(1);
  return after?.utmCampaign ?? tag;
}

/**
 * Tag one destination URL for one ad.
 *
 * `utm_content` names the AD, so two creatives in one campaign are distinguishable in
 * any analytics tool without a second tagging scheme. `appendUtmParams` never clobbers
 * a param the caller wrote themselves and returns an unparseable URL unchanged — an
 * untagged click is a gap in a report, a corrupted destination is money spent landing
 * nowhere.
 */
export function tagDestination(
  network: string, utmCampaign: string | null, adName: string, destinationUrl: string | null | undefined,
): string | null | undefined {
  if (!destinationUrl || !utmCampaign) return destinationUrl;
  return appendUtmParams(destinationUrl, {
    ...utmParamsFor(network, utmCampaign),
    ...(slugify(adName) ? { utm_content: slugify(adName) } : {}),
  });
}

// ---------------------------------------------------------------------------
// Ad sets
// ---------------------------------------------------------------------------

/** One ad set as a caller sees it: the network's truth plus our local row id. */
export interface AdSetRead extends AdSetRemote {
  /** The `ad_sets` row, once mirrored. Null when the mirror could not resolve a parent. */
  id: number | null;
}

/**
 * Mirror the ad sets a network reports into `ad_sets`, and return external id → row id.
 *
 * ONE query for the parents and ONE for the ids after the upserts — never a `returning`
 * per row, which on a driver with no pipelining is a round trip per ad set.
 */
async function mirrorAdSets(
  db: Db, tenantId: number, network: string, remote: readonly AdSetRemote[],
): Promise<Map<string, number>> {
  const withIds = remote.filter((set) => set.externalId);
  if (withIds.length === 0) return new Map();

  const campaignExternalIds = [...new Set(withIds.flatMap((set) => set.externalCampaignId ? [set.externalCampaignId] : []))];
  const campaignRows = campaignExternalIds.length === 0 ? [] : await db
    .select({ id: adCampaigns.id, externalId: adCampaigns.externalId })
    .from(adCampaigns)
    .where(scopedToTenant(
      adCampaigns, tenantId,
      and(eq(adCampaigns.platform, network), inArray(adCampaigns.externalId, campaignExternalIds)),
    ));
  const campaignId = new Map(campaignRows.flatMap((row) => row.externalId ? [[row.externalId, row.id] as const] : []));

  const now = new Date();
  for (const set of withIds) {
    const parent = set.externalCampaignId ? campaignId.get(set.externalCampaignId) ?? null : null;
    const values = {
      tenantId,
      campaignId: parent,
      externalId: set.externalId,
      name: set.name || set.externalId,
      targeting: set.targeting as unknown,
      bidStrategy: set.bidStrategy,
      bidCents: set.bidCents,
      dailyBudgetCents: set.dailyBudgetCents,
      status: set.status,
      updatedAt: now,
    };
    await db.insert(adSets).values(values).onConflictDoUpdate({
      target: [adSets.tenantId, adSets.externalId],
      set: {
        campaignId: parent,
        name: values.name,
        targeting: values.targeting,
        bidStrategy: values.bidStrategy,
        bidCents: values.bidCents,
        dailyBudgetCents: values.dailyBudgetCents,
        status: values.status,
        updatedAt: now,
      },
    });
  }

  const rows = await db
    .select({ id: adSets.id, externalId: adSets.externalId })
    .from(adSets)
    .where(scopedToTenant(adSets, tenantId, inArray(adSets.externalId, withIds.map((set) => set.externalId))));
  return new Map(rows.flatMap((row) => row.externalId ? [[row.externalId, row.id] as const] : []));
}

/**
 * Read one account's ad sets, optionally scoped to one campaign.
 *
 * Deliberately UNCACHED, for the same reason `readAdInsights` is: this is the read a
 * panel performs immediately after a write, and a five-minute cache would show the
 * operator the state before their own edit. The campaign LIST is cached because it is
 * read on every page load; ad sets are read when somebody opens a campaign.
 */
export async function readAdSets(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount,
  externalCampaignId?: string | null, actorKind: 'agent' | 'user' = 'user',
): Promise<AdSetRead[]> {
  const identity = await account.provider.identity(callerFor(db, env, tenantId, account, actorKind), account.fields);
  const remote = await account.provider.listAdSets(
    callerFor(db, env, tenantId, account, actorKind), account.fields, identity, externalCampaignId ?? null,
  );
  const ids = await mirrorAdSets(db, tenantId, account.provider.network, remote);
  return remote.map((set) => ({ ...set, id: ids.get(set.externalId) ?? null }));
}

export async function createAdSet(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount,
  draft: AdSetDraft, actorKind: 'agent' | 'user' = 'user',
): Promise<AdWriteOutcome<AdSetRead>> {
  return write(db, env, tenantId, account, 'createAdSet', async (identity) => {
    const created = await account.provider.createAdSet(
      callerFor(db, env, tenantId, account, actorKind), account.fields, draft, identity,
    );
    const ids = await mirrorAdSets(db, tenantId, account.provider.network, [created]);
    return { ...created, id: ids.get(created.externalId) ?? null };
  });
}

export async function updateAdSet(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount,
  externalId: string, patch: AdSetPatch, actorKind: 'agent' | 'user' = 'user',
): Promise<AdWriteOutcome<null>> {
  return write(db, env, tenantId, account, 'updateAdSet', async (identity) => {
    await account.provider.updateAdSet(
      callerFor(db, env, tenantId, account, actorKind), account.fields, externalId, patch, identity,
    );
    // The network accepted it, so the mirror may reflect it. Only the fields the patch
    // actually carried — writing `undefined` through would blank a column the caller
    // never mentioned.
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.dailyBudgetCents !== undefined) set.dailyBudgetCents = patch.dailyBudgetCents;
    if (patch.bidCents !== undefined) set.bidCents = patch.bidCents;
    if (patch.targeting !== undefined) set.targeting = patch.targeting;
    await db.update(adSets).set(set).where(scopedToTenant(adSets, tenantId, eq(adSets.externalId, externalId)));
    return null;
  });
}

// ---------------------------------------------------------------------------
// Ads
// ---------------------------------------------------------------------------

export interface AdRead extends AdCreativeRemote {
  id: number | null;
}

async function mirrorAds(
  db: Db, tenantId: number, remote: readonly AdCreativeRemote[],
): Promise<Map<string, number>> {
  const withIds = remote.filter((ad) => ad.externalId);
  if (withIds.length === 0) return new Map();

  const setExternalIds = [...new Set(withIds.flatMap((ad) => ad.externalAdSetId ? [ad.externalAdSetId] : []))];
  const setRows = setExternalIds.length === 0 ? [] : await db
    .select({ id: adSets.id, externalId: adSets.externalId })
    .from(adSets)
    .where(scopedToTenant(adSets, tenantId, inArray(adSets.externalId, setExternalIds)));
  const adSetId = new Map(setRows.flatMap((row) => row.externalId ? [[row.externalId, row.id] as const] : []));

  const now = new Date();
  for (const ad of withIds) {
    const parent = ad.externalAdSetId ? adSetId.get(ad.externalAdSetId) ?? null : null;
    const values = {
      tenantId,
      adSetId: parent,
      externalId: ad.externalId,
      name: ad.name || ad.externalId,
      headline: ad.headline,
      body: ad.body,
      callToAction: ad.callToAction,
      destinationUrl: ad.destinationUrl,
      status: ad.status,
      updatedAt: now,
    };
    await db.insert(ads).values(values).onConflictDoUpdate({
      target: [ads.tenantId, ads.externalId],
      set: {
        adSetId: parent,
        name: values.name,
        headline: values.headline,
        body: values.body,
        callToAction: values.callToAction,
        destinationUrl: values.destinationUrl,
        status: values.status,
        updatedAt: now,
      },
    });
  }

  const rows = await db
    .select({ id: ads.id, externalId: ads.externalId })
    .from(ads)
    .where(scopedToTenant(ads, tenantId, inArray(ads.externalId, withIds.map((ad) => ad.externalId))));
  return new Map(rows.flatMap((row) => row.externalId ? [[row.externalId, row.id] as const] : []));
}

export async function readAds(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount,
  externalAdSetId?: string | null, actorKind: 'agent' | 'user' = 'user',
): Promise<AdRead[]> {
  const identity = await account.provider.identity(callerFor(db, env, tenantId, account, actorKind), account.fields);
  const remote = await account.provider.listAds(
    callerFor(db, env, tenantId, account, actorKind), account.fields, identity, externalAdSetId ?? null,
  );
  const ids = await mirrorAds(db, tenantId, remote);
  return remote.map((ad) => ({ ...ad, id: ids.get(ad.externalId) ?? null }));
}

/**
 * Create one ad, with its destination URL tagged before any adapter sees it.
 *
 * The campaign is resolved from the ad set rather than asked for: a caller who had to
 * pass the campaign id alongside the ad set id could pass a mismatched pair, and the
 * tag would then attribute the click to a campaign that is not paying for it.
 */
export async function createAd(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount,
  draft: AdDraft, actorKind: 'agent' | 'user' = 'user',
): Promise<AdWriteOutcome<AdRead & { utmCampaign: string | null }>> {
  return write(db, env, tenantId, account, 'createAd', async (identity) => {
    const network = account.provider.network;

    // Which campaign owns the set this ad joins. From the local mirror, which the
    // ad-set read populated; a set nothing has mirrored yields a null tag rather than
    // a provider round trip on the write path.
    const [parent] = await db
      .select({ campaignExternalId: adCampaigns.externalId })
      .from(adSets)
      .innerJoin(adCampaigns, eq(adCampaigns.id, adSets.campaignId))
      .where(scopedToTenant(adSets, tenantId, eq(adSets.externalId, draft.externalAdSetId)))
      .limit(1);

    const utmCampaign = parent?.campaignExternalId
      ? await ensureCampaignUtmTag(db, tenantId, network, parent.campaignExternalId)
      : null;

    const created = await account.provider.createAd(
      callerFor(db, env, tenantId, account, actorKind), account.fields,
      { ...draft, destinationUrl: tagDestination(network, utmCampaign, draft.name, draft.destinationUrl) },
      identity,
    );
    const ids = await mirrorAds(db, tenantId, [created]);
    return { ...created, id: ids.get(created.externalId) ?? null, utmCampaign };
  });
}

export async function updateAd(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount,
  externalId: string, patch: AdPatch, actorKind: 'agent' | 'user' = 'user',
): Promise<AdWriteOutcome<null>> {
  return write(db, env, tenantId, account, 'updateAd', async (identity) => {
    await account.provider.updateAd(
      callerFor(db, env, tenantId, account, actorKind), account.fields, externalId, patch, identity,
    );
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.status !== undefined) set.status = patch.status;
    await db.update(ads).set(set).where(scopedToTenant(ads, tenantId, eq(ads.externalId, externalId)));
    return null;
  });
}
