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
  /** One-shot work item to auto-link the opened chat to (`/ide/:id?ticket=<kind>:<ref>`),
   *  so clicking an item opens a chat already tied to it — parity with the VS Code flow. */
  initialTicket?: { kind: string; ref: string };
}

export function IDE({ project, initialFiles, onProjectUpdate, onOpenProjectDetails, initialChatId, initialPrompt, initialTicket }: IDEProps) {
  return (
    <IDENew
      project={project}
      initialFiles={initialFiles}
      onProjectUpdate={onProjectUpdate}
      onOpenProjectDetails={onOpenProjectDetails}
      initialChatId={initialChatId}
      initialPrompt={initialPrompt}
      initialTicket={initialTicket}
    />
  );
}
