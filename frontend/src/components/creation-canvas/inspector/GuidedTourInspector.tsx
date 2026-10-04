import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData } from '../types';
import { useTranslations } from 'next-intl';
import { type CanvasTourDesign, canvasTourDesignFromNode } from '@/lib/onboarding/canvasTourDesign';
import styles from '../CreationCanvas.module.css';

export function GuidedTourInspector({ node, nodes, onChange }: { node: CreationFlowNode; nodes: CreationFlowNode[]; onChange: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas.tourBuilder');
  const objectT = useTranslations('creationCanvas.object');
  const tour = canvasTourDesignFromNode(node.data);
  const update = (patch: Partial<CanvasTourDesign>) => {
    const next = { ...tour, ...patch };
    onChange({ tour: next, status: t('draftSteps', { count: next.steps.length }) });
  };
  const updateStep = (index: number, patch: Partial<CanvasTourDesign['steps'][number]>) => update({ steps: tour.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) });
  const targets = nodes.filter((candidate) => candidate.id !== node.id);
  return <section className={styles.tourInspector} aria-label={t('settings')}>
    <p className={styles.inspectorHint}>{t('settingsHint')}</p>
    <label>{t('offerTitle')}<input value={tour.offerTitle} onChange={(event) => update({ offerTitle: event.target.value })} /></label>
    <label>{t('offerBody')}<textarea rows={3} value={tour.offerBody} onChange={(event) => update({ offerBody: event.target.value })} /></label>
    <div className={styles.tourInspectorGrid}>
      <label>{t('version')}<input type="number" min={1} max={999} value={tour.version} onChange={(event) => update({ version: Number(event.target.value) || 1 })} /></label>
      <label>{t('minimumVisits')}<input type="number" min={1} max={20} value={tour.minimumVisits} onChange={(event) => update({ minimumVisits: Number(event.target.value) || 1 })} /></label>
    </div>
    <label className={styles.tourToggle}><input type="checkbox" checked={tour.blurBackground} onChange={(event) => update({ blurBackground: event.target.checked })} /><span>{t('blurBackground')}</span></label>
    <label className={styles.tourToggle}><input type="checkbox" checked disabled /><span>{t('escapeHatch')}</span></label>
    <div className={styles.tourStepEditor}>
      <div className={styles.tourStepEditorHeader}><strong>{t('steps')}</strong><button type="button" onClick={() => update({ steps: [...tour.steps, { id: crypto.randomUUID(), title: t('newStepTitle'), body: '', targetObjectId: '' }] })}>{t('addStep')}</button></div>
      {tour.steps.map((step, index) => <fieldset key={step.id} className={styles.tourStepFields}>
        <legend>{t('stepOf', { current: index + 1, total: tour.steps.length })}</legend>
        <label>{t('stepTitle')}<input value={step.title} onChange={(event) => updateStep(index, { title: event.target.value })} /></label>
        <label>{t('stepBody')}<textarea rows={2} value={step.body} onChange={(event) => updateStep(index, { body: event.target.value })} /></label>
        <label>{t('targetObject')}<select value={step.targetObjectId} onChange={(event) => updateStep(index, { targetObjectId: event.target.value })}><option value="">{t('chooseTarget')}</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.data.title} · {objectT(target.data.kind)}</option>)}</select></label>
        <button type="button" disabled={tour.steps.length <= 1} onClick={() => update({ steps: tour.steps.filter((_, stepIndex) => stepIndex !== index) })}>{t('removeStep')}</button>
      </fieldset>)}
    </div>
  </section>;
}
