import { useTranslations } from 'next-intl';
import styles from '../styles/creativeEditors.module.css';
import model from '../model3d/model3dEditor.module.css';
import { AuthedImg } from '../creative/AuthedMedia';
import { creativePreviewImageUrl } from '@/lib/creationDeliverables';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';
import { Model3dExportRow } from '../model3d/Model3dExportRow';
import { useModel3dEditor, type PrimitiveKind } from '../model3d/useModel3dEditor';

const PRIMITIVES: readonly PrimitiveKind[] = ['box', 'cylinder', 'sphere'];

/**
 * A 3D model on the card: a shaded picture of the scene (an `<img>`, not a WebGL canvas —
 * a board can hold dozens of cards and each live context would cost a GPU surface),
 * quick-add for the three primitives, and export. Orbiting, selecting and editing a part
 * happen on the model surface, which the card header opens (`creationObjectSurface`).
 */
export function Model3dBody({ data }: CreationBodyProps) {
  const t = useTranslations('canvas.kinds.model3d');
  const { edit: onEdit } = useCreationNodeActions();
  const editor = useModel3dEditor(data, onEdit);
  const { state, editable } = editor;
  // A dropped STL/OBJ has a picture of itself but no editable parts: show it until the scene has some.
  const previewUrl = editor.previewUrl ?? (data.modelState ? null : creativePreviewImageUrl(data));
  const addLabels: Record<PrimitiveKind, string> = { box: t('add.box'), cylinder: t('add.cylinder'), sphere: t('add.sphere') };

  return <div className={styles.editor}>
    <div className={styles.summary}>
      <span>{t('summary', { parts: state.entities.length })}</span>
      <span>{t('bed', { x: state.buildVolumeMm.x, y: state.buildVolumeMm.y, z: state.buildVolumeMm.z, unit: state.unit })}</span>
      {!editable && <span>{t('viewOnly')}</span>}
    </div>
    {previewUrl
      ? <AuthedImg className={model.preview} src={previewUrl} alt={t('previewAlt', { title: String(data.title ?? '') })} width={480} height={270} />
      : <div className={model.previewEmpty}>{t('empty')}</div>}
    <div className={styles.group} role="group" aria-label={t('add.label')}>
      {PRIMITIVES.map((kind) => <button key={kind} type="button" className={styles.button} disabled={!editable} onClick={() => editor.actions.add(kind)}>{addLabels[kind]}</button>)}
    </div>
    <Model3dExportRow status={editor.exporter.status} hasParts={state.entities.length > 0} approximated={editor.approximated} onExport={editor.exporter.run} />
  </div>;
}
