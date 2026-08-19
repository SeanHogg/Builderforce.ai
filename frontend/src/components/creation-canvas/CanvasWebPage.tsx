'use client';

import { Icon } from '@/components/ui/Icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';
import { brain } from '@/lib/builderforceApi';
import { canvasViewport } from '@/lib/canvasViewport';
import {
  canvasWebPageUrl, hasWebPageProbe, isLocalWebPageUrl, isMixedContentFrame, normalizeWebPageUrl,
  webPageHost,
} from '@/lib/canvasWebPage';
import { CanvasDeviceFrame } from './CanvasDeviceFrame';

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
        live.current.onEdit?.({ frameCheckedUrl: url, frameable: true, frameBlockedBy: null });
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

      {(probing || error) && <div className={styles.webPageStatus} role="status">{error ?? t('checking')}</div>}
    </div>
  );
}
