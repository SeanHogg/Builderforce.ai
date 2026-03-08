'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchProjects } from '@/lib/api';
import { ProjectList } from './ProjectList';
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
      setLoading(true);
      fetchProjects()
        .then(setProjects)
        .catch(() => setProjects([]))
        .finally(() => setLoading(false));
    }
  }, [open]);

  const handleSelect = (project: Project) => {
    onClose();
    router.push(`/projects/${project.id}`);
  };

  if (!open) return null;

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 9998,
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(400px, 90vw)',
          background: 'var(--bg-deep)',
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
        <div style={{ flex: 1, overflow: 'auto' }}>
          <ProjectList
            projects={projects}
            currentProjectId={currentProjectId}
            onSelect={handleSelect}
            loading={loading}
          />
        </div>
      </div>
    </>
  );
}
