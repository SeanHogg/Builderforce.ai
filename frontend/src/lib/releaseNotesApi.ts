/**
 * Public platform release notes — the changelog behind the footer "What's new"
 * panel. The endpoint is PUBLIC (published marketing content, no tenant data),
 * so no auth headers: the panel works on login screens and marketing pages too.
 */

import { getApiBaseUrl } from './apiClient';

export type ReleaseNoteCategory = 'new' | 'improvement' | 'fix';

export interface ReleaseNote {
  id: string;
  version: string;
  title: string;
  body: string | null;
  category: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchReleaseNotes(limit = 50): Promise<ReleaseNote[]> {
  const res = await fetch(`${getApiBaseUrl()}/api/release-notes?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to load release notes (${res.status})`);
  const data = (await res.json()) as { releaseNotes?: ReleaseNote[] };
  return data.releaseNotes ?? [];
}
