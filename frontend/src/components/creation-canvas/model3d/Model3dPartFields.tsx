import { useTranslations } from 'next-intl';
import { materialColor, type Model3dEntity, type Model3dEntityKind, type Model3dState, type V3 } from '@/lib/creation/model3d/model3dState';
import { CommitNumberField } from '../creative/CommitNumberField';
import styles from '../styles/creativeEditors.module.css';
import editor from './model3dEditor.module.css';

type DimensionLabel = 'width' | 'depth' | 'height' | 'radius' | 'extrudeDepth';

/** Which numeric fields each kind of part has, in the order they read. A row of data, not a branch per kind. */
const DIMENSIONS: Record<Model3dEntityKind, ReadonlyArray<{ key: string; label: DimensionLabel }>> = {
  box: [{ key: 'widthMm', label: 'width' }, { key: 'depthMm', label: 'depth' }, { key: 'heightMm', label: 'height' }],
  cylinder: [{ key: 'radiusMm', label: 'radius' }, { key: 'heightMm', label: 'height' }],
  sphere: [{ key: 'radiusMm', label: 'radius' }],
  extrude: [{ key: 'depthMm', label: 'extrudeDepth' }],
  boolean: [],
};

export interface Model3dPartFieldsProps {
  entity: Model3dEntity;
  state: Model3dState;
  editable: boolean;
  onPatch: (id: string, patch: Partial<Model3dEntity>) => void;
  onMove: (id: string, translate: V3) => void;
  onRemove: (ids: readonly string[]) => void;
}

/** Size, position and material of the one selected part. */
export function Model3dPartFields({ entity, state, editable, onPatch, onMove, onRemove }: Model3dPartFieldsProps) {
  const t = useTranslations('canvas.kinds.model3d.inspector');
  const labels: Record<DimensionLabel, string> = { width: t('width'), depth: t('depth'), height: t('height'), radius: t('radius'), extrudeDepth: t('extrudeDepth') };
  const at: V3 = entity.translate ?? { x: 0, y: 0, z: 0 };
  const values = entity as unknown as Record<string, number>;
  return <div className={editor.fields}>
    <div className={styles.row}>
      {DIMENSIONS[entity.kind].map(({ key, label }) => <CommitNumberField
        key={key}
        label={labels[label]}
        value={values[key] ?? 0}
        min={0.1}
        step={1}
        disabled={!editable}
        onCommit={(value) => onPatch(entity.id, { [key]: value } as Partial<Model3dEntity>)}
      />)}
    </div>
    <div className={styles.row}>
      {(['x', 'y', 'z'] as const).map((axis) => <CommitNumberField
        key={axis}
        label={t(axis)}
        value={at[axis]}
        step={1}
        disabled={!editable}
        onCommit={(value) => onMove(entity.id, { ...at, [axis]: value })}
      />)}
    </div>
    <div className={styles.row}>
      <label className={styles.field}>
        <span>{t('material')}</span>
        <select
          value={entity.materialId ?? state.defaultMaterialId}
          disabled={!editable}
          onChange={(event) => onPatch(entity.id, { materialId: event.target.value })}
        >
          {state.materials.map((material) => <option key={material.id} value={material.id}>{material.label}</option>)}
        </select>
      </label>
      <span className={editor.swatch} style={{ background: materialColor(state, entity) }} aria-hidden="true" />
      <button type="button" className={styles.button} disabled={!editable} onClick={() => onRemove([entity.id])}>{t('delete')}</button>
    </div>
  </div>;
}
