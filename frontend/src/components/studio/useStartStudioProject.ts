// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProject } from '@/lib/api';
import { faultMessage } from '@/lib/apiClient';
import { handOffPrompt } from '@/lib/studio/promptHandoff';
import { studioProjectPath } from '@/lib/studio/studioHost';

/** The Vite + React starter: the stack the in-browser preview serves instantly. */
const STUDIO_TEMPLATE = 'vanilla';
const NAME_WORDS = 6;
const NAME_MAX = 60;

/** A project name from the first words of the prompt ("A todo app with tags…"). */
export function projectNameFromPrompt(prompt: string, fallback: string): string {
  const words = prompt.trim().replace(/\s+/g, ' ').split(' ').slice(0, NAME_WORDS).join(' ');
  const name = words.length > NAME_MAX ? `${words.slice(0, NAME_MAX - 1)}…` : words;
  return name || fallback;
}

/**
 * Turn a Studio prompt into a project and open it: create the project (tagged
 * `studio` so the Studio home lists it), hand the prompt to its first open, and
 * navigate. The agent starts on the prompt when the IDE opens.
 */
export function useStartStudioProject(untitled: string, failedMessage: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (prompt: string) => {
    setBusy(true);
    setError(null);
    try {
      const project = await createProject({
        name: projectNameFromPrompt(prompt, untitled),
        description: prompt.trim().slice(0, 500),
        template: STUDIO_TEMPLATE,
        modality: 'designer',
        origin: 'studio',
      });
      handOffPrompt(project.id, prompt.trim());
      router.push(studioProjectPath(project.id));
    } catch (cause) {
      setError(faultMessage(cause, failedMessage));
      setBusy(false);
    }
  }, [router, untitled, failedMessage]);

  return { start, busy, error };
}
