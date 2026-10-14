/**
 * The heatmap's controls (PRD 33 §8 S4): route, release, compare release,
 * device, layer tabs and mode tabs. Presentational — `HeatmapView` owns the
 * state. Which controls show is the caller's (`compact` in a lens hides the
 * route picker, compare and modes).
 */

import { useTranslations } from 'next-intl';
import type { ReplayDeviceClass, ReplayReleaseDto, ReplayRouteStatDto } from '@builderforce/interaction-contract';
import { HEAT_MODES, type HeatLayerId, type HeatMode } from './heatLayers';
import styles from './heatmap.module.css';

const DEVICES: readonly ReplayDeviceClass[] = ['desktop', 'tablet', 'phone'];
const ALL = '';

export interface HeatmapControlsProps {
  compact: boolean;
  route: string;
  routes: readonly ReplayRouteStatDto[];
  onRoute: (route: string) => void;
  releases: readonly ReplayReleaseDto[];
  release: string | null;
  onRelease: (release: string | null) => void;
  compare: string | null;
  onCompare: (release: string | null) => void;
  device: ReplayDeviceClass | null;
  onDevice: (device: ReplayDeviceClass | null) => void;
  layers: readonly HeatLayerId[];
  layer: HeatLayerId;
  onLayer: (layer: HeatLayerId) => void;
  mode: HeatMode;
  onMode: (mode: HeatMode) => void;
  /** Modes are for heat cells; Areas always shows one release. */
  modesEnabled: boolean;
}

export function HeatmapControls(props: HeatmapControlsProps) {
  const t = useTranslations('replay');
  const { compact, releases } = props;
  const releaseLabel = (row: ReplayReleaseDto) => row.label ?? t('heat.releaseOrdinal', { ordinal: row.ordinal });
  // The route being viewed is always a choice, even when it is not among the busiest.
  const routeChoices = props.routes.some((row) => row.route === props.route)
    ? props.routes.map((row) => row.route)
    : [props.route, ...props.routes.map((row) => row.route)];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <div className={styles.controls}>
        {!compact && (
          <label className={styles.control}>
            <span>{t('heat.route')}</span>
            <select className="input" value={props.route} onChange={(event) => props.onRoute(event.currentTarget.value)}>
              {routeChoices.map((route) => <option key={route} value={route}>{route}</option>)}
            </select>
          </label>
        )}
        <label className={styles.control}>
          <span>{t('heat.release')}</span>
          <select className="input" value={props.release ?? ALL} onChange={(event) => props.onRelease(event.currentTarget.value || null)}>
            <option value={ALL}>{t('heat.allReleases')}</option>
            {releases.map((row) => <option key={row.releaseKey} value={row.releaseKey}>{releaseLabel(row)}</option>)}
          </select>
        </label>
        {!compact && (
          <label className={styles.control}>
            <span>{t('heat.compare')}</span>
            <select className="input" value={props.compare ?? ALL} onChange={(event) => props.onCompare(event.currentTarget.value || null)}>
              <option value={ALL}>{t('heat.noCompare')}</option>
              {releases.filter((row) => row.releaseKey !== props.release).map((row) => (
                <option key={row.releaseKey} value={row.releaseKey}>{releaseLabel(row)}</option>
              ))}
            </select>
          </label>
        )}
        <label className={styles.control}>
          <span>{t('heat.device')}</span>
          <select
            className="input"
            value={props.device ?? ALL}
            onChange={(event) => props.onDevice((event.currentTarget.value || null) as ReplayDeviceClass | null)}
          >
            <option value={ALL}>{t('heat.allDevices')}</option>
            {DEVICES.map((device) => <option key={device} value={device}>{t(`player.deviceClass.${device}`)}</option>)}
          </select>
        </label>
      </div>

      <div className={styles.controls}>
        <div role="tablist" aria-label={t('heat.layersAria')} className={styles.tabs}>
          {props.layers.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === props.layer}
              className={id === props.layer ? 'btn-secondary' : 'btn-ghost'}
              onClick={() => props.onLayer(id)}
            >
              {t(`heat.layers.${id}`)}
            </button>
          ))}
        </div>
        {!compact && (
          <div role="tablist" aria-label={t('heat.modesAria')} className={styles.tabs}>
            {HEAT_MODES.map((row) => {
              const disabled = !props.modesEnabled || (row.needsCompare && !props.compare);
              return (
                <button
                  key={row.id}
                  type="button"
                  role="tab"
                  aria-selected={row.id === props.mode}
                  disabled={disabled && row.id !== 'single'}
                  className={row.id === props.mode ? 'btn-secondary' : 'btn-ghost'}
                  onClick={() => props.onMode(row.id)}
                >
                  {t(`heat.modes.${row.id}`)}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {!compact && !props.compare && <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('heat.compareHint')}</p>}
    </div>
  );
}
