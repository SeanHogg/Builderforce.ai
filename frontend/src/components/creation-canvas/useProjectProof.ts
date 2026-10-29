// No `'use client'`: this module exports a hook, not a component.
/**
 * The live proof of a board's app (PRD 33 §5.3): the newest BUILT realization on
 * the project that carries a visitor measure — or null for an app that is not a
 * proof, a project not yet known, or a failed read (never an error: the surfaces
 * that ask must not wait on it; the failure is recorded). The setter lets the
 * scoreboard replace its copy after an early call.
 *
 * The answer is held WITH the project it answers for, so a project change reads as
 * null until the new read lands — no reset has to be set from inside the effect.
 */

import { useCallback, useEffect, useState } from 'react';
import { realizationApi, type Realization } from '@/lib/realizationApi';
import { recordedFailure } from '@/lib/reportError';

interface Held {
  projectId: number | null;
  proof: Realization | null;
}

export function useProjectProof(projectId: number | null): readonly [Realization | null, (next: Realization | null) => void] {
  const [held, setHeld] = useState<Held>({ projectId: null, proof: null });

  useEffect(() => {
    if (projectId === null) return undefined;
    let live = true;
    // The server picks the proof (built, measured, newest) — never a client filter over a capped list.
    realizationApi.liveProofForProject(projectId)
      .catch(recordedFailure('Reading the project proof', null))
      .then((proof) => {
        if (live) setHeld({ projectId, proof });
      });
    return () => { live = false; };
  }, [projectId]);

  const setProof = useCallback((next: Realization | null) => setHeld({ projectId, proof: next }), [projectId]);
  return [held.projectId === projectId ? held.proof : null, setProof];
}
