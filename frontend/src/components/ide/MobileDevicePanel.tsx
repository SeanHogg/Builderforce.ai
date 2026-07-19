'use client';

/**
 * "Preview on your phone" — the Mobile modality's hand-off to a real handset.
 *
 * The simulator in the centre pane runs against the WebContainer dev server,
 * which lives inside the current browser tab and is unreachable from any other
 * device. A phone therefore needs a PUBLISHED build, so this panel encodes the
 * project's published URL as a QR code and, when nothing is published yet, says
 * so plainly and points at the Publish tab rather than showing a dead code.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { QrCode } from './QrCode';
import { fetchSite, type SiteInfo } from '@/lib/api';

interface MobileDevicePanelProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  /** Switches the right panel to Publish — the fix for the unpublished state. */
  onGoToPublish: () => void;
}

export function MobileDevicePanel({ open, onClose, projectId, onGoToPublish }: MobileDevicePanelProps) {
  const t = useTranslations('ide');
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Re-read on each open so a publish made while the panel was closed shows up.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchSite(projectId)
      .then((s) => { if (!cancelled) setSite(s); })
      .catch(() => { if (!cancelled) setSite(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyUrl = useCallback(async () => {
    if (!site?.url) return;
    try {
      await navigator.clipboard.writeText(site.url);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the URL is shown as text either way.
    }
  }, [site]);

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('device.panelTitle')} width="min(420px, 96vw)">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18, color: 'var(--text-primary)' }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
          {t('device.panelIntro')}
        </p>

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('device.checking')}</div>
        ) : site?.url ? (
          <>
            <div
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
                padding: 18, borderRadius: 12,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              }}
            >
              <QrCode value={site.url} size={200} label={t('device.qrAlt')} />
              <code
                style={{
                  fontSize: 12, color: 'var(--text-secondary)', wordBreak: 'break-all',
                  textAlign: 'center', fontFamily: 'var(--font-mono, monospace)',
                }}
              >
                {site.url}
              </code>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button type="button" onClick={copyUrl} style={secondaryButton}>
                  {copied ? t('device.copied') : t('device.copyLink')}
                </button>
                <a
                  href={site.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...secondaryButton, textDecoration: 'none', display: 'inline-block' }}
                >
                  {t('device.openLink')}
                </a>
              </div>
            </div>

            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <li style={stepStyle}>{t('device.step1')}</li>
              <li style={stepStyle}>{t('device.step2')}</li>
              <li style={stepStyle}>{t('device.step3')}</li>
            </ol>

            {site.publishedAt && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                {t('device.lastPublished', { when: new Date(site.publishedAt).toLocaleString() })}
              </p>
            )}
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {t('device.republishHint')}
            </p>
          </>
        ) : (
          <div
            style={{
              display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start',
              padding: 18, borderRadius: 12,
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            }}
          >
            <span style={{ fontSize: 32 }} aria-hidden>🚀</span>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{t('device.notPublishedTitle')}</p>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
              {t('device.notPublishedBody')}
            </p>
            <button
              type="button"
              onClick={() => { onGoToPublish(); onClose(); }}
              style={{
                padding: '9px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                color: '#fff', fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--font-display)',
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

const secondaryButton: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
  background: 'var(--bg-deep)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)', fontFamily: 'var(--font-display)',
};

const stepStyle: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)',
};
