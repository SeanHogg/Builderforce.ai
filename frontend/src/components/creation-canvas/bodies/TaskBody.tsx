import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import type { CreationBodyProps } from './types';
import { textValue, AuthoredContent } from './shared';

export function TaskBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const agent = textValue(data.assignee, textValue(data.agentName, textValue(data.role, t('unassigned'))));
  const priority = textValue(data.priority, t('notSet'));
  const prdTitle = textValue(data.prdTitle);
  const prdSummary = textValue(data.prdSummary);
  const acceptance = textValue(data.acceptanceCriteria);
  return <div className={styles.taskBody}>
    {data.isBlocked === true && <p role="status" style={{ margin: 0, padding: '3px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--tone-warning-bg)', color: 'var(--tone-warning-ink)', fontSize: 'var(--font-size-eyebrow)', fontWeight: 600 }}>{t('blockedByDependency')}</p>}
    <div className={styles.taskFacts}>
      <span><small>{t('agent')}</small><b>{agent}</b></span>
      <span><small>{t('priority')}</small><b>{priority}</b></span>
    </div>
    <AuthoredContent data={data} fallback={t('noTaskDescription')} />
    <div className={styles.taskContext}>
      <small>{t('prd')}</small>
      {prdTitle || prdSummary
        ? <><b>{prdTitle || t('linkedRequirements')}</b>{prdSummary && <p>{prdSummary}</p>}</>
        : <p className={styles.taskEmpty}>{t('noPrdLinked')}</p>}
    </div>
    {acceptance && <div className={styles.taskContext}><small>{t('doneWhen')}</small><p>{acceptance}</p></div>}
  </div>;
}
