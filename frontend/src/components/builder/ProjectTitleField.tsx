// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { updateProject } from '@/lib/api';
import { projectSubtitle } from '@/lib/projectSubtitle';
import type { Project } from '@/lib/types';
import styles from './workspaceChrome.module.css';

/**
 * The project's name, renamed in place: it reads as a title until it is hovered
 * or focused, and saves on blur or Enter. The description rides along as the
 * tooltip — printed beside the name, a prompt-started project read as its title
 * twice.
 */
export function ProjectTitleField({ project, onProjectUpdate }: {
  project: Project;
  onProjectUpdate?: (project: Project) => void;
}) {
  const t = useTranslations('ide');
  const [value, setValue] = useState(project.name);
  const [saving, setSaving] = useState(false);

  // Keep in sync when the project is renamed elsewhere.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(project.name);
  }, [project.name]);

  const save = async () => {
    const name = value.trim() || project.name;
    if (name === project.name) {
      setValue(project.name);
      return;
    }
    setSaving(true);
    try {
      const updated = await updateProject(project.id, { name });
      onProjectUpdate?.({ ...project, ...updated });
      setValue(updated.name);
    } catch {
      setValue(project.name);
    } finally {
      setSaving(false);
    }
  };

  const subtitle = projectSubtitle(project.name, project.description);
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { void save(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      disabled={saving}
      aria-label={t('editNameHint')}
      title={subtitle ? `${value} — ${subtitle}` : t('editNameHint')}
      className={styles.titleInput}
    />
  );
}
