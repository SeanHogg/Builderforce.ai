'use client';

import { useMemo } from 'react';
import { segmentTrackerClient, type TrackerRow } from '@/lib/builderforceApi';
import { ScheduleGantt } from '@/components/ScheduleGantt';
import type { Schedulable } from '@/lib/schedule';
import { usePmScope } from '@/lib/pm/scope';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError } from './pmShared';

/**
 * Roadmap Gantt — maps roadmap_items onto the shared {@link ScheduleGantt} engine
 * (reused, not rebuilt). Roadmap items carry only a targetDate, so it drives the
 * bar end; items with no target date fall into the Gantt's "unscheduled" list.
 */
const roadmapClient = segmentTrackerClient('/api/product/roadmap');

interface RoadmapBar extends Schedulable {
  id: string;
  title: string;
}

export function RoadmapGantt() {
  const { projectId } = usePmScope();
  const { data, error } = usePmData<TrackerRow[]>(
    () => roadmapClient.list(projectId ?? undefined),
    [projectId],
  );

  const bars: RoadmapBar[] = useMemo(
    () =>
      (data ?? []).map((r) => ({
        id: String(r.id),
        title: typeof r.title === 'string' ? r.title : '(untitled)',
        startDate: null,
        dueDate: typeof r.targetDate === 'string' ? r.targetDate : null,
      })),
    [data],
  );

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message="Loading roadmap…" />;
  if (!data.length) return <PmEmpty message="No roadmap items yet." />;

  return (
    <ScheduleGantt<RoadmapBar>
      items={bars}
      getLabel={(b) => b.title}
      onSelect={() => { /* selection wiring deferred — see Gap Register */ }}
      noun="roadmap item"
    />
  );
}
