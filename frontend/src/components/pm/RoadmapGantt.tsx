'use client';

import { useMemo, useState } from 'react';
import type { TrackerRow } from '@/lib/builderforceApi';
import { ScheduleGantt } from '@/components/ScheduleGantt';
import type { Schedulable } from '@/lib/schedule';
import { usePmScope } from '@/lib/pm/scope';
import { usePmData } from '@/lib/pm/usePmData';
import { roadmapClient } from '@/lib/pm/roadmap';
import { PmEmpty, PmError } from './pmShared';
import { RoadmapItemPanel } from './RoadmapItemPanel';

/**
 * Roadmap Gantt — maps roadmap_items onto the shared {@link ScheduleGantt} engine
 * (reused, not rebuilt). Roadmap items carry only a targetDate, so it drives the
 * bar end; items with no target date fall into the Gantt's "unscheduled" list.
 * Clicking a bar opens the shared edit panel.
 */
interface RoadmapBar extends Schedulable {
  id: string;
  title: string;
}

export function RoadmapGantt() {
  const { projectId } = usePmScope();
  const { data, error, reload } = usePmData<TrackerRow[]>(
    () => roadmapClient.list(projectId ?? undefined),
    [projectId],
  );
  const [editing, setEditing] = useState<TrackerRow | null | undefined>(undefined);

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
    <>
      <ScheduleGantt<RoadmapBar>
        items={bars}
        getLabel={(b) => b.title}
        onSelect={(b) => setEditing(data.find((r) => String(r.id) === b.id) ?? null)}
        noun="roadmap item"
      />
      <RoadmapItemPanel
        open={editing !== undefined}
        item={editing ?? null}
        projectId={projectId}
        onClose={() => setEditing(undefined)}
        onSaved={reload}
      />
    </>
  );
}
