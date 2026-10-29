/**
 * The proof scoreboard for a board's app, when that app IS a proof (PRD 33 §5.3):
 * the newest measured, built realization on the project. Renders nothing for an
 * app that is not a proof, and nothing when the read fails — the Visitors surface
 * beneath it must never wait on this.
 */

import { ProofScoreboard } from './ProofScoreboard';
import { useProjectProof } from './useProjectProof';

export function ProjectProofScoreboard({ projectId }: { projectId: number }) {
  const [proof, setProof] = useProjectProof(projectId);
  if (!proof) return null;
  return <ProofScoreboard realization={proof} onRealizationChange={setProof} />;
}
