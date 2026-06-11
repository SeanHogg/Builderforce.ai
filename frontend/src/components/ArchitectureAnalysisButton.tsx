
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/types';
import { runArchitectureAnalysis } from '@/lib/api';

export interface ArchitectureAnalysisButtonProps {
  project: Project;
  /** Open the project Information panel on the PRDs tab to read the result. */
  onView: (project: Project) => void;
  /** No repo mapped yet — open the project Information panel on Integrations. */
  onConfigureRepo: (project: Project) => void;
}

/**
 * The Architect entry point on a project. It decides its own label from the
 * project's state — **View Arch Analysis** once an architecture PRD exists,
 * otherwise **Run Architecture Analysis** — so callers never compute that.
 *
 * Running creates an "Architecture Analysis" task on the board and routes to the
 * Tasks tab to watch it execute. A run is refused (409 no_repo) until a repo is
 * mapped; that case opens Integrations instead of erroring globally.
 *
 * Shared by the project card and the projects table so the behavior can't drift.
 */
export function ArchitectureAnalysisButton({ project, onView, onConfigureRepo }: ArchitectureAnalysisButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Increased padding and explicit min-size for touch targets.
  const baseStyle: React.CSSProperties = {
    fontSize: 13, // Slightly larger font
    fontWeight: 600,
    color: 'var(--coral-bright)',
    background: 'transparent',
    border: '1px solid var(--coral-bright)',
    borderRadius: 10, // Slightly larger radius
    padding: '10px 18px', // Increased padding for better touch target
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-display)', // Use display font for consistency
    minWidth: 44, // Ensure min touch target width
    minHeight: 44, // Ensure min touch target height
  };

  if (project.hasArchitecturePrd) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onView(project); }}
        style={baseStyle}
      >
        View Arch Analysis
      </button>
    );
  }

  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      await runArchitectureAnalysis(project.id);
      router.push(`/projects?tab=tasks&project=${project.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('no_repo')) {
        setError('Map a repository first.');
        onConfigureRepo(project);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        style={{ ...baseStyle, opacity: busy ? 0.7 : 1, cursor: busy ? 'default' : 'pointer' }}
      >
        {busy ? 'Starting…' : 'Run Architecture Analysis'}
      </button>
      {error && <span style={{ fontSize: 11, color: 'var(--error-text, #e55)' }}>{error}</span>}
    </span>
  );
}
