import { useMemo, type ReactNode } from 'react';
import { ProjectScopeProvider, type ProjectScopeHost } from '@/lib/ProjectScopeContext';
import { LiveSessionProvider } from '@/lib/live/LiveSessionContext';
import { PinsProvider } from '@/lib/widgets/PinsProvider';
import { post } from '../vscodeBridge';

/**
 * The shell state the web canvas reads, mounted for the editor.
 *
 * The canvas's surfaces (Insights, the PM widgets, the ceremony stage) read the
 * project scope, the live room and the pinned widgets from providers the web app
 * shell mounts. The editor compiles the canvas but not that shell, so without these
 * each of those surfaces threw and took the board down to the chat.
 *
 * They are the SAME providers, not editor copies. The one difference is who owns the
 * project selection: here it is the sidebar, so the scope is handed the host's choice
 * through {@link ProjectScopeHost} and a pick on the canvas is sent back to the host,
 * which applies it and re-posts `init`. "Which project?" is still answered by the one
 * resolution in `lib/projectScopeResolution.ts`.
 */
export function HostScopeProviders({ projectId, children }: { projectId: number | null; children: ReactNode }) {
  const host = useMemo<ProjectScopeHost>(
    () => ({ projectId, select: (id) => post('project.select', { projectId: id }) }),
    [projectId],
  );
  return (
    <ProjectScopeProvider host={host}>
      <LiveSessionProvider>
        <PinsProvider>{children}</PinsProvider>
      </LiveSessionProvider>
    </ProjectScopeProvider>
  );
}
