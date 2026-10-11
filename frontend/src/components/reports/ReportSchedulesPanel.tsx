/**
 * Scheduled reports — the UI for `report_schedules`.
 *
 * Until this, the only schedule a person could see or change was a QA run's;
 * report schedules (standups, executive summaries, portfolio rollups and board
 * packs — a canvas frame delivered on a cadence) existed only as API routes.
 * This lists them, opens one in a slide-out to edit, creates a new one through
 * the same form, pauses/resumes in place and deletes behind the one destructive
 * confirm.
 *
 * Every read and write goes through `useReportSchedules` → the typed client; this
 * component holds view state only. Writes are MANAGER+ on the API, so every
 * write control sits in `<RoleGate>` — disabled with the role named, never hidden.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { useConfirm } from '@/components/ConfirmProvider';
import { RoleGate } from '@/components/RoleGate';
import { Badge, Button, SectionEmpty, SectionError, SectionLoading, Surface } from '@/components/ui';
import { useFormat } from '@/i18n/useFormat';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import type { ReportSchedule } from '@/lib/reports/reportSchedulesApi';
import { useReportSchedules } from '@/lib/reports/useReportSchedules';
import { ReportScheduleForm, type ReportScheduleSubmit } from './ReportScheduleForm';

const CAPABILITY = 'reports.manageSchedules' as const;

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 600 };
const mutedStyle: React.CSSProperties = { margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' };
const listStyle: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' };
const rowMainStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 220px' };
const rowActionsStyle: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
const nameStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontWeight: 600, color: 'var(--text-primary)' };
const errorStyle: React.CSSProperties = { margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--error-text)' };

type Editing = { mode: 'create' } | { mode: 'edit'; schedule: ReportSchedule } | null;

export function ReportSchedulesPanel() {
  const t = useTranslations('financeHub.reports');
  const fmt = useFormat();
  const confirm = useConfirm();
  const errorMessage = useErrorMessage();
  const { schedules, loading, error, create, update, remove } = useReportSchedules();
  const [editing, setEditing] = useState<Editing>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const close = () => setEditing(null);

  const submit = async (next: ReportScheduleSubmit) => {
    if (next.kind === 'create') await create(next.input);
    else await update(next.id, next.patch);
    close();
  };

  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusyId(id);
    setActionError(null);
    try {
      await run();
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  };

  const toggle = (schedule: ReportSchedule) =>
    act(schedule.id, () => update(schedule.id, { isEnabled: !schedule.isEnabled }));

  const destroy = async (schedule: ReportSchedule) => {
    const ok = await confirm({
      title: t('deleteTitle'),
      message: t('deleteMessage', { type: t(`type.${schedule.reportType}`) }),
      confirmLabel: t('delete'),
      destructive: true,
    });
    if (ok) await act(schedule.id, () => remove(schedule.id));
  };

  return (
    <section style={sectionStyle} aria-labelledby="report-schedules-title">
      <div style={headerStyle}>
        <div>
          <h2 id="report-schedules-title" style={titleStyle}>{t('title')}</h2>
          <p style={mutedStyle}>{t('blurb')}</p>
        </div>
        <RoleGate capability={CAPABILITY}>
          <Button variant="primary" onClick={() => setEditing({ mode: 'create' })}>{t('new')}</Button>
        </RoleGate>
      </div>

      {loading && schedules.length === 0 && <SectionLoading label={t('loading')} />}
      <SectionError error={error} />
      {actionError && <p style={errorStyle} role="alert">{actionError}</p>}
      {!loading && !error && schedules.length === 0 && <SectionEmpty message={t('empty')} />}

      {schedules.length > 0 && (
        <ul style={listStyle}>
          {schedules.map((schedule) => {
            const busy = busyId === schedule.id;
            return (
              <li key={schedule.id}>
                <Surface padding="sm">
                  <div style={rowStyle}>
                    <div style={rowMainStyle}>
                      <span style={nameStyle}>
                        {t(`type.${schedule.reportType}`)}
                        <Badge tone={schedule.isEnabled ? 'success' : 'neutral'} dot>
                          {schedule.isEnabled ? t('statusOn') : t('statusPaused')}
                        </Badge>
                      </span>
                      <span style={mutedStyle}>
                        {t('cadenceSummary', {
                          cadence: t(`cadence.${schedule.schedule}`),
                          hour: String(schedule.deliveryHour).padStart(2, '0'),
                        })}
                        {' · '}
                        {t('recipientsCount', { count: schedule.recipients.length })}
                        {schedule.subjectKind === 'canvas_frame' && <>{' · '}{t('subjectFrame')}</>}
                      </span>
                      <span style={mutedStyle}>
                        {schedule.nextRunAt ? t('nextRun', { when: fmt.dateTime(schedule.nextRunAt) }) : t('nextRunPending')}
                      </span>
                    </div>
                    <div style={rowActionsStyle}>
                      <RoleGate capability={CAPABILITY}>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing({ mode: 'edit', schedule })}>
                          {t('edit')}
                        </Button>
                      </RoleGate>
                      <RoleGate capability={CAPABILITY}>
                        <Button size="sm" variant="secondary" loading={busy} onClick={() => void toggle(schedule)}>
                          {schedule.isEnabled ? t('pause') : t('resume')}
                        </Button>
                      </RoleGate>
                      <RoleGate capability={CAPABILITY}>
                        <Button size="sm" variant="danger" disabled={busy} onClick={() => void destroy(schedule)}>
                          {t('delete')}
                        </Button>
                      </RoleGate>
                    </div>
                  </div>
                </Surface>
              </li>
            );
          })}
        </ul>
      )}

      <SlideOutPanel
        open={editing !== null}
        onClose={close}
        title={editing?.mode === 'edit' ? t('editTitle') : t('createTitle')}
        crumb={t('crumb')}
        accentVar="--seat-cfo"
      >
        {editing && (
          <ReportScheduleForm
            // Keyed so opening a different schedule starts from its own values.
            key={editing.mode === 'edit' ? editing.schedule.id : 'new'}
            schedule={editing.mode === 'edit' ? editing.schedule : null}
            onSubmit={submit}
            onCancel={close}
          />
        )}
      </SlideOutPanel>
    </section>
  );
}
