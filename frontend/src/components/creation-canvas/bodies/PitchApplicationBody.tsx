import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { pitchApplicationAnswers, pitchApplicationReadiness, pitchCompetitionFor, pitchEligibility } from '@/lib/pitchCompetition';
import type { CreationBodyProps } from './types';
import { PitchLabel } from './pitchParts';

export function PitchApplicationBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.pitch');
  const competition = pitchCompetitionFor(data);
  const answers = pitchApplicationAnswers(data);
  const eligibility = pitchEligibility(data);
  const readiness = pitchApplicationReadiness(answers, eligibility);
  const tone = readiness.submittable ? 'good' : readiness.unmetRules.length || readiness.overLimit.length ? 'risk' : 'watch';
  return <div className={styles.pitchBody}>
    <div className={styles.pitchReadiness} data-tone={tone} style={{ '--pitch-readiness': readiness.percent } as CSSProperties}>
      <div className={styles.pitchGauge}><strong>{readiness.percent}%</strong><small>{t('complete')}</small></div>
      <div><small>{t('entryFor')}</small><b>{competition.name}</b><p>{readiness.submittable ? t('readyToSubmit') : t('blockedCount', { count: readiness.unmetRules.length + readiness.overLimit.length })}</p></div>
    </div>
    {eligibility.length > 0 && <div className={styles.pitchEligibility}>
      {eligibility.map((rule) => <span key={rule.id} data-met={rule.met ? 'true' : 'false'}>{rule.met ? '✓' : '○'} <PitchLabel item={rule} /></span>)}
    </div>}
    <div className={styles.pitchAnswers}>
      {answers.map((answer) => <div key={answer.id} data-over={answer.over ? 'true' : 'false'} data-answered={answer.answered ? 'true' : 'false'}>
        <b><PitchLabel item={answer} /></b>
        {answer.maxChars > 0 && <small>{t('charCount', { chars: answer.chars, max: answer.maxChars })}</small>}
        <p>{answer.answer || t('answerEmpty')}</p>
      </div>)}
    </div>
  </div>;
}
