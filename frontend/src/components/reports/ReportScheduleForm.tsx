/**
 * Create or edit ONE report schedule — the body of the panel's slide-out.
 *
 * The form follows the API's contract exactly rather than offering more: on
 * create every field is open; on edit only the three PATCH takes (hour,
 * recipients, enabled) are, and type / cadence / subject read as fixed. A
 * board pack cannot be submitted until a frame is chosen, because POST refuses
 * a board pack without one.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { Button, LabelField } from '@/components/ui';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import {
  boardPackSessionId,
  REPORT_TYPES,
  type CreateReportScheduleInput,
  type ReportCadence,
  type ReportSchedule,
  type ReportType,
  type UpdateReportScheduleInput,
} from '@/lib/reports/reportSchedulesApi';
import { formatRecipients, parseRecipientInput } from '@/lib/reports/recipients';
import { ReportCadenceFields } from './ReportCadenceFields';
import { RecipientsField } from './RecipientsField';
import { BoardPackFramePicker } from './BoardPackFramePicker';

const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' };
const toggleStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' };
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' };
const errorStyle: React.CSSProperties = { margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--error-text)' };

export type ReportScheduleSubmit =
  | { kind: 'create'; input: CreateReportScheduleInput }
  | { kind: 'update'; id: string; patch: UpdateReportScheduleInput };

export function ReportScheduleForm({ schedule, onSubmit, onCancel }: {
  /** The schedule being edited, or null to create one. */
  schedule: ReportSchedule | null;
  onSubmit: (submit: ReportScheduleSubmit) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('financeHub.reports');
  const errorMessage = useErrorMessage();
  const editing = schedule !== null;
  const [reportType, setReportType] = useState<ReportType>(schedule?.reportType ?? 'executive_summary');
  const [cadence, setCadence] = useState<ReportCadence>(schedule?.schedule ?? 'weekly');
  const [hour, setHour] = useState<number>(schedule?.deliveryHour ?? 8);
  const [recipientsText, setRecipientsText] = useState(formatRecipients(schedule?.recipients ?? []));
  const [isEnabled, setIsEnabled] = useState(schedule?.isEnabled ?? true);
  const [sessionId, setSessionId] = useState(boardPackSessionId(schedule?.subjectRef) ?? '');
  const [subjectRef, setSubjectRef] = useState(schedule?.subjectRef ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recipients = useMemo(() => parseRecipientInput(recipientsText), [recipientsText]);
  const isBoardPack = reportType === 'board_pack';
  const blocker = recipients.valid.length === 0
    ? t('needRecipients')
    : recipients.invalid.length > 0
      ? t('fixRecipients')
      : !editing && isBoardPack && !subjectRef
        ? t('needFrame')
        : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (blocker) return;
    setSaving(true);
    setError(null);
    try {
      if (schedule) {
        await onSubmit({ kind: 'update', id: schedule.id, patch: { deliveryHour: hour, recipients: recipients.valid, isEnabled } });
      } else {
        await onSubmit({
          kind: 'create',
          input: {
            reportType,
            schedule: cadence,
            deliveryHour: hour,
            recipients: recipients.valid,
            ...(isBoardPack ? { subjectKind: 'canvas_frame', subjectRef } : {}),
          },
        });
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form style={formStyle} onSubmit={submit} aria-label={editing ? t('editTitle') : t('createTitle')}>
      <LabelField label={t('field.type')}>
        <Select
          aria-label={t('field.type')}
          value={reportType}
          disabled={editing || saving}
          onChange={(e) => setReportType(e.target.value as ReportType)}
        >
          {REPORT_TYPES.map((value) => <option key={value} value={value}>{t(`type.${value}`)}</option>)}
        </Select>
      </LabelField>

      {isBoardPack && !editing && (
        <BoardPackFramePicker
          sessionId={sessionId}
          subjectRef={subjectRef}
          disabled={saving}
          onSession={(next) => { setSessionId(next); setSubjectRef(''); }}
          onFrame={setSubjectRef}
        />
      )}

      <ReportCadenceFields
        cadence={cadence}
        hour={hour}
        onCadence={setCadence}
        onHour={setHour}
        cadenceLocked={editing}
        disabled={saving}
      />
      {editing && <p style={hintStyle}>{t('fixedOnEdit')}</p>}

      <RecipientsField id="report-schedule-recipients" value={recipientsText} onChange={setRecipientsText} disabled={saving} />

      <label style={toggleStyle}>
        <input type="checkbox" checked={isEnabled} disabled={saving} onChange={(e) => setIsEnabled(e.target.checked)} />
        {t('field.enabled')}
      </label>

      {blocker && <p style={hintStyle}>{blocker}</p>}
      {error && <p style={errorStyle} role="alert">{error}</p>}

      <div style={actionsStyle}>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>{t('cancel')}</Button>
        <Button type="submit" variant="primary" loading={saving} disabled={blocker !== null}>
          {editing ? t('save') : t('create')}
        </Button>
      </div>
    </form>
  );
}
