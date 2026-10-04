import { useTranslations } from 'next-intl';
import { Avatar } from '@seanhogg/builderforce-brain-ui';
import styles from '../CreationCanvas.module.css';
import { Icon } from '@/components/ui/Icon';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';
import { optionLabel, textValue } from './shared';

export function AgentBody({ data }: CreationBodyProps) {
  const { openDetails: onOpen, openBuiltinAgent: onOpenBuiltin } = useCreationNodeActions();
  const t = useTranslations('creationCanvas.node');
  const tools = Array.isArray(data.tools) ? data.tools.map(String) : ['Audience Analyzer', 'Copy Optimizer'];
  const autonomy = optionLabel(data.autonomy, { low: t('lowAutonomy'), medium: t('mediumAutonomy'), high: t('highAutonomy') }, t('mediumAutonomy'));
  const existing = typeof data.resourceId === 'string' && data.resourceId.startsWith('agent:');
  const builtin = typeof data.agentDomain === 'string' && typeof data.agentSeat === 'string';
  const managerBuiltin = builtin && data.agentDomain === 'delivery' && data.agentSeat === 'Manager';
  const thinking = data.collaborationState === 'thinking' || data.testStatus === 'Running';
  const latestReply = textValue(data.collaborationReply, textValue(data.testResponse));
  return <>
    <div className={styles.agentIdentity}>
      <Avatar name={data.title} kind="agent" size={34} />
      <span><b>{existing || builtin ? t('configuredAgent') : t('newAgent')}</b><small>{textValue(data.role, data.status || t('online'))}</small></span>
      <em>{data.model === 'auto' || !data.model ? t('autoModel') : data.model}</em>
    </div>
    {thinking && <div className={styles.agentThinking} role="status"><i aria-hidden><Icon source="✦" size="1em" /></i><b>{data.testStatus === 'Running' ? t('testing') : t('thinking')}</b><span>{t('contributing')}</span></div>}
    {!thinking && latestReply && <div className={styles.agentLatestReply}><small>{t('latestResponse')}</small><p>{latestReply}</p></div>}
    {!latestReply && !thinking && <p>{textValue(data.personality, textValue(data.instructions, data.subtitle || ''))}</p>}
    <div className={styles.pills}>{tools.map((tool) => <span key={tool}>{tool}</span>)}<span>{autonomy}</span>{typeof data.testStatus === 'string' && data.testStatus && <span>{data.testStatus}</span>}</div>
    <div className={`${styles.nodeActionBar} nodrag nowheel`}>{builtin ? <>
      <button type="button" onClick={(event) => { event.stopPropagation(); onOpenBuiltin?.('execute'); }}>{t('executeBuiltin')}</button>
      {managerBuiltin && <button type="button" onClick={(event) => { event.stopPropagation(); onOpenBuiltin?.('diagnostics'); }}>{t('builtinDiagnostics')}</button>}
    </> : <>
      <button type="button" onClick={(event) => { event.stopPropagation(); onOpen?.('knowledge'); }}>{t('addKnowledgeStep')}</button>
      <button type="button" onClick={(event) => { event.stopPropagation(); onOpen?.('test'); }}>{t('testAgentStep')}</button>
    </>}</div>
  </>;
}
