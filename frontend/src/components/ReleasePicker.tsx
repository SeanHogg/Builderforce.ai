'use client';

import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { releasesApi, type Release } from '@/lib/releasesApi';
import { usePmData } from '@/lib/pm/usePmData';

/**
 * ReleasePicker (EMP-10a) — associate a task with a product release. Self-contained:
 * loads the releases for the task's project (falling back to all tenant releases)
 * and emits the chosen releaseId. The PARENT persists it via the existing task
 * update path (`tasksApi.update(id, { releaseId })`) so the task route stays the
 * single writer — this component never PATCHes the task itself.
 */
export function ReleasePicker({
  value,
  projectId,
  onChange,
  disabled,
  autoFocus,
  onBlur,
  style,
}: {
  value: string | null;
  projectId?: number;
  onChange: (releaseId: string | null) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  style?: React.CSSProperties;
}) {
  const t = useTranslations('insights.emp');
  const { data } = usePmData<{ releases: Release[] }>(() => releasesApi.list(projectId), [projectId]);
  const releases = data?.releases ?? [];

  return (
    <Select
      autoFocus={autoFocus}
      disabled={disabled}
      onBlur={onBlur}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={t('release.label')}
      style={style}
    >
      <option value="">{t('release.none')}</option>
      {releases.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}{r.version ? ` (${r.version})` : ''}
        </option>
      ))}
    </Select>
  );
}
