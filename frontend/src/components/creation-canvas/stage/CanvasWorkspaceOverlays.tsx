import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { EvermindBuildPanel } from '@/domains/workflow/presentation/EvermindBuildPanel';
import { AITrainingPanel } from '../canvasLazyPanels';
import type { CreationFlowNode } from '../CreationNode';
import { useCanvasSessionFacts } from '../chrome/canvasSessionContext';
import type { useCanvasFlowBuild } from '../hooks/useCanvasFlowBuild';
import styles from '../CreationCanvas.module.css';

type FlowBuild = ReturnType<typeof useCanvasFlowBuild>;

const TRAINING_BODY_STYLE: CSSProperties = { overflow: 'auto', background: 'var(--bg-elevated)', justifyContent: 'center', padding: 20 };

export interface CanvasWorkspaceOverlaysProps {
  /** The Builder object whose workspace is open on top of the board. */
  evermindBuild: FlowBuild['evermindBuild'];
  setEvermindBuild: FlowBuild['setEvermindBuild'];
  trainingFocus: { nodeId: string; projectId: number | string; localOnly: boolean } | null;
  setTrainingFocus: Dispatch<SetStateAction<{ nodeId: string; projectId: number | string; localOnly: boolean } | null>>;
  setNodes: Dispatch<SetStateAction<CreationFlowNode[]>>;
}

/** The workspaces that open OVER the board — a build, the in-browser Evermind runner,
 *  and the adapter studio — each reporting back onto the card it was opened from. */
export function CanvasWorkspaceOverlays({ evermindBuild, setEvermindBuild, trainingFocus, setTrainingFocus, setNodes }: CanvasWorkspaceOverlaysProps) {
  const t = useTranslations('creationCanvas');
  const { notify } = useCanvasSessionFacts();
  return <>

        {/* The in-browser Evermind runner, over the section that holds the build steps.
            A panel rather than a modal, like every other canvas surface — the board it
            is reporting on stays visible behind it. */}
        {evermindBuild && <EvermindBuildPanel
          open
          onClose={() => setEvermindBuild(null)}
          graph={evermindBuild.graph}
          workflowName={evermindBuild.name}
          projectId={evermindBuild.projectId}
        />}
        {trainingFocus && <section className={styles.workflowFocus} role="dialog" aria-modal="true" aria-label={t('evermindAdapterStudio')}>
          <header><div><strong>{t('trainEvermindOnCanvas')}</strong><small>{t('trainEvermindHint')}</small></div><button type="button" onClick={() => setTrainingFocus(null)} aria-label={t('closeAdapterStudio')}>×</button></header>
          <div className={styles.workflowFocusBody} style={TRAINING_BODY_STYLE}>
            <AITrainingPanel
              projectId={trainingFocus.projectId}
              initialDataMode={trainingFocus.localOnly ? 'local-only' : 'workspace'}
              workspaceEnabled={!trainingFocus.localOnly}
              onJobCompleted={(job) => {
                setNodes((current) => current.map((node) => node.id === trainingFocus.nodeId ? { ...node, data: { ...node.data, status: 'Adapter trained', trainingJobId: job.id, adapterArtifact: job.r2_artifact_key, model: job.base_model, loraRank: job.lora_rank } } : node));
                notify(t('adapterTrained'));
              }}
              onLocalArtifactCompleted={(artifact) => {
                setNodes((current) => current.map((node) => node.id === trainingFocus.nodeId ? { ...node, data: { ...node.data, status: 'Local adapter trained', adapterArtifact: `local://${artifact.filename}`, trainableParams: artifact.trainableParams } } : node));
                notify(t('localAdapterTrained'));
              }}
              onModelPublished={(model) => {
                setNodes((current) => current.map((node) => node.id === trainingFocus.nodeId ? { ...node, data: { ...node.data, status: 'Published', model: model.ref, modelSlug: model.slug, evermindRef: model.evermindRef, publishedAt: new Date().toISOString() } } : node));
                notify(t('noticeEvermindPublished', { ref: model.ref }));
              }}
            />
          </div>
        </section>}
  </>;
}
