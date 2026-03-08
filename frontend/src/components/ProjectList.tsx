'use client';

import type { Project } from '@/lib/types';

export interface ProjectListProps {
  projects: Project[];
  currentProjectId?: number;
  onSelect: (project: Project) => void;
  loading?: boolean;
}

export function ProjectList({ projects, currentProjectId, onSelect, loading }: ProjectListProps) {
  if (loading) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        Loading projects…
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center' }}>
        No projects yet.
      </div>
    );
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {projects.map((project) => {
        const isCurrent = currentProjectId != null && project.id === currentProjectId;
        return (
          <li key={project.id}>
            <button
              type="button"
              onClick={() => onSelect(project)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '12px 16px',
                border: 'none',
                borderBottom: '1px solid var(--border-subtle)',
                background: isCurrent ? 'var(--bg-elevated)' : 'transparent',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '0.9rem',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
              onMouseEnter={(e) => {
                if (!isCurrent) e.currentTarget.style.background = 'var(--bg-elevated)';
              }}
              onMouseLeave={(e) => {
                if (!isCurrent) e.currentTarget.style.background = 'transparent';
              }}
            >
              <span style={{ fontWeight: 600 }}>{project.name}</span>
              {project.description && (
                <span
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--text-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {project.description}
                </span>
              )}
              {isCurrent && (
                <span style={{ fontSize: '0.7rem', color: 'var(--coral-bright)', marginTop: 2 }}>Current project</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
