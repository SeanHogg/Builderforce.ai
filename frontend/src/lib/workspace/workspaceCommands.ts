// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useEffect, useRef } from 'react';
import type { RightTab } from '@/lib/modality';
import type { WorkspaceId } from './workspaceId';

/**
 * Things a surface AROUND the Builder workspace may ask it to do: the Studio
 * header's Publish and GitHub buttons open the workspace's own panels rather
 * than a second copy of them. A command channel, not props: the workspace keeps
 * owning its panels and their state, and a new command is a new member of this
 * union plus one case where the workspace handles it.
 */
export type WorkspaceCommand =
  | { type: 'openTab'; tab: RightTab }
  /** The settings slide-out: source control, GitHub, deploy. */
  | { type: 'openSettings' }
  /** Bring a bottom-panel tab forward (a publish shows its output). */
  | { type: 'showPanel'; panel: BottomPanelTab };

export type BottomPanelTab = 'terminal' | 'output' | 'problems';

const EVENT = 'bf:workspace-command';
const bus = typeof EventTarget === 'undefined' ? null : new EventTarget();

interface Envelope {
  projectId: WorkspaceId;
  command: WorkspaceCommand;
}

export function sendWorkspaceCommand(projectId: WorkspaceId, command: WorkspaceCommand): void {
  bus?.dispatchEvent(new CustomEvent<Envelope>(EVENT, { detail: { projectId, command } }));
}

/** Handle commands addressed to the workspace of `projectId`. */
export function useWorkspaceCommands(projectId: WorkspaceId, handle: (command: WorkspaceCommand) => void): void {
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle]);

  useEffect(() => {
    if (!bus) return undefined;
    const listener = (event: Event) => {
      const { detail } = event as CustomEvent<Envelope>;
      if (detail.projectId === projectId) handleRef.current(detail.command);
    };
    bus.addEventListener(EVENT, listener);
    return () => bus.removeEventListener(EVENT, listener);
  }, [projectId]);
}
