'use client';

/**
 * StorageHeadroom — how full one Neon endpoint is against its plan ceiling.
 *
 * WHY IT IS ITS OWN COMPONENT. The number it draws is the one the nightly
 * `db-pressure` sweep acts on: past 80% that sweep re-purges every compressible log
 * table at a shortened window, and past 90% at its floor. An operator has to be able to
 * see what the sweep is about to see, from the same figures, or the first sign of a
 * database filling up is a vendor banner and the first sign of the response is history
 * that is no longer there. It is self-contained so it can be dropped beside any other
 * endpoint readout without edits — it takes only the three numbers the API already
 * returns and owns its own thresholds, labels and empty state.
 *
 * `tier` arrives from the server rather than being re-derived here on purpose: the
 * thresholds live in `application/maintenance/storagePressure.ts` beside the sweep that
 * enforces them, and a second copy in the UI is exactly the drift that would let this
 * bar read green on the morning the sweep started compressing windows.
 */

import { useTranslations } from 'next-intl';
import { formatBytes } from '@/lib/formatBytes';

export type StorageTier = 'ok' | 'warn' | 'critical';

interface StorageHeadroomProps {
  /** Bytes the endpoint currently holds (`pg_database_size`). */
  totalBytes: number;
  /** Bytes the plan allows one branch. 0 or absent = unknown, and nothing renders. */
  ceilingBytes?: number;
  /** The sweep's own verdict on `totalBytes / ceilingBytes`. */
  tier?: StorageTier;
}

/** Bar colour per tier. Theme tokens only — the same three read correctly in light and
 *  dark, where a literal green/amber/red would not. */
const TIER_COLOR: Record<StorageTier, string> = {
  ok: 'var(--success, #15803d)',
  warn: 'var(--warning, #b45309)',
  critical: 'var(--danger, #b91c1c)',
};

export function StorageHeadroom({ totalBytes, ceilingBytes, tier = 'ok' }: StorageHeadroomProps) {
  const t = useTranslations('admin.system.storage');
  // Nothing to say without a ceiling: a bare size is already shown beside this, and a
  // percentage of an unknown limit would be an invented number.
  if (!ceilingBytes || ceilingBytes <= 0) return null;

  const ratio = totalBytes / ceilingBytes;
  const percent = Math.round(ratio * 100);
  // The BAR is clamped so an over-ceiling endpoint still draws inside its track; the
  // LABEL is not, because "104%" is the fact an operator needs to see.
  const width = Math.min(100, Math.max(0, ratio * 100));

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span className="text-muted" style={{ fontSize: 'var(--font-size-small)' }}>
          {t('label', { used: formatBytes(totalBytes), ceiling: formatBytes(ceilingBytes) })}
        </span>
        <span className={`badge ${tier === 'ok' ? 'badge-success' : tier === 'warn' ? 'badge-warning' : 'badge-danger'}`}>
          {t(`tier.${tier}`, { percent })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('label', { used: formatBytes(totalBytes), ceiling: formatBytes(ceilingBytes) })}
        style={{
          marginTop: 6,
          height: 6,
          width: '100%',
          borderRadius: 999,
          background: 'var(--border)',
          overflow: 'hidden',
        }}
      >
        <div style={{ height: '100%', width: `${width}%`, background: TIER_COLOR[tier], borderRadius: 999 }} />
      </div>
      {tier !== 'ok' && (
        <div className="text-muted" style={{ fontSize: 'var(--font-size-small)', marginTop: 6 }}>
          {t(tier === 'critical' ? 'noteCritical' : 'noteWarn')}
        </div>
      )}
    </div>
  );
}
