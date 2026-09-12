/**
 * Publishing and withdrawing a listing — the Stage gate over the build actually
 * being published, the immutable publication snapshot, and the hosted-listing
 * watch. Split out of `../creationListings.ts`, which re-exports the public names.
 */
import { and, eq } from 'drizzle-orm';
import {
  declaredLimits,
  isPublishable,
  resolveListingHarness,
  SNAPSHOT_REASON_PUBLICATION,
  SNAPSHOT_REASON_STAGE,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import { catalogItems, snapshots } from '../../../infrastructure/database/schema';
import { liveUrl, runStageChecks, type StageObject } from '../stageChecks';
import { deploymentProbe, systemDryRunProbe, voiceCloneProbe, watchHostedListing } from '../stageChecks.probe';
import { isSandboxApplicable, stageSandboxPayloadHash } from '../../../domain/marketplace/stageSandboxPayload';
import { resolveStageSandboxState } from '../stageSandboxRuns';
import { isHostedListing, recordHostedProbe, recordHostedWithdrawal } from '../creationListings.hosted';
import { invalidateListingCaches } from './cache';
import {
  ListingError,
  toView,
  type CreationListingView,
  type ListingBody,
  type ListingSnapshotPayload,
  type PublishInput,
} from './model';
import { buildSnapshotPayload } from './source';
import { resolveListingTarget, writeListingRow } from './target';

/**
 * Read a STAGED snapshot for promotion.
 *
 * Tenant-scoped and pinned to `reason = 'stage'` AND to this listing's registry
 * object: the id arrives from the client, and without all three a seller could
 * promote any snapshot in the database — including another tenant's private board —
 * into their own public listing.
 */
export async function stagedPayload(
  db: Db,
  tenantId: number,
  registryObjectId: string,
  snapshotId: string,
): Promise<ListingSnapshotPayload> {
  const [row] = await db
    .select({ payload: snapshots.payload })
    .from(snapshots)
    .where(and(
      eq(snapshots.id, snapshotId),
      eq(snapshots.tenantId, tenantId),
      eq(snapshots.objectId, registryObjectId),
      eq(snapshots.reason, SNAPSHOT_REASON_STAGE),
    ))
    .limit(1);
  const payload = (row?.payload ?? null) as ListingSnapshotPayload | null;
  if (!payload) throw new ListingError('That staged version no longer exists', 404);
  return payload;
}

/**
 * Publish, or re-publish, one canvas creation.
 *
 * Idempotent per source in the sense that matters: publishing the same object
 * twice UPDATES its listing (new snapshot, bumped version) rather than creating a
 * second row, so a seller who clicks twice does not end up competing with
 * themselves at two URLs.
 *
 * ── PUBLISHING WHAT WAS TESTED ───────────────────────────────────────────────────
 * `fromSnapshotId` names a STAGED snapshot to promote. Without it this re-reads the
 * live board, which means the thing that goes on sale is not the thing the checks
 * ran against — a seller stages v1.3, edits one card, presses Publish, and ships an
 * untested build under a tested version number. Promoting COPIES the staged payload
 * into a new `publication` snapshot rather than relabelling the staged row, so the
 * candidate stays in the rail and the sold copy is its own immutable record.
 *
 * ── THE GATE RUNS HERE, NOT ONLY IN THE PANEL ────────────────────────────────────
 * The Releases panel already refuses to publish while a blocker stands. That is the
 * seller's experience of the rule, and it is not the rule: a panel is a client, and a
 * gate that only exists in a client is a gate a different client does not have. So
 * the checks run again over the payload ACTUALLY BEING PUBLISHED and refuse it here.
 * It is also the only place the promoted build is in hand — a seller may stage v1.3,
 * edit a card, and publish without restaging.
 *
 * Every WARNING those checks produced is written onto the listing (`declared`), so
 * the limits the seller was shown are the limits the buyer reads.
 */
export async function publishCreationListing(
  db: Db,
  env: Env,
  input: PublishInput,
): Promise<CreationListingView> {
  const target = await resolveListingTarget(db, env, input);
  const { spec, existing, objectKind, name } = target;

  const payload = input.fromSnapshotId
    ? await stagedPayload(db, input.tenantId, target.registryObjectId, input.fromSnapshotId)
    : await buildSnapshotPayload(db, input.sessionId, input.objectId, name);

  const objects = (payload.objects ?? []) as readonly StageObject[];
  const strippedFields = payload.strippedFields ?? [];
  const harness = resolveListingHarness(spec.id, objectKind, target.delivery);

  // THE GATE: a runtime/media listing that has never been driven in a sandbox
  // for this EXACT build cannot go on sale. Matched on the payload hash, not on
  // `fromSnapshotId` — a seller who published straight from the live board
  // (never staged) has no matching run either way, which is what makes this a
  // real gate rather than one only a staged path goes through.
  const sandboxApplicable = isSandboxApplicable(harness);
  const sandbox = sandboxApplicable
    ? await resolveStageSandboxState(db, {
        tenantId: input.tenantId,
        // Only meaningful for the "edited since" wording lookup — a publish
        // straight from the live board (no `fromSnapshotId`) has no staged
        // snapshot to compare against, so there is nothing honest to pass here.
        snapshotId: input.fromSnapshotId ?? '',
        harness,
        payloadHash: await stageSandboxPayloadHash({ harness, delivery: target.delivery, objects, strippedFields }),
        sandboxApplicable,
      })
    : null;

  const checks = await runStageChecks({
    listingKind: spec.id,
    objectKind,
    objects,
    priceCents: target.priceCents,
    trial: target.trial,
    delivery: target.delivery,
    strippedFields,
    probe: deploymentProbe(),
    sandbox,
    voiceClone: voiceCloneProbe(db, input.tenantId),
    systemDryRun: harness === 'system' ? systemDryRunProbe(env) : null,
  });
  if (!isPublishable(checks)) {
    // 409 rather than 400: the request is well-formed and the seller is entitled to
    // make it — the CREATION is not ready. The panel shows the findings; the message
    // names the first one so a caller without a panel is not told merely "no".
    const first = checks.find((entry) => entry.severity === 'block');
    throw new ListingError(
      `This cannot go on sale yet — ${first?.label ?? 'a check refused it'}`,
      409,
    );
  }

  const [snapshot] = await db
    .insert(snapshots)
    .values({
      tenantId: input.tenantId,
      objectId: target.registryObjectId,
      // Publication IS the reason — this is the copy a stranger is served, and
      // calling it 'manual' would lose the one fact that explains why it may
      // never be deleted while a sale references it.
      reason: SNAPSHOT_REASON_PUBLICATION,
      payload: payload as unknown as Record<string, unknown>,
      createdBy: input.userId,
    })
    .returning({ id: snapshots.id });
  if (!snapshot) throw new ListingError('Could not snapshot the creation', 400);

  const body: ListingBody = {
    source: { sessionId: input.sessionId, objectId: input.objectId, objectKind },
    snapshotId: snapshot.id,
    launch: spec.launch,
    trial: target.trial,
    delivery: target.delivery,
    seller: { userId: input.userId, name: target.sellerName },
    declared: [...declaredLimits(checks)],
  };

  const row = await writeListingRow(db, input, target, body, {
    visibility: 'public',
    // A previously-PUBLISHED listing bumps; one that has only ever existed as a
    // staged draft starts at 1.0.0 on its first real publish rather than inheriting
    // the number its candidates were staged under.
    version: existing?.publishedAt ? bumpVersion(existing.version) : '1.0.0',
  });

  // A hosted listing that just went on sale is now something strangers depend on, so
  // it joins the standing watch — and its lifecycle clock is seeded from the probe
  // that just passed rather than from the first sweep to notice it hours later.
  // Re-publishing an existing hosted listing re-opens its shop window too.
  if (target.delivery === 'hosted') {
    const address = liveUrl(payload.objects as readonly StageObject[]);
    await Promise.all([
      recordHostedProbe(db, env, {
        tenantId: input.tenantId, listingId: row.id, url: address, ok: true,
      }),
      recordHostedWithdrawal(db, env, {
        tenantId: input.tenantId, listingId: row.id, withdrawn: false,
      }),
      address && target.projectId != null
        ? watchHostedListing(db, {
            tenantId: input.tenantId,
            projectId: target.projectId,
            projectName: name,
            deployedUrl: address,
          })
        : Promise.resolve(),
    ]);
  }

  await invalidateListingCaches(env, row.slug);
  return toView(row, body);
}

/** `1.0.0` → `1.1.0`. A re-publish is a new minor: the snapshot changed, and a
 *  buyer comparing what they hold against what is live needs the two to differ. */
export function bumpVersion(current: string): string {
  const [major, minor] = current.split('.').map((part) => Number.parseInt(part, 10));
  if (major == null || minor == null || !Number.isFinite(major) || !Number.isFinite(minor)) return '1.0.0';
  return `${major}.${minor + 1}.0`;
}

/**
 * Take a listing off the public catalogue.
 *
 * ── WHAT WITHDRAWING MEANS, FOR EACH OF THE TWO DELIVERIES ───────────────────────
 * The row and every sold snapshot stay. For a `copy` that settles it: the buyer holds
 * their own cards on their own board, `resolveListingAccess` keeps letting them
 * through on their licence, and the seller can never reach them again. Withdrawal is
 * a decision to stop SELLING and nothing more.
 *
 * For a `hosted` listing the same sentence is only half of one, because what the
 * buyer holds is ACCESS to an instance THE SELLER RUNS. Withdrawal still means the
 * storefront closes and existing subscribers keep working — but nothing here can make
 * the seller keep a cloud bill paid, so the platform records WHEN the shop window
 * closed and the hosted lifecycle (`creationListings.hosted.ts`) governs what
 * subscribers are owed if the address later goes dark. Explicitly NOT the same
 * timestamp: withdrawing is not abandoning, and starting an abandonment clock against
 * a seller who is still serving would be wrong on both facts.
 */
export async function unpublishCreationListing(
  db: Db,
  env: Env,
  tenantId: number,
  userId: string,
  listingId: string,
): Promise<void> {
  const [row] = await db
    .update(catalogItems)
    .set({ visibility: 'private', updatedAt: new Date() })
    .where(and(
      eq(catalogItems.id, listingId),
      eq(catalogItems.tenantId, tenantId),
      eq(catalogItems.publisherRef, userId),
    ))
    .returning({ slug: catalogItems.slug, body: catalogItems.body });
  if (!row) throw new ListingError('Listing not found', 404);
  if (isHostedListing(row.body as ListingBody | null)) {
    await recordHostedWithdrawal(db, env, { tenantId, listingId, withdrawn: true });
  }
  await invalidateListingCaches(env, row.slug);
}
