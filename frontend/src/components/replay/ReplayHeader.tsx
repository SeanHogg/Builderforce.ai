/**
 * What the reader needs before pressing play: which release, which device,
 * where from, how long. Facts, not chrome — every value is a chip with a label.
 */

import { useTranslations } from 'next-intl';
import type { ReplayRecordingDto } from '@builderforce/interaction-contract';
import { fmtClock } from './replayMarks';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 'var(--space-1)',
        alignItems: 'baseline',
        padding: '2px var(--space-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--font-size-small)',
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </span>
  );
}

export function ReplayHeader({ recording }: { recording: ReplayRecordingDto }) {
  const t = useTranslations('replay.player');
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', minWidth: 0 }}>
      <Fact label={t('release')} value={recording.releaseKey.slice(0, 12)} />
      <Fact label={t('device')} value={t(`deviceClass.${recording.deviceClass}`)} />
      <Fact label={t('country')} value={recording.country ?? '—'} />
      <Fact label={t('referrer')} value={recording.referrerHost ?? t('direct')} />
      <Fact label={t('duration')} value={fmtClock(recording.durationMs)} />
    </div>
  );
}
