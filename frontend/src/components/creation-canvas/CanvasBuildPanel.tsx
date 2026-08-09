'use client';

import { Icon } from '@/components/ui/Icon';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { fetchFiles, fetchProject } from '@/lib/api';
import type { FileEntry, Project } from '@/lib/types';
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary';

/**
 * The full Builder workspace, mounted inside the Creation Canvas.
 *
 * Every build capability lives in `<BuilderWorkspace>` — file explorer, code editor,
 * WebContainer dev server + live preview, quality checks, terminal, site/agent
 * publish, training, agent state, and the per-modality studios (video, Evermind,
 * fine-tune, voice). Rather than reimplementing any of that on the canvas, a
 * Builder object opens THIS panel against its bound storage project, so there is
 * no second surface to drift. It is lazy so the editor + WebGPU bundles do not
 * ship until a Builder object is opened.
 */
const BuilderWorkspace = dynamic(() => import('@/components/BuilderWorkspace').then((m) => m.BuilderWorkspace), { ssr: false });

interface CanvasBuildPanelProps {
  /** Backing storage project id of the bound Canvas build. */
  storageProjectId: number;
  onClose: () => void;
  /** Renaming inside Builder renames the Canvas object too. */
  onProjectRenamed?: (name: string) => void;
  initialChatId?: number | null;
  initialTicket?: { kind: string; ref: string };
}

export function CanvasBuildPanel({ storageProjectId, onClose, onProjectRenamed, initialChatId, initialTicket }: CanvasBuildPanelProps) {
  const t = useTranslations('creationCanvas.build');
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProject(null);
    setError(null);
    Promise.all([fetchProject(storageProjectId), fetchFiles(storageProjectId)])
      .then(([loadedProject, loadedFiles]) => {
        if (cancelled) return;
        setProject(loadedProject);
        setFiles(loadedFiles);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t('loadFailed'));
      });
    return () => { cancelled = true; };
  }, [storageProjectId, t]);

  return (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
      {error ? (
        <div role="alert" style={{ display: 'grid', gap: 12, justifyItems: 'center', alignContent: 'center', flex: 1, padding: 24, textAlign: 'center' }}>
          <span aria-hidden style={{ fontSize: '2rem' }}><Icon source="⚠️" size="1em" /></span>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{error}</p>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            {t('close')}
          </button>
        </div>
      ) : !project ? (
        <div style={{ display: 'grid', gap: 12, justifyItems: 'center', alignContent: 'center', flex: 1, padding: 24, color: 'var(--text-secondary)' }}>
          <span aria-hidden style={{ fontSize: '2rem' }}><Icon source="⚡" size="1em" /></span>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>{t('loading')}</p>
        </div>
      ) : (
        <ChunkErrorBoundary>
          <BuilderWorkspace
            project={project}
            initialFiles={files}
            initialChatId={initialChatId}
            initialTicket={initialTicket}
            onProjectUpdate={(updated) => {
              setProject(updated);
              onProjectRenamed?.(updated.name);
            }}
          />
        </ChunkErrorBoundary>
      )}
    </div>
  );
}
