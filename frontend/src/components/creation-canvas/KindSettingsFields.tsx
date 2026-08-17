/**
 * The compact anchored panel's body — ONE component for every kind, replacing the old
 * hardcoded `PersonaBody`/`ConfigBody` pair.
 *
 * A kind with a registered `KindSettingsManifest` draws its declared fields; a kind
 * without one still gets the baseline every object had before this existed — a name and
 * a status, Advanced holding the subtitle and a link to the full inspector. Timing is
 * neither: every object can run on its own schedule (`CreationNode`'s clock badge says
 * so for a reason — "not conditional on there being a schedule"), so Advanced always
 * offers it here too, which is the direct fix for a Persona panel whose Advanced
 * section had a Model field and nothing else.
 */

import { useTranslations } from 'next-intl';
import { kindSettingsFields, kindSettingsHasMoreInFullInspector } from '@/lib/canvasKindSettings';
import { canvasPersonOrigin, isCanvasPersonKind } from '@/lib/canvasNodeAffordances';
import { SettingsFieldControl } from './SettingsFieldControl';
import { TimingFields } from './TimingFields';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

export function KindSettingsFields({
  data,
  editable,
  advancedOpen,
  onChange,
  onOpenFull,
}: {
  data: CreationNodeData;
  editable: boolean;
  advancedOpen: boolean;
  onChange: (patch: Partial<CreationNodeData>) => void;
  onOpenFull: () => void;
}) {
  const t = useTranslations('creationCanvas.nodePanel');
  const fields = kindSettingsFields(data.kind, data, 'compact');
  const basic = fields.filter((field) => field.section !== 'advanced');
  const advanced = fields.filter((field) => field.section === 'advanced');
  const person = isCanvasPersonKind(data.kind);
  const origin = person ? canvasPersonOrigin(data.kind) : null;

  return <>
    {origin && <span className={styles.personaOrigin} data-origin={origin}>{t(origin === 'builtin' ? 'builtinSeat' : 'customAgent')}</span>}
    {!person && <>
      <label className={styles.anchoredField}>
        <span>{t('name')}</span>
        <input value={data.title} disabled={!editable} onChange={(event) => onChange({ title: event.target.value })} />
      </label>
      <label className={styles.anchoredField}>
        <span>{t('status')}</span>
        <input value={data.status ?? ''} disabled={!editable} placeholder={t('statusPlaceholder')} onChange={(event) => onChange({ status: event.target.value })} />
      </label>
    </>}
    {basic.map((field) => <SettingsFieldControl key={field.name} field={field} data={data} editable={editable} variant="compact" translate={(key) => t(key as never)} onChange={onChange} />)}
    {origin === 'builtin' && <p className={styles.anchoredHint}>{t('builtinSeatHint')}</p>}
    {advancedOpen && <>
      {!person && <>
        <label className={styles.anchoredField}>
          <span>{t('subtitle')}</span>
          <input value={data.subtitle ?? ''} disabled={!editable} onChange={(event) => onChange({ subtitle: event.target.value })} />
        </label>
        {/* Naming the inspector and then not going there is what a dead end reads like:
            somebody who opens Advanced looking for their object's OWN settings — a
            dashboard's date range, a dataset's import — is told where those live and
            left to find the door themselves. The sentence IS the door. */}
        {kindSettingsHasMoreInFullInspector(data.kind) && (
          <button type="button" className={styles.anchoredHintAction} onClick={onOpenFull}>{t('configAdvancedHint')}</button>
        )}
      </>}
      {advanced.map((field) => <SettingsFieldControl key={field.name} field={field} data={data} editable={editable} variant="compact" translate={(key) => t(key as never)} onChange={onChange} />)}
      <TimingFields data={data} editable={editable} onChange={onChange} />
    </>}
  </>;
}
