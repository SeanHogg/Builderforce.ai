import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { formatPitchDuration, pitchCompetitionFor, pitchQaCoverage, pitchQaItems, pitchReadinessTone } from '@/lib/pitchCompetition';
import type { CreationBodyProps } from './types';
import { PitchScoreRow } from './pitchParts';

export function PitchQaBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.pitch');
  const competition = pitchCompetitionFor(data);
  const items = pitchQaItems(data);
  const coverage = pitchQaCoverage(items);
  return <div className={styles.pitchBody}>
    <div className={styles.pitchReadiness} data-tone={pitchReadinessTone(coverage.percent)} style={{ '--pitch-readiness': coverage.percent } as CSSProperties}>
      <div className={styles.pitchGauge}><strong>{coverage.percent}%</strong><small>{t('rehearsed')}</small></div>
      <div><small>{t('qaWindow')}</small><b>{formatPitchDuration(competition.qaSeconds)}</b><p>{t('answeredCount', { answered: coverage.answered, total: coverage.total })}</p></div>
    </div>
    <div className={styles.pitchQaList}>
      {items.map((item) => <div key={item.id} data-answered={item.answered ? 'true' : 'false'}>
        <b>{item.question}</b>
        <PitchScoreRow score={item.strength} />
        <p>{item.answer || t('answerEmpty')}</p>
      </div>)}
    </div>
  </div>;
}
