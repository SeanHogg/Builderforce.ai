/**
 * Job sourcing — the typed client.
 *
 * Its own module for the reason `pointsApi` and `phoneApi` are: one domain, one
 * client, droppable into a second surface without dragging the platform's whole
 * API surface behind it.
 *
 * ── THE FEED URL IS NEVER VALIDATED HERE ─────────────────────────────────────
 * Deliberately. The server refuses a private or malformed target through the
 * SSRF guard, and a second opinion in the browser would be a second rule that
 * can disagree with the one that decides — and the browser's copy is the one an
 * attacker edits. So this sends what the operator typed and renders the refusal
 * the server returns.
 */
import { apiRequestStream } from './apiClient';
import { jsonOrThrow } from './apiEnvelope';

export interface SourcedJobListing {
  id: string;
  title: string;
  summary: string;
  company: string;
  location: string;
  url: string;
  jobType: string;
  seenAt: string;
}

export interface JobBoardSource {
  id: number;
  name: string;
  vendor: string;
  url: string;
  format: 'rss' | 'json';
  status: string;
  hasApiKey: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface SourceSyncResult {
  connectionId: number;
  fetched: number;
  written: number;
  skipped: number;
  error: string | null;
}

export interface NewSourceInput {
  name: string;
  url: string;
  vendor?: string;
  format: 'rss' | 'json';
  itemsPath?: string;
  apiKey?: string;
}

export async function fetchSourcedListings(query = '', limit = 50): Promise<SourcedJobListing[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set('q', query);
  const res = await apiRequestStream(`/api/sourcing/listings?${params}`, { auth: 'tenant' });
  return (await jsonOrThrow<{ rows: SourcedJobListing[] }>(res, 'Failed to load sourced jobs')).rows;
}

export async function fetchJobSources(): Promise<JobBoardSource[]> {
  const res = await apiRequestStream('/api/sourcing/sources', { auth: 'tenant' });
  return (await jsonOrThrow<{ rows: JobBoardSource[] }>(res, 'Failed to load job feeds')).rows;
}

export async function saveJobSource(input: NewSourceInput): Promise<JobBoardSource> {
  const res = await apiRequestStream('/api/sourcing/sources', {
    method: 'POST', auth: 'tenant', body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { detail?: string; error?: string } | null;
    throw new Error(body?.detail ?? body?.error ?? 'That feed could not be saved');
  }
  return (await res.json() as { source: JobBoardSource }).source;
}

export async function deleteJobSource(id: number): Promise<void> {
  const res = await apiRequestStream(`/api/sourcing/sources/${id}`, { method: 'DELETE', auth: 'tenant' });
  await jsonOrThrow<{ ok: boolean }>(res, 'That feed could not be removed');
}

/** Run one feed now. Resolves with the run's counters even when the feed failed —
 *  `error` on the result is the feed's problem, not the request's. */
export async function syncJobSource(id: number): Promise<SourceSyncResult> {
  const res = await apiRequestStream(`/api/sourcing/sources/${id}/sync`, { method: 'POST', auth: 'tenant' });
  return jsonOrThrow<SourceSyncResult>(res, 'That feed could not be synced');
}
