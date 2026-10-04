import type { CreationFlowNode } from '../CreationNode';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { EvermindValidationProvider } from '@/components/builder/EvermindValidationContext';
import { ProjectEvermindPanel } from '@/components/builder/ProjectEvermindPanel';

export function EvermindInspector({ node, persistence, onAttach, onExpand, onTrain }: { node: CreationFlowNode; persistence: 'local' | 'server'; onAttach: () => void; onExpand: () => void; onTrain: () => void }) {
  const t = useTranslations('creationCanvas');
  const rawProjectId = node.data.resourceId?.startsWith('evermind:') ? node.data.resourceId.slice('evermind:'.length) : '';
  const projectId = /^\d+$/.test(rawProjectId) ? Number(rawProjectId) : null;
  return <>
    <div className={styles.evermindStartGuide}><span>{node.data.pipelineExpanded === true ? t('guidedSetupAdded') : t('newModel')}</span><strong>{node.data.pipelineExpanded === true ? t('continueFromStep1') : t('startWithExamples')}</strong><p>{node.data.pipelineExpanded === true ? t('guidedSetupAddedHint') : t('guidedSetupHint')}</p></div>
    <button className={styles.fullButton} onClick={onExpand}>{node.data.pipelineExpanded === true ? t('goToStep1') : t('startGuidedSetup')}</button>
    <button className={styles.fullButton} onClick={onTrain}>{t('trainLoraAdapter')}</button>
    {persistence === 'local' && <p className={styles.inspectorHint}>{t('blueprintNoAccountHint')}</p>}
    {persistence === 'server' && projectId == null && <button className={styles.fullButton} onClick={onAttach}>{t('useProjectOnCanvas')}</button>}
    {persistence === 'server' && projectId != null && <div className={styles.evermindConsoleHost}><EvermindValidationProvider><ProjectEvermindPanel projectId={projectId} /></EvermindValidationProvider></div>}
  </>;
}
