import { useTranslations } from 'next-intl';
import { evermindLearnedStatus, evermindNextAction } from '@seanhogg/builderforce-brain-ui';
import styles from '../CreationCanvas.module.css';
import { Icon } from '@/components/ui/Icon';
import { useFormat } from '@/i18n/useFormat';
import type { CreationBodyProps } from './types';
import { textValue } from './shared';

/** Product name — never translated, so it stays out of the message catalogs. */
const EVERMIND_BRAND = 'Evermind';

export function EvermindBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const fmt = useFormat();
  const version = typeof data.evermindVersion === 'number' ? data.evermindVersion : 0;
  const contributions = typeof data.contributions === 'number' ? data.contributions : 0;
  const loss = typeof data.trainingLoss === 'number' ? data.trainingLoss : null;
  const pending = typeof data.pendingContributions === 'number' ? data.pendingContributions : 0;
  if (data.evermindLoading === true) return <div className={styles.evermindSyncing} role="status"><span><Icon source="◌" size="1em" /></span><b>{t('evermindSyncing')}</b><p>{t('evermindSyncingDetail')}</p></div>;
  const recent = Array.isArray(data.recentLearnings)
    ? data.recentLearnings.flatMap((value, index) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      return [{
        id: String(item.id ?? index),
        kind: item.kind === 'delta' ? 'delta' as const : 'text' as const,
        version: typeof item.version === 'number' ? item.version : version,
        prompt: textValue(item.prompt),
        text: textValue(item.text),
        teacher: textValue(item.teacherModel),
        distilled: item.distilled === true,
        fitted: item.fitted !== false,
        weight: typeof item.weight === 'number' ? item.weight : 1,
        at: typeof item.at === 'number' ? item.at : 0,
        skipReason: textValue(item.skipReason),
        skipDetail: textValue(item.skipDetail),
        attemptedTeacherModel: textValue(item.attemptedTeacherModel),
      }];
    }).slice(0, 12)
    : [];
  const textLearnings = recent.filter((item) => item.kind === 'text');
  const fittedLearnings = recent.filter((item) => item.fitted);
  const teacherModel = textValue(data.teacherModel);
  const connected = data.learningMode !== 'offline-frozen' && data.status !== 'Blueprint';
  const inference = data.inferenceEnabled === true;
  const notYet = t('notYet');
  const lastLearned = typeof data.lastLearnedAt === 'string' && !Number.isNaN(Date.parse(data.lastLearnedAt))
    ? fmt.dateWith(data.lastLearnedAt, { month: 'short', day: 'numeric' })
    : notYet;
  const nextAction = evermindNextAction({
    seeded: data.evermindSeeded === true || version > 0,
    inferenceEnabled: inference,
    mode: data.learningMode === 'offline-frozen' ? 'offline-frozen' : 'connected',
    pending,
    teacherModel: teacherModel || null,
    quarantinedAt: textValue(data.quarantinedAt) || null,
    recent,
    eval: data.evalPoint && typeof data.evalPoint === 'object' && typeof (data.evalPoint as Record<string, unknown>).delta === 'number' ? { delta: Number((data.evalPoint as Record<string, unknown>).delta) } : null,
  });
  return <div className={styles.evermindBody}>
    <div className={styles.evermindMetrics}>
      <span><small>{t('adapterVersion')}</small><b>{version ? `v${version}` : t('blueprint')}</b></span>
      <span><small>{t('learned')}</small><b>{contributions}</b></span>
      <span><small>{t('queued')}</small><b>{pending}</b></span>
      <span><small>{t('trainingLoss')}</small><b>{loss == null ? '—' : loss.toFixed(3)}</b></span>
    </div>
    <div className={styles.evermindKnowledge}>
      <section className={styles.evermindMap} aria-label={t('knowledgeMapAria', { count: contributions })}>
        <div className={styles.evermindMapHeading}><b>{t('knowledgeMap')}</b><span className={connected ? styles.evermindLearning : styles.evermindFrozen}>{connected ? `● ${t('learning')}` : `○ ${t('waiting')}`}</span></div>
        <svg className={styles.evermindBrain} viewBox="0 0 320 172" role="img" aria-label={t('evermindBrainAria')}>
          <g className={styles.evermindMapEdges}>
            {[[160,28],[264,62],[54,73],[88,143],[155,148],[220,140],[272,112]].map(([x,y], index) => <line key={index} x1="160" y1="88" x2={x} y2={y} />)}
            <line className={styles.evermindSetpointEdge} x1="54" y1="73" x2="88" y2="143" /><line className={styles.evermindSetpointEdge} x1="54" y1="73" x2="155" y2="148" /><line className={styles.evermindSetpointEdge} x1="54" y1="73" x2="220" y2="140" /><line className={styles.evermindSetpointEdge} x1="54" y1="73" x2="272" y2="112" />
          </g>
          {teacherModel && <g className={styles.evermindTeacherFlow}><rect x="222" y="3" width="91" height="18" rx="9" /><text x="267" y="15" textAnchor="middle">{t('teacherPrefix', { model: teacherModel.slice(0, 13) })}</text><path d="M267 22 L265 36 L264 40" /><text x="285" y="35">{t('distils')}</text></g>}
          <EvermindRegion x={160} y={28} r={22} className={styles.regionNeocortex} label={t('regionNeocortex')} count={fittedLearnings.length} />
          <EvermindRegion x={264} y={62} r={21} className={styles.regionHippocampus} label={t('regionHippocampus')} count={textLearnings.length} />
          <EvermindRegion x={54} y={73} r={18} className={styles.regionPersonality} label={t('regionPersonality')} />
          <EvermindRegion x={88} y={143} r={13} className={styles.regionAmygdala} label={t('regionAmygdala')} small />
          <EvermindRegion x={155} y={148} r={13} className={styles.regionHypothalamus} label={t('regionHypothalamus')} small />
          <EvermindRegion x={220} y={140} r={13} className={styles.regionThalamus} label={t('regionThalamus')} small />
          <EvermindRegion x={272} y={112} r={13} className={styles.regionBasal} label={t('regionBasal')} small />
          <g className={styles.evermindCore}><circle cx="160" cy="88" r="25" /><circle cx="160" cy="88" r="19" /><text x="160" y="86" textAnchor="middle"></text><text x="160" y="99" textAnchor="middle">{EVERMIND_BRAND}</text></g>
          {fittedLearnings.map((item, index) => <circle key={`neo-${item.id}`} className={styles.evermindKnowledgeNode} cx={122 + (index % 3) * 17} cy={18 + Math.floor(index / 3) * 12} r={3 + Math.min(item.weight, 3) / 2}><title>{item.kind === 'delta' ? t('weightDelta') : item.prompt || t('fittedLearning')}</title></circle>)}
          {textLearnings.map((item, index) => <circle key={`hip-${item.id}`} className={styles.evermindMemoryNode} cx={280 + (index % 2) * 11} cy={43 + Math.floor(index / 2) * 13} r={3 + Math.min(item.weight, 3) / 2}><title>{item.prompt || item.text || t('learnedTextTitle')}</title></circle>)}
          {!recent.length && <text className={styles.evermindDormantLabel} x="160" y="123" textAnchor="middle">{t('growMap')}</text>}
        </svg>
        <div className={styles.evermindLegend}><span><i data-kind="delta" /> {t('reasoningWeights')}</span><span><i data-kind="text" /> {t('learnedTextLegend')}</span><span><i data-kind="affect" /> {t('liveAffect')}</span></div>
      </section>
      <section className={styles.evermindRecent} aria-label={t('recentlyLearned')}>
        <div className={styles.evermindMapHeading}><b>{t('recentlyLearned')}</b><span>{recent.length ? t('shownCount', { count: Math.min(recent.length, 3) }) : t('empty')}</span></div>
        {recent.length ? recent.slice(0, 3).map((item) => {
          const learnedStatus = evermindLearnedStatus(item);
          const faulted = learnedStatus.state === 'fault';
          return <article key={item.id} data-learning-state={learnedStatus.state}>
            <i data-kind={item.kind} />
            <div><b>{item.prompt || (item.kind === 'delta' ? t('agentModelUpdate') : t('untitledLearning'))}</b><p>{faulted ? `${t('teacherNoAnswer')}${learnedStatus.reason ? ` · ${learnedStatus.reason.replaceAll('_', ' ')}` : ''}` : item.text || (item.kind === 'delta' ? t('weightsAdapted') : t('noReadableText'))}</p></div>
            <small>v{item.version}<strong>{learnedStatus.state === 'distilled' ? t('viaTeacher', { teacher: learnedStatus.teacherModel || t('teacher') }) : learnedStatus.state === 'fault' ? t('notDistilled') : learnedStatus.state === 'self' ? t('selfLearned') : t('weightDelta')}</strong></small>
          </article>;
        }) : <div className={styles.evermindEmpty}><span><Icon source="◇" size="1em" /></span><b>{t('nothingLearned')}</b><p>{t('nothingLearnedDetail')}</p></div>}
      </section>
    </div>
    <section className={styles.evermindNextAction} data-tone={nextAction.tone} aria-label={t('recommendedNextAction')}><span>{t('recommendedNextAction')}</span><div><b>{nextAction.title}</b><p>{nextAction.detail}</p></div><strong>{t('openDetails', { destination: nextAction.destination })}</strong></section>
    <div className={styles.evermindSignals}>
      <span><i className={connected ? styles.signalOn : styles.signalOff} /><small>{t('learning')}</small><b>{connected ? t('connected') : t('waiting')}</b></span>
      <span><i className={inference ? styles.signalOn : styles.signalOff} /><small>{t('replies')}</small><b>{inference ? t('onEvermind') : t('off')}</b></span>
      <span><i className={lastLearned === notYet ? styles.signalOff : styles.signalOn} /><small>{t('lastLearned')}</small><b>{lastLearned}</b></span>
    </div>
  </div>;
}

function EvermindRegion({ x, y, r, className, label, count, small = false }: { x: number; y: number; r: number; className: string; label: string; count?: number; small?: boolean }) {
  return <g className={`${styles.evermindRegion} ${className}`}><circle cx={x} cy={y} r={r + 4} /><circle cx={x} cy={y} r={r} /><text x={x} y={y + (small ? 2 : 3)} textAnchor="middle">{label}</text>{count != null && count > 0 && <g className={styles.evermindRegionCount}><circle cx={x + r - 1} cy={y - r + 1} r="7" /><text x={x + r - 1} y={y - r + 3} textAnchor="middle">{count}</text></g>}</g>;
}
