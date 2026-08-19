'use client';

import { Icon } from '@/components/ui/Icon';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';
import { brain } from '@/lib/builderforceApi';
import { canvasViewport } from '@/lib/canvasViewport';
import {
  canvasWebPageUrl, hasWebPageProbe, isLocalWebPageUrl, isMixedContentFrame, normalizeWebPageUrl,
  webPageHost,
} from '@/lib/canvasWebPage';
import {
  canvasPreviewReportLog, canvasPreviewStatusFailed, type CanvasPreviewEntry,
} from '@/lib/canvasPreviewReport';
import { CanvasDeviceFrame } from './CanvasDeviceFrame';
import { useCanvasPreviewLog } from './useCanvasPreviewLog';

/**
 * A live web page, framed as a panel on the board.
 *
 * Two things make this more than an `<iframe>`:
 *
 *  1. Most of the web refuses to be framed. The browser gives an embedder no
 *     usable signal when that happens — `load` fires on the refusal page just as
 *     it does on the real one — so the panel asks the gateway, which CAN see
 *     `X-Frame-Options` / CSP `frame-ancestors`, and falls back to a readable
 *     view of the same page instead of showing the user a white rectangle.
 *  2. The probe that answers (1) returns the page's text, which is written back
 *     onto the object. A framed page is opaque to everything else on the canvas;
 *     its text is not, so Brain can reason about a page the user is looking at
 *     rather than only knowing its address.
 *
 * The frame is sandboxed and rendered at the selected device width, then scaled
 * into the panel, so a responsive site lays out for the device it is previewing
 * rather than being a squeezed desktop. Measuring and scaling that frame is NOT
 * this panel's job any more: it is `CanvasDeviceFrame`, shared with the app
 * surface, the site surface and the website card, which is what makes "Desktop"
 * mean the same 1280px everywhere instead of "whatever the panel happens to be".
 *
 * ── AND (3): A PREVIEW THAT SAYS IT IS BROKEN ────────────────────────────────
 * A framed page used to look identical whether it worked or threw. Two things
 * changed that, and they are deliberately different mechanisms because they have
 * different reach:
 *
 *   · The STATUS is known for every page the gateway can reach, with no
 *     cooperation at all — the probe above already fetched it. A 404 or a 500
 *     renders a perfectly good-looking document, so a frame alone can never tell
 *     anybody the request failed; the strip does.
 *   · The CONSOLE needs the page to report, because the browser gives an embedder
 *     nothing from inside a cross-origin document — no `contentWindow.console`,
 *     no error events, no `PerformanceObserver` entries. Pages the canvas writes
 *     carry `CANVAS_PREVIEW_REPORTER`; pages somebody else wrote carry it by
 *     loading `@seanhogg/builderforce-quality`. A page carrying neither is
 *     reported as UNKNOWN rather than as clean — see `canvasPreviewSummary`'s
 *     `reported` flag, which exists so those two states cannot be conflated.
 *
 * What the frame reports is written back onto the object, bounded, so Brain reads
 * "this preview is throwing" from the board instead of being told the page loaded.
 */

interface CanvasWebPageProps {
  data: CreationNodeData;
  /** Absent when the viewer cannot edit — the address bar becomes read-only. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}

export function CanvasWebPage({ data, onEdit }: CanvasWebPageProps) {
  const t = useTranslations('creationCanvas.webPage');
  const url = canvasWebPageUrl(data);
  const viewport = canvasViewport(data.viewport);
  const [draft, setDraft] = useState(url ?? '');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openReport, setOpenReport] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // The address bar mirrors the object until the user starts typing in it; a
  // Brain-authored or inspector-side change has to show up here too.
  useEffect(() => { setDraft(url ?? ''); }, [url]);
  useEffect(() => { setLoaded(false); setError(null); }, [url, reloadNonce]);

  // A dev server on the user's own machine is reachable by their browser and by
  // nothing else — the gateway cannot probe it, and framing it is the point.
  const local = !!url && isLocalWebPageUrl(url);
  // `https:` page + `http:` target is refused by the browser itself, silently.
  const mixed = !!url && isMixedContentFrame(url, typeof window === 'undefined' ? 'https:' : window.location.protocol);
  const blocked = mixed || (data.frameCheckedUrl === url && data.frameable === false);
  const readerText = typeof data.content === 'string' ? data.content : '';
  const framing = !!url && !blocked;

  // What the framed page says about itself, over the ONE preview wire. Scoped to this
  // card's own frame: a board can hold several live pages and they all post to the same
  // `window`, so a listener of this panel's own would show the neighbour's errors.
  const { log, summary, reset } = useCanvasPreviewLog(frameRef, framing);
  useEffect(() => { reset(); setOpenReport(false); }, [url, reloadNonce, reset]);

  // The status the GATEWAY saw. A styled 404 frames as happily as the real page, so this
  // is the only thing that distinguishes "the site is up" from "the site returned 500"
  // for a page that reports nothing from inside.
  const httpStatus = data.frameCheckedUrl === url && typeof data.httpStatus === 'number'
    ? data.httpStatus
    : null;
  const statusFailed = canvasPreviewStatusFailed(httpStatus);
  const failing = statusFailed || summary.errors > 0;

  /**
   * The bounded report written back onto the object, so Brain reads a broken preview off
   * the board rather than being told the page loaded.
   *
   * Debounced and compared by VALUE: a page logging in a render loop would otherwise
   * write to the session on every frame, and an identical report re-written is a canvas
   * revision that says nothing.
   *
   * A page that has said nothing writes nothing — a board of live cards must not each
   * record "reported: false" simply for having been opened. The one exception is a card
   * that is CARRYING a report: a reload that comes back clean has to clear the previous
   * run's errors, or Brain keeps reading a failure the page no longer has. The debounce
   * absorbs the ordinary case, where the page reports again before the clear fires.
   */
  const report = useMemo(() => canvasPreviewReportLog(log), [log]);
  const stored = summary.reported
    || data.previewReported === true
    || (Array.isArray(data.previewLog) && data.previewLog.length > 0);
  const writtenRef = useRef('');
  const liveEdit = useRef(onEdit);
  liveEdit.current = onEdit;
  useEffect(() => {
    if (!framing || !liveEdit.current || !url || !stored) return;
    const next = JSON.stringify({ url, errors: summary.errors, warnings: summary.warnings, report });
    if (next === writtenRef.current) return;
    const timer = setTimeout(() => {
      writtenRef.current = next;
      liveEdit.current?.({
        previewLog: report,
        previewErrorCount: summary.errors,
        previewWarningCount: summary.warnings,
        previewReported: summary.reported,
        previewReportedAt: new Date().toISOString(),
      });
    }, 1_200);
    return () => clearTimeout(timer);
  }, [framing, url, stored, report, summary.errors, summary.warnings, summary.reported]);

  /**
   * Ask the gateway whether this address may be framed, and keep the text it
   * returns. Runs once per address: the answer is stored beside the URL it was
   * measured against, and the in-flight address is held in a ref, so neither a
   * re-render nor the patch this very effect writes can re-spend the tenant's
   * metered outbound-fetch allowance on a question already asked.
   */
  const live = useRef({ data, onEdit, t });
  live.current = { data, onEdit, t };
  const probedUrl = useRef<string | null>(null);
  useEffect(() => {
    const { data: current, onEdit: edit, t: translate } = live.current;
    if (!url || !edit || local || hasWebPageProbe(current, url) || probedUrl.current === url) return;
    probedUrl.current = url;
    let cancelled = false;
    setProbing(true);
    brain.fetchUrl(url)
      .then((result) => {
        if (cancelled) return;
        live.current.onEdit?.({
          frameCheckedUrl: url,
          frameable: result.frameable,
          frameBlockedBy: result.frameBlockedBy,
          pageTitle: result.title,
          content: result.text,
          // The half of "is this preview broken" that needs no cooperation from the
          // page: a 4xx/5xx body frames exactly like a working one.
          httpStatus: result.status,
          fetchedAt: new Date().toISOString(),
          ...(!current.status || current.status === 'Ready' ? { status: translate('statusLive') } : {}),
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // An unreachable or refused origin is not a reason to hide the frame —
        // the page may still render for the user's own browser (a private
        // network host the gateway cannot reach is the common case). Record the
        // attempt so it is not retried on every render, and say what happened.
        setError(cause instanceof Error ? cause.message : translate('probeFailed'));
        // `httpStatus: 0` records "the gateway never got an answer" — distinct from a
        // status it did get, and from the absence of a probe entirely.
        live.current.onEdit?.({ frameCheckedUrl: url, frameable: true, frameBlockedBy: null, httpStatus: 0 });
      })
      .finally(() => { if (!cancelled) setProbing(false); });
    return () => { cancelled = true; };
  }, [url, local]);

  const load = useCallback((raw: string) => {
    const next = normalizeWebPageUrl(raw);
    if (!next) { setError(t('invalidUrl')); return; }
    setError(null);
    if (next === url) { setReloadNonce((n) => n + 1); return; }
    // Clearing the probe is what re-arms it for the new address.
    onEdit?.({ url: next, frameCheckedUrl: '', frameable: true, frameBlockedBy: null, title: data.title || webPageHost(next) });
  }, [data.title, onEdit, t, url]);

  return (
    <div className={styles.webPage} data-viewport={viewport}>
      <div className={`${styles.webPageBar} nodrag nowheel`}>
        <button
          type="button"
          aria-label={t('reload')}
          title={t('reload')}
          disabled={!url}
          onClick={(event) => { event.stopPropagation(); setReloadNonce((n) => n + 1); }}
        >↻</button>
        <input
          value={draft}
          readOnly={!onEdit}
          spellCheck={false}
          inputMode="url"
          aria-label={t('address')}
          placeholder={t('addressPlaceholder')}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') load(draft);
            if (event.key === 'Escape') setDraft(url ?? '');
          }}
        />
        {url && <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={t('openInNewTab')}
          title={t('openInNewTab')}
          onClick={(event) => event.stopPropagation()}
        ><Icon source="↗" size="1em" /></a>}
      </div>

      {!url && <div className={styles.webPageEmpty}><strong>{t('emptyTitle')}</strong><p>{t('emptyHint')}</p></div>}

      {url && blocked && <div className={`${styles.webPageReader} nowheel nodrag`} role="region" aria-label={data.title} tabIndex={0}>
        <div className={styles.webPageNotice} role="status">
          <strong>{mixed ? t('mixedTitle', { host: webPageHost(url) }) : t('blockedTitle', { host: webPageHost(url) })}</strong>
          <span>{mixed ? t('mixedHint') : t('blockedHint')}</span>
        </div>
        {readerText ? <p>{readerText}</p> : <p className={styles.webPageMuted}>{t('readerEmpty')}</p>}
      </div>}

      {url && !blocked && <CanvasDeviceFrame
        frameRef={frameRef}
        reloadKey={`${url}#${reloadNonce}`}
        viewport={viewport}
        src={url}
        title={typeof data.pageTitle === 'string' && data.pageTitle ? data.pageTitle : data.title}
        loading="lazy"
        referrerPolicy="no-referrer"
        // The framed document keeps its OWN origin — `allow-same-origin` here
        // lets a normal site use its own cookies and storage, which most of the
        // web needs to render at all; it grants the frame nothing of ours. This
        // is the one framed document on the canvas that gets it, and the reason
        // `CanvasDeviceFrame` takes the sandbox rather than declaring one.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        allow="clipboard-write; fullscreen; picture-in-picture"
        onLoad={() => setLoaded(true)}
        frameClassName="nodrag nowheel"
      >
        {!loaded && <div className={styles.webPageLoading} role="status">{t('loading', { host: webPageHost(url) })}</div>}
      </CanvasDeviceFrame>}

      {framing && <div className={styles.webPageReport} data-failing={failing || undefined}>
        <button
          type="button"
          className={styles.webPageReportBar}
          aria-expanded={openReport}
          disabled={!summary.reported && !statusFailed}
          onClick={(event) => { event.stopPropagation(); setOpenReport((open) => !open); }}
        >
          <span className={styles.webPageReportDot} data-tone={failing ? 'bad' : summary.reported ? 'good' : 'unknown'} aria-hidden />
          <span className={styles.webPageReportText}>
            {statusFailed
              ? t('reportStatusFailed', { status: httpStatus ?? 0 })
              : summary.errors > 0
                ? t('reportErrors', { count: summary.errors })
                : summary.reported
                  ? t('reportClean', { requests: summary.requests })
                  : t('reportUnknown')}
          </span>
        </button>
        {openReport && <div className={`${styles.webPageReportLines} nowheel nodrag`} role="region" aria-label={t('reportRegion')}>
          {report.length === 0
            ? <p className={styles.webPageMuted}>{t('reportUnknownHint')}</p>
            : <ol>
              {report.map((entry: CanvasPreviewEntry, index: number) => (
                <li key={`${entry.at}-${index}`} data-level={entry.level}>
                  <span>{t(`reportLevel.${entry.level}` as 'reportLevel.log')}</span>
                  <span>{entry.text}</span>
                </li>
              ))}
            </ol>}
        </div>}
      </div>}

      {(probing || error) && <div className={styles.webPageStatus} role="status">{error ?? t('checking')}</div>}
    </div>
  );
}
