/**
 * The live preview's run session — ONE hook for either run target (PRD 31 §W9).
 *
 * Opening the preview reads the project's blueprint and lets the run-target registry
 * ATTACH to an app that is already running (a container run). A target that would
 * start the app itself (the browser) waits for the user's Run (`run()`), because it
 * spends their tab. A plan-limit 402 is kept so the panel can render
 * {@link UpgradeGate}, with the declines that led there; every other miss is "no
 * preview", with the targets' declines kept so the panel can say why.
 *
 * State is held per request key (project + execution): a new key reads as empty and
 * loading until its own answer lands, so nothing from the previous project shows.
 *
 * Reload remounts the iframe; Restart restarts the shown service on its target (a new
 * ticket for a container preview, a process restart in the browser).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import { fetchProjectBlueprint } from '@/lib/appBlueprintApi';
import { isPlanLimitError } from '@/lib/planLimitError';
import { recordedFailure } from '@/lib/reportError';
import { RunPlanLimitError, startRun, type TargetDecline } from '@/lib/runTarget/runTargetRegistry';
import { loadProjectRunFiles } from '@/lib/runTarget/projectRunFiles';
import { publishActiveRun, withdrawActiveRun } from '@/lib/runTarget/activeRun';
import { serveRuntimeToolsFromThisTab } from '@/lib/runTarget/runtimeTools/runtimeToolRouter';
import type { RunService, RunSession, RunTargetId } from '@/lib/runTarget/runTarget';

export function isExpoPreviewUrl(url: string): boolean {
  return url.startsWith('exp://') || url.startsWith('exps://');
}

export interface LivePreviewRun {
  /** The target the app is running on, or null when no target is running it. */
  targetId: RunTargetId | null;
  /** Why each earlier target did not run it. */
  declined: TargetDecline[];
  /** A target that would run it once the user presses Run. */
  awaiting?: RunTargetId;
}

interface View {
  key: string | null;
  pending: boolean;
  run: LivePreviewRun | null;
  services: RunService[];
  session: RunSession | null;
  planError: unknown;
}

const EMPTY: View = { key: null, pending: false, run: null, services: [], session: null, planError: null };

/** A failed blueprint read is said as such, never as "no blueprint yet". */
function withBlueprintError(declined: TargetDecline[], readError: string | null): TargetDecline[] {
  if (!readError) return declined;
  return declined.map((d) => (d.code === 'noBlueprint' ? { ...d, code: 'blueprintUnavailable', detail: readError } : d));
}

export function useLivePreview(opts: {
  projectId?: number | string;
  executionId?: number | null;
  enabled?: boolean;
}) {
  const { projectId, executionId, enabled = true } = opts;
  const hasProject = projectId != null && projectId !== '';
  const key = enabled && (executionId != null || hasProject) ? `${projectId ?? ''}:${executionId ?? ''}` : null;
  const [view, setView] = useState<View>(EMPTY);
  const [request, setRequest] = useState<{ key: string | null; n: number }>({ key: null, n: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const sessionRef = useRef<RunSession | null>(null);
  const requested = request.key === key && request.n > 0;
  const requestN = requested ? request.n : 0;

  // While a preview is open here, agents in other tabs reach this tab's browser run.
  useEffect(() => serveRuntimeToolsFromThisTab(), []);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const land = (next: Omit<View, 'key' | 'pending'>) => { if (!cancelled) setView({ key, pending: false, ...next }); };
    (async () => {
      let blueprint: AppBlueprint | null = null;
      let readError: string | null = null;
      if (hasProject) {
        try {
          blueprint = await fetchProjectBlueprint(projectId);
        } catch (error) {
          readError = error instanceof Error ? error.message : String(error);
        }
      }
      try {
        const outcome = await startRun(blueprint, {
          projectId: hasProject ? String(projectId) : '',
          executionId,
          loadFiles: () => loadProjectRunFiles(projectId ?? ''),
        }, { requested: requestN > 0 });
        const declined = withBlueprintError(outcome.declined, readError);
        if (cancelled) {
          if (outcome.ok) await outcome.session.stop();
          return;
        }
        if (!outcome.ok) {
          land({
            run: { targetId: null, declined, ...(outcome.awaiting ? { awaiting: outcome.awaiting } : {}) },
            services: [], session: null, planError: outcome.planLimit ?? null,
          });
          return;
        }
        const started = outcome.session;
        sessionRef.current = started;
        // The agent's `runtime.*` tools in this tab answer from the run the preview holds.
        if (hasProject) publishActiveRun({ projectId: String(projectId), session: started, declined, blueprint });
        // A plan limit met on the way no longer matters: another target is running the app.
        land({ run: { targetId: started.targetId, declined }, services: started.services(), session: started, planError: null });
        unsubscribe = started.onState(() => {
          if (!cancelled) setView((v) => (v.session === started ? { ...v, services: started.services() } : v));
        });
      } catch (error) {
        if (error instanceof RunPlanLimitError) {
          land({ run: { targetId: null, declined: withBlueprintError(error.declined, readError) }, services: [], session: null, planError: error.limit });
          return;
        }
        recordedFailure('Starting the live preview', undefined)(error);
        land({ run: null, services: [], session: null, planError: null });
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
      const held = sessionRef.current;
      sessionRef.current = null;
      if (held) {
        if (hasProject) withdrawActiveRun(String(projectId), held);
        void held.stop();
      }
    };
  }, [key, requestN, hasProject, projectId, executionId]);

  const current = view.key === key ? view : EMPTY;

  /** Start the app on a target that waits for the user (the browser). */
  const run = useCallback(() => {
    setView((v) => ({ ...v, pending: true }));
    setRequest((r) => ({ key, n: r.key === key ? r.n + 1 : 1 }));
  }, [key]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const restart = useCallback((serviceId: string) => {
    const held = sessionRef.current;
    if (!held) return;
    setReloadKey((k) => k + 1);
    held.restart(serviceId)
      .then(() => setReloadKey((k) => k + 1))
      // A service that would not come back says so on its own state and error, which
      // the refresh below shows; only a plan limit changes what the panel renders.
      .catch((err: unknown) => { if (isPlanLimitError(err)) setView((v) => ({ ...v, planError: err })); })
      .finally(() => {
        if (sessionRef.current === held) setView((v) => (v.session === held ? { ...v, services: held.services() } : v));
      });
  }, []);

  return {
    loading: key !== null && (view.key !== key || view.pending),
    run: current.run,
    services: current.services,
    session: current.session,
    planError: current.planError,
    reloadKey,
    reload,
    restart,
    start: run,
  };
}
