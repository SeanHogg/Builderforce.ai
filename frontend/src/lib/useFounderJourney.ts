/**
 * The founder's journey, computed once and shared.
 *
 * `stage` and `act` place a tenant on the arc (`STAGES` in `navGroups.ts`) and,
 * while still in Idea, on the inner loop (`METHOD_STEPS` in `methodology.ts`).
 * Both are derived from data that already exists — no field anywhere stores
 * "current founder stage" — so this is the ONE place that reads `creation_sessions`,
 * `realizations`, the realization journey signal and `companies` and turns them
 * into a journey position. The Journey Strip, the TopBar pill and the canvas chip
 * all call this hook rather than each re-deriving their own answer, which would
 * drift the moment one of them changed how "in Make" is decided.
 *
 * Precedence, first match wins:
 *   1. `run` — the workspace owns a company. A company outranks any one proof.
 *   2. `make` / `measure` — `GET /api/realizations/journey-signal` (PRD 33 §5.3.5):
 *      the newest proof is being made (planned, building, built with nobody on it
 *      yet) or measured (built, and its hosted site has had its first visitor).
 *      A graded proof gives no signal: the founder is back at Idea, reading again.
 *   3. `idea` — an active Creation Session, with `act` from its latest proof.
 *   4. `null` — a brand-new tenant.
 * `reach` is never current here; nothing yet says a founder is distributing.
 */

import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { creationSessionsApi } from './builderforceApi';
import { investorApi } from './investorApi';
import { getOrSetClientCached, invalidateClientCache, readClientCached } from '@/infrastructure/http/readThrough';
import type { Stage } from './navGroups';
import type { MethodStep } from './methodology';

export interface FounderJourney {
  /** `null` while loading or when there is no signal yet (a brand-new tenant). */
  stage: Extract<Stage, 'idea' | 'make' | 'measure' | 'run'> | null;
  /** Only meaningful while `stage === 'idea'`; `null` otherwise or with no active session. */
  act: MethodStep | null;
  /** The session `act` was read from, so a caller can link to it. */
  activeSessionId: string | null;
  /** The proof the Make / Measure signal is about, so a caller can link to it. */
  activeRealizationId: string | null;
  loading: boolean;
}

const EMPTY: FounderJourney = { stage: null, act: null, activeSessionId: null, activeRealizationId: null, loading: false };

/**
 * Shared across mounts. The shell panel, the dashboard and its act rail all call
 * this hook on the same page, and each used to fire the same three or four list
 * reads; they now share ONE in-flight read and its answer for a minute (a founder
 * does not change arc stage per render). Keyed by workspace so a switch never
 * shows the previous workspace's position.
 */
const JOURNEY_TTL_MS = 60_000;
const JOURNEY_CACHE_PREFIX = 'founder-journey:';

/** Drop the shared journey so the next mount re-reads it (after a stage-moving act). */
export function invalidateFounderJourney(): void {
  invalidateClientCache(JOURNEY_CACHE_PREFIX);
}

async function readFounderJourney(): Promise<FounderJourney> {
  // Loaded on demand: the journey read is effect work, so the realization client
  // (and the method-event emitter behind it) stays out of the root layout's closure.
  const { realizationApi } = await import('./realizationApi');
  const [companies, signal, sessions] = await Promise.all([
    investorApi.companies.list().catch(() => []),
    realizationApi.journeySignal().catch(() => null),
    creationSessionsApi.list('active').then((r) => r.sessions).catch(() => []),
  ]);

  const ownsACompany = companies.some((company) => !company.isPortfolio);
  if (ownsACompany) return { ...EMPTY, stage: 'run' };
  if (signal?.stage) return { ...EMPTY, stage: signal.stage, activeRealizationId: signal.realizationId };
  if (sessions.length === 0) return EMPTY;

  const activeSessionId = sessions[0].id;
  const realizations = await realizationApi.list(activeSessionId).catch(() => []);
  const latest = realizations[0];
  const act: MethodStep = !latest ? 'read' : latest.verdict === 'met' ? 'build' : 'prove';
  return { ...EMPTY, stage: 'idea', act, activeSessionId };
}

export function useFounderJourney(): FounderJourney {
  const { isAuthenticated, hasTenant, tenant } = useAuth();
  const key = `${JOURNEY_CACHE_PREFIX}${tenant?.id ?? ''}`;
  const [journey, setJourney] = useState<FounderJourney>(
    () => readClientCached<FounderJourney>(key, JOURNEY_TTL_MS) ?? { ...EMPTY, loading: true },
  );

  useEffect(() => {
    if (!isAuthenticated || !hasTenant) {
      setJourney(EMPTY);
      return;
    }
    let live = true;
    const cached = readClientCached<FounderJourney>(key, JOURNEY_TTL_MS);
    setJourney(cached ?? ((prev) => ({ ...prev, loading: true })));
    if (cached) return;
    getOrSetClientCached(key, () => readFounderJourney(), { ttlMs: JOURNEY_TTL_MS })
      .then((next) => { if (live) setJourney(next); })
      .catch(() => { if (live) setJourney(EMPTY); });
    return () => { live = false; };
  }, [isAuthenticated, hasTenant, key]);

  return journey;
}
