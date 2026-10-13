/**
 * Client for the "Idea → Real" realization pipeline (`/api/realizations`) — the
 * SAME pipeline the `/realize` wizard uses to turn an idea into one of the 8
 * tested proofs (a phone line, a pilot, a smoke test, a live system, …).
 *
 * Exists so `canvas_realize` can hand the model the platform's own tested build
 * output — real signed routes, a real runbook, the real required connectors and
 * secrets — instead of the model improvising an approximation from its own
 * knowledge of Twilio. See `phoneLineTarget` (`api/src/application/realization/
 * targets/phoneLine.ts`) for what "tested" means here: TwiML `<Gather>` wired to
 * an LLM step, a shared reply route for both call directions, and a runbook that
 * gets the auth-token-vs-API-key distinction right — all of which a freehanded
 * canvas object got wrong (2026-08-29 diagnostic: wrong webhook URLs, no
 * WEBHOOK_SHARED_SECRET, a `workflow` card with zero authored steps).
 */
import {
  authoredWebsiteProblem,
  realizationCanvasDelivery,
  realizationWebsiteFromPlan,
  type RealizationCanvasDelivery,
  type WebsitePage,
  type WebsiteTheme,
} from '@builderforce/creation-canvas-contract';
import { apiRequest } from './apiClient';

export interface RealizationTargetSummary {
  key: string;
  name: string;
  summary: string;
  answers: string;
  fidelity: number;
  effort: number;
  suits: string[];
  hasBackend: boolean;
  allowsStrategyChoice: boolean;
}

export interface RealizationRequiredConnector {
  key: string;
  label: string;
  why: string;
}

export interface RealizationRequiredSecret {
  name: string;
  label: string;
  where: string;
}

export interface RealizationTask {
  order: number;
  title: string;
  description: string;
  kind: string;
}

export interface RealizationPlan {
  blueprintKey: string;
  blueprintName: string;
  summary: string;
  files: Record<string, string>;
  tasks: RealizationTask[];
  requiredConnectors: RealizationRequiredConnector[];
  requiredSecrets: RealizationRequiredSecret[];
  successCriteria: string[];
}

export interface RealizationView {
  id: string;
  targetKey: string;
  title: string;
  status: string;
  liveUrl: string | null;
  plan: RealizationPlan;
}

export interface RealizationRecommendation {
  key: string;
  score: number;
  recommended: boolean;
}

/** The catalog of 8 proof forms, as `canvas_list_realization_targets` needs it. */
export async function listRealizationTargets(): Promise<{ targets: RealizationTargetSummary[] }> {
  return apiRequest<{ targets: RealizationTargetSummary[] }>('/api/realizations/targets');
}

/**
 * Read an idea and rank the 8 targets against it. Writes nothing server-side —
 * used to pick a `targetKey` automatically when the model did not name one.
 */
export async function rankRealizationIdea(idea: string, sessionId?: string | null): Promise<{
  recommendations: RealizationRecommendation[];
  targets: RealizationTargetSummary[];
}> {
  return apiRequest('/api/realizations/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idea, ...(sessionId ? { sessionId } : {}) }),
  });
}

/** Choose a target and plan it — persists a realization row carrying the real build output. */
export async function createCanvasRealization(input: {
  idea: string;
  targetKey: string;
  sessionId?: string | null;
}): Promise<{ realization: RealizationView }> {
  return apiRequest('/api/realizations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idea: input.idea,
      targetKey: input.targetKey,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    }),
  });
}

/**
 * The one generated document worth putting on the board: every target writes
 * exactly one markdown charter/runbook alongside its HTML console(s) — this picks
 * it by extension rather than guessing a filename, so a new target needs no
 * change here.
 */
export function primaryRealizationDoc(files: Record<string, string>): { path: string; content: string } | null {
  const path = Object.keys(files).find((candidate) => candidate.endsWith('.md'));
  return path ? { path, content: files[path] } : null;
}

/**
 * What `canvas_realize` puts on the board. The website is the delivered
 * artifact (`website.publish` / `artifact.publish`); the markdown charter is
 * working notes beside it, not a substitute. Unknown target keys refuse rather
 * than land a titled shell or a `workflow` card.
 */
export interface RealizationCanvasLanding {
  delivery: RealizationCanvasDelivery;
  website: {
    title: string;
    subtitle: string;
    status: string;
    pages: WebsitePage[];
    websiteTheme: WebsiteTheme;
  };
  document: {
    title: string;
    subtitle: string;
    content: string;
    status: string;
  } | null;
}

export function realizationCanvasLanding(
  realization: Pick<RealizationView, 'id' | 'targetKey' | 'title' | 'plan'>,
): RealizationCanvasLanding | { error: string } {
  const delivery = realizationCanvasDelivery(realization.targetKey);
  if (!delivery) {
    return { error: `No canvas delivery adapter for "${realization.targetKey}". Call canvas_list_realization_targets and name a tested proof form.` };
  }
  const nextStep = `Open /realize/${realization.id} to review the plan and build it live.`;
  const website = realizationWebsiteFromPlan({
    title: realization.title,
    summary: realization.plan.summary,
    successCriteria: realization.plan.successCriteria ?? [],
    nextStep,
  });
  const problem = authoredWebsiteProblem(website);
  if (problem) return { error: problem };
  const doc = primaryRealizationDoc(realization.plan.files ?? {});
  return {
    delivery,
    website: {
      title: realization.title,
      subtitle: realization.plan.summary,
      status: 'Plan ready',
      pages: website.pages,
      websiteTheme: website.websiteTheme,
    },
    document: doc
      ? {
          title: `${realization.title} — ${realization.plan.blueprintName}`,
          subtitle: realization.plan.summary,
          content: doc.content,
          status: 'Plan ready',
        }
      : null,
  };
}
