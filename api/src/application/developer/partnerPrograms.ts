/**
 * THE PROGRAMS — PRD 24 §6 Phase C and §7 Phase 4.
 *
 * §2.7's first observation is that distribution is the currency, and §2.1 is that
 * Lovable runs TWO tracks because a technology vendor and an agency want different
 * things: the vendor wants reach and co-marketing, the agency wants LEADS. This
 * module is that structure, and almost all of it is data.
 *
 * ── WHY THE BENEFITS ARE DATA AND NOT PROSE IN A COMPONENT ──────────────────
 * Every benefit listed here is either something the platform actually does or
 * something it does not. A marketing page that lists a benefit with no producer
 * is the defect this codebase already refuses by name — so each entry carries the
 * mechanism that delivers it, and `automated` says plainly whether that mechanism
 * is code or a human commitment. A reader can therefore tell "featured placement" (a real column, a
 * real ranking input) apart from "co-marketing" (a human commitment nothing in
 * the code can enforce), which is the distinction a partner about to sign
 * actually needs.
 *
 * ── AND WHY THE REV-SHARE NUMBERS ARE NOT HERE ──────────────────────────────
 * `feeSchedule(env)` in `finance/platformFees.ts` is the deployment's published
 * schedule, read from the SAME env vars the charge path reads. PRD 24 §9 decision
 * 1 asks for a threshold and the platform already has one — $200,000 lifetime,
 * 15% above it, 0% below — so this module PROJECTS that rather than declaring a
 * second one. A program page quoting its own numbers is how a partner is told one
 * rate and charged another.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tenants } from '../../infrastructure/database/schema';
import { bpsToPercent, feeSchedule } from '../finance/platformFees';
import { invalidatePublisher, PublisherError, requirePublisherRole } from './publishers';
import { invalidatePublicCatalog } from './extensionRepository';
import { isPartnerTrack, PARTNER_TRACKS, type PartnerTrack } from './extensionContract';

/**
 * One thing a track gives a partner, and what actually delivers it.
 *
 * `key` is a localization key's stem, not a sentence: the label a partner reads
 * is the frontend's, in their language. What lives here is the FACT — which
 * mechanism delivers it, and whether that mechanism is built.
 */
export interface TrackBenefit {
  key: string;
  /** The code, column or process that delivers this. Named so a claim is checkable. */
  mechanism: string;
  /** False for a benefit that is a human commitment rather than a platform feature. */
  automated: boolean;
}

export interface TrackDefinition {
  track: PartnerTrack;
  /** Who it is for, as a localization key stem. */
  audienceKey: string;
  benefits: readonly TrackBenefit[];
}

/**
 * The two tracks, plus the self-serve default.
 *
 * `none` is listed FIRST and is not a lesser state: §6 Phase B is open
 * registration at 0% rev-share, and most publishers should never need to apply
 * for anything. A program page that presented self-serve as the absence of a
 * program would push people into an application queue for benefits they already
 * have.
 */
export const TRACK_DEFINITIONS: readonly TrackDefinition[] = [
  {
    track: 'none',
    audienceKey: 'selfServe',
    benefits: [
      { key: 'openRegistration', mechanism: 'POST /api/developer/publisher — no application, no queue', automated: true },
      { key: 'zeroRevShare', mechanism: 'resolveTakeRateBps — 0% below the lifetime threshold', automated: true },
      { key: 'directoryListing', mechanism: 'searchDirectory + /integrations projection', automated: true },
      { key: 'installAnalytics', mechanism: 'GET /api/developer/analytics — aggregate only', automated: true },
    ],
  },
  {
    track: 'technology',
    audienceKey: 'vendors',
    benefits: [
      { key: 'featuredPlacement', mechanism: 'tenants.publisher_featured_at — a ranking input in catalogRanking', automated: true },
      { key: 'nativeBilling', mechanism: 'extensionCommerce — the customer is billed on their existing invoice', automated: true },
      { key: 'installWebhooks', mechanism: 'extension.installation.* on the publisher subscription', automated: true },
      // Stated as NOT automated on purpose. There is no code that writes a launch
      // post, and claiming it as a platform feature would be the listed-benefit-
      // with-no-producer defect this module's header refuses.
      { key: 'coMarketing', mechanism: 'a human commitment — joint launch post and changelog', automated: false },
      { key: 'engineeringSupport', mechanism: 'a human commitment — design-partner engineering hours (§6 Phase A)', automated: false },
    ],
  },
  {
    track: 'solutions',
    audienceKey: 'agencies',
    benefits: [
      // The agency track is pointed at rails that already exist and were simply
      // never aimed at agencies — §6 Phase C's whole point.
      { key: 'leadMatchmaking', mechanism: "the freelance rails: account_type='freelancer', engagements, project_role_assignments", automated: true },
      { key: 'revShare', mechanism: 'resolveTakeRateBps — the same schedule every seller is measured against', automated: true },
      { key: 'featuredPlacement', mechanism: 'tenants.publisher_featured_at — a ranking input in catalogRanking', automated: true },
      { key: 'enterpriseIntroductions', mechanism: 'a human commitment — enterprise implementation introductions', automated: false },
    ],
  },
];

export function trackDefinition(track: PartnerTrack): TrackDefinition {
  // `none` is guaranteed present, so this total function needs no null branch —
  // the array above is the whole domain of `PARTNER_TRACKS`.
  return TRACK_DEFINITIONS.find((d) => d.track === track) ?? TRACK_DEFINITIONS[0]!;
}

export interface RevShareSchedule {
  /** The rate above the threshold, in basis points AND as a percentage, because
   *  a partner reads one and a calculation uses the other. */
  bps: number;
  percent: number;
  thresholdCents: number;
  /** What is charged below the threshold. Always 0 — stated rather than implied,
   *  because "free until it is material" is the promise, and a promise that is
   *  only visible as the absence of a number is one nobody trusts. */
  belowThresholdBps: number;
}

/**
 * The deployment's published rev-share, projected from the one schedule.
 *
 * Not computed here. `feeSchedule` reads the SAME env vars `resolveTakeRateBps`
 * reads at the instant of a charge, so the number a partner is shown and the
 * number they are charged cannot drift.
 */
export function revShareSchedule(env: Env): RevShareSchedule {
  const schedule = feeSchedule(env);
  return {
    bps: schedule.configuredBps,
    percent: bpsToPercent(schedule.configuredBps),
    thresholdCents: schedule.thresholdCents,
    belowThresholdBps: 0,
  };
}

export interface PartnerStanding {
  track: PartnerTrack;
  featuredAtISO: string | null;
  definition: TrackDefinition;
  revShare: RevShareSchedule;
  /** Every track, so a publisher can see what they are not in without a second call. */
  tracks: readonly TrackDefinition[];
}

/** Where a publisher stands in the programs, and what every track offers. */
export async function partnerStanding(db: Db, env: Env, tenantId: number): Promise<PartnerStanding> {
  const [row] = await db
    .select({ track: tenants.publisherTrack, featuredAt: tenants.publisherFeaturedAt })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const track: PartnerTrack = isPartnerTrack(row?.track) ? row.track : 'none';
  return {
    track,
    featuredAtISO: row?.featuredAt ? new Date(row.featuredAt).toISOString() : null,
    definition: trackDefinition(track),
    revShare: revShareSchedule(env),
    tracks: TRACK_DEFINITIONS,
  };
}

/**
 * Put a publisher in a track, or take them out.
 *
 * ── WHY THIS IS AN OPERATOR ACTION AND NOT SELF-SERVE ───────────────────────
 * §2.1: the funnel that works has a HUMAN at the top — apply, sign, build with
 * support, launch together. A self-serve "join the technology partner track"
 * button would hand out Featured placement to anybody who pressed it, which is
 * the one benefit here whose whole value is that not everybody has it.
 *
 * So the caller must be an operator, and this function takes the decision as
 * already made. Self-serve publishing is unaffected and remains the default —
 * `none` is a track, and it is the one that needs no permission.
 */
export async function setPartnerTrack(
  db: Db,
  env: Env,
  input: { tenantId: number; track: string; featured?: boolean },
): Promise<PartnerStanding> {
  if (!isPartnerTrack(input.track)) {
    throw new PublisherError(`track must be one of: ${PARTNER_TRACKS.join(', ')}`);
  }
  const [row] = await db
    .update(tenants)
    .set({
      publisherTrack: input.track,
      // Featured is set explicitly or left alone. Leaving it alone on a track
      // change is deliberate: demoting a partner out of a track should not
      // silently pull a listing off the front page in the same click, because
      // those are two decisions and only one of them was made.
      publisherFeaturedAt: input.featured === undefined
        ? undefined
        : (input.featured ? new Date() : null),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, input.tenantId))
    .returning({ id: tenants.id });
  if (!row) throw new PublisherError('workspace not found', 404);

  await invalidatePublisher(env, input.tenantId);
  // Featured placement is a ranking input, and the directory is cached.
  if (input.featured !== undefined) await invalidatePublicCatalog(env);
  return partnerStanding(db, env, input.tenantId);
}

/**
 * The publisher's own view of the programs.
 *
 * Requires membership but no particular authority: what the tracks OFFER is
 * public information a vendor is entitled to read before deciding whether to
 * apply, and gating it behind `manager` would mean the person evaluating the
 * program is usually not the person who can see it.
 */
export async function partnerStandingFor(
  db: Db,
  env: Env,
  tenantId: number,
  actorUserId: string,
): Promise<PartnerStanding> {
  await requirePublisherRole(db, tenantId, actorUserId, 'viewer');
  return partnerStanding(db, env, tenantId);
}
