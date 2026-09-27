/*
 * No `'use client'` — imported only by the room's station registry, which is reached
 * through a `dynamic(..., { ssr: false })` import from the canvas.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { EvermindStudioCenter } from '@/components/builder/EvermindStudioCenter';
import { useProjectEvermindActivity } from '@/hooks/useProjectEvermindActivity';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';
import { EVERMIND_REGION_KEYS, evermindRegionSignals, type EvermindRegionKey } from '@/lib/evermindRegions';
import { useCanvasBoardBridge } from '../../canvasBoardBridge';
import type { RoomStationModel, RoomStationView } from '../types';
import styles from '../roomStations.module.css';
import { EvermindBrain3D } from './EvermindBrain3D';

/**
 * THE EVERMIND BRAIN — an Evermind on the board, standing in the room as a 3D brain
 * whose learning centres light with what it has learned and how it feels right now.
 *
 * Entitlement: anyone who can see the board sees the model on it. The brain reads the
 * project it is attached to (`resourceId`, set by `roomStations.ts`) through the ONE
 * live read (`useProjectEvermindActivity`); a blueprint on a draft canvas has nothing
 * to read and stands dormant — which is the truth about it, not an error.
 *
 * Its panel is the full 2D reading: the Studio's Knowledge Map beside its Learnings,
 * the same component the Studio mounts, so the room adds no third account of it.
 */

/** The project this brain learns for — only on a saved board, only once attached. */
function useStationProject(instance: RoomStationInstance): number | null {
  const board = useCanvasBoardBridge();
  if (board?.persistence !== 'server' || !instance.resourceId) return null;
  const id = Number(instance.resourceId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function useRegionNames(): Record<EvermindRegionKey, string> {
  const t = useTranslations('creationCanvas.node');
  return useMemo(() => {
    const keyOf: Record<EvermindRegionKey, string> = {
      neocortex: 'regionNeocortex', hippocampus: 'regionHippocampus', personality: 'regionPersonality',
      amygdala: 'regionAmygdala', hypothalamus: 'regionHypothalamus', thalamus: 'regionThalamus', basalGanglia: 'regionBasal',
    };
    return Object.fromEntries(EVERMIND_REGION_KEYS.map((key) => [key, t(keyOf[key])])) as Record<EvermindRegionKey, string>;
  }, [t]);
}

function useEvermindStationModel(instance: RoomStationInstance): RoomStationModel | null {
  const t = useTranslations('roomStations.evermind');
  const board = useCanvasBoardBridge();
  const { data } = useProjectEvermindActivity(useStationProject(instance));
  const signals = useMemo(() => evermindRegionSignals(data), [data]);
  const names = useRegionNames();
  if (!board) return null;
  return {
    title: instance.title || t('title'),
    summary: data?.seeded ? t('summaryLive', { count: data.contributions, version: data.version }) : t('summaryBlueprint'),
    body: <EvermindBrain3D signals={signals} names={names} />,
  };
}

function EvermindStationPanel({ instance }: { instance: RoomStationInstance }) {
  const t = useTranslations('roomStations.evermind');
  const projectId = useStationProject(instance);
  return (
    <div className={styles.panel} data-testid="evermind-station-panel">
      {projectId == null && <p className={styles.insight}>{t('blueprintHint')}</p>}
      <EvermindStudioCenter projectId={projectId} />
    </div>
  );
}

export const evermindStationView: RoomStationView = {
  useModel: (instance) => useEvermindStationModel(instance),
  Panel: EvermindStationPanel,
};
