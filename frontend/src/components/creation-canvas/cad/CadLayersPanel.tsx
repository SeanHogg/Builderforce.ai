import { useTranslations } from 'next-intl';
import type { CadLayer, CadState } from '@/lib/creation/cad/cadState';
import styles from './cadEditor.module.css';
import buttons from '../styles/creativeEditors.module.css';

export interface CadLayersPanelProps {
  state: CadState;
  editable: boolean;
  onAdd: () => void;
  onRemove: (name: string) => void;
  onUpdate: (name: string, patch: Partial<Omit<CadLayer, 'name'>>) => void;
  onActivate: (name: string) => void;
}

/**
 * The drawing's layers: which one new shapes go on, and per layer whether it is shown,
 * locked and what colour it inherits. Presentational — every change is a callback.
 */
export function CadLayersPanel({ state, editable, onAdd, onRemove, onUpdate, onActivate }: CadLayersPanelProps) {
  const t = useTranslations('canvas.kinds.cad.layers');
  return <section className={styles.layers} aria-label={t('heading')}>
    <header className={styles.layersHead}>
      <strong>{t('heading')}</strong>
      <button type="button" className={buttons.button} disabled={!editable} onClick={onAdd}>{t('add')}</button>
    </header>
    <ul className={styles.layerList}>
      {state.layers.map((layer) => {
        const active = layer.name === state.activeLayerName;
        return <li key={layer.name} className={styles.layerRow} data-active={active || undefined}>
          <button type="button" className={buttons.iconButton} aria-pressed={layer.visible} aria-label={t(layer.visible ? 'hide' : 'show', { name: layer.name })} disabled={!editable} onClick={() => onUpdate(layer.name, { visible: !layer.visible })}>{layer.visible ? '◉' : '○'}</button>
          <button type="button" className={buttons.iconButton} aria-pressed={layer.locked} aria-label={t(layer.locked ? 'unlock' : 'lock', { name: layer.name })} disabled={!editable} onClick={() => onUpdate(layer.name, { locked: !layer.locked })}>{layer.locked ? '▣' : '□'}</button>
          <input type="color" className={styles.layerColor} value={layer.color} aria-label={t('color', { name: layer.name })} disabled={!editable} onChange={(event) => onUpdate(layer.name, { color: event.target.value })} />
          <button type="button" className={styles.layerName} aria-pressed={active} aria-label={t('activate', { name: layer.name })} onClick={() => onActivate(layer.name)}>{layer.name}</button>
          {state.layers.length > 1 && <button type="button" className={buttons.iconButton} aria-label={t('remove', { name: layer.name })} disabled={!editable} onClick={() => onRemove(layer.name)}>×</button>}
        </li>;
      })}
    </ul>
  </section>;
}
