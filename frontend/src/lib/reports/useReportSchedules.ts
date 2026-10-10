import { useCallback, useEffect, useState } from 'react';
import {
  reportSchedulesApi,
  type CreateReportScheduleInput,
  type ReportSchedule,
  type UpdateReportScheduleInput,
} from './reportSchedulesApi';

/*
 * No `'use client'`: a hook module marks no boundary (the `lib/useTheme.ts`
 * convention) — it runs inside whichever client component calls it.
 */

export interface ReportSchedulesState {
  schedules: ReportSchedule[];
  loading: boolean;
  /** The last read's rejection, raw — `<SectionError>` decides how to show it. */
  error: unknown;
  create: (input: CreateReportScheduleInput) => Promise<ReportSchedule>;
  update: (id: string, patch: UpdateReportScheduleInput) => Promise<ReportSchedule>;
  remove: (id: string) => Promise<void>;
}

/**
 * The report schedules a workspace delivers, with the three writes the API
 * takes. A write re-reads the list (the client invalidates its own key), so the
 * panel shows what the server stored — including the `nextRunAt` it computed —
 * rather than an optimistic guess at it.
 */
export function useReportSchedules(): ReportSchedulesState {
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    try {
      const next = await reportSchedulesApi.list();
      setSchedules(next);
      setError(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const create = useCallback(async (input: CreateReportScheduleInput) => {
    const created = await reportSchedulesApi.create(input);
    await reload();
    return created;
  }, [reload]);

  const update = useCallback(async (id: string, patch: UpdateReportScheduleInput) => {
    const updated = await reportSchedulesApi.update(id, patch);
    await reload();
    return updated;
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    await reportSchedulesApi.remove(id);
    await reload();
  }, [reload]);

  return { schedules, loading, error, create, update, remove };
}
