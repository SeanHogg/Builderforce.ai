'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { tasksApi, type Task } from '@/lib/builderforceApi';
import { taskTypeBadgeClass, taskTypeLabelKey } from '@/lib/taskType';
import { usePmScope } from '@/lib/pm/scope';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { usePmData } from '@/lib/pm/usePmData';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { PmEmpty, PmError, StatusPill } from './pmShared';
import { EpicPanel } from './EpicPanel';

const newEpicButtonStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--coral-bright)',
  color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap',
};

/**
 * Epic → child-task decomposition tree. Built from a single tasks list
 * (parentTaskId links children to their epic) rather than N tree fetches.
 * Top-level tasks with no parent are grouped under "Unparented" so they are
 * never silently dropped.
 *
 * Scope follows the global project selector: a project view shows that project's
 * tree; the all-projects (portfolio) view rolls every project's epics up under a
 * per-project heading — so the Planning tab is never a dead-end when no single
 * project is selected.
 */

/** Render one project's epic/child tree as a table. Clicking an epic row opens
 *  the edit panel via {@link onEdit}. */
function EpicTable({ tasks, t, tCommon, onEdit }: { tasks: Task[]; t: ReturnType<typeof useTranslations>; tCommon: ReturnType<typeof useTranslations>; onEdit: (epic: Task) => void }) {
  const epics = tasks.filter((tk) => tk.taskType === 'epic');
  const childrenByParent = new Map<number, Task[]>();
  for (const tk of tasks) {
    if (tk.parentTaskId != null) {
      const arr = childrenByParent.get(tk.parentTaskId) ?? [];
      arr.push(tk);
      childrenByParent.set(tk.parentTaskId, arr);
    }
  }
  const orphans = tasks.filter((tk) => tk.taskType !== 'epic' && tk.parentTaskId == null);

  if (!epics.length && !orphans.length) return <PmEmpty message={t('noTasksProject')} />;

  const renderChild = (tk: Task) => (
    <tr key={tk.id} style={trStyle}>
      <td style={{ ...tdStyle, paddingLeft: 40 }}>
        ↳ {tk.key} · {tk.title}
        {taskTypeBadgeClass(tk.taskType) && (
          <span className={taskTypeBadgeClass(tk.taskType)!} style={{ marginLeft: 6, fontSize: 10 }}>
            {tCommon(taskTypeLabelKey(tk.taskType))}
          </span>
        )}
      </td>
      <td style={tdStyle}><StatusPill value={tk.status} /></td>
      <td style={tdMutedStyle}>{tk.priority}</td>
      <td style={tdMutedStyle}>{tk.sprintId ? t('scheduled') : '—'}</td>
    </tr>
  );

  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={thStyle}>{t('colEpicTask')}</th>
            <th style={thStyle}>{t('colStatus')}</th>
            <th style={thStyle}>{t('colPriority')}</th>
            <th style={thStyle}>{t('colSprint')}</th>
          </tr>
        </thead>
        <tbody>
          {epics.map((epic) => {
            const kids = childrenByParent.get(epic.id) ?? [];
            return (
              <>
                <tr
                  key={epic.id}
                  onClick={() => onEdit(epic)}
                  style={{ ...trStyle, background: 'var(--bg-subtle, rgba(127,127,127,0.06))', cursor: 'pointer' }}
                  title={t('editEpic')}
                >
                  <td style={{ ...tdStyle, fontWeight: 700 }}>
                    📦 {epic.key} · {epic.title}{' '}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({kids.length})</span>
                  </td>
                  <td style={tdStyle}><StatusPill value={epic.status} /></td>
                  <td style={tdMutedStyle}>{epic.priority}</td>
                  <td style={tdMutedStyle}>{epic.sprintId ? t('scheduled') : '—'}</td>
                </tr>
                {kids.map(renderChild)}
              </>
            );
          })}
          {orphans.length > 0 && (
            <>
              <tr style={{ ...trStyle, background: 'var(--bg-subtle, rgba(127,127,127,0.06))' }}>
                <td style={{ ...tdMutedStyle, fontStyle: 'italic' }} colSpan={4}>
                  {t('unparented', { count: orphans.length })}
                </td>
              </tr>
              {orphans.map(renderChild)}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function EpicTreeView() {
  const t = useTranslations('pm');
  const tCommon = useTranslations('common');
  const { projectId } = usePmScope();
  // Optional: present in the app shell, absent in embed (which scopes explicitly).
  const scope = useOptionalProjectScope();
  const { data: tasks, error, reload } = usePmData<Task[]>(
    () => tasksApi.list(projectId ?? undefined),
    [projectId],
  );

  // Epic create/edit panel. `panel.epic === null` = create under `panel.projectId`;
  // a row = edit that epic. `null` = closed.
  const [panel, setPanel] = useState<{ epic: Task | null; projectId: number | null } | null>(null);
  const openCreate = (pid: number | null) => setPanel({ epic: null, projectId: pid });
  const openEdit = (epic: Task) => setPanel({ epic, projectId: epic.projectId });

  const epicPanel = panel && (
    <EpicPanel
      open
      epic={panel.epic}
      projectId={panel.projectId}
      onClose={() => setPanel(null)}
      onSaved={reload}
    />
  );

  if (error) return <PmError message={error} />;
  if (!tasks) return <PmEmpty message={t('loadingEpics')} />;

  // Single-project view: a "New epic" action above the tree.
  if (projectId != null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" style={newEpicButtonStyle} onClick={() => openCreate(projectId)}>
            + {t('newEpic')}
          </button>
        </div>
        <EpicTable tasks={tasks} t={t} tCommon={tCommon} onEdit={openEdit} />
        {epicPanel}
      </div>
    );
  }

  // All-projects rollup: group every project's tasks under a per-project heading,
  // each with its own "New epic" action (create needs a single target project).
  const byProject = new Map<number, Task[]>();
  for (const tk of tasks) {
    const arr = byProject.get(tk.projectId) ?? [];
    arr.push(tk);
    byProject.set(tk.projectId, arr);
  }
  if (byProject.size === 0) return <PmEmpty message={t('noEpicsAnywhere')} />;

  const projectName = (id: number) => scope?.projects.find((p) => p.id === id)?.name ?? `#${id}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('allProjectsCaption')}</div>
      {Array.from(byProject.entries()).map(([pid, ptasks]) => (
        <div key={pid} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>{projectName(pid)}</h3>
            <button type="button" style={newEpicButtonStyle} onClick={() => openCreate(pid)}>
              + {t('newEpic')}
            </button>
          </div>
          <EpicTable tasks={ptasks} t={t} tCommon={tCommon} onEdit={openEdit} />
        </div>
      ))}
      {epicPanel}
    </div>
  );
}
