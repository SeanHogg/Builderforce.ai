import { useTranslations } from 'next-intl';
import type { BooleanOperation, Model3dEntity, Model3dEntityKind, Model3dState, V3 } from '@/lib/creation/model3d/model3dState';
import styles from '../styles/creativeEditors.module.css';
import editor from './model3dEditor.module.css';
import { Model3dPartFields } from './Model3dPartFields';
import type { PrimitiveKind } from './useModel3dEditor';

const PRIMITIVES: readonly PrimitiveKind[] = ['box', 'cylinder', 'sphere'];
const OPERATIONS: readonly BooleanOperation[] = ['union', 'difference', 'intersection'];

export interface Model3dPartsProps {
  state: Model3dState;
  selection: readonly string[];
  editable: boolean;
  onSelect: (ids: readonly string[]) => void;
  onAdd: (kind: PrimitiveKind) => void;
  onRemove: (ids: readonly string[]) => void;
  onPatch: (id: string, patch: Partial<Model3dEntity>) => void;
  onMove: (id: string, translate: V3) => void;
  onGroup: (op: BooleanOperation, ids: readonly string[]) => void;
}

/**
 * The part list and its controls: add a primitive, pick parts (a checkbox per row, so
 * multi-select works on a touch screen as well as with shift-click), combine two or more
 * under an operation, and edit the one selected. Presentational — every change is a callback.
 */
export function Model3dParts({ state, selection, editable, onSelect, onAdd, onRemove, onPatch, onMove, onGroup }: Model3dPartsProps) {
  const t = useTranslations('canvas.kinds.model3d');
  const kindNames: Record<Model3dEntityKind, string> = { box: t('part.box'), cylinder: t('part.cylinder'), sphere: t('part.sphere'), extrude: t('part.extrude'), boolean: t('part.boolean') };
  const operationNames: Record<BooleanOperation, string> = { union: t('operation.union'), difference: t('operation.difference'), intersection: t('operation.intersection') };
  const addLabels: Record<PrimitiveKind, string> = { box: t('add.box'), cylinder: t('add.cylinder'), sphere: t('add.sphere') };

  const counts = new Map<Model3dEntityKind, number>();
  const rows = state.entities.map((entity) => {
    const index = (counts.get(entity.kind) ?? 0) + 1;
    counts.set(entity.kind, index);
    return { entity, name: `${kindNames[entity.kind]} ${index}` };
  });
  const chosen = new Set(selection);
  const only = selection.length === 1 ? state.entities.find((entity) => entity.id === selection[0]) : undefined;
  const toggle = (id: string) => onSelect(chosen.has(id) ? selection.filter((existing) => existing !== id) : [...selection, id]);

  return <div className={editor.parts}>
    <div className={styles.group} role="group" aria-label={t('add.label')}>
      {PRIMITIVES.map((kind) => <button key={kind} type="button" className={styles.button} disabled={!editable} onClick={() => onAdd(kind)}>{addLabels[kind]}</button>)}
    </div>
    {rows.length === 0
      ? <span className={styles.hint}>{t('parts.empty')}</span>
      : <ul className={editor.partList} aria-label={t('parts.heading')}>
        {rows.map(({ entity, name }) => <li key={entity.id} className={editor.partRow} data-selected={chosen.has(entity.id) || undefined}>
          <input type="checkbox" className={editor.partCheck} checked={chosen.has(entity.id)} aria-label={t('parts.pick', { name })} onChange={() => toggle(entity.id)} />
          <button type="button" className={editor.partName} onClick={() => onSelect([entity.id])}>{name}</button>
        </li>)}
      </ul>}
    {selection.length >= 2 && <div className={styles.group} role="group" aria-label={t('operation.label')}>
      {OPERATIONS.map((op) => <button key={op} type="button" className={styles.button} disabled={!editable} onClick={() => onGroup(op, selection)}>{operationNames[op]}</button>)}
    </div>}
    {only && <Model3dPartFields entity={only} state={state} editable={editable} onPatch={onPatch} onMove={onMove} onRemove={onRemove} />}
    {selection.length > 1 && <button type="button" className={styles.button} disabled={!editable} onClick={() => onRemove(selection)}>{t('parts.deleteSelected', { count: selection.length })}</button>}
  </div>;
}
