import { useMemo } from 'react';
import type { BrainChat } from '@seanhogg/builderforce-brain-embedded';
import type { InitData } from '../bridge/vscodeBridge';

/**
 * The chat's project, resolved chat-FIRST: a chat that belongs to a project is about
 * THAT project whatever the sidebar shows; a new chat falls back to the IDE's project.
 * The one resolution the run's project, the header, Evermind and the triage report share.
 */
export function useAssociatedProject(init: InitData, activeChat: BrainChat | null) {
  const associatedProjectId = activeChat ? activeChat.projectId : (init.project?.id ?? null);
  const associatedProject = useMemo<{ id: number; name: string } | null>(() => {
    if (associatedProjectId == null) return null;
    const name = init.projectNames?.[String(associatedProjectId)]
      ?? (associatedProjectId === init.project?.id ? init.project?.name : undefined);
    return { id: associatedProjectId, name: name ?? `#${associatedProjectId}` };
  }, [associatedProjectId, init.projectNames, init.project?.id, init.project?.name]);
  return { associatedProjectId, associatedProject };
}
