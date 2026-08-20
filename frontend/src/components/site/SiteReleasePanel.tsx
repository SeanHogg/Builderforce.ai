'use client';

/**
 * Rollback and packaging — the two things a published app needs that publishing
 * alone never gave it.
 *
 * ── ROLLBACK ────────────────────────────────────────────────────────────────
 * Publishing used to delete the previous build before writing the new one, so a
 * bad release destroyed the working one it replaced. Builds now land under their
 * own version prefix and this panel is where one is put back — a pointer move and
 * a cache invalidation, not a rebuild, so it is effectively instant.
 *
 * ── PACKAGING ───────────────────────────────────────────────────────────────
 * Real Capacitor / PWA / APK / signed-`.ipa` adapters already existed and were
 * reachable only from the game domain. The same build that publishes is now also
 * what gets packaged, so the thing installed on a phone is byte-for-byte the thing
 * that was previewed.
 *
 * Gates itself on there being a published site, in keeping with the sibling
 * panels: the consumer never repeats the condition.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import {
  APP_PACKAGE_TARGETS,
  fetchSiteReleases,
  packageApp,
  restoreSiteRelease,
  type AppPackageTarget,
  type SiteRelease,
} from '@/lib/api';
import { useFormat } from "@/i18n/useFormat";

interface SiteReleasePanelProps {
  projectId: number;
  /** Build the project and return its dist assets — the same builder publish uses. */
  onBuild: () => Promise<Array<{ path: string; data: Uint8Array }>>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SiteReleasePanel({ projectId, onBuild }: SiteReleasePanelProps) {
    const fmt = useFormat();
  const t = useTranslations('ide');
  const [releases, setReleases] = useState<SiteRelease[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchSiteReleases(projectId).then(setReleases).catch(() => setReleases([]));
  }, [projectId]);

  useEffect(load, [load]);

  const restore = useCallback(async (versionToken: string) => {
    setBusy(versionToken);
    setError(null);
    setNotice(null);
    try {
      await restoreSiteRelease(projectId, versionToken);
      setNotice(t('releases.restored'));
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('releases.restoreFailed'));
    } finally {
      setBusy(null);
    }
  }, [load, projectId, t]);

  const pack = useCallback(async (target: AppPackageTarget) => {
    setBusy(target);
    setError(null);
    setNotice(null);
    try {
      const assets = await onBuild();
      const result = await packageApp(projectId, target, assets);
      setNotice(t('packaging.done', { directory: result.state.directory }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('packaging.failed'));
    } finally {
      setBusy(null);
    }
  }, [onBuild, projectId, t]);

  // Nothing published yet — the sibling panels take the same posture, so the
  // consumer never has to know the condition.
  if (!releases.length) return null;

  return (
    <div style={{ borderTop: '1px solid var(--chat-input-border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 'var(--font-size-body)' }}><Icon source="↩️" size="1em" /> {t('releases.title')}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', marginTop: 2 }}>{t('releases.description')}</div>
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {releases.map((release) => (
          <li
            key={release.versionToken}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              padding: '7px 10px', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            }}
          >
            <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, monospace)' }}>
              {release.versionToken.slice(0, 8)}
            </span>
            <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', flex: 1, minWidth: 0 }}>
              {release.publishedAt ? fmt.dateTime(release.publishedAt) : '—'}
              {' · '}{formatBytes(release.totalBytes)}
              {' · '}{release.source}
            </span>
            {release.current ? (
              <span style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 600, color: 'var(--emerald-bright)' }}>{t('releases.current')}</span>
            ) : (
              <button
                type="button"
                onClick={() => { void restore(release.versionToken); }}
                disabled={busy !== null}
                style={{
                  padding: '4px 10px', fontSize: 'var(--font-size-eyebrow)', fontWeight: 600, minHeight: 28,
                  borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-deep)', color: 'var(--text-secondary)',
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >
                {busy === release.versionToken ? t('releases.restoring') : t('releases.restore')}
              </button>
            )}
          </li>
        ))}
      </ul>

      <div>
        <div style={{ fontWeight: 600, fontSize: 'var(--font-size-body)' }}><Icon source="📱" size="1em" /> {t('packaging.title')}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', marginTop: 2 }}>{t('packaging.description')}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {APP_PACKAGE_TARGETS.map((target) => (
          <button
            key={target}
            type="button"
            onClick={() => { void pack(target); }}
            disabled={busy !== null}
            style={{
              padding: '7px 14px', fontSize: 'var(--font-size-small)', fontWeight: 600, minHeight: 32,
              borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
              background: 'var(--bg-deep)', color: 'var(--text-primary)',
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {busy === target ? t('packaging.working') : t(`packaging.target.${target}`)}
          </button>
        ))}
      </div>

      {notice && <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{notice}</div>}
      {error && <div role="alert" style={{ fontSize: 'var(--font-size-small)', color: 'var(--error-text)', whiteSpace: 'pre-wrap' }}>{error}</div>}
    </div>
  );
}
