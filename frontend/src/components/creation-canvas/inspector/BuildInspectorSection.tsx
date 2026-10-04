import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData } from '../types';
import type { IdeProject } from '@/lib/types';
import { useTranslations } from 'next-intl';
import { useLocalizedModalities, useModalityCopy } from '@/lib/useModalityCopy';
import { canvasBuildBinding } from '@/lib/canvasBuild';
import { useEffect, useState } from 'react';
import { listIdeProjects } from '@/lib/api';
import type { ProjectModality } from '@/lib/modality';
import styles from '../CreationCanvas.module.css';

/**
 * Builder inspector — pick what to build, then open the workspace.
 *
 * The type list is Builder's modality registry, so Canvas offers every supported
 * project type and each one seeds its own starter template.
 * Type is fixed once the workspace exists (a project's modality
 * is set at creation, not switched mid-session).
 */
export function BuildInspectorSection({ node, editable, creating, persistence, onChange, onOpenBuild, onAttachBuild, onDeleteBuildWorkspace }: {
  node: CreationFlowNode;
  editable: boolean;
  creating: boolean;
  persistence: 'local' | 'server';
  onChange: (patch: Partial<CreationNodeData>) => void;
  onOpenBuild: () => void;
  onAttachBuild: (ide: IdeProject) => void;
  onDeleteBuildWorkspace: () => void;
}) {
  const t = useTranslations('creationCanvas.build');
  const modalities = useLocalizedModalities();
  const active = useModalityCopy()(typeof node.data.modality === 'string' ? node.data.modality : null);
  const binding = canvasBuildBinding(node.data);
  // Existing workspaces, so a Builder object can adopt work already under way
  // instead of only ever provisioning a second one. Only fetched while unbound.
  const [existing, setExisting] = useState<IdeProject[]>([]);
  useEffect(() => {
    if (binding || persistence !== 'server') { setExisting([]); return; }
    let alive = true;
    void listIdeProjects().then((projects) => { if (alive) setExisting(projects); }).catch(() => { if (alive) setExisting([]); });
    return () => { alive = false; };
  }, [binding, persistence]);
  return <section data-inspector-section="build">
    <label>{t('typeLabel')}
      <select
        value={active.id}
        disabled={!editable || !!binding || creating}
        onChange={(event) => onChange({ modality: event.target.value as ProjectModality })}
      >
        {modalities.map((modality) => <option key={modality.id} value={modality.id} disabled={!!modality.comingSoon}>{modality.label}</option>)}
      </select>
    </label>
    <p className={styles.inspectorHint}>{binding ? t('typeLockedHint') : active.tagline}</p>
    <button type="button" className={styles.fullButton} disabled={!editable || creating} onClick={onOpenBuild}>
      {creating ? t('creating') : binding ? t('openBuilder') : t('createWorkspace')}
    </button>
    {!binding && existing.length > 0 && <label>{t('attachLabel')}
      <select
        value=""
        disabled={!editable || creating}
        onChange={(event) => { const chosen = existing.find((project) => String(project.id) === event.target.value); if (chosen) onAttachBuild(chosen); }}
      >
        <option value="">{t('attachPlaceholder')}</option>
        {existing.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </label>}
    <p className={styles.inspectorHint}>{binding ? t('boundHint') : t('unboundHint')}</p>
    {binding && <>
      <button type="button" className={styles.secondaryFullButton} disabled={!editable} onClick={onDeleteBuildWorkspace}>{t('deleteWorkspace')}</button>
      <p className={styles.inspectorHint}>{t('deleteWorkspaceHint')}</p>
    </>}
  </section>;
}
