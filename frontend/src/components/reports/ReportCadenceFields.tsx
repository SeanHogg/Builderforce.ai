/**
 * Cadence + delivery hour for a scheduled report — the two controls every
 * report schedule carries, as ONE piece so a second report surface does not
 * draw its own.
 *
 * Not the QA/ceremony cron picker on purpose: those schedules speak 5-field
 * cron + timezone, while `report_schedules` stores the `report_schedule` enum
 * (daily / weekly / monthly) and a UTC hour. Offering cron presets here would
 * promise cadences the column cannot hold.
 */

import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { LabelField } from '@/components/ui';
import { REPORT_CADENCES, type ReportCadence } from '@/lib/reports/reportSchedulesApi';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 12,
};

export function ReportCadenceFields({ cadence, hour, onCadence, onHour, cadenceLocked = false, disabled = false }: {
  cadence: ReportCadence;
  hour: number;
  onCadence: (next: ReportCadence) => void;
  onHour: (next: number) => void;
  /** Cadence is fixed once a schedule exists — the API's PATCH does not take it. */
  cadenceLocked?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('financeHub.reports');
  return (
    <div style={rowStyle}>
      <LabelField label={t('field.cadence')}>
        <Select
          aria-label={t('field.cadence')}
          value={cadence}
          disabled={disabled || cadenceLocked}
          onChange={(e) => onCadence(e.target.value as ReportCadence)}
        >
          {REPORT_CADENCES.map((value) => <option key={value} value={value}>{t(`cadence.${value}`)}</option>)}
        </Select>
      </LabelField>
      <LabelField label={t('field.hour')}>
        <Select
          aria-label={t('field.hour')}
          value={String(hour)}
          disabled={disabled}
          onChange={(e) => onHour(Number(e.target.value))}
        >
          {HOURS.map((value) => (
            <option key={value} value={String(value)}>{t('hourOption', { hour: String(value).padStart(2, '0') })}</option>
          ))}
        </Select>
      </LabelField>
    </div>
  );
}
