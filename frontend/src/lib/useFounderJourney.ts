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

import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { creationSessionsApi, realizationApi } from './builderforceApi';
import { investorApi } from './investorApi';
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

export function useFounderJourney(): FounderJourney {
  const { isAuthenticated, hasTenant } = useAuth();
  const [journey, setJourney] = useState<FounderJourney>({ ...EMPTY, loading: true });
  const requestId = useRef(0);

  useEffect(() => {
    if (!isAuthenticated || !hasTenant) {
      setJourney(EMPTY);
      return;
    }
    const id = ++requestId.current;
    setJourney((prev) => ({ ...prev, loading: true }));

    (async () => {
      const [companies, signal, sessions] = await Promise.all([
        investorApi.companies.list().catch(() => []),
        realizationApi.journeySignal().catch(() => null),
        creationSessionsApi.list('active').then((r) => r.sessions).catch(() => []),
      ]);
      if (requestId.current !== id) return;

      const ownsACompany = companies.some((company) => !company.isPortfolio);
      if (ownsACompany) {
        setJourney({ ...EMPTY, stage: 'run' });
        return;
      }
      if (signal?.stage) {
        setJourney({ ...EMPTY, stage: signal.stage, activeRealizationId: signal.realizationId });
        return;
      }
      if (sessions.length === 0) {
        setJourney(EMPTY);
        return;
      }

      const activeSessionId = sessions[0].id;
      const realizations = await realizationApi.list(activeSessionId).catch(() => []);
      if (requestId.current !== id) return;

      const latest = realizations[0];
      const act: MethodStep = !latest ? 'read' : latest.verdict === 'met' ? 'build' : 'prove';
      setJourney({ ...EMPTY, stage: 'idea', act, activeSessionId });
    })();
  }, [isAuthenticated, hasTenant]);

  return journey;
}
