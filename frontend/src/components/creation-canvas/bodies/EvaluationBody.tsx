import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
// One provenance line and one gate badge, rendered by every body that shows a derived
// number — see the header there for why a truncated number is worse than a blank one.
import { EvaluationGateBadge } from '../DerivedProvenance';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';
import { authoredText } from './shared';

export function EvaluationBody({ data }: CreationBodyProps) {
  const { openDetails } = useCreationNodeActions();
  const onOpen = () => openDetails?.('evaluation');
  const t = useTranslations('creationCanvas.node');
  const gaps = Array.isArray(data.gaps) ? data.gaps.slice(0, 3).map(String) : [];
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations.slice(0, 3).map(String) : [];
  return (
    <div className={styles.evaluationBody}>
      <div className={styles.verdict}>{String(data.verdict || t('evaluationReady'))}</div>
      {/* The gate reads the same fields the tool handlers refuse on, so what a person
          sees on the card and what the model is told when it tries to publish cannot
          disagree — one evaluator, three consumers. */}
      <EvaluationGateBadge data={data as Record<string, unknown>} />
      {(gaps.length ? gaps : [t('gapMessageMatch'), t('gapPrimaryAction'), t('gapDeliveryTiming')]).map((gap, index) => <div key={`${gap}-${index}`}><b>{index ? '△' : '✓'} {gap}</b><p>{recommendations[index] || (index ? t('askBrainResolution') : authoredText(data) || t('evidenceOnCanvas'))}</p></div>)}
      <button type="button" className="nodrag nowheel" onClick={(event) => { event.stopPropagation(); onOpen?.(); }}>{Array.isArray(data.testResults) && data.testResults.length ? t('reviewTestResults') : t('reviewEvaluationStep')}</button>
    </div>
  );
}
