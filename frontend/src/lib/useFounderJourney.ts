/**
 * The founder's journey, computed once and shared.
 *
 * `stage` and `act` place a tenant on the arc (`STAGES` in `navGroups.ts`) and,
 * while still in Idea, on the inner loop (`METHOD_STEPS` in `methodology.ts`).
 * Both are derived from data that already exists — no field anywhere stores
 * "current founder stage" — so this is the ONE place that reads `creation_sessions`,
 * `realizations` and `companies` and turns them into a journey position. The
 * Journey Strip, the TopBar pill and the canvas chip all call this hook rather
 * than each re-deriving their own answer, which would drift the moment one of
 * them changed how "in Make" is decided.
 *
 * Only `idea` and `run` are computed. `make` and `measure` have no reliable
 * signal yet without inventing one (a company can be several proofs deep into
 * Make with nothing today distinguishing that from freshly graduated Run) — a
 * follow-up pass can add real signals (e.g. `outcomeMetricContract`'s graded
 * proof rate) once one exists. Until then those two stages render as plain
 * upcoming steps, never marked "current".
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { creationSessionsApi, realizationApi } from './builderforceApi';
import { investorApi } from './investorApi';
import type { Stage } from './navGroups';
import type { MethodStep } from './methodology';

export interface FounderJourney {
  /** `null` while loading or when there is no signal yet (a brand-new tenant). */
  stage: Extract<Stage, 'idea' | 'run'> | null;
  /** Only meaningful while `stage === 'idea'`; `null` otherwise or with no active session. */
  act: MethodStep | null;
  /** The session `act` was read from, so a caller can link to it. */
  activeSessionId: string | null;
  loading: boolean;
}

const EMPTY: FounderJourney = { stage: null, act: null, activeSessionId: null, loading: false };

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
      const [companies, sessions] = await Promise.all([
        investorApi.companies.list().catch(() => []),
        creationSessionsApi.list('active').then((r) => r.sessions).catch(() => []),
      ]);
      if (requestId.current !== id) return;

      const ownsACompany = companies.some((company) => !company.isPortfolio);
      if (ownsACompany) {
        setJourney({ stage: 'run', act: null, activeSessionId: null, loading: false });
        return;
      }
      if (sessions.length === 0) {
        setJourney({ ...EMPTY, loading: false });
        return;
      }

      const activeSessionId = sessions[0].id;
      const realizations = await realizationApi.list(activeSessionId).catch(() => []);
      if (requestId.current !== id) return;

      const latest = realizations[0];
      const act: MethodStep = !latest ? 'read' : latest.verdict === 'met' ? 'build' : 'prove';
      setJourney({ stage: 'idea', act, activeSessionId, loading: false });
    })();
  }, [isAuthenticated, hasTenant]);

  return journey;
}
