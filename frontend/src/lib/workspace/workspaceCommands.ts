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
  | { type: 'showPanel'; panel: BottomPanelTab }
  /** Open a file in the Code view (a chat's "files changed" card). */
  | { type: 'openFile'; path: string };

export type BottomPanelTab = 'terminal' | 'output' | 'problems';

const EVENT = 'bf:workspace-command';
const bus = typeof EventTarget === 'undefined' ? null : new EventTarget();

interface Envelope {
  projectId: WorkspaceId;
  command: WorkspaceCommand;
}

/** How many handlers each workspace has mounted, and what is waiting for the first. */
const listening = new Map<WorkspaceId, number>();
const waiting = new Map<WorkspaceId, WorkspaceCommand[]>();

/**
 * Send `command` to the workspace of `projectId`.
 *
 * `whenReady` is for a surface that opens the workspace and addresses it in the same
 * breath — the canvas opening its App surface on the Publish panel. The workspace has not
 * mounted yet, so a plain send would reach nobody; a waiting command is delivered once the
 * workspace's handlers are subscribed (after the commit that mounted them).
 */
export function sendWorkspaceCommand(projectId: WorkspaceId, command: WorkspaceCommand, options: { whenReady?: boolean } = {}): void {
  if (options.whenReady && !listening.get(projectId)) {
    waiting.set(projectId, [...(waiting.get(projectId) ?? []), command]);
    return;
  }
  bus?.dispatchEvent(new CustomEvent<Envelope>(EVENT, { detail: { projectId, command } }));
}

function deliverWaiting(projectId: WorkspaceId): void {
  const commands = waiting.get(projectId);
  if (!commands) return;
  waiting.delete(projectId);
  for (const command of commands) sendWorkspaceCommand(projectId, command);
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
    listening.set(projectId, (listening.get(projectId) ?? 0) + 1);
    // A microtask, so every handler the same commit mounts is subscribed before delivery.
    if (waiting.has(projectId)) queueMicrotask(() => deliverWaiting(projectId));
    return () => {
      bus.removeEventListener(EVENT, listener);
      const left = (listening.get(projectId) ?? 1) - 1;
      if (left > 0) listening.set(projectId, left);
      else listening.delete(projectId);
    };
  }, [projectId]);
}
