/**
 * `compile('persona')` — lowers an already-compiled persona (directives + execution
 * levers) into the spec's `persona` slot. The trait-vector → directives compilation
 * lives in `agent-runtime` (the behavioural compiler); this adapter consumes its
 * output, so a persona authored once threads onto the *same* spec as the model and
 * the steps — which is how a persona's temperature reaches a workflow node, not just
 * IDE chat. Pure.
 */
import type { AgentSpec } from '@builderforce/agent-tools';
import type { PersonaNeed } from './types';

export function compileFromPersona(need: PersonaNeed): AgentSpec {
  const directives = (need.directives ?? []).filter((d) => d.trim().length > 0);
  const hasExec = !!need.execParams && Object.keys(need.execParams).length > 0;
  return {
    identity: { name: '' }, // persona carries no identity; merged onto another spec
    ...(directives.length || hasExec
      ? { persona: { ...(directives.length ? { directives } : {}), ...(hasExec ? { execParams: need.execParams } : {}) } }
      : {}),
  };
}
