/**
 * The proof scoreboard for a board's app, when that app IS a proof (PRD 33 §5.3):
 * the newest measured, built realization on the project. Renders nothing for an
 * app that is not a proof, and nothing when the read fails — the Visitors surface
 * beneath it must never wait on this.
 */

import { useEffect, useState } from 'react';
import { realizationApi, type Realization } from '@/lib/builderforceApi';
import { ProofScoreboard } from './ProofScoreboard';

export function ProjectProofScoreboard({ projectId }: { projectId: number }) {
  const [proof, setProof] = useState<Realization | null>(null);

  useEffect(() => {
    let live = true;
    setProof(null);
    realizationApi.list()
      .then((rows) => {
        if (!live) return;
        setProof(rows.find((r) => r.projectId === projectId && r.status === 'built' && !!r.measure) ?? null);
      })
      .catch(() => { if (live) setProof(null); });
    return () => { live = false; };
  }, [projectId]);

  if (!proof) return null;
  return <ProofScoreboard realization={proof} onRealizationChange={setProof} />;
}
