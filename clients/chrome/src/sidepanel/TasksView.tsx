/**
 * Tasks linked to the chat — the ones Rovr added (`rovr_add_task`) and the ones the
 * person adds here. Kept on the device first and synced to the platform with the chat
 * (created in the person's chosen project and linked to the chat as `created`).
 */
import { useState, type FormEvent } from 'react';
import { t, type MessageKey } from '../i18n/t';
import type { LocalTask, TaskSyncState } from '../store/records';
import { useLoaded, useServices } from './hooks';

const STATE_KEY: Record<TaskSyncState, MessageKey> = {
  queued: 'taskQueued',
  synced: 'taskSynced',
  local: 'taskLocalOnly',
};

export function TasksView({ chatId, onNewChat }: { chatId: number | null; onNewChat(): Promise<number> }) {
  const services = useServices();
  const [title, setTitle] = useState('');
  const [tasks, reload] = useLoaded<LocalTask[]>(
    () => (chatId === null ? Promise.resolve([]) : services.records.listTasks(chatId)),
    [],
    [chatId],
  );

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle('');
    const id = chatId ?? (await onNewChat());
    await services.addTask(id, text, '');
    reload();
  };

  return (
    <section className="rovr-stack">
      <form className="rovr-row" onSubmit={(e) => void add(e)}>
        <label className="rovr-sr" htmlFor="rovr-task-title">
          {t('taskAddLabel')}
        </label>
        <input
          id="rovr-task-title"
          className="rovr-input"
          value={title}
          placeholder={t('taskAddPlaceholder')}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" className="rovr-btn rovr-btn--primary" disabled={!title.trim()}>
          {t('taskAdd')}
        </button>
      </form>
      <button type="button" className="rovr-btn rovr-btn--link" onClick={reload}>
        {t('refresh')}
      </button>
      {tasks.length === 0 ? (
        <p className="rovr-empty">{t('tasksEmpty')}</p>
      ) : (
        <ul className="rovr-list">
          {tasks.map((task) => (
            <li key={task.id} className="rovr-card">
              <p className="rovr-card__title">{task.title}</p>
              {task.description && <p className="rovr-muted">{task.description}</p>}
              <span className={`rovr-chip rovr-chip--${task.state === 'synced' ? 'ok' : task.state === 'queued' ? 'pending' : 'local'}`}>
                {t(STATE_KEY[task.state])}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
