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
  /** One-shot prompt to auto-send into the Brain panel on load (e.g. the Project 360
   *  "Improve with Brain" seed via `/ide/:id?prompt=`). */
  initialPrompt?: string;
}

export function IDE({ project, initialFiles, onProjectUpdate, onOpenProjectDetails, initialChatId, initialPrompt }: IDEProps) {
  return (
    <IDENew
      project={project}
      initialFiles={initialFiles}
      onProjectUpdate={onProjectUpdate}
      onOpenProjectDetails={onOpenProjectDetails}
      initialChatId={initialChatId}
      initialPrompt={initialPrompt}
    />
  );
}
