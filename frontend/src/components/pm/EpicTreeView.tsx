'use client';

import { tasksApi, type Task } from '@/lib/builderforceApi';
import { usePmScope } from '@/lib/pm/scope';
import { usePmData } from '@/lib/pm/usePmData';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { PmEmpty, PmError, PmSelectProject, StatusPill } from './pmShared';

/**
 * Epic → child-task decomposition tree for one project. Built from a single
 * tasks list (parentTaskId links children to their epic) rather than N tree
 * fetches. Top-level tasks with no parent are grouped under "Unparented" so they
 * are never silently dropped.
 */
export function EpicTreeView() {
  const { projectId } = usePmScope();
  const { data: tasks, error } = usePmData<Task[]>(
    () => (projectId == null ? Promise.resolve([]) : tasksApi.list(projectId)),
    [projectId],
  );

  if (projectId == null) return <PmSelectProject what="epics" />;
  if (error) return <PmError message={error} />;
  if (!tasks) return <PmEmpty message="Loading epics…" />;

  const epics = tasks.filter((t) => t.taskType === 'epic');
  const childrenByParent = new Map<number, Task[]>();
  for (const t of tasks) {
    if (t.parentTaskId != null) {
      const arr = childrenByParent.get(t.parentTaskId) ?? [];
      arr.push(t);
      childrenByParent.set(t.parentTaskId, arr);
    }
  }
  const orphans = tasks.filter((t) => t.taskType !== 'epic' && t.parentTaskId == null);

  if (!epics.length && !orphans.length) return <PmEmpty message="No tasks in this project yet." />;

  const renderChild = (t: Task) => (
    <tr key={t.id} style={trStyle}>
      <td style={{ ...tdStyle, paddingLeft: 40 }}>↳ {t.key} · {t.title}</td>
      <td style={tdStyle}><StatusPill value={t.status} /></td>
      <td style={tdMutedStyle}>{t.priority}</td>
      <td style={tdMutedStyle}>{t.sprintId ? 'scheduled' : '—'}</td>
    </tr>
  );

  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={thStyle}>Epic / Task</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Priority</th>
            <th style={thStyle}>Sprint</th>
          </tr>
        </thead>
        <tbody>
          {epics.map((epic) => {
            const kids = childrenByParent.get(epic.id) ?? [];
            return (
              <>
                <tr key={epic.id} style={{ ...trStyle, background: 'var(--bg-subtle, rgba(127,127,127,0.06))' }}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>
                    📦 {epic.key} · {epic.title}{' '}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({kids.length})</span>
                  </td>
                  <td style={tdStyle}><StatusPill value={epic.status} /></td>
                  <td style={tdMutedStyle}>{epic.priority}</td>
                  <td style={tdMutedStyle}>{epic.sprintId ? 'scheduled' : '—'}</td>
                </tr>
                {kids.map(renderChild)}
              </>
            );
          })}
          {orphans.length > 0 && (
            <>
              <tr style={{ ...trStyle, background: 'var(--bg-subtle, rgba(127,127,127,0.06))' }}>
                <td style={{ ...tdMutedStyle, fontStyle: 'italic' }} colSpan={4}>
                  Unparented ({orphans.length})
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
