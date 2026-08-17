/**
 * The timing/schedule controls — "run on its own" — shared by the compact panel's
 * Advanced section and the full inspector.
 *
 * Extracted out of `CanvasNodePanel`'s old standalone `'schedule'` panel rather than
 * kept as a fifth anchored-panel id: a schedule nobody can find because it lives behind
 * a second popover is a schedule that does not exist for the person who needed it. A
 * kind that supports timing (`KindSettingsManifest.timing`) now gets it inside the SAME
 * Advanced section as its other settings, on both surfaces.
 */

import { useTranslations } from 'next-intl';
import {
  CANVAS_SCHEDULE_INTERVALS,
  canvasNodeSchedule,
  type CanvasNodeSchedule,
} from '@/lib/canvasNodeAffordances';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

export function TimingFields({
  data,
  editable,
  /** Gates the finer-grained hour-range/weekdays controls, matching the Advanced switch
   *  every other panel already has. Callers that only ever render this INSIDE their own
   *  already-open Advanced section (the compact panel's Config/Persona body) pass `true`
   *  — a second nested toggle there would just be a switch that does nothing new. */
  advancedOpen = true,
  onChange,
}: {
  data: CreationNodeData;
  editable: boolean;
  advancedOpen?: boolean;
  onChange: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = useTranslations('creationCanvas.nodePanel');
  const schedule = canvasNodeSchedule(data);
  const write = (next: CanvasNodeSchedule) => onChange({ schedule: next } as Partial<CreationNodeData>);
  return <>
    <label className={styles.anchoredField}>
      <span>{t('runOnItsOwn')}</span>
      <button
        type="button"
        className={styles.advancedSwitch}
        aria-pressed={schedule.enabled}
        disabled={!editable}
        onClick={() => write({ ...schedule, enabled: !schedule.enabled })}
      ><i aria-hidden />{schedule.enabled ? t('scheduleOn') : t('scheduleOff')}</button>
    </label>
    <label className={styles.anchoredField}>
      <span>{t('every')}</span>
      <select
        value={schedule.everyMinutes}
        disabled={!editable || !schedule.enabled}
        onChange={(event) => write({ ...schedule, everyMinutes: Number(event.target.value) as CanvasNodeSchedule['everyMinutes'] })}
      >{CANVAS_SCHEDULE_INTERVALS.map((minutes) => <option key={minutes} value={minutes}>{t('everyMinutes', { minutes })}</option>)}</select>
    </label>
    <p className={styles.anchoredHint}>{t('scheduleFloorHint')}</p>
    {advancedOpen && <>
      <label className={styles.anchoredField}>
        <span>{t('onlyBetween')}</span>
        <span className={styles.anchoredRange}>
          <input type="time" aria-label={t('fromHour')} value={schedule.fromHour ?? ''} disabled={!editable} onChange={(event) => write({ ...schedule, fromHour: event.target.value })} />
          <input type="time" aria-label={t('toHour')} value={schedule.toHour ?? ''} disabled={!editable} onChange={(event) => write({ ...schedule, toHour: event.target.value })} />
        </span>
      </label>
      <label className={styles.anchoredField}>
        <span>{t('weekdaysOnly')}</span>
        <button
          type="button"
          className={styles.advancedSwitch}
          aria-pressed={schedule.weekdaysOnly === true}
          disabled={!editable}
          onClick={() => write({ ...schedule, weekdaysOnly: !schedule.weekdaysOnly })}
        ><i aria-hidden />{schedule.weekdaysOnly ? t('scheduleOn') : t('scheduleOff')}</button>
      </label>
    </>}
  </>;
}
