/*
 * No `'use client'` here on purpose. Imported only by `CanvasSurfaceStage`, which
 * already sits behind the canvas client boundary, so a directive would mark a
 * second entry point that does not exist.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReplaySiteDto } from '@builderforce/interaction-contract';
import { InsightsHome } from '@/components/insights/InsightsHome';
import { ComposerBridgeProvider, composerBridgeFor, type ComposerBridge } from '@/components/insights/composerBridge';
import { RoleGate } from '@/components/RoleGate';
import { useCapability } from '@/lib/useCapability';
import { replaySitesApi } from '@/lib/replaySitesApi';
import { CAPABILITY_APPS, capabilityListingHref } from '@/lib/marketplace/capabilityApps';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { useOperateReading } from './hooks/useOperateReading';
import { useCounterBrainDockSide } from './hooks/useCounterBrainDockSide';
import { useCanvasSessionFacts } from './chrome/canvasSessionContext';
import { ProjectProofScoreboard } from './ProjectProofScoreboard';
import type { CreationFlowNode } from './CreationNode';
import styles from './CreationCanvas.module.css';

const INSIGHTS = CAPABILITY_APPS.insights;

/**
 * Measure ▸ Visitors (PRD 33 S7): THE Insights home for this board's app, with
 * its panel docked opposite the Brain. Three states, from the workspace's
 * entitlement and the app's hosted site:
 *
 *   not entitled            → a door to the Insights listing; no replay read at all
 *   entitled, not recording → one switch that turns recording on for the app
 *   recording               → `InsightsHome` on the app's site
 *
 * The app is the board's primary app (`useOperateReading`), the same selector
 * Operate reads; its durable project id is what the hosted site hangs off.
 *
 * The canvas HAS the ONE composer, so this host provides the Insights
 * `ComposerBridge`: "Apply in composer" puts a fix's compiled `composer` prompt in
 * the composer as a draft and attaches each element it changes as a chip (a
 * selector-anchored pick, `composerBridgeFor`); the person presses send.
 */
export interface CanvasVisitorsSurfaceProps {
  nodes: readonly CreationFlowNode[];
  /** Escape hands the board back; this surface is in the rail, so its entry is the way out. */
  onExit: () => void;
  /** Put a draft in the canvas composer and show it; absent → no composer bridge. */
  composeDraft?: (text: string) => void;
}

export function CanvasVisitorsSurface({ nodes, onExit, composeDraft }: CanvasVisitorsSurfaceProps) {
  const t = useTranslations('creationCanvas.surface.sessions');
  const errorMessage = useErrorMessage();
  const { lens } = useCanvasSessionFacts();
  const panelSide = useCounterBrainDockSide(lens);
  const app = useOperateReading(nodes).app;
  const projectId = app?.projectId ?? null;
  const appName = app?.title || null;
  const { entitled } = useCapability(INSIGHTS.listingSlug);
  // undefined = not read yet; null = the app is not recorded.
  const [site, setSite] = useState<ReplaySiteDto | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bridge = useMemo<ComposerBridge | null>(
    () => (composeDraft ? composerBridgeFor(composeDraft, appName) : null),
    [composeDraft, appName],
  );

  useEffect(() => {
    // Never read replay data for a workspace that does not hold the licence.
    if (entitled !== true || projectId === null) return undefined;
    let live = true;
    replaySitesApi.projectSite(projectId)
      .then((found) => { if (live) setSite(found); })
      .catch((cause: unknown) => { if (live) { setSite(null); setError(errorMessage(cause)); } });
    return () => { live = false; };
  }, [entitled, projectId, errorMessage]);

  const enable = async () => {
    if (projectId === null) return;
    setBusy(true);
    setError(null);
    try {
      setSite(await replaySitesApi.enableProjectSite(projectId));
    } catch (cause) {
      setError(errorMessage(cause) ?? t('enableFailed'));
    } finally {
      setBusy(false);
    }
  };

  const empty = (testId: string, title: string, body: string, action?: ReactNode) => (
    <div className={styles.insightsEmpty} role="status" data-testid={testId}>
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
      {error && <p role="alert">{error}</p>}
    </div>
  );

  let body: ReactNode;
  if (entitled === null) body = empty('canvas-visitors-loading', t('loadingTitle'), t('loadingBody'));
  else if (!entitled) {
    body = empty('canvas-visitors-buy', t('buyTitle'), t('buyBody'),
      <Link href={capabilityListingHref(INSIGHTS)}>{t('buyAction')}</Link>);
  } else if (projectId === null) body = empty('canvas-visitors-no-app', t('noAppTitle'), t('noAppBody'));
  else if (site === undefined) body = empty('canvas-visitors-loading', t('loadingTitle'), t('loadingBody'));
  else if (site === null) {
    body = empty('canvas-visitors-off', t('offTitle'), t('offBody'), (
      <label className={styles.visitorsSwitch}>
        <RoleGate capability="insights.manageSites">
          <input type="checkbox" role="switch" checked={busy} disabled={busy} onChange={() => void enable()} />
        </RoleGate>
        {t('enable')}
      </label>
    ));
  } else {
    body = (
      <div className={styles.visitorsHome} data-testid="canvas-visitors-home">
        <ComposerBridgeProvider value={bridge}>
          <InsightsHome siteId={site.id} panelSide={panelSide} />
        </ComposerBridgeProvider>
      </div>
    );
  }

  return (
    <section
      className={styles.insightsSurface}
      data-testid="canvas-visitors-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      <div className={styles.insightsSurfaceBody}>
        {/* A proof app is recorded with no install (D12): its scoreboard leads, whatever the licence state. */}
        {projectId !== null && <ProjectProofScoreboard projectId={projectId} />}
        {body}
      </div>
    </section>
  );
}
