import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { formatPitchDuration, pitchBeats, pitchCompetitionFor, pitchRuntimeSeconds, pitchSpokenSeconds, pitchTimingTone } from '@/lib/pitchCompetition';
import type { CreationBodyProps } from './types';
import { PitchLabel } from './pitchParts';

export function PitchBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.pitch');
  const competition = pitchCompetitionFor(data);
  const beats = pitchBeats(data);
  const budget = pitchRuntimeSeconds(beats);
  const spoken = pitchSpokenSeconds(beats);
  const written = beats.filter((beat) => beat.written).length;
  return <div className={styles.pitchBody}>
    <div className={styles.pitchClock} data-tone={pitchTimingTone(spoken || budget, competition.pitchSeconds)}>
      <div><small>{t('runtime')}</small><strong>{formatPitchDuration(spoken || budget)}</strong><span>{t('ofLimit', { limit: formatPitchDuration(competition.pitchSeconds) })}</span></div>
      <div><small>{t('budget')}</small><b>{formatPitchDuration(budget)}</b><span>{t('beatsWritten', { written, total: beats.length })}</span></div>
      <div><small>{t('judgeQa')}</small><b>{formatPitchDuration(competition.qaSeconds)}</b><span>{competition.name}</span></div>
    </div>
    <ol className={styles.pitchBeats}>
      {beats.map((beat) => <li key={beat.id} data-written={beat.written ? 'true' : 'false'}>
        <i style={{ '--pitch-beat-share': `${competition.pitchSeconds ? Math.round((beat.seconds / competition.pitchSeconds) * 100) : 0}%` } as CSSProperties} />
        <b><PitchLabel item={beat} /></b>
        <small>{formatPitchDuration(beat.seconds)}</small>
        <p>{beat.script || beat.prompt || t('beatEmpty')}</p>
      </li>)}
    </ol>
  </div>;
}
