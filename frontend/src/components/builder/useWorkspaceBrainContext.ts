// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useEffect, useMemo } from 'react';
import { useBrainContext } from '@/lib/brain';
import type { ProjectModality } from '@/lib/modality';

/**
 * What the Brain is told about this workspace: the project, its type, and the
 * file open in the editor. One `extraSystem` feeds both the global Brain (via
 * the context) and the docked panel, so they speak with identical awareness.
 *
 * Also handles a deep link: docked, the panel takes the chat/prompt/ticket as
 * props (only the chat id is published); not docked, the floating drawer is
 * seeded and opened. Returns `openDrawer` for the non-docked "Ask AI" button.
 */
export function useWorkspaceBrainContext({ projectId, modality, activeFile, activeFileContent, docked, initialChatId, initialPrompt, initialTicket }: {
  projectId: number;
  modality: ProjectModality;
  activeFile: string | undefined;
  activeFileContent: string | undefined;
  docked: boolean;
  initialChatId?: number | null;
  initialPrompt?: string;
  initialTicket?: { kind: string; ref: string };
}) {
  const { setContext, setOpen } = useBrainContext();

  const extraSystem = useMemo(
    () =>
      activeFile
        ? `The user currently has the file \`${activeFile}\` open.${activeFileContent ? `\n\nCurrent content of that file:\n\`\`\`\n${activeFileContent.slice(0, 4000)}\n\`\`\`` : ''}`
        : undefined,
    [activeFile, activeFileContent],
  );

  useEffect(() => {
    setContext({ projectId, modality, extraSystem });
  }, [setContext, projectId, modality, extraSystem]);

  useEffect(() => {
    if (initialChatId == null && !initialPrompt && !initialTicket) return;
    if (docked) {
      if (initialChatId != null) setContext({ initialChatId });
      return;
    }
    setContext({
      ...(initialChatId != null ? { initialChatId } : {}),
      ...(initialPrompt ? { initialPrompt } : {}),
      ...(initialTicket ? { initialTicket } : {}),
    });
    setOpen(true);
  }, [initialChatId, initialPrompt, initialTicket, docked, setContext, setOpen]);

  const openDrawer = useCallback(() => {
    setContext({ projectId, modality });
    setOpen(true);
  }, [setContext, setOpen, projectId, modality]);

  return { extraSystem, openDrawer };
}
