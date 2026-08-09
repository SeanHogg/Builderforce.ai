'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { fetchFiles, fetchProject } from '@/lib/api';
import type { FileEntry, Project } from '@/lib/types';
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary';

/**
 * The full IDE surface, mounted inside the Creation Canvas.
 *
 * Every IDE project capability lives in `<IDE>` — file explorer, code editor,
 * WebContainer dev server + live preview, quality checks, terminal, site/agent
 * publish, training, agent state, and the per-modality studios (video, Evermind,
 * fine-tune, voice). Rather than reimplementing any of that on the canvas, a
 * Builder object opens THIS panel against its bound storage project, so the two
 * surfaces can never drift. Lazily imported for the same reason `/ide/[id]` does
 * it: the editor + WebGPU bundles must not ship with the canvas itself.
 */
const IDE = dynamic(() => import('@/components/IDE').then((m) => m.IDE), { ssr: false });

interface CanvasBuildPanelProps {
  /** Backing storage project id of the bound IDE project. */
  storageProjectId: number;
  onClose: () => void;
  /** Renaming inside the IDE renames the canvas object too. */
  onProjectRenamed?: (name: string) => void;
}

export function CanvasBuildPanel({ storageProjectId, onClose, onProjectRenamed }: CanvasBuildPanelProps) {
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
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-deep, #0f1420)', color: 'var(--text-primary, #f4f6fb)' }}>
      {error ? (
        <div role="alert" style={{ display: 'grid', gap: 12, justifyItems: 'center', alignContent: 'center', flex: 1, padding: 24, textAlign: 'center' }}>
          <span aria-hidden style={{ fontSize: '2rem' }}>⚠️</span>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary, #aab3c5)' }}>{error}</p>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle, #2a3346)', background: 'var(--bg-elevated, #1a2233)', color: 'var(--text-primary, #f4f6fb)', cursor: 'pointer' }}
          >
            {t('close')}
          </button>
        </div>
      ) : !project ? (
        <div style={{ display: 'grid', gap: 12, justifyItems: 'center', alignContent: 'center', flex: 1, padding: 24, color: 'var(--text-secondary, #aab3c5)' }}>
          <span aria-hidden style={{ fontSize: '2rem' }}>⚡</span>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>{t('loading')}</p>
        </div>
      ) : (
        <ChunkErrorBoundary>
          <IDE
            project={project}
            initialFiles={files}
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
