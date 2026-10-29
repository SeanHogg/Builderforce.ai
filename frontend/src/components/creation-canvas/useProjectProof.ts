// No `'use client'`: this module exports a hook, not a component.
/**
 * The live proof of a board's app (PRD 33 §5.3): the newest BUILT realization on
 * the project that carries a visitor measure — or null for an app that is not a
 * proof, a project not yet known, or a failed read (never an error: the surfaces
 * that ask must not wait on it). The setter lets the scoreboard replace its copy
 * after an early call.
 */

import { useEffect, useState } from 'react';
import { realizationApi, type Realization } from '@/lib/realizationApi';

export function useProjectProof(projectId: number | null): readonly [Realization | null, (next: Realization | null) => void] {
  const [proof, setProof] = useState<Realization | null>(null);

  useEffect(() => {
    let live = true;
    setProof(null);
    if (projectId === null) return undefined;
    realizationApi.list()
      .then((rows) => {
        if (!live) return;
        setProof(rows.find((r) => r.projectId === projectId && r.status === 'built' && !!r.measure) ?? null);
      })
      .catch(() => { if (live) setProof(null); });
    return () => { live = false; };
  }, [projectId]);

  return [proof, setProof];
}
