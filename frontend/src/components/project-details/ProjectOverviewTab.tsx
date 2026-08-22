'use client';

/**
 * The Details tab: the project's own facts, and the form that edits them.
 *
 * Presentational — every piece of state it renders belongs to `useProjectEditForm`,
 * which the panel owns because a pending "Fix" can open this form from another tab.
 * The DOM ids (`edit-description`, `edit-due-date`, `project-initiative-section`)
 * are a contract with `RECOMMENDATION_TARGET`: a fix names a field, and the field
 * has to be findable. They are declared once, in `projectPanelTabs.ts`.
 */
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import { Select } from '@/components/Select';
import { ScheduleDateField } from '@/components/ui/ScheduleDateField';
import { PROJECT_STATUSES, useProjectStatusLabel } from '@/lib/projectStatus';
import { useFormat } from '@/i18n/useFormat';
import { ProjectInitiativeLink } from '@/components/pm/ProjectInitiativeLink';
import { cardStyle, tabGridStyle } from './panelStyles';
import type { ProjectEditForm } from './useProjectEditForm';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 'var(--font-size-small)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-muted)',
  marginBottom: 4,
};

/** One `key / status / tasks / …` line of the facts list. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 'var(--font-size-small)' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function ProjectOverviewTab({ project, form }: { project: Project; form: ProjectEditForm }) {
  const t = useTranslations('projectDetails');
  const fmt = useFormat();
  const statusLabel = useProjectStatusLabel();
  const taskCount = project.taskCount ?? 0;

  const keyNote = form.keyStatus === 'checking' ? { text: t('checking'), color: 'var(--text-muted)' }
    : form.keyStatus === 'available' ? { text: t('keyAvailable'), color: 'var(--success)' }
    : form.keyStatus === 'taken' ? { text: t('keyTaken'), color: 'var(--error-text)' }
    : null;

  return (
    <div style={tabGridStyle}>
      <div style={cardStyle}>
        <div style={{ position: 'relative' }}>
          <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 'var(--font-size-body)' }}>{t('overview')}</div>
          {!form.editing && (
            <button
              type="button"
              onClick={form.begin}
              aria-label={t('editAria')}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-base)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
              </svg>
            </button>
          )}
        </div>

        {form.editing ? (
          <form onSubmit={form.submit} style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 10 }}>
              <label htmlFor="edit-name" style={labelStyle}>{t('nameLabel')}</label>
              <input id="edit-name" value={form.name} onChange={(e) => form.setName(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label htmlFor="edit-key" style={labelStyle}>{t('keyLabel')}</label>
              <input
                id="edit-key"
                value={form.key}
                onChange={(e) => form.setKey(e.target.value)}
                style={{
                  ...inputStyle,
                  border: `1px solid ${form.keyStatus === 'taken' ? 'var(--error-text)' : form.keyStatus === 'available' ? 'var(--success)' : 'var(--border-subtle)'}`,
                }}
              />
              {keyNote && (
                <div style={{ fontSize: 'var(--font-size-eyebrow)', color: keyNote.color, marginTop: 4 }}>{keyNote.text}</div>
              )}
            </div>
            <div style={{ marginBottom: 10 }}>
              <label htmlFor="edit-status" style={labelStyle}>{t('statusLabel')}</label>
              <Select id="edit-status" value={form.status} onChange={(e) => form.setStatus(e.target.value)} style={inputStyle}>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`status.${s}`)}</option>
                ))}
              </Select>
            </div>
            <ScheduleDateField
              id="edit-start-date"
              label={t('startDateLabel')}
              hint={t('startDateHint')}
              value={form.startDate}
              onChange={form.setStartDate}
            />
            <ScheduleDateField
              id="edit-due-date"
              label={t('dueDateLabel')}
              hint={t('dueDateHint')}
              value={form.dueDate}
              onChange={form.setDueDate}
            />
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="edit-description" style={labelStyle}>{t('descriptionLabel')}</label>
              <textarea
                id="edit-description"
                value={form.description}
                onChange={(e) => form.setDescription(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>
            {form.error && (
              <div
                style={{
                  fontSize: 'var(--font-size-small)',
                  color: 'var(--error-text)',
                  marginBottom: 8,
                  padding: '6px 10px',
                  background: 'var(--error-bg)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {form.error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="submit"
                disabled={form.saving || form.blocked}
                style={{
                  padding: '8px 14px',
                  fontSize: 'var(--font-size-small)',
                  fontWeight: 600,
                  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                  color: 'var(--text-on-accent)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  cursor: (form.saving || form.blocked) ? 'not-allowed' : 'pointer',
                  opacity: (form.saving || form.blocked) ? 0.6 : 1,
                }}
              >
                {form.saving ? t('saving') : t('save')}
              </button>
              <button
                type="button"
                onClick={form.cancel}
                style={{
                  padding: '8px 14px',
                  fontSize: 'var(--font-size-small)',
                  background: 'var(--bg-deep)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
              >
                {t('cancel')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 600, marginBottom: 6 }}>{project.name}</div>
            <div style={{ fontSize: 'var(--font-size-small)', lineHeight: 1.6, color: 'var(--text-secondary)', marginBottom: 14 }}>
              {project.description || t('noDescription')}
            </div>
          </>
        )}

        <div style={{ display: 'grid', gap: 8 }}>
          {!form.editing && (
            <>
              <Fact label={t('keyLabel')}>{project.key ?? `#${project.id}`}</Fact>
              <Fact label={t('statusLabel')}>{statusLabel(project.status)}</Fact>
            </>
          )}
          <Fact label={t('tasks')}>{taskCount}</Fact>
          <Fact label={t('template')}>{project.template ?? '—'}</Fact>
          <Fact label={t('start')}>
            {fmt.date(project.startDate)}
            {project.startDate && !project.projectStartDate && (
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{t('deadlineDerived')}</span>
            )}
          </Fact>
          <Fact label={t('deadline')}>
            {fmt.date(project.dueDate)}
            {project.dueDate && !project.projectDueDate && (
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{t('deadlineDerived')}</span>
            )}
          </Fact>
        </div>

        <div id="project-initiative-section" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
          <ProjectInitiativeLink projectId={project.id} />
        </div>
      </div>
    </div>
  );
}
