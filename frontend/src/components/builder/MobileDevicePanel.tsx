'use client';

/**
 * "Preview on your phone" — the Mobile modality's hand-off to a real handset.
 *
 * TWO things a phone can load, and the panel has to be honest about WHICH one it just
 * put in the QR:
 *
 *   1. The LIVE preview — a dev server running inside the project's cloud-run container,
 *      reached through the signed preview ingress. It reflects the work in progress and
 *      hot-reloads, and its link EXPIRES. This is what the roadmap item asked for: the
 *      panel now calls the mint endpoint and encodes that URL.
 *   2. The PUBLISHED build — the last publish, served from R2. Always there once you have
 *      published, never reflects unsaved work.
 *
 * The simulator in the centre pane is neither: it runs against the WebContainer dev
 * server inside this browser tab, which no other device can reach. So the panel mints a
 * live preview first, falls back to the published build, and — the part that matters —
 * SAYS which of the two the code points at, because a QR that silently switched between
 * "your latest edits" and "your last publish" is worse than one that only ever did one.
 */

import { Icon } from '@/components/ui/Icon';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { QrCode } from './QrCode';
import { fetchSite, fetchLivePreviewUrl, type SiteInfo, type LivePreviewLink } from '@/lib/api';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { useFormat } from "@/i18n/useFormat";

interface MobileDevicePanelProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  /** Switches the right panel to Publish — the fix for the unpublished state. */
  onGoToPublish: () => void;
}

export function MobileDevicePanel({ open, onClose, projectId, onGoToPublish }: MobileDevicePanelProps) {
  const fmt = useFormat();
  const t = useTranslations('ide');
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [live, setLive] = useState<LivePreviewLink | null>(null);
  const [loading, setLoading] = useState(false);
  // 2000ms confirmation (the hook's default); the hook also owns the reset timer that
  // used to need its own effect below.
  const { copied, copy } = useCopyToClipboard();

  // Re-read on each open so a publish — or a dev server that came up — while the panel
  // was closed shows up. Both are asked in parallel: the live mint is the preferred
  // answer but the published build is the fallback, and waiting for one to fail before
  // starting the other would make the common case feel slow.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchLivePreviewUrl(projectId), fetchSite(projectId).catch(() => null)])
      .then(([preview, s]) => {
        if (cancelled) return;
        setLive(preview);
        setSite(s);
      })
      .catch(() => { if (!cancelled) { setLive(null); setSite(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId]);

  // The one URL the QR encodes. Live wins; published is the fallback.
  const target = live?.url ?? site?.url ?? null;
  const isLive = !!live?.url;

  const copyUrl = useCallback(() => {
    if (!target) return;
    // Clipboard access can be denied; the URL is shown as text either way, so a
    // failure stays silent exactly as before.
    void copy(target);
  }, [target, copy]);

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('device.panelTitle')} width="sheet" widthStorageKey="mobile-device-preview">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18, color: 'var(--text-primary)' }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
          {t('device.panelIntro')}
        </p>

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('device.checking')}</div>
        ) : target ? (
          <>
            <div
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
                padding: 18, borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              }}
            >
              {/* WHICH of the two things this code points at — stated, never inferred. */}
              <span style={isLive ? liveBadge : publishedBadge}>
                {isLive ? t('device.liveBadge') : t('device.publishedBadge')}
              </span>
              <QrCode
                value={target}
                size={200}
                label={isLive ? t('device.qrAltLive') : t('device.qrAlt')}
              />
              <code
                style={{
                  fontSize: 12, color: 'var(--text-secondary)', wordBreak: 'break-all',
                  textAlign: 'center', fontFamily: 'var(--font-mono, monospace)',
                }}
              >
                {target}
              </code>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button type="button" onClick={copyUrl} style={secondaryButton}>
                  {copied ? t('device.copied') : t('device.copyLink')}
                </button>
                <a
                  href={target}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...secondaryButton, textDecoration: 'none', display: 'inline-block' }}
                >
                  {t('device.openLink')}
                </a>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: 'var(--font-size-small)', lineHeight: 1.55, color: 'var(--text-secondary)' }}>
              {isLive ? t('device.liveExplain') : t('device.publishedExplain')}
            </p>

            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <li style={stepStyle}>{t('device.step1')}</li>
              <li style={stepStyle}>{t('device.step2')}</li>
              <li style={stepStyle}>{t('device.step3')}</li>
            </ol>

            {isLive ? (
              <>
                {live!.status === 'starting' && (
                  <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {t('device.liveStarting')}
                  </p>
                )}
                {live!.expiresInSeconds > 0 && (
                  <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
                    {t('device.liveExpires', { minutes: Math.max(1, Math.round(live!.expiresInSeconds / 60)) })}
                  </p>
                )}
              </>
            ) : (
              <>
                {site?.publishedAt && (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                    {t('device.lastPublished', { when: fmt.dateTime(site.publishedAt) })}
                  </p>
                )}
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {t('device.republishHint')}
                </p>
              </>
            )}
          </>
        ) : (
          <div
            style={{
              display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start',
              padding: 18, borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            }}
          >
            <span style={{ fontSize: 32 }} aria-hidden><Icon source="🚀" size="1em" /></span>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{t('device.notPublishedTitle')}</p>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
              {t('device.notPublishedBody')}
            </p>
            <button
              type="button"
              onClick={() => { onGoToPublish(); onClose(); }}
              style={{
                padding: '9px 16px', borderRadius: 'var(--radius-lg)', border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                color: 'var(--text-on-accent)', fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--font-display)',
              }}
            >
              {t('device.goToPublish')}
            </button>
          </div>
        )}
      </div>
    </SlideOutPanel>
  );
}

const badgeBase: React.CSSProperties = {
  alignSelf: 'center', padding: '3px 10px', borderRadius: 'var(--radius-full)',
  fontSize: 'var(--font-size-eyebrow)',
  fontWeight: 700, letterSpacing: '0.02em', textTransform: 'uppercase',
  border: '1px solid var(--border-subtle)',
};

const liveBadge: React.CSSProperties = {
  ...badgeBase, background: 'var(--success-bg)', color: 'var(--success-text)',
  borderColor: 'var(--success-border)',
};

const publishedBadge: React.CSSProperties = {
  ...badgeBase, background: 'var(--bg-deep)', color: 'var(--text-secondary)',
};

const secondaryButton: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
  background: 'var(--bg-deep)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)', fontFamily: 'var(--font-display)',
};

const stepStyle: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)',
};
