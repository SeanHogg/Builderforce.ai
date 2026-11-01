/**
 * The agent's model preflight, made the Brain's (PRD 35 §4 WS4, parity ruling T10). The Brain's preamble already ran the host's
 * check and wrote what it found (`runStore/hostRunContext.ts`, `modelPreflight.ts`: the `model.preflight` step, the banner's
 * unresolved accounts, the Flash-class plan warning for a model the run names). The agent's own preflight would ask the host a
 * second time and warn about a model the loop never warned about (a QUICK run's quick model).
 *
 * So the Brain's module asks nobody. It still SAYS the agent's event - the one every entry point opens its trace with - but
 * carries no notice (the sink writes a step only for a notice), and it records the same verdict on the run state (what the outcome row
 * reads), derived from what the preamble left on the cell.
 */

import { defaultPolicyModules, planModelWarning, type ModelHook } from '@builderforce/agent-run';
import type { RunCell } from '../runStore/runCell';

function recordedPreflight(c: RunCell, pinnedModel: string | undefined): NonNullable<ModelHook['preflight']> {
  return (ctx) => {
    const byo = c.byoUnresolved.join(',');
    const plan = c.codeChanged ? null : planModelWarning(pinnedModel);
    const degraded = byo !== '' || plan !== null;
    ctx.state.preflight = degraded ? `degraded:${byo || 'plan_flash'}` : 'ok';
    return { kind: 'model.preflight', step: ctx.step, status: degraded ? 'degraded' : 'ok', notices: [] };
  };
}

/** The agent's model module with its preflight made the Brain's: the one `runPrepared` hands the run. */
export function recordedModelHook(c: RunCell, pinnedModel: string | undefined): ModelHook {
  return { ...defaultPolicyModules().model, preflight: recordedPreflight(c, pinnedModel) };
}
