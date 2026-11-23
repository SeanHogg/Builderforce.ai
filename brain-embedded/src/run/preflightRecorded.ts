/** Facts left by the Brain preamble's model check. Policy and event construction live in agent-run's model factory. */
import type { RecordedModelPreflight } from '@builderforce/agent-run';
import type { RunCell } from '../runStore/runCell';

export function recordedPreflight(c: RunCell, pinnedModel: string | undefined): RecordedModelPreflight {
  return {
    byoUnresolved: [...c.byoUnresolved],
    ...(!c.codeChanged && pinnedModel ? { planModel: pinnedModel } : {}),
  };
}
