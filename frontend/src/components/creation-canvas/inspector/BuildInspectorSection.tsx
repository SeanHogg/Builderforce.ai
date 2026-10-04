import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData } from '../types';
import type { IdeProject } from '@/lib/types';
import { useTranslations } from 'next-intl';
import { useLocalizedModalities, useModalityCopy } from '@/lib/useModalityCopy';
import { canvasBuildBinding } from '@/lib/canvasBuild';
import { hasCodeWorkspace } from '@/lib/canvasBuildTools';
import { canvasAppLocalKey } from '@/lib/canvasSessionApp';
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
 * is set at creation, not switched mid-session). A board with no account holds its
 * workspace in this browser, so it offers only the types that run there.
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
  const local = !binding && canvasAppLocalKey(node.data) !== null;
  const hasWorkspace = !!binding || local;
  const durable = persistence === 'server';
  // Existing workspaces, so a Builder object can adopt work already under way
  // instead of only ever provisioning a second one. Only fetched while unbound.
  const offersExisting = !hasWorkspace && durable;
  const [fetched, setFetched] = useState<IdeProject[]>([]);
  useEffect(() => {
    if (!offersExisting) return;
    let alive = true;
    void listIdeProjects().then((projects) => { if (alive) setFetched(projects); }).catch(() => { if (alive) setFetched([]); });
    return () => { alive = false; };
  }, [offersExisting]);
  const existing = offersExisting ? fetched : [];
  return <section data-inspector-section="build">
    <label>{t('typeLabel')}
      <select
        value={active.id}
        disabled={!editable || hasWorkspace || creating}
        onChange={(event) => onChange({ modality: event.target.value as ProjectModality })}
      >
        {modalities.map((modality) => <option key={modality.id} value={modality.id} disabled={!!modality.comingSoon || (!durable && !hasCodeWorkspace(modality.id))}>{modality.label}</option>)}
      </select>
    </label>
    <p className={styles.inspectorHint}>{hasWorkspace ? t('typeLockedHint') : active.tagline}</p>
    <button type="button" className={styles.fullButton} disabled={!editable || creating} onClick={onOpenBuild}>
      {creating ? t('creating') : hasWorkspace ? t('openBuilder') : t('createWorkspace')}
    </button>
    {existing.length > 0 && <label>{t('attachLabel')}
      <select
        value=""
        disabled={!editable || creating}
        onChange={(event) => { const chosen = existing.find((project) => String(project.id) === event.target.value); if (chosen) onAttachBuild(chosen); }}
      >
        <option value="">{t('attachPlaceholder')}</option>
        {existing.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </label>}
    <p className={styles.inspectorHint}>{binding ? t('boundHint') : local ? t('tileLocalHint') : t('unboundHint')}</p>
    {hasWorkspace && <>
      <button type="button" className={styles.secondaryFullButton} disabled={!editable} onClick={onDeleteBuildWorkspace}>{t('deleteWorkspace')}</button>
      <p className={styles.inspectorHint}>{t('deleteWorkspaceHint')}</p>
    </>}
  </section>;
}
