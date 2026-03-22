'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchProjects } from '@/lib/api';
import { ProjectCard } from './ProjectCard';
import type { Project } from '@/lib/types';

export interface ProjectsSlideOutPanelProps {
  open: boolean;
  onClose: () => void;
  currentProjectId?: number;
}

export function ProjectsSlideOutPanel({ open, onClose, currentProjectId }: ProjectsSlideOutPanelProps) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(true);
      fetchProjects()
        .then(setProjects)
        .catch(() => setProjects([]))
        .finally(() => setLoading(false));
    }
  }, [open]);

  const handleSelect = (project: Project) => {
    onClose();
    router.push(`/ide/${project.publicId ?? project.id}`);
  };

  if (!open) return null;

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        className="projects-panel-overlay"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 'var(--footer-height, 44px)',
          zIndex: 9998,
        }}
      />
      <div
        className="projects-panel-drawer"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 'var(--footer-height, 44px)',
          width: 'min(420px, 90vw)',
          borderLeft: '1px solid var(--border-subtle)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.2)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Projects</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: '6px 10px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '1.1rem',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {loading ? (
            <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Loading projects…
            </div>
          ) : projects.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center' }}>
              No projects yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {projects.map((project) => (
                <div
                  key={project.id}
                  style={
                    currentProjectId != null && project.id === currentProjectId
                      ? { position: 'relative', boxShadow: '0 0 0 2px var(--coral-bright)' }
                      : undefined
                  }
                >
                  <ProjectCard
                    project={project}
                    onCardClick={handleSelect}
                    showDetailsButton={false}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
