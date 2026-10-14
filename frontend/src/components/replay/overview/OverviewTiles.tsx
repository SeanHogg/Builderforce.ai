/**
 * The Overview dashboard's numbers (PRD 33 §2.1 "Dashboard"), as two
 * registries of the shared `StatTile`: the traffic tiles and the frustration
 * tiles. A frustration tile is a button — it narrows the ONE filter to that
 * signal and opens the issues behind it. Every value says whether it is exact
 * or estimated: a filtered overview is read from kept recordings weighted by
 * `sample_weight` and prints "≈" (D15).
 */

import { useTranslations } from 'next-intl';
import type { FrustrationMarkKind, ReplayOverviewDto } from '@builderforce/interaction-contract';
import { useFormat } from '@/i18n/useFormat';
import type { Formatter } from '@/i18n/format';
import { StatTile } from '@/components/admin/adminShared';
import { fmtClock } from '../replayMarks';

const EMPTY = '—';

export interface OverviewTileDef {
  id: string;
  /** Under `replay.overview.tile`. */
  labelKey: string;
  /** null = the read cannot know it (a weighted read has no new visitors or scroll depth). */
  value: (overview: ReplayOverviewDto, fmt: Formatter) => string | null;
}

export const OVERVIEW_TILES: ReadonlyArray<OverviewTileDef> = [
  { id: 'sessions', labelKey: 'sessions', value: (o, fmt) => fmt.number(o.sessions) },
  { id: 'newVisitors', labelKey: 'newVisitors', value: (o, fmt) => (o.newVisitors == null ? null : fmt.number(o.newVisitors)) },
  { id: 'pagesPerSession', labelKey: 'pagesPerSession', value: (o, fmt) => fmt.number(o.pagesPerSession, { maximumFractionDigits: 1 }) },
  { id: 'activeTime', labelKey: 'activeTime', value: (o) => fmtClock(o.avgActiveMs) },
  { id: 'scrollDepth', labelKey: 'scrollDepth', value: (o, fmt) => (o.avgScrollDepthPct == null ? null : fmt.percent(o.avgScrollDepthPct / 100)) },
];

export interface FrustrationTileDef {
  key: keyof ReplayOverviewDto['frustration'];
  /** The `frustration` filter value this tile narrows to. */
  kind: FrustrationMarkKind;
  /** Ink when the share is above zero. */
  tone: 'error' | 'warning';
}

export const FRUSTRATION_TILES: ReadonlyArray<FrustrationTileDef> = [
  { key: 'rage', kind: 'rage', tone: 'error' },
  { key: 'dead', kind: 'dead', tone: 'warning' },
  { key: 'quickback', kind: 'quickback', tone: 'warning' },
  { key: 'excessiveScroll', kind: 'excessive_scroll', tone: 'warning' },
  { key: 'error', kind: 'error', tone: 'error' },
];

export interface OverviewTilesProps {
  overview: ReplayOverviewDto;
  onFrustration: (kind: FrustrationMarkKind) => void;
}

const rowStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-2)', minWidth: 0 } as const;

export function OverviewTiles({ overview, onFrustration }: OverviewTilesProps) {
  const t = useTranslations('replay.overview');
  const fmt = useFormat();
  const shown = (value: string | null) => (value == null ? EMPTY : overview.estimated ? t('approx', { value }) : value);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <div role="group" aria-label={t('trafficAria')} style={rowStyle}>
        {OVERVIEW_TILES.map((tile) => {
          const value = tile.value(overview, fmt);
          return (
            <div key={tile.id} style={{ display: 'flex', minWidth: 0 }}>
              <StatTile label={t(`tile.${tile.labelKey}`)} value={shown(value)} hint={value == null ? t('notInWeighted') : undefined} />
            </div>
          );
        })}
      </div>
      <div role="group" aria-label={t('frustrationAria')} style={rowStyle}>
        {FRUSTRATION_TILES.map((tile) => {
          const share = overview.frustration[tile.key];
          const label = t(`frustration.${tile.key}`);
          return (
            <button
              key={tile.key}
              type="button"
              aria-label={t('frustrationOpen', { label })}
              onClick={() => onFrustration(tile.kind)}
              style={{ display: 'flex', padding: 0, border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', color: 'inherit', minWidth: 0 }}
            >
              <StatTile
                label={label}
                value={shown(fmt.percent(share, 1))}
                hint={t('ofSessions')}
                tone={share > 0 ? tile.tone : undefined}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
