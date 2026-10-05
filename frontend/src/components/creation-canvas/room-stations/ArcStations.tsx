import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { boardDeployments } from '@/lib/canvas/boardDeployments';
import { LAUNCH_STATION_KINDS, type RoomStationInstance } from '@/lib/canvas/roomStations';
import { ideaLogEntries, ideaStageCounts, untestedIdeaCount } from '@/lib/ideaLog';
import { primarySessionApp, sessionApps } from '@/lib/canvasSessionApp';
import { canvasAppFiles } from '@/lib/canvasApp';
import { makeSpecDeriveBoard } from '@/lib/specObjects';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { useCanvasBoardBridge } from '../canvasBoardBridge';
import { DeploymentList } from '../DeploymentList';
import { IdeaLogRow } from '../IdeaLogRow';
import { IdeaStageBar, type IdeaStageFilter } from '../IdeaStageBar';
import { CanvasPhasePath } from '../phase/CanvasPhasePath';
import { useCanvasPhase } from '../phase/CanvasPhaseContext';
import { AcademicFace } from './academic/AcademicFace';
import type { RoomStationModel, RoomStationView } from './types';
import styles from './roomStations.module.css';

/**
 * THE ARC'S STATIONS — one per phase of IDEA → MAKE → RUN → REACH (Measure's is the
 * metrics board), plus the sign that stands while the canvas's phase is not ready.
 *
 * Each reads the board through the bridge and draws a face (DOM through `SurfacePanel`)
 * from values computed in its hook — never a context read inside the face. Each panel is
 * a 2D reading that reuses the canvas's own component for the thing (the idea rows, the
 * deployments list, the path card) inside `.canvasTokens`, because the panel portals out
 * of the canvas shell that declares the canvas's palette.
 *
 * NO SPEECH. A station never talks on behalf of an agent; the phase's guidance is the
 * path card's and Brain's, and both are real.
 */
type BoardObjects = ReadonlyArray<{ id: string; data: Record<string, unknown> }>;

function useObjects(): BoardObjects | null {
  return useCanvasBoardBridge()?.objects ?? null;
}

function OpenSurfaceButton({ surface, label }: { surface: CanvasSurfaceId; label: string }) {
  const openSurface = useCanvasPhase()?.openSurface;
  if (!openSurface) return null;
  return <button type="button" className={styles.rowOpen} onClick={() => openSurface(surface)}>{label}</button>;
}

// ── EVIDENCE (Idea) ─────────────────────────────────────────────────────────────────
function useIdeas() {
  const objects = useObjects();
  return useMemo(() => {
    const entries = objects ? ideaLogEntries(objects) : [];
    return { objects, entries, untested: untestedIdeaCount(entries), counts: ideaStageCounts(entries) };
  }, [objects]);
}

function useEvidenceModel(): RoomStationModel | null {
  const t = useTranslations('roomStations.evidence');
  const { entries, untested } = useIdeas();
  if (!entries.length) return null;
  const summary = t('summary', { count: entries.length, untested });
  return {
    title: t('title'),
    summary,
    face: <AcademicFace figure={String(entries.length)} headline={summary} lines={entries.slice(0, 3).map((entry) => String(entry.data.title ?? ''))} tone={untested > 0 ? 'attention' : 'calm'} />,
  };
}

function EvidencePanel(_props: { instance: RoomStationInstance }) {
  const t = useTranslations('roomStations.evidence');
  const { objects, entries, untested, counts } = useIdeas();
  const [filter, setFilter] = useState<IdeaStageFilter>('all');
  const board = useMemo(() => makeSpecDeriveBoard((objects ?? []).map((object) => object.data)), [objects]);
  const openSurface = useCanvasPhase()?.openSurface;
  if (!entries.length) return null;
  const visible = entries.filter((entry) => filter === 'all' || entry.stage === filter).slice(0, 5);
  return (
    <div className={`${styles.panel} ${styles.canvasTokens}`} data-testid="evidence-station-panel">
      <IdeaStageBar counts={counts} total={entries.length} untested={untested} value={filter} onChange={setFilter} />
      {visible.map((entry) => <IdeaLogRow key={entry.id} entry={entry} board={board} onOpen={() => openSurface?.('ideas')} />)}
      <OpenSurfaceButton surface="ideas" label={t('open')} />
    </div>
  );
}

// ── BUILD (Make) ────────────────────────────────────────────────────────────────────
function useBuild() {
  const objects = useObjects();
  return useMemo(() => {
    if (!objects) return null;
    const nodes = objects as ReadonlyArray<{ id: string; data: { [key: string]: unknown; kind: string } }>;
    const app = primarySessionApp(sessionApps(nodes));
    return { title: app?.title ?? null, files: canvasAppFiles(nodes).length };
  }, [objects]);
}

function useBuildModel(): RoomStationModel | null {
  const t = useTranslations('roomStations.build');
  const build = useBuild();
  if (!build) return null;
  const title = build.title ?? t('fromCode');
  return {
    title: t('title'),
    summary: t('summary', { title, files: build.files }),
    face: <AcademicFace figure={String(build.files)} headline={title} lines={[t('files', { count: build.files })]} tone="calm" />,
  };
}

function BuildPanel(_props: { instance: RoomStationInstance }) {
  const t = useTranslations('roomStations.build');
  const build = useBuild();
  if (!build) return null;
  return (
    <div className={`${styles.panel} ${styles.canvasTokens}`} data-testid="build-station-panel">
      <p className={styles.insight}>{t('summary', { title: build.title ?? t('fromCode'), files: build.files })}</p>
      <OpenSurfaceButton surface="app" label={t('open')} />
    </div>
  );
}

// ── OPS (Run) ───────────────────────────────────────────────────────────────────────
function useDeployments() {
  const objects = useObjects();
  return useMemo(() => (objects ? boardDeployments(objects) : []), [objects]);
}

function useOpsModel(): RoomStationModel | null {
  const t = useTranslations('roomStations.ops');
  const deployments = useDeployments();
  const newest = deployments[0];
  if (!newest) return null;
  const summary = t('summary', { env: newest.environment ?? newest.title, version: newest.version ?? '—' });
  return {
    title: t('title'),
    summary,
    face: <AcademicFace figure={String(deployments.length)} headline={summary} lines={newest.url ? [newest.url] : [t('notLive')]} tone={newest.url ? 'calm' : 'attention'} />,
  };
}

function OpsPanel(_props: { instance: RoomStationInstance }) {
  const t = useTranslations('roomStations.ops');
  const deployments = useDeployments();
  if (!deployments.length) return null;
  return (
    <div className={`${styles.panel} ${styles.canvasTokens}`} data-testid="ops-station-panel">
      <DeploymentList deployments={deployments} />
      <OpenSurfaceButton surface="operate" label={t('open')} />
    </div>
  );
}

// ── LAUNCH (Reach) ──────────────────────────────────────────────────────────────────
function useLaunchCounts() {
  const objects = useObjects();
  return useMemo(() => LAUNCH_STATION_KINDS.map((kind) => ({ kind, count: (objects ?? []).filter((object) => object.data.kind === kind).length })), [objects]);
}

function useLaunchModel(): RoomStationModel | null {
  const t = useTranslations('roomStations.launch');
  const counts = useLaunchCounts();
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  if (!total) return null;
  const lines = counts.filter((entry) => entry.count > 0).map((entry) => t(`count.${entry.kind}`, { count: entry.count }));
  return { title: t('title'), summary: lines.join(' · '), face: <AcademicFace figure={String(total)} headline={t('title')} lines={lines} tone="calm" /> };
}

function LaunchPanel(_props: { instance: RoomStationInstance }) {
  const t = useTranslations('roomStations.launch');
  const counts = useLaunchCounts();
  return (
    <div className={`${styles.panel} ${styles.canvasTokens}`} data-testid="launch-station-panel">
      <ul className={styles.rows}>
        {counts.filter((entry) => entry.count > 0).map((entry) => <li key={entry.kind} className={styles.row}>{t(`count.${entry.kind}`, { count: entry.count })}</li>)}
      </ul>
      <OpenSurfaceButton surface="launch" label={t('open')} />
    </div>
  );
}

// ── THE PATH SIGN (whichever phase is not ready) ─────────────────────────────────────
function usePhasePathModel(): RoomStationModel | null {
  const t = useTranslations('roomStations.phasePath');
  const tc = useTranslations('creationCanvas');
  const phaseValue = useCanvasPhase();
  const missing = phaseValue?.current.missing[0];
  if (!phaseValue || !missing) return null;
  const needs = tc(`requirement.${missing.id}.label` as 'requirement.idea.label');
  return {
    title: t('title', { needs }),
    summary: t('summary', { count: phaseValue.current.missing.length }),
    face: <AcademicFace figure="!" headline={t('title', { needs })} lines={[tc(`phaseGate.${phaseValue.phase}.title` as 'phaseGate.make.title')]} tone="attention" />,
  };
}

function PhasePathPanel(_props: { instance: RoomStationInstance }) {
  return <div className={`${styles.panel} ${styles.canvasTokens}`} data-testid="phase-path-station-panel"><CanvasPhasePath /></div>;
}

export const evidenceStationView: RoomStationView = { useModel: () => useEvidenceModel(), Panel: EvidencePanel };
export const buildStationView: RoomStationView = { useModel: () => useBuildModel(), Panel: BuildPanel };
export const opsStationView: RoomStationView = { useModel: () => useOpsModel(), Panel: OpsPanel };
export const launchStationView: RoomStationView = { useModel: () => useLaunchModel(), Panel: LaunchPanel };
export const phasePathStationView: RoomStationView = { useModel: () => usePhasePathModel(), Panel: PhasePathPanel };
