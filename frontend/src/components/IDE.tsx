'use client';

import { useState, useEffect } from 'react';
import { IDE as IDEOld } from './IDEOld';
import { IDE as IDENew } from './IDENew';
import type { Project, FileEntry } from '@/lib/types';

interface IDEProps {
  project: Project;
  initialFiles: FileEntry[];
  onProjectUpdate?: (project: Project) => void;
  onOpenProjectDetails?: () => void;
  /** When opening from "Open in IDE" with a chat, select this project chat on load. */
  initialChatId?: number | null;
}

const LAYOUT_STORAGE_KEY = 'builderforce-ide-layout';

export function IDE({ project, initialFiles, onProjectUpdate, onOpenProjectDetails, initialChatId }: IDEProps) {
  const [useNewLayout, setUseNewLayout] = useState(() => {
    // Load preference from localStorage on mount
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
      return stored === 'new' || stored === null; // Default to new layout
    }
    return true;
  });

  // Persist preference to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LAYOUT_STORAGE_KEY, useNewLayout ? 'new' : 'old');
    }
  }, [useNewLayout]);

  if (useNewLayout) {
    return <IDENew key="new" project={project} initialFiles={initialFiles} onToggleLayout={() => setUseNewLayout(false)} onProjectUpdate={onProjectUpdate} onOpenProjectDetails={onOpenProjectDetails} initialChatId={initialChatId} />;
  }

  return <IDEOld key="old" project={project} initialFiles={initialFiles} onToggleLayout={() => setUseNewLayout(true)} onProjectUpdate={onProjectUpdate} onOpenProjectDetails={onOpenProjectDetails} initialChatId={initialChatId} />;
}
