'use client';

/**
 * THE facilitation surface — where a workshop is actually RUN.
 *
 * ── WHAT THIS IS THE OTHER HALF OF ──────────────────────────────────────────
 * A `poll` card can hold a question. It cannot be the thing a person stands in front of a
 * room with: the join address has to be readable from the back, the count has to move
 * while people answer, and open/close and show/hide have to be one press each. That is a
 * medium with its own axis — the room — which is exactly what a canvas SURFACE is for,
 * the same argument `play` makes about a running build and `timeline` about an edit.
 *
 * ── WHAT IT WRITES BACK, AND WHY ────────────────────────────────────────────
 * Publishing mints an address and a question-set id, and both are written onto the card.
 * The id is what every later call is addressed by (steering, the tally), and the address
 * is what a facilitator reads out — so a board reopened tomorrow still points at the same
 * poll. The COUNTED result is written back too, into the card's derived `results` field,
 * so the board keeps a readable record after the surface is closed. None of it is
 * authorable: a result somebody typed is not a result.
 *
 * ── WHY IT POLLS ────────────────────────────────────────────────────────────
 * Same reason the participant's page does, and the module header there argues it in
 * full: a live count has to move without anybody doing anything, and the canvas relay is
 * a tenant Durable Object shaped around board objects rather than around a tally that
 * lives for the minutes a poll is open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CopyButton } from '@/components/CopyButton';
import { PollResults } from '@/components/facilitation/PollResults';
import { facilitatorPoll, publishPoll, setPollState } from '@/lib/pollApi';
import { emptyPollTally, type PollTally } from '@builderforce/creation-canvas-contract';
// The reading of a poll CARD lives in one place, because this surface and the canvas
// action dispatch both publish the same card and two readings of `options` is two polls.
import { pollFormatOf, pollGridOf, pollJoinUrl, pollPublishBody } from '@/lib/pollObject';
import type { CreationNodeData } from './types';
import styles from './CanvasFacilitateSurface.module.css';

/** How often the count is re-read while this surface is open. Matched to the
 *  participant's interval so the room and the board are never more than one tick apart —
 *  two different rates is two answers to "how many have voted". */
const REFRESH_MS = 4000;

export interface CanvasFacilitateSurfaceProps {
  data: CreationNodeData;
  /** Writes the published address, the id and the counted result back onto the card.
   *  Absent when the board is read-only, which is what disables publishing. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
  onExit: () => void;
  /** The canvas object id, so the published set points back at the card it came from. */
  objectId: string;
}

export function CanvasFacilitateSurface({ data, onEdit, onExit, objectId }: CanvasFacilitateSurfaceProps) {
  const t = useTranslations('poll');
  const questionSetId = typeof data.questionSetId === 'string' ? data.questionSetId : null;
  const joinUrl = typeof data.joinUrl === 'string' ? data.joinUrl : null;

  const format = pollFormatOf(data);
  const grid = useMemo(() => pollGridOf(data), [data]);

  const [tally, setTally] = useState<PollTally>(() => emptyPollTally(format));
  const [open, setOpen] = useState(true);
  const [resultsLive, setResultsLive] = useState(data.showResultsLive !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last result written back to the card, so a tally that has not changed does not
  // re-enter the board's undo history once every four seconds.
  const lastWritten = useRef<string>('');

  /** Mirror the counted result onto the card. Derived fields only — the card keeps a
   *  readable record of what the room said after this surface is closed. */
  const writeBack = useCallback((next: PollTally) => {
    if (!onEdit) return;
    const results = next.entries.map((entry) => ({ label: entry.label, value: entry.value }));
    const answers = next.texts.slice(0, 40);
    const fingerprint = JSON.stringify([next.responseCount, results, answers]);
    if (fingerprint === lastWritten.current) return;
    lastWritten.current = fingerprint;
    onEdit({ responseCount: next.responseCount, results, answers } as Partial<CreationNodeData>);
  }, [onEdit]);

  const read = useCallback(async () => {
    if (!questionSetId) return;
    try {
      const view = await facilitatorPoll(questionSetId);
      setTally(view.tally);
      setOpen(view.poll.status === 'open');
      setResultsLive(view.poll.showResultsLive);
      writeBack(view.tally);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : t('readFailed'));
    }
  }, [questionSetId, t, writeBack]);

  useEffect(() => { void read(); }, [read]);

  useEffect(() => {
    if (!questionSetId) return undefined;
    const timer = setInterval(() => { void read(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [questionSetId, read]);

  const publish = async () => {
    if (!onEdit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await publishPoll(pollPublishBody(data, objectId));
      const url = pollJoinUrl(result.slug);
      setOpen(true);
      onEdit({ questionSetId: result.questionSetId, joinUrl: url, status: t('statusOpen') } as Partial<CreationNodeData>);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : t('publishFailed'));
    } finally {
      setBusy(false);
    }
  };

  const steer = async (state: { status?: 'open' | 'closed'; showResultsLive?: boolean }) => {
    if (!questionSetId) return;
    setBusy(true);
    setError(null);
    try {
      const next = await setPollState(questionSetId, state);
      setOpen(next.status === 'open');
      setResultsLive(next.showResultsLive);
      if (onEdit) {
        onEdit({
          showResultsLive: next.showResultsLive,
          status: next.status === 'open' ? t('statusOpen') : t('statusClosed'),
        } as Partial<CreationNodeData>);
      }
      void read();
    } catch (steerError) {
      setError(steerError instanceof Error ? steerError.message : t('steerFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.surface} data-testid="canvas-facilitate-surface">
      <div className={styles.bar}>
        <h2 className={styles.barTitle}>{String(data.title ?? t('untitled'))}</h2>
        {questionSetId ? (
          <>
            <button
              type="button" className={styles.button} disabled={busy || !onEdit}
              onClick={() => void steer({ status: open ? 'closed' : 'open' })}
            >{open ? t('closeVoting') : t('openVoting')}</button>
            {/* Show/hide is a SEPARATE press from open/close on purpose: hiding the
                count while voting continues is what stops the first three answers
                deciding the rest, and a control that did both at once would not allow
                it. */}
            <button
              type="button" className={styles.button} disabled={busy || !onEdit}
              onClick={() => void steer({ showResultsLive: !resultsLive })}
            >{resultsLive ? t('hideResults') : t('revealResults')}</button>
            <button
              type="button" className={`${styles.button} ${styles.buttonPrimary}`} disabled={busy || !onEdit}
              onClick={() => void publish()}
            >{t('republish')}</button>
          </>
        ) : (
          <button
            type="button" className={`${styles.button} ${styles.buttonPrimary}`} disabled={busy || !onEdit}
            onClick={() => void publish()}
          >{t('publish')}</button>
        )}
        <button type="button" className={styles.button} onClick={onExit}>{t('backToBoard')}</button>
      </div>

      <div className={styles.body}>
        {error && <p className={styles.error} role="alert">{error}</p>}

        {!questionSetId ? (
          <div className={styles.unpublished}>
            <p>{t('unpublishedHint')}</p>
            {!onEdit && <p>{t('readOnlyHint')}</p>}
          </div>
        ) : (
          <div className={styles.stage}>
            {typeof data.prompt === 'string' && data.prompt.trim() && (
              <p className={styles.prompt}>{data.prompt}</p>
            )}

            {joinUrl && (
              <div className={styles.join}>
                <span className={styles.joinLabel}>{t('joinAt')}</span>
                <span className={styles.joinUrl}>{joinUrl.replace(/^https?:\/\//, '')}</span>
                <div className={styles.joinActions}>
                  <CopyButton getText={() => joinUrl} label={t('copyJoinLink')} />
                  <a className={styles.button} href={joinUrl} target="_blank" rel="noreferrer">{t('openJoinPage')}</a>
                </div>
              </div>
            )}

            <p className={styles.state}>
              <span>{open ? t('votingOpen') : t('votingClosed')}</span>
              <span>{resultsLive ? t('resultsShown') : t('resultsHiddenFromRoom')}</span>
              <span>{data.anonymous === false ? t('anonymousNo') : t('anonymousYes')}</span>
            </p>

            <PollResults tally={tally} grid={grid} />
          </div>
        )}
      </div>
    </div>
  );
}
