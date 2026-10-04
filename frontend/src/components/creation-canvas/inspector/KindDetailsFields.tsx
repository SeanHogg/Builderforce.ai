import type { CreationNodeData } from '../types';
import { useTranslations } from 'next-intl';
import { kindSettingsFields, kindSettingsManifest } from '@/lib/canvasKindSettings';
import { SettingsFieldControl } from '../SettingsFieldControl';
import styles from '../CreationCanvas.module.css';

/** The full-surface fields a kind's manifest declares, plus its one hint paragraph.
 *  Declaration order is the render order — see `SettingsFieldControl`. */
export function KindDetailsFields({ kind, data, editable, onChange }: {
  kind: string; data: CreationNodeData; editable: boolean; onChange: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = useTranslations('creationCanvas');
  const manifest = kindSettingsManifest(kind);
  const fields = kindSettingsFields(kind, data, 'full');
  return <>
    {fields.map((field) => <SettingsFieldControl key={field.name} field={field} data={data} editable={editable} variant="full" translate={(key) => t(key as never)} onChange={onChange} />)}
    {manifest?.hintKey && <p className={styles.inspectorHint}>{t(manifest.hintKey as never)}</p>}
  </>;
}
