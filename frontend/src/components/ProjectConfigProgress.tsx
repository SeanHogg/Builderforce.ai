'use client';

import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import { computeProjectConfig, type ProjectConfigItem } from '@/lib/projectInspection';
import { useOpenProjectChat } from '@/lib/brain';
import { DonutChart } from './charts/DonutChart';

/**
 * Compact configuration-completeness pill for the List view — self-gating (hidden
 * once fully set up), tooltip lists what's missing. Shares {@link computeProjectConfig}
 * with the card donut so the two never disagree.
 */
export function ProjectConfigBadge({ project }: { project: Project }) {
  const t = useTranslations('projectCard');
  const cfg = computeProjectConfig(project);
  if (cfg.missing.length === 0) return null;
  const missingLabels = cfg.missing.map((k) => t(`config_${k}`)).join(', ');
  return (
    <span
      title={t('configMissingList', { items: missingLabels })}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
        background: 'var(--surface-interactive, var(--bg-elevated))',
        border: '1px solid var(--border-subtle)', borderRadius: 999, padding: '2px 8px',
      }}
    >
      <span aria-hidden>🛠</span>
      {t('configPct', { pct: cfg.pct })}
    </span>
  );
}

/**
 * ProjectConfigProgress — a compact configuration-completeness donut for a
 * project card/row. Self-gating: renders nothing once the project is fully set
 * up, so it only nags the projects that "require configuration".
 *
 * Shows how much of the project's setup (vision, goals, deadline, owner, tasks,
 * architecture) is done, lists what's still missing, and — because goals are the
 * hardest blank to fill — offers a one-click "Brainstorm goals" that opens a
 * project-scoped Brain chat seeded to help define them.
 */
export function ProjectConfigProgress({ project }: { project: Project }) {
  const t = useTranslations('projectCard');
  const openChat = useOpenProjectChat();
  const cfg = computeProjectConfig(project);

  // Fully configured — nothing to prompt.
  if (cfg.missing.length === 0) return null;

  const projectId = typeof project.id === 'number' ? project.id : Number(project.id);
  const goalsMissing = cfg.missing.includes('goals');

  const segments = [
    { key: 'done', label: t('configDone'), value: cfg.done.length, color: '#22c55e' },
    { key: 'todo', label: t('configTodo'), value: cfg.missing.length, color: 'var(--border-subtle)' },
  ];

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        padding: '10px 12px', borderRadius: 10,
        background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
      }}
    >
      <DonutChart
        segments={segments}
        size={72}
        thickness={12}
        centerValue={`${cfg.pct}%`}
        legend={false}
        ariaLabel={t('configAria', { pct: cfg.pct })}
      />
      <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
          {t('configTitle')}
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {cfg.missing.map((item: ProjectConfigItem) => (
            <span
              key={item}
              style={{
                fontSize: 11, color: 'var(--text-muted)',
                background: 'var(--surface-interactive, var(--bg-elevated))',
                border: '1px solid var(--border-subtle)', borderRadius: 999, padding: '2px 8px',
              }}
            >
              {t(`config_${item}`)}
            </span>
          ))}
        </div>
        {goalsMissing && Number.isFinite(projectId) && (
          <button
            type="button"
            onClick={() => openChat(projectId, { prompt: t('brainstormGoalsPrompt', { name: project.name }) })}
            style={{
              alignSelf: 'flex-start', marginTop: 2,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              color: 'var(--coral-bright)', background: 'transparent',
              border: '1px solid var(--coral-bright)', borderRadius: 8, padding: '4px 10px',
            }}
          >
            <span aria-hidden>💡</span>
            {t('brainstormGoals')}
          </button>
        )}
      </div>
    </div>
  );
}
