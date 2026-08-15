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
  isPublishable,
  listingKindSpec,
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
          setStaged(await creationReleaseApi.staged(sessionId, objectId, existing.snapshotId));
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
        listingId: candidate.existingListingId,
      });
      setStaged(next);
      await loadRail();
      onNotice(t('noticeStaged', { version: next.version }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [candidate, sessionId, objectId, loadRail, onNotice, t]);

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
