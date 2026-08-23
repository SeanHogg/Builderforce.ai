'use client';

/**
 * TALKTRACK — record a narrated walkthrough of this board.
 *
 * ── WHAT WAS MISSING ─────────────────────────────────────────────────────────
 * The canvas could edit a video and render one and never make one. So the most
 * common thing anybody does with a board — walk somebody else through it — was
 * the one thing that left no artifact: it happened in a call, or in an external
 * screen recorder whose output came back as a file with no idea which part of it
 * mattered.
 *
 * ── WHAT THE RECORDING BECOMES ───────────────────────────────────────────────
 * A `video` object on this board, and nothing new. The recording is its source,
 * the chapters are its clips, the narration is its captions and its transcript,
 * and a `.vtt` beside it is what any other player will read. Everything after the
 * Stop button — trimming, splitting, re-titling a chapter, exporting, publishing
 * to YouTube — is the editor that already existed, unchanged.
 *
 * ── WHY IT IS SELF-CONTAINED ─────────────────────────────────────────────────
 * It owns its capture, its transcript, its storage and its own decision about
 * whether the browser can do any of this. Its contract with the board is two
 * callbacks and two facts — place this object, say this to the person, here is
 * the board's name and the object they have selected — which is the same narrow
 * seam `CanvasHostActions` already uses to put a captured object on a canvas. It
 * would mount unchanged in a second surface.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  talktrackTranscript,
  talktrackWebVtt,
  talktrackVideoTimeline,
} from '@builderforce/creation-canvas-contract';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { storeCanvasMedia, uploadCanvasFile } from '@/lib/canvasMediaStore';
import type { CanvasHostCapture } from '@/lib/canvasHost';
import { useCanvasTalktrack } from '@/hooks/useCanvasTalktrack';
import styles from './CanvasTalktrackPanel.module.css';

/** `m:ss`, from seconds. The one place this panel formats a time. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export interface CanvasTalktrackPanelProps {
  open: boolean;
  onClose: () => void;
  /** Names the object the recording becomes. */
  boardTitle: string;
  /** The single selected object, so a marked moment can name what it is about. */
  focus: { id: string; title: string } | null;
  /** True when the session role or an editing lock forbids adding to the board. */
  disabled: boolean;
  /** Place the finished walkthrough on the board. */
  onCapture: (capture: CanvasHostCapture) => void;
  /** Surface a result through the canvas's own notice channel. */
  onNotice: (message: string) => void;
}

export function CanvasTalktrackPanel({
  open,
  onClose,
  boardTitle,
  focus,
  disabled,
  onCapture,
  onNotice,
}: CanvasTalktrackPanelProps) {
  const t = useTranslations('creationCanvas.talktrack');
  // Localized topic openers for the key-moment heuristic — the catalog is the only
  // place that knows what "so, next, over here" is in the reader's language.
  const openers = t('openers').split(',').map((phrase) => phrase.trim()).filter(Boolean);
  const capture = useCanvasTalktrack({ openers });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const begin = async () => {
    setProblem(null);
    const started = await capture.start();
    if (!started && capture.error && capture.error !== 'cancelled') setProblem(t('captureFailed'));
  };

  const finish = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await capture.stop();
      if (!result) { setProblem(t('nothingRecorded')); return; }
      const { file, talktrack } = result;
      const source = await storeCanvasMedia(file, 'screen');
      const timeline = talktrackVideoTimeline(source, talktrack, { openingTitle: t('opening') });
      const transcript = talktrackTranscript(talktrack.cues);
      // The captions go up as a real `.vtt` so a player outside our editor can read
      // them. A failed upload is not a failed recording — the cues are on the object
      // either way, so this degrades to "no sidecar" rather than to "no walkthrough".
      const captions = talktrack.cues.length
        ? await uploadCanvasFile(new File([talktrackWebVtt(talktrack.cues)], `${source.id}.vtt`, { type: 'text/vtt' }))
        : null;
      onCapture({
        kind: 'video',
        title: t('objectTitle', { board: boardTitle }),
        content: {
          videoSources: [source],
          videoTimeline: timeline,
          videoUrl: source.url,
          duration: source.durationSeconds,
          talktrack,
          ...(transcript ? { transcript } : {}),
          ...(captions ? { captionsUrl: captions.url } : {}),
          status: t('status', { chapters: timeline.clips.length }),
        },
      });
      onNotice(t('added', { chapters: timeline.clips.length }));
      onClose();
    } catch {
      setProblem(t('storeFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      crumb={boardTitle}
      title={t('title')}
      width="sheet"
      widthStorageKey="canvas-talktrack"
    >
      <div className={styles.panel}>
        <p className={styles.lead}>{t('lead')}</p>

        {!capture.supported && <p className={styles.problem} role="alert">{t('unsupported')}</p>}
        {capture.supported && !capture.canTranscribe && <p className={styles.status}>{t('noTranscription')}</p>}
        {disabled && <p className={styles.status}>{t('readOnly')}</p>}

        <div className={styles.controls}>
          {!capture.recording && (
            <button
              type="button"
              className={styles.primary}
              disabled={!capture.supported || disabled || busy}
              onClick={() => void begin()}
            >
              {t('start')}
            </button>
          )}
          {capture.recording && (
            <>
              <button type="button" className={styles.stop} disabled={busy} onClick={() => void finish()}>
                {t('stop')}
              </button>
              <button
                type="button"
                onClick={() => capture.mark(focus?.title ?? t('markedMoment'), focus?.id)}
              >
                {focus ? t('markObject', { title: focus.title }) : t('mark')}
              </button>
              <span className={styles.elapsed}>
                <span className={styles.dot} aria-hidden />
                <time>{clock(capture.elapsedMs / 1000)}</time>
              </span>
            </>
          )}
        </div>

        {busy && <p className={styles.status} role="status">{t('saving')}</p>}
        {problem && <p className={styles.problem} role="alert">{problem}</p>}

        {(capture.recording || capture.moments.length > 0) && (
          <section className={styles.section} aria-label={t('keyMoments')}>
            <h3>{t('keyMoments')}</h3>
            {capture.moments.length === 0 && <p className={styles.empty}>{t('noMomentsYet')}</p>}
            {capture.moments.length > 0 && (
              <ul className={styles.moments}>
                {capture.moments.map((moment) => (
                  <li key={`${moment.atSeconds}-${moment.title}`}>
                    <time>{clock(moment.atSeconds)}</time>
                    <span>{moment.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {capture.recording && (
          <section className={styles.section} aria-label={t('transcriptHeading')}>
            <h3>{t('transcriptHeading')}</h3>
            {capture.cues.length === 0 && !capture.interim && <p className={styles.empty}>{t('listening')}</p>}
            <ul className={styles.transcript} aria-live="polite">
              {capture.cues.map((cue) => (
                <li key={`${cue.startSeconds}-${cue.text}`}>
                  <time>{clock(cue.startSeconds)}</time>
                  <span>{cue.text}</span>
                </li>
              ))}
              {capture.interim && (
                <li>
                  <time>{clock(capture.elapsedMs / 1000)}</time>
                  <span className={styles.interim}>{capture.interim}</span>
                </li>
              )}
            </ul>
          </section>
        )}
      </div>
    </SlideOutPanel>
  );
}
