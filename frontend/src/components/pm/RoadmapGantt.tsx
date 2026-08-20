'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TrackerRow } from '@/lib/builderforceApi';
import { ScheduleGantt } from '@/components/ScheduleGantt';
import type { ReschedulePatch, Schedulable } from '@/lib/schedule';
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
  const t = useTranslations('schedule');
  const tPm = useTranslations('pm');
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
        title: typeof r.title === 'string' && r.title ? r.title : tPm('untitledItem'),
        startDate: null,
        dueDate: typeof r.targetDate === 'string' ? r.targetDate : null,
      })),
    [data, tPm],
  );

  /**
   * Persist a dragged roadmap bar.
   *
   * A roadmap item carries only `targetDate`, so `shiftSchedule` leaves the patch's
   * `startDate` null and only the deadline moves — which is exactly right: a
   * roadmap item has a target, not a window, and a drag must not invent a start
   * the roadmap does not model.
   */
  const reschedule = async (bar: RoadmapBar, patch: ReschedulePatch) => {
    if (!patch.dueDate) return;
    await roadmapClient.update(bar.id, { targetDate: patch.dueDate });
    reload();
  };

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={tPm('loadingRoadmap')} />;
  if (!data.length) return <PmEmpty message={t('emptyRoadmapItems')} />;

  return (
    <>
      <ScheduleGantt<RoadmapBar>
        items={bars}
        getLabel={(b) => b.title}
        onSelect={(b) => setEditing(data.find((r) => String(r.id) === b.id) ?? null)}
        columnLabel={t('columnRoadmapItem')}
        emptyMessage={t('emptyRoadmapItems')}
        onReschedule={reschedule}
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
