import { readLocal, removeLocal, writeLocal } from '@/lib/storage';

/**
 * The prompt a Studio visitor typed, carried across the two hops it has to
 * survive: a sign-in that may reload the page (a blocked pop-up falls back to a
 * full redirect), and the navigation from the home page into the new project.
 *
 * Storage, not the URL: a prompt in the address bar would be resent by a reload
 * and leak into history and analytics. Each entry is consumed once and the draft
 * is dropped on hand-off, so nothing lingers. The storage helpers never throw, so
 * an unavailable store just means the prompt does not survive the hop.
 */

const DRAFT_KEY = 'bf:studio:draft';
const projectKey = (projectId: number) => `bf:studio:prompt:${projectId}`;

/** The home page's unsent prompt, kept while the visitor signs in. */
export const studioDraft = {
  load: (): string => readLocal(DRAFT_KEY) ?? '',
  save: (prompt: string): void => {
    if (prompt.trim()) writeLocal(DRAFT_KEY, prompt);
    else removeLocal(DRAFT_KEY);
  },
};

/** Hand a prompt to a project's first open. */
export function handOffPrompt(projectId: number, prompt: string): void {
  writeLocal(projectKey(projectId), prompt);
  removeLocal(DRAFT_KEY);
}

/** Take the prompt handed to this project, once. */
export function takeHandedOffPrompt(projectId: number): string | undefined {
  const prompt = readLocal(projectKey(projectId));
  removeLocal(projectKey(projectId));
  return prompt ?? undefined;
}
