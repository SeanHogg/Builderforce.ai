/**
 * The JOB SEEKER's own side of a posting: saved jobs, standing alerts, and the
 * extractor that turns a pasted description or an uploaded file into a draft.
 *
 * Split from `postings.ts` because the subject is different. A posting module
 * answers "what work exists and who applied"; this one answers "what is THIS
 * person watching for" — a private list and a saved query, read by the seeker and
 * by nobody else. A saved job is deliberately a proposal in the `saved` state, so
 * saving and applying are one lifecycle rather than two tables that can disagree.
 *
 * Transport, and why it is not `fetch`: see `./transport`.
 */
import { apiRequestStream, jsonOrThrow } from './transport';
import type { JobProposal } from './postings';

// ---- Job seeker: saved jobs, alerts, and reading a job description -------------

/** Jobs the seeker shortlisted. A saved job is a proposal in the `saved` state, so
 *  saving and applying are one lifecycle rather than two tables that can disagree. */
export async function listSavedJobs(): Promise<JobProposal[]> {
  const res = await apiRequestStream(`/api/jobs/saved`, { auth: 'web' });
  return jsonOrThrow<JobProposal[]>(res, 'Failed to load saved jobs');
}

export async function saveJob(jobId: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/save`, { method: 'POST', auth: 'web' });
  await jsonOrThrow(res, 'Failed to save job');
}

export async function unsaveJob(jobId: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/${jobId}/save`, { method: 'DELETE', auth: 'web' });
  await jsonOrThrow(res, 'Failed to remove saved job');
}

/** A standing search that tells the seeker when matching work appears. */
export interface JobAlert {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  resultCount: number | null;
}

export async function listJobAlerts(): Promise<JobAlert[]> {
  const res = await apiRequestStream(`/api/jobs/alerts`, { auth: 'web' });
  return jsonOrThrow<JobAlert[]>(res, 'Failed to load alerts');
}

export async function createJobAlert(input: { name: string; filters?: Record<string, unknown>; enabled?: boolean }): Promise<JobAlert> {
  const res = await apiRequestStream(`/api/jobs/alerts`, { method: 'POST', auth: 'web', body: JSON.stringify(input) });
  return jsonOrThrow<JobAlert>(res, 'Failed to create alert');
}

export async function updateJobAlert(id: string, patch: { name?: string; filters?: Record<string, unknown>; enabled?: boolean }): Promise<JobAlert> {
  const res = await apiRequestStream(`/api/jobs/alerts/${id}`, { method: 'PATCH', auth: 'web', body: JSON.stringify(patch) });
  return jsonOrThrow<JobAlert>(res, 'Failed to update alert');
}

export async function deleteJobAlert(id: string): Promise<void> {
  const res = await apiRequestStream(`/api/jobs/alerts/${id}`, { method: 'DELETE', auth: 'web' });
  await jsonOrThrow(res, 'Failed to delete alert');
}

/** A job description read out of pasted text or an uploaded file. */
export interface JobDescriptionDocument {
  title: string | null;
  company: string | null;
  location: string | null;
  workMode: 'remote' | 'hybrid' | 'onsite' | null;
  employmentType: string | null;
  salaryText: string | null;
  requirements: string[];
  responsibilities: string[];
  benefits: string[];
  skills: string[];
  text: string;
}

/** How the seeker's résumé scores against one posting, and what to change. */
export interface JobExtractResult {
  job: JobDescriptionDocument;
  match: { score: number; matched: string[]; missing: string[]; summary?: string } | null;
  tailor: { changes: Array<{ section?: string; action?: string; detail?: string }>; summary?: string } | null;
}

/** Read a JD from pasted text, or from an uploaded file when `source` is a File. */
export async function extractJobDescription(source: string | File): Promise<JobExtractResult> {
  const init = source instanceof File
    ? { method: 'POST' as const, auth: 'web' as const, body: (() => { const fd = new FormData(); fd.append('file', source); return fd; })() }
    : { method: 'POST' as const, auth: 'web' as const, body: JSON.stringify({ text: source }) };
  const res = await apiRequestStream(`/api/jobs/extract`, init);
  return jsonOrThrow<JobExtractResult>(res, 'Failed to read job description');
}

