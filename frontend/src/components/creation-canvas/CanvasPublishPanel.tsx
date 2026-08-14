/**
 * "Put it in the marketplace" — the panel behind a canvas creation's Sell button.
 *
 * ── WHAT IT IS FOR ───────────────────────────────────────────────────────────────
 * The canvas could take an idea, make it and run it, and then stop. This is the
 * step that was missing: naming what the thing IS ("this is a Game"), deciding what
 * a stranger may do with it, putting a price on it, and sending it somewhere other
 * people can find it.
 *
 * ── THREE SHAPES THAT ARE DELIBERATE ─────────────────────────────────────────────
 *  - The KIND list comes from the server's candidate call, not from a local guess.
 *    A publish button that offers a choice the server will refuse is worse than one
 *    that offers fewer choices.
 *  - The SPLIT is shown before the price is typed, not after the sale. A seller who
 *    learns the platform's cut from their first payout learns it at the worst
 *    possible moment.
 *  - The TRIAL line is stated in the seller's own terms ("anyone can play it" /
 *    "buyers only") because `full` and `preview` are our words, not theirs, and the
 *    decision behind them is the one they actually care about.
 *
 * A slide-out rather than a modal: this is a form, and the app reserves centred
 * dialogs for terminal destructive approvals.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import {
  listingKindSpec,
  resolveTrialPolicy,
  type ListingTrialPolicy,
} from '@builderforce/creation-canvas-contract';
import {
  creationListingApi,
  formatListingPrice,
  type CandidatesView,
  type CreationListing,
  type PublishCandidate,
} from '@/lib/creationListings';
import styles from './CreationCanvas.module.css';

export interface CanvasPublishPanelProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  /** Preselect the object the seller pressed the button on; null offers the board. */
  focusObjectId: string | null;
  /** Surfaced through the canvas's own notice bar, so messaging stays in one place. */
  onNotice: (message: string) => void;
}

/** The candidate key, since a board publishes under a null object id. */
const keyOf = (candidate: PublishCandidate) => candidate.objectId ?? '__session__';

export function CanvasPublishPanel({
  open,
  onClose,
  sessionId,
  focusObjectId,
  onNotice,
}: CanvasPublishPanelProps) {
  const t = useTranslations('creationCanvas.publish');
  const [view, setView] = useState<CandidatesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>(focusObjectId ?? '__session__');
  const [kind, setKind] = useState('');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [price, setPrice] = useState('0');
  const [trial, setTrial] = useState<ListingTrialPolicy>('full');
  const [published, setPublished] = useState<CreationListing | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    creationListingApi.candidates(sessionId)
      .then((next) => { if (live) setView(next); })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { live = false; };
  }, [open, sessionId]);

  // Reopening on a different card must not leave the previous card's answers in
  // the form — that is how somebody sells a dashboard under a game's name.
  useEffect(() => {
    if (!open) return;
    setSelectedKey(focusObjectId ?? '__session__');
    setPublished(null);
  }, [open, focusObjectId]);

  const candidates = useMemo(
    () => (view ? [...view.objects, view.session] : []),
    [view],
  );
  const selected = useMemo(
    () => candidates.find((candidate) => keyOf(candidate) === selectedKey) ?? null,
    [candidates, selectedKey],
  );

  // The kind and the name follow the selection unless the seller has changed them.
  useEffect(() => {
    if (!selected) return;
    setKind((current) => (selected.kinds.includes(current) ? current : selected.kinds[0] ?? ''));
    setName((current) => (current.trim() ? current : selected.title));
  }, [selected]);

  const priceCents = Math.max(0, Math.round((Number.parseFloat(price) || 0) * 100));
  const takeRateBps = view?.takeRateBps ?? 0;
  const feeCents = Math.round((priceCents * takeRateBps) / 10_000);
  const netCents = Math.max(0, priceCents - feeCents);

  // ONE derivation of the trial policy, shared with the server — so what the panel
  // promises the seller and what the launch endpoint hands out are the same rule.
  const effectiveTrial = kind ? resolveTrialPolicy(kind, priceCents, trial) : trial;
  const spec = kind ? listingKindSpec(kind) : null;

  const submit = useCallback(async () => {
    if (!selected || !kind || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const listing = await creationListingApi.publish({
        sessionId,
        objectId: selected.objectId,
        kind,
        name: name.trim(),
        summary: summary.trim() || undefined,
        priceCents,
        trial: effectiveTrial,
        listingId: selected.existingListingId,
      });
      setPublished(listing);
      onNotice(t('noticePublished', { name: listing.name }));
      // The board's candidate list now carries a listing id for this card, so the
      // next open offers "update" rather than a second competing listing.
      setView(await creationListingApi.candidates(sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [selected, kind, name, summary, priceCents, effectiveTrial, sessionId, onNotice, t]);

  const withdraw = useCallback(async () => {
    if (!selected?.existingListingId) return;
    setBusy(true);
    try {
      await creationListingApi.unpublish(selected.existingListingId);
      onNotice(t('noticeWithdrawn'));
      setPublished(null);
      setView(await creationListingApi.candidates(sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [selected, sessionId, onNotice, t]);

  const canSubmit = !!selected && !!kind && !!name.trim() && !busy;

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      crumb={t('crumb')}
      title={t('title')}
      width="wide"
      widthStorageKey="canvas-publish"
    >
      <div className={styles.publishPanel}>
        {error && <p className={styles.publishError} role="alert">{error}</p>}

        {!view && !error && <p className={styles.publishHint}>{t('loading')}</p>}

        {view && candidates.length === 0 && (
          <p className={styles.publishHint}>{t('emptyBoard')}</p>
        )}

        {view && candidates.length > 0 && (
          <>
            <label className={styles.publishField}>
              <span>{t('whatLabel')}</span>
              <select
                value={selectedKey}
                onChange={(event) => setSelectedKey(event.target.value)}
                disabled={busy}
              >
                {candidates.map((candidate) => (
                  <option key={keyOf(candidate)} value={keyOf(candidate)}>
                    {candidate.objectId ? candidate.title : t('wholeBoard', { title: candidate.title })}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.publishField}>
              <span>{t('kindLabel')}</span>
              <select value={kind} onChange={(event) => setKind(event.target.value)} disabled={busy}>
                {(selected?.kinds ?? []).map((id) => (
                  <option key={id} value={id}>
                    {listingKindSpec(id)?.icon ?? ''} {t(`kind.${id}`)}
                  </option>
                ))}
              </select>
              {spec && <small className={styles.publishHint}>{t(`launchHint.${spec.launch}`)}</small>}
            </label>

            <label className={styles.publishField}>
              <span>{t('nameLabel')}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('namePlaceholder')}
                disabled={busy}
              />
            </label>

            <label className={styles.publishField}>
              <span>{t('summaryLabel')}</span>
              <textarea
                rows={3}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder={t('summaryPlaceholder')}
                disabled={busy}
              />
            </label>

            <label className={styles.publishField}>
              <span>{t('priceLabel')}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                disabled={busy}
              />
            </label>

            {/* The split, before the price is committed rather than after the sale. */}
            <div className={styles.publishSplit}>
              {priceCents > 0 ? (
                <>
                  <span>{t('splitYouKeep', { amount: formatListingPrice(netCents) })}</span>
                  <span className={styles.publishHint}>
                    {t('splitFee', {
                      amount: formatListingPrice(feeCents),
                      rate: (takeRateBps / 100).toFixed(takeRateBps % 100 === 0 ? 0 : 2),
                    })}
                  </span>
                </>
              ) : (
                <span className={styles.publishHint}>{t('splitFree')}</span>
              )}
            </div>

            <label className={styles.publishField}>
              <span>{t('trialLabel')}</span>
              <select
                value={effectiveTrial}
                onChange={(event) => setTrial(event.target.value as ListingTrialPolicy)}
                disabled={busy || priceCents === 0}
              >
                <option value="full">{t('trialFull')}</option>
                <option value="preview">{t('trialPreview')}</option>
              </select>
              <small className={styles.publishHint}>
                {priceCents === 0 ? t('trialHintFree') : t(`trialHint.${effectiveTrial}`)}
              </small>
            </label>

            <div className={styles.publishActions}>
              <button type="button" className={styles.fullButton} onClick={submit} disabled={!canSubmit}>
                {busy
                  ? t('publishing')
                  : selected?.existingListingId ? t('update') : t('publishAction')}
              </button>
              {selected?.existingListingId && (
                <button
                  type="button"
                  className={styles.secondaryFullButton}
                  onClick={withdraw}
                  disabled={busy}
                >
                  {t('withdraw')}
                </button>
              )}
            </div>

            {published && (
              <p className={styles.publishSuccess}>
                {t('liveAt')}{' '}
                <a href={`/marketplace/listing/${published.slug}`} target="_blank" rel="noreferrer">
                  /marketplace/listing/{published.slug}
                </a>
              </p>
            )}
          </>
        )}
      </div>
    </SlideOutPanel>
  );
}
