'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { fetchSpawnInstallers, type SpawnInstallers } from '@/lib/spawn/spawnApi';
import { SPAWN_DOWNLOAD_URL } from '@/lib/spawn/spawnLinks';
import styles from './spawn.module.css';

type Platform = 'windows' | 'mac' | 'other';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|Android/i.test(ua)) return 'other';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  return 'other';
}

/** The platform never changes while the page is open; there is nothing to subscribe to. */
const noSubscription = () => () => {};

/**
 * THE Spawn download: one click to the installer for the computer the visitor is
 * on, read from the newest release (`/api/spawn/downloads`). Every download on
 * the site is this button, so the header, the hero and the account page can never
 * point at different files. Before the installers load — or on a phone, where
 * Studio does not run — it opens the release list instead of doing nothing.
 *
 * `compact` is the header's size: the button alone, no other-computer links.
 */
export function SpawnDownloadButton({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('spawn.download');
  // The server renders the any-computer button; the browser swaps in its own platform.
  const platform = useSyncExternalStore<Platform>(noSubscription, detectPlatform, () => 'other');
  const [installers, setInstallers] = useState<SpawnInstallers | null>(null);

  useEffect(() => {
    // No installers yet → the button keeps its release-list fallback; nothing to report.
    fetchSpawnInstallers().then(setInstallers, () => setInstallers(null));
  }, []);

  const fallback = installers?.releaseUrl ?? SPAWN_DOWNLOAD_URL;
  const direct = platform === 'windows' ? installers?.windows : platform === 'mac' ? installers?.macArm : null;
  const label = platform === 'windows' ? t('windows') : platform === 'mac' ? t('mac') : t('any');

  const others = [
    platform !== 'windows' && installers?.windows ? { href: installers.windows, label: t('windowsShort') } : null,
    platform !== 'mac' && installers?.macArm ? { href: installers.macArm, label: t('macArm') } : null,
    installers?.macIntel ? { href: installers.macIntel, label: t('macIntel') } : null,
  ].filter((o): o is { href: string; label: string } => o !== null);

  if (compact) {
    return <a href={direct ?? fallback} className={styles.ctaSmall}>{label}</a>;
  }
  return (
    <div className={styles.download}>
      <a href={direct ?? fallback} className={styles.ctaBig}>
        <span aria-hidden>⬇</span> {label}
      </a>
      <p className={styles.fine}>
        {platform === 'other' && <>{t('needsComputer')} </>}
        {others.length > 0 && <>{t('alsoFor')} </>}
        {others.map((o, i) => (
          <span key={o.href}>{i > 0 && ' · '}<a href={o.href} className={styles.inlineLink}>{o.label}</a></span>
        ))}
        {others.length === 0 && <a href={fallback} className={styles.inlineLink} target="_blank" rel="noopener noreferrer">{t('all')}</a>}
      </p>
    </div>
  );
}
