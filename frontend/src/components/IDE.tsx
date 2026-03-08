'use client';

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

export function IDE({ project, initialFiles, onProjectUpdate, onOpenProjectDetails, initialChatId }: IDEProps) {
  return (
    <IDENew
      project={project}
      initialFiles={initialFiles}
      onProjectUpdate={onProjectUpdate}
      onOpenProjectDetails={onOpenProjectDetails}
      initialChatId={initialChatId}
    />
  );
}
