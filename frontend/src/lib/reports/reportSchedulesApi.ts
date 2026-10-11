/**
 * Typed client for scheduled reports (`/api/reports/schedules`).
 *
 * Its own module rather than another block in `builderforceApi.ts`: report
 * schedules are the Run stage's delivery contract, read by the finance
 * destination, and that file is already the platform's largest. The shapes
 * mirror `report_schedules` (api `schema/delivery.ts`) and the handlers in
 * `api/src/presentation/routes/reportRoutes.ts`.
 *
 * Every read goes through the browser's ONE read-through cache and every write
 * invalidates the prefix it changed, so a panel and a picker mounting in the
 * same commit cost one request, and a save is never followed by a stale list.
 *
 * Two wire facts are normalised HERE, at the edge, so no component has to know
 * them:
 *  - `recipients` is stored as a JSON TEXT column, so the list route returns a
 *    string; callers get `string[]`.
 *  - a board pack's subject is `canvas_frame` + `"<sessionId>:<frameId>"`; the
 *    picker reads the frames the server says are schedulable and posts the
 *    `subjectRef` it was handed, never one it assembled.
 */

import { apiRequest } from '@/lib/apiClient';
import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';

/** `report_type` enum (api `schema/kernel.ts`). Order is the picker's order. */
export const REPORT_TYPES = [
  'standup', 'code_review', 'project_status', 'executive_summary', 'portfolio_rollup', 'board_pack',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** `report_schedule` enum. */
export const REPORT_CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type ReportCadence = (typeof REPORT_CADENCES)[number];

export interface ReportSchedule {
  id: string;
  reportType: ReportType;
  schedule: ReportCadence;
  /** UTC hour, 0–23. */
  deliveryHour: number;
  recipients: string[];
  isEnabled: boolean;
  subjectKind: string | null;
  subjectRef: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A frame the server will accept as a board pack's subject. */
export interface SchedulableFrame {
  id: string;
  title: string;
  tileCount: number;
  subjectKind: 'canvas_frame';
  subjectRef: string;
}

export interface CreateReportScheduleInput {
  reportType: ReportType;
  schedule: ReportCadence;
  deliveryHour: number;
  recipients: string[];
  subjectKind?: string;
  subjectRef?: string;
}

/** What PATCH accepts — the route updates only these three. Type, cadence and
 *  subject are fixed at creation; changing them is a new schedule. */
export interface UpdateReportScheduleInput {
  deliveryHour?: number;
  recipients?: string[];
  isEnabled?: boolean;
}

type ReportScheduleRow = Omit<ReportSchedule, 'recipients'> & { recipients: string | string[] | null };

const CACHE_PREFIX = 'report-schedules:';
const LIST_KEY = `${CACHE_PREFIX}list`;
const framesKey = (sessionId: string) => `${CACHE_PREFIX}frames:${sessionId}`;
/** Frames move as a board is edited, so the picker's read is short-lived. */
const FRAMES_TTL_MS = 30_000;

/** `recipients` as the column stores it (JSON text), or already an array. */
export function parseRecipients(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === 'string');
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function normalise(row: ReportScheduleRow): ReportSchedule {
  return { ...row, recipients: parseRecipients(row.recipients) };
}

/** The session a board pack's `subjectRef` (`"<sessionId>:<frameId>"`) points at. */
export function boardPackSessionId(subjectRef: string | null | undefined): string | null {
  if (!subjectRef) return null;
  const at = subjectRef.indexOf(':');
  return at > 0 ? subjectRef.slice(0, at) : null;
}

function invalidateList(): void {
  invalidateClientCache(LIST_KEY);
}

export const reportSchedulesApi = {
  list: (): Promise<ReportSchedule[]> =>
    getOrSetClientCached(LIST_KEY, async () => {
      const { schedules } = await apiRequest<{ schedules: ReportScheduleRow[] }>('/api/reports/schedules');
      return (schedules ?? []).map(normalise);
    }),

  boardPackFrames: (sessionId: string): Promise<SchedulableFrame[]> =>
    getOrSetClientCached(framesKey(sessionId), async () => {
      const { frames } = await apiRequest<{ frames: SchedulableFrame[] }>(
        `/api/reports/schedules/board-pack/frames?sessionId=${encodeURIComponent(sessionId)}`,
      );
      return frames ?? [];
    }, { ttlMs: FRAMES_TTL_MS }),

  create: async (input: CreateReportScheduleInput): Promise<ReportSchedule> => {
    const row = await apiRequest<ReportScheduleRow>('/api/reports/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    invalidateList();
    return normalise(row);
  },

  update: async (id: string, patch: UpdateReportScheduleInput): Promise<ReportSchedule> => {
    const row = await apiRequest<ReportScheduleRow>(`/api/reports/schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    invalidateList();
    return normalise(row);
  },

  remove: async (id: string): Promise<void> => {
    await apiRequest(`/api/reports/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
    invalidateList();
  },
};
