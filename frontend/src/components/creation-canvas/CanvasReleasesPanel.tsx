/**
 * BUILD → STAGE → LIVE, for one canvas creation.
 *
 * ── WHAT WAS MISSING ─────────────────────────────────────────────────────────────
 * Publishing wrote the listing, an immutable snapshot and the registry row in one
 * press, so the first time a seller saw the buyer's view of their own creation was
 * on the public URL that was already selling it. The snapshots were all still there
 * — every version of every listing, complete — and nothing read them: no history, no
 * way back to the one that worked.
 *
 * This panel is both halves. The RAIL lists every version and what it is doing
 * commercially; STAGE captures a candidate, runs its harness over it, and refuses to
 * publish while anything is a blocker.
 *
 * ── AND THE PRODUCT ITSELF ───────────────────────────────────────────────────────
 * For a while it was only those two, which left a hole in the middle: a seller read a
 * VERDICT about their own creation without ever seeing it. Every piece needed to
 * close that already existed and none of them were joined up — the server returns the
 * right launch shape per mode, and the marketplace page already renders all five. The
 * obstacle was addressing: the public launch path resolves by SLUG and a staged
 * version deliberately has none. It now resolves by SNAPSHOT ID for the seller, under
 * the same entitlement rule, through the SAME component the buyer's page uses. The
 * preview is the product, bounded — never a metadata card or a screenshot.
 *
 * ── WHY THE CHECKS ARE NOT COMPUTED HERE ─────────────────────────────────────────
 * The findings arrive from the server, which ran them against the SNAPSHOT — the
 * copy a buyer actually receives, after every seller binding has been stripped and
 * every id regenerated. A panel that re-derived them from the live board would agree
 * with the seller and disagree with reality, which is the exact failure this surface
 * exists to prevent. `isPublishable` is likewise imported from the shared contract
 * rather than reimplemented as `checks.every(...)`: two copies of the gate is how a
 * client comes to offer a publish the server will refuse.
 *
 * A slide-out rather than a modal, per the app's convention — centred dialogs are
 * reserved for terminal destructive approvals, and a revert is undoable by
 * reverting again.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  STAGE_CHECK_GROUPS,
  blockingChecks,
  declaredLimits,
  deliveriesForKind,
  isPublishable,
  listingKindSpec,
  resolveDelivery,
  type ListingDelivery,
  type StageCheck,
  type StageCheckGroup,
} from '@builderforce/creation-canvas-contract';
import {
  creationReleaseApi,
  type ReleaseRail,
  type ReleaseView,
  type StagedRelease,
} from '@/lib/creationReleases';
import { creationListingApi, type PublishCandidate } from '@/lib/creationListings';
import {
  DeclaredLimits,
  HostedStatusNote,
  LAUNCH_STAGE_CSS,
  LaunchStage,
} from '@/lib/creationListings.launch';
import styles from './CreationCanvas.module.css';

export interface CanvasReleasesPanelProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  /** The card whose releases these are; null is the whole board. */
  objectId: string | null;
  onNotice: (message: string) => void;
}

/** The mark beside a finding. Glyphs rather than colour alone, so the verdict
 *  survives a monochrome display and a colour-blind reader. */
const MARK: Record<StageCheck['severity'], string> = { pass: '✓', warn: '!', block: '✕' };

export function CanvasReleasesPanel({
  open,
  onClose,
  sessionId,
  objectId,
  onNotice,
}: CanvasReleasesPanelProps) {
  const t = useTranslations('creationCanvas.releases');
  const confirm = useConfirm();
  const [rail, setRail] = useState<ReleaseRail | null>(null);
  const [candidate, setCandidate] = useState<PublishCandidate | null>(null);
  const [staged, setStaged] = useState<StagedRelease | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Which door this listing opens.
   *
   * Null means "whatever the kind declares first", which is what the server would
   * pick anyway — `resolveDelivery` is the one derivation and this holds an override
   * of it, never a second copy. It matters here because it decides WHICH HARNESS
   * runs: the same website is a runnable document when you sell the build and a live
   * address when you sell access, and a seller choosing after they have staged would
   * be reading findings from the wrong question.
   */
  const [delivery, setDelivery] = useState<ListingDelivery | null>(null);
  /** How many times the sandbox-pending poll (below) has fired for the current
   *  `staged` build. Reset whenever a fresh `staged` is loaded. */
  const [sandboxPolls, setSandboxPolls] = useState(0);

  const loadRail = useCallback(async () => {
    const next = await creationReleaseApi.rail(sessionId, objectId);
    setRail(next);
    return next;
  }, [sessionId, objectId]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    setStaged(null);
    (async () => {
      try {
        // The rail AND the candidate: the rail says what exists, the candidate says
        // what this card may be sold as. Staging needs both, and asking for them
        // separately as the seller presses the button is a round-trip they wait on.
        const [next, candidates] = await Promise.all([
          loadRail(),
          creationListingApi.candidates(sessionId),
        ]);
        if (!live) return;
        const match = objectId
          ? candidates.objects.find((entry) => entry.objectId === objectId) ?? null
          : candidates.session;
        setCandidate(match);

        // Reopening on an existing candidate re-reads its findings rather than
        // capturing a new one — otherwise the version a seller came back to publish
        // silently becomes today's board.
        const existing = next.releases.find((release) => release.state === 'staged');
        if (existing?.snapshotId) {
          const found = await creationReleaseApi.staged(sessionId, objectId, existing.snapshotId);
          if (!live) return;
          setStaged(found);
          setSandboxPolls(0);
          // The candidate on record decides the toggle, not the other way round: a
          // seller reopening Stage must see the door their staged build was checked
          // against, even if the kind's default is the other one.
          setDelivery(found.delivery);
        }
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => { live = false; };
  }, [open, sessionId, objectId, loadRail]);

  const stage = useCallback(async () => {
    if (!candidate?.kinds.length) return;
    setBusy(true);
    setError(null);
    try {
      const next = await creationReleaseApi.stage({
        sessionId,
        objectId,
        kind: candidate.kinds[0] ?? '',
        name: candidate.title,
        delivery: delivery ?? undefined,
        listingId: candidate.existingListingId,
      });
      setStaged(next);
      setDelivery(next.delivery);
      setSandboxPolls(0);
      await loadRail();
      onNotice(t('noticeStaged', { version: next.version }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [candidate, delivery, sessionId, objectId, loadRail, onNotice, t]);

  /**
   * WHILE THE STAGE SANDBOX IS STILL VERIFYING, KEEP RE-READING.
   *
   * The sandbox check ARRIVES as an ordinary `StageCheck` (`sandbox.pending`) in
   * `staged.checks` — the exact same list every other finding lives in — so no
   * new field or component is needed to display it; `CheckGroup` already renders
   * it. This effect only decides WHEN to re-read: while a run is genuinely in
   * flight, re-fetch `staged` on a widening interval (3s ×10, 6s ×8, 12s ×6 —
   * ~2m46s / 24 requests, then stop and leave the last-known state showing) so
   * "still verifying" resolves to a real pass/fail without the seller having to
   * reopen the panel.
   */
  const sandboxPending = !!staged?.checks.some((entry) => entry.code === 'sandbox.pending');

  useEffect(() => {
    if (!open || !staged || !sandboxPending || sandboxPolls >= 24) return;
    let live = true;
    const delay = sandboxPolls < 10 ? 3_000 : sandboxPolls < 18 ? 6_000 : 12_000;
    const timer = setTimeout(async () => {
      try {
        const next = await creationReleaseApi.staged(sessionId, objectId, staged.snapshotId);
        if (live) setStaged(next);
      } catch {
        // Transient — the next tick retries.
      } finally {
        if (live) setSandboxPolls((count) => count + 1);
      }
    }, delay);
    return () => { live = false; clearTimeout(timer); };
  }, [open, staged, sandboxPending, sandboxPolls, sessionId, objectId]);

  /** Promote the STAGED snapshot, so what was checked is what goes on sale. */
  const publish = useCallback(async () => {
    if (!staged || !candidate) return;
    setBusy(true);
    setError(null);
    try {
      const listing = await creationListingApi.publish({
        sessionId,
        objectId,
        kind: candidate.kinds[0] ?? '',
        name: candidate.title,
        // The door the STAGED candidate was checked against, not whatever the toggle
        // says now — publishing what was tested is the point of promoting a snapshot,
        // and the delivery decides which questions were asked of it.
        delivery: staged.delivery,
        listingId: candidate.existingListingId,
        fromSnapshotId: staged.snapshotId,
      });
      await loadRail();
      onNotice(t('noticePublished', { version: listing.version }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [staged, candidate, sessionId, objectId, loadRail, onNotice, t]);

  /**
   * Put an earlier version back on sale.
   *
   * Confirmed, because it changes what every NEW buyer receives — and the
   * confirmation says how many people are on the version being replaced, which is
   * the fact that makes it a decision rather than a shrug. Existing buyers are not
   * moved; their licence pins what they bought.
   */
  const revert = useCallback(async (release: ReleaseView) => {
    if (!rail?.listingId || !release.snapshotId) return;
    const live = rail.releases.find((entry) => entry.state === 'live');
    const ok = await confirm({
      title: t('revertTitle', { version: release.version }),
      // The version being REPLACED and how many people are on it — the two facts
      // that turn "put this back" from a shrug into a decision.
      message: t('revertBody', {
        version: live?.version ?? '—',
        holders: t('holders', { count: live?.holders ?? 0 }),
      }),
      confirmLabel: t('revertConfirm'),
      // Reverting takes nothing away — existing buyers keep what they hold, and the
      // action is undone by reverting again — so it is not styled as destruction.
      destructive: false,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const result = await creationReleaseApi.revert(rail.listingId, release.snapshotId);
      await loadRail();
      onNotice(t('noticeReverted', { version: result.version, from: release.version }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [rail, confirm, loadRail, onNotice, t]);

  const blockers = useMemo(() => blockingChecks(staged?.checks ?? []), [staged]);
  const canPublish = !!staged && isPublishable(staged.checks) && !busy;
  const kindSpec = candidate?.kinds[0] ? listingKindSpec(candidate.kinds[0]) : null;

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      crumb={t('crumb')}
      title={t('title')}
      width="wide"
      widthStorageKey="canvas-releases"
    >
      <div className={styles.releasePanel}>
        {error && <p className={styles.publishError} role="alert">{error}</p>}

        {!rail && !error && <p className={styles.publishHint}>{t('loading')}</p>}

        {rail && !candidate && <p className={styles.publishHint}>{t('notSellable')}</p>}

        {rail && candidate && (
          <>
            <DeliveryChoice
              kindId={candidate.kinds[0] ?? ''}
              chosen={delivery}
              busy={busy}
              onChoose={setDelivery}
            />

            <p className={styles.releaseHarness}>
              <span>{kindSpec?.icon ?? '📦'}</span>
              <span>{t('harnessLine', { harness: t(`harness.${staged?.harness ?? rail.harness ?? 'system'}`) })}</span>
            </p>

            {/* ── The rail ─────────────────────────────────────────────── */}
            <section aria-label={t('railLabel')} className={styles.releaseRail}>
              {rail.releases.map((release) => (
                <ReleaseRow
                  key={release.snapshotId ?? 'draft'}
                  release={release}
                  busy={busy}
                  onStage={release.state === 'draft' ? stage : undefined}
                  onRevert={release.state === 'superseded' ? () => revert(release) : undefined}
                  slug={rail.slug}
                />
              ))}
            </section>

            {/* ── The product ──────────────────────────────────────────────
                Above the findings on purpose: a seller reads "is it right" before
                they read "what is wrong with it", and a verdict over something you
                cannot see is the defect this closes. Rendered by the buyer's own
                component so there is nothing here that could agree with the listing
                page today and drift from it tomorrow. */}
            {staged && (
              <>
                <style>{LAUNCH_STAGE_CSS}</style>
                <p className={styles.publishHint}>
                  {t('previewHead', { version: staged.version })}
                </p>
                <HostedStatusNote hosted={staged.launch.hosted} />
                <LaunchStage launch={staged.launch} name={staged.payload.title} />
              </>
            )}

            {/* ── The findings ─────────────────────────────────────────── */}
            {staged && (
              <>
                <div className={styles.releaseVerdict} data-blocked={blockers.length > 0}>
                  {blockers.length
                    ? t('verdictBlocked', { count: blockers.length })
                    : t('verdictReady', { version: staged.version })}
                </div>

                {STAGE_CHECK_GROUPS.map((group) => (
                  <CheckGroup key={group} group={group} checks={staged.checks} />
                ))}

                {/* Exactly what a buyer will read on the listing, shown to the seller
                    BEFORE they publish it — the same derivation, so there is no
                    version of this where the seller is surprised by their own page. */}
                <DeclaredLimits checks={declaredLimits(staged.checks)} />

                {!!staged.payload.strippedFields?.length && (
                  <div className={styles.checkGroup}>
                    <div className={styles.checkGroupHead}>
                      <span>{t('strippedHead')}</span>
                      <span>{staged.payload.strippedFields.length}</span>
                    </div>
                    <p className={styles.releaseStripped}>{staged.payload.strippedFields.join(' · ')}</p>
                  </div>
                )}

                <div className={styles.publishActions}>
                  <button
                    type="button"
                    className={styles.fullButton}
                    onClick={publish}
                    disabled={!canPublish}
                  >
                    {busy ? t('working') : t('publishVersion', { version: staged.version })}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryFullButton}
                    onClick={stage}
                    disabled={busy}
                  >
                    {t('restage')}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </SlideOutPanel>
  );
}

/**
 * WHICH DOOR THIS LISTING OPENS — but only when the kind opens two.
 *
 * Almost every sellable kind hands over the thing itself and has nothing to choose:
 * a book cannot be a subscription. So this decides its own visibility from the
 * registry rather than taking a `canChooseDelivery` prop the caller would have to
 * compute — one listing kind gaining a second door is a registry entry, not an edit
 * here or at the call site.
 *
 * It sits ABOVE the harness line because it is what selects the harness: sell the
 * build and the captured document is checked; sell access and the live address is.
 */
function DeliveryChoice({
  kindId,
  chosen,
  busy,
  onChoose,
}: {
  kindId: string;
  chosen: ListingDelivery | null;
  busy: boolean;
  onChoose: (delivery: ListingDelivery) => void;
}) {
  const t = useTranslations('commerce.stage');
  const offered = deliveriesForKind(kindId);
  if (offered.length < 2) return null;
  // The effective value, from the one derivation the server uses — so the control
  // shows what WOULD happen rather than an empty state that means "the default".
  const effective = resolveDelivery(kindId, chosen);

  return (
    <fieldset className="cl-delivery">
      {/* Scoped here rather than in the canvas stylesheet: this control belongs to
          the listing surface and nothing else in the canvas renders one. Every value
          is a theme token, and the grid wraps rather than fixing a width, so it holds
          in both themes and at 360px. */}
      <style>{`
        .cl-delivery { border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
                       padding: 12px 14px; margin: 0 0 12px; display: grid; gap: 8px; }
        .cl-delivery legend { padding: 0 6px; font-size: var(--font-size-eyebrow);
                              font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
                              color: var(--text-secondary); }
        .cl-delivery label { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px;
                             align-items: start; padding: 8px 10px; cursor: pointer;
                             border-radius: var(--radius-md); border: 1px solid transparent; }
        .cl-delivery label[data-selected="true"] { border-color: var(--border-strong, var(--border-subtle));
                                                   background: var(--surface-card); }
        .cl-delivery input { margin: 3px 0 0; grid-row: span 2; }
        .cl-delivery span { font-size: var(--font-size-small); font-weight: 600;
                            color: var(--text-primary); }
        .cl-delivery small { font-size: var(--font-size-eyebrow); color: var(--text-secondary);
                             line-height: 1.5; }
      `}</style>
      <legend>{t('deliveryLegend')}</legend>
      {offered.map((option) => (
        <label key={option} data-selected={option === effective}>
          <input
            type="radio"
            name="listing-delivery"
            value={option}
            checked={option === effective}
            disabled={busy}
            onChange={() => onChoose(option)}
          />
          <span>{t(`delivery.${option}`)}</span>
          <small>{t(`deliveryHint.${option}`)}</small>
        </label>
      ))}
    </fieldset>
  );
}

/** One version in the rail. Decides its own actions from its state rather than
 *  taking them as props, so a new state cannot render a button that does nothing. */
function ReleaseRow({
  release,
  busy,
  slug,
  onStage,
  onRevert,
}: {
  release: ReleaseView;
  busy: boolean;
  slug: string | null;
  onStage?: () => void;
  onRevert?: () => void;
}) {
  const t = useTranslations('creationCanvas.releases');
  const when = release.takenAtISO ? new Date(release.takenAtISO) : null;

  return (
    <article className={styles.releaseItem} data-current={release.state === 'live' || release.state === 'draft'}>
      <div className={styles.releaseTop}>
        <span className={styles.releaseVersion}>v{release.version}</span>
        <span className={styles.releaseState} data-state={release.state}>{t(`state.${release.state}`)}</span>
        <span className={styles.releaseWhen}>
          {when ? when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : t('now')}
        </span>
      </div>
      <p className={styles.releaseNote}>
        {release.state === 'draft'
          ? t('draftNote')
          : t('holders', { count: release.holders })}
      </p>
      <div className={styles.releaseActions}>
        {onStage && (
          <button type="button" className={styles.secondaryFullButton} onClick={onStage} disabled={busy}>
            {t('stageAction')}
          </button>
        )}
        {onRevert && (
          <button type="button" className={styles.secondaryFullButton} onClick={onRevert} disabled={busy}>
            {t('revertAction')}
          </button>
        )}
        {release.state === 'live' && slug && (
          <a className={styles.secondaryFullButton} href={`/marketplace/listing/${slug}`} target="_blank" rel="noreferrer">
            {t('viewListing')}
          </a>
        )}
      </div>
    </article>
  );
}

/** One group of findings. Renders nothing when the harness produced none for it —
 *  an empty "Sells" heading is a section a seller reads as a missing feature. */
function CheckGroup({ group, checks }: { group: StageCheckGroup; checks: readonly StageCheck[] }) {
  const t = useTranslations('creationCanvas.releases');
  const mine = checks.filter((entry) => entry.group === group);
  if (!mine.length) return null;
  const failing = mine.filter((entry) => entry.severity !== 'pass').length;

  return (
    <section className={styles.checkGroup} aria-label={t(`group.${group}`)}>
      <div className={styles.checkGroupHead}>
        <span>{t(`group.${group}`)}</span>
        <span>{failing ? t('groupOpen', { count: failing }) : t('groupClear', { count: mine.length })}</span>
      </div>
      {mine.map((entry) => (
        <div key={entry.code} className={styles.checkRow}>
          <span className={styles.checkMark} data-severity={entry.severity} aria-hidden="true">
            {MARK[entry.severity]}
          </span>
          <span>
            <span className={styles.checkLabel}>{entry.label}</span>
            {entry.detail && <span className={styles.checkDetail}>{entry.detail}</span>}
          </span>
        </div>
      ))}
    </section>
  );
}
