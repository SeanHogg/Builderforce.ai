'use client';

/**
 * The project OVERVIEW form: its fields, its key-availability check, and its save.
 *
 * A hook rather than state in the panel because the form has a life of its own —
 * a debounced availability request with a timer to clear, a save that can fail,
 * and six fields that must re-seed when the panel is handed a different project.
 * Sitting in the panel, those eleven `useState` calls were the largest single
 * reason the panel had to know about anything other than which tab is open.
 *
 * It owns its write path (`updateProject`) and its read (`checkProjectKeyAvailable`);
 * the component that renders the form owns none.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import { updateProject } from '@/lib/api';
import { checkProjectKeyAvailable } from '@/lib/builderforceApi';

/** `null` means "not asked" — the key is unchanged, so availability is not a question. */
export type ProjectKeyStatus = 'idle' | 'checking' | 'available' | 'taken';

/** ISO timestamp → `yyyy-mm-dd` for a native date input (empty string when unset). */
export const toDateInputValue = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

export interface ProjectEditForm {
  editing: boolean;
  /** Open the form, re-seeded from the project as it stands right now. */
  begin(): void;
  cancel(): void;
  submit(event: React.FormEvent): void;
  saving: boolean;
  error: string | null;
  keyStatus: ProjectKeyStatus;
  /** True while the key is being checked or is known to be taken. */
  blocked: boolean;
  name: string;
  setName(value: string): void;
  key: string;
  /** Not a plain setter: changing the key re-asks the API whether it is free. */
  setKey(value: string): void;
  status: string;
  setStatus(value: string): void;
  startDate: string;
  setStartDate(value: string): void;
  dueDate: string;
  setDueDate(value: string): void;
  description: string;
  setDescription(value: string): void;
}

export function useProjectEditForm(
  project: Project,
  onProjectUpdate?: (project: Project) => void,
): ProjectEditForm {
  const t = useTranslations('projectDetails');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [key, setKeyValue] = useState(project.key ?? '');
  const [status, setStatus] = useState(project.status ?? 'active');
  const [startDate, setStartDate] = useState(toDateInputValue(project.projectStartDate));
  const [dueDate, setDueDate] = useState(toDateInputValue(project.projectDueDate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<ProjectKeyStatus>('idle');
  const keyCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seed = useCallback(() => {
    setName(project.name);
    setDescription(project.description ?? '');
    setKeyValue(project.key ?? '');
    setStatus(project.status ?? 'active');
    setStartDate(toDateInputValue(project.projectStartDate));
    setDueDate(toDateInputValue(project.projectDueDate));
  }, [project.name, project.description, project.key, project.status, project.projectStartDate, project.projectDueDate]);

  // A different project (or a saved one) re-seeds the fields, so the form never
  // shows the previous project's values.
  useEffect(() => { seed(); }, [project.id, seed]);

  // The debounce outlives a render; an unmount mid-flight must not fire it.
  useEffect(() => () => { if (keyCheckTimer.current) clearTimeout(keyCheckTimer.current); }, []);

  const setKey = useCallback((value: string) => {
    setKeyValue(value);
    setError(null);
    const trimmed = value.trim().toUpperCase();
    if (keyCheckTimer.current) clearTimeout(keyCheckTimer.current);
    if (!trimmed || trimmed === (project.key ?? '').toUpperCase()) {
      setKeyStatus('idle');
      return;
    }
    setKeyStatus('checking');
    keyCheckTimer.current = setTimeout(async () => {
      try {
        const result = await checkProjectKeyAvailable(trimmed, project.id);
        setKeyStatus(result.available ? 'available' : 'taken');
      } catch {
        setKeyStatus('idle');
      }
    }, 500);
  }, [project.id, project.key]);

  const submit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (keyStatus === 'taken') return;
    setError(null);
    setSaving(true);
    try {
      const updated = await updateProject(project.publicId ?? project.id, {
        name: name.trim() || project.name,
        description: description.trim() || undefined,
        key: key.trim() || undefined,
        status,
        // Empty input clears the explicit date (null) so it reverts to the derived
        // task-based one; a date sets it explicitly. Both ends behave identically —
        // that symmetry is what lets the Gantt drag either edge of the bar.
        startDate: startDate ? new Date(startDate).toISOString() : null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      });
      onProjectUpdate?.(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [keyStatus, project.publicId, project.id, project.name, name, description, key, status, startDate, dueDate, onProjectUpdate, t]);

  const begin = useCallback(() => { seed(); setEditing(true); }, [seed]);
  const cancel = useCallback(() => setEditing(false), []);

  return {
    editing, begin, cancel, submit,
    saving, error, keyStatus,
    blocked: keyStatus === 'taken' || keyStatus === 'checking',
    name, setName,
    key, setKey,
    status, setStatus,
    startDate, setStartDate,
    dueDate, setDueDate,
    description, setDescription,
  };
}
