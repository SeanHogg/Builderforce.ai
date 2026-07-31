'use client';

/**
 * Registers the Brain's CLIENT-ONLY actions (browser navigation + local UI
 * panels) into the client tool loop. Rendered (null UI) inside the Brain
 * providers whenever the user is in a workspace, so both the docked drawer and
 * the full Brain Storm page can move the browser.
 *
 * All DATA capabilities (projects/tasks/OKRs/…) come from the ONE server MCP
 * catalog, registered by {@link McpExtensionsBridge} — the same source the VS
 * Code chat uses. Navigation has no server equivalent, so it lives here; see
 * platformActions.ts for the history of the retired data manifest.
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { buildPlatformActions, useRegisterBrainActions, useBrainContext } from '@/lib/brain';

export function PlatformActionsBridge() {
  const router = useRouter();
  const { setOpen } = useBrainContext();

  const actions = useMemo(
    () =>
      buildPlatformActions({
        navigate: (path: string) => {
          // Keep the Brain visible across Brain-initiated navigation. The
          // full-page Brain (/brainstorm) and the IDE-embedded Brain are
          // route-scoped and unmount when the Brain navigates the user, so
          // surface the persistent floating drawer on the destination page —
          // otherwise a redirect silently "closes" the Brain mid-task. The
          // active chat is shared via BrainContext, so the conversation resumes
          // seamlessly. setOpen(true) is a no-op when the drawer is already open.
          setOpen(true);
          router.push(path);
        },
      }),
    [router, setOpen],
  );

  useRegisterBrainActions(actions);
  return null;
}
