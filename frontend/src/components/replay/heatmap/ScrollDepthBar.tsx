/**
 * How far down the page visitors get (PRD 33 §2.1 "scroll heatmap", §8 S4):
 * the share of page views reaching each tenth of the page, from
 * `heatScroll` — exact over every session (D15/D18). Text beside every bar,
 * so the reading never depends on the bar's colour or length alone.
 */

import { useTranslations } from 'next-intl';
import type { ReplayDeviceClass, ReplayScrollDepthDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useAdminData } from '@/components/admin/adminShared';
import { useFormat } from '@/i18n/useFormat';
import styles from './heatmap.module.css';

export interface ScrollDepthBarProps {
  siteId: string;
  route: string;
  release?: string | null;
  device?: ReplayDeviceClass | null;
  days?: number;
}

export function ScrollDepthBar({ siteId, route, release = null, device = null, days }: ScrollDepthBarProps) {
  const t = useTranslations('replay.heat.scroll');
  const fmt = useFormat();
  const { data, loading, error } = useAdminData<ReplayScrollDepthDto>(
    () => replayApi.heatScroll(siteId, { route, release, device, days }),
    [siteId, route, release, device, days],
  );

  return (
    <section aria-labelledby="heat-scroll-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <h3 id="heat-scroll-heading" style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('title')}</h3>
      {error && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{t('error')} {error}</p>}
      {loading && !data && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>}
      {data && data.sessions === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>}
      {data && data.sessions > 0 && (
        <>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
            {t('sessions', { count: fmt.number(data.sessions) })}
          </p>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {data.reach.slice(0, 10).map((reach, decile) => {
              const band = t('band', { from: decile * 10, to: (decile + 1) * 10 });
              const share = fmt.percent(reach);
              return (
                <li key={decile} className={styles.scrollRow} data-testid="heat-scroll-row">
                  <span style={{ color: 'var(--text-secondary)' }}>{band}</span>
                  <span
                    className={styles.scrollTrack}
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(reach * 100)}
                    aria-label={t('reachAria', { band, share })}
                  >
                    <span className={styles.scrollFill} style={{ display: 'block', width: `${Math.max(0, Math.min(1, reach)) * 100}%` }} />
                  </span>
                  <span style={{ textAlign: 'right' }}>{share}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
