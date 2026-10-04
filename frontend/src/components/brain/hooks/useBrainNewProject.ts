import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { createProject } from '@/lib/api';
import type { useBrainChats } from '@/lib/brain';
import type { Project } from '@/lib/types';

/**
 * "Create a new project and file this chat under it" — the inline form opened from
 * a row's "Add to…" picker or the page's conversation header.
 */
export function useBrainNewProject({ chats, setProjects }: {
  chats: ReturnType<typeof useBrainChats>;
  setProjects: Dispatch<SetStateAction<Project[]>>;
}) {
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  const openNewProject = useCallback(() => setShowNewProject(true), []);
  const cancelNewProject = useCallback(() => {
    setShowNewProject(false);
    setNewProjectName('');
  }, []);

  const createProjectAndAssign = useCallback(async () => {
    const name = newProjectName.trim();
    const target = chats.activeChatId;
    if (!name || target == null || creatingProject) return;
    setCreatingProject(true);
    try {
      const project = await createProject({ name });
      setProjects((prev) => [...prev, project]);
      await chats.assignToProject(target, project.id);
      setShowNewProject(false);
      setNewProjectName('');
    } catch { /* surfaced via chats.error */ } finally {
      setCreatingProject(false);
    }
  }, [newProjectName, chats, creatingProject, setProjects]);

  return {
    showNewProject,
    openNewProject,
    cancelNewProject,
    newProjectName,
    setNewProjectName,
    creatingProject,
    createProjectAndAssign,
  };
}
