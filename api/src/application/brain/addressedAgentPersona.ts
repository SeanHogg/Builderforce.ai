/**
 * The compiled persona of an invited agent, handed to a client that will run the
 * agent's turn ITSELF.
 *
 * `BrainService.agentReply` answers an @-addressed agent on the server with platform
 * tools only — it has no working tree. The editor beside it does: file, shell and git
 * tools against the open folder. Asked to "commit and push", the server reply could
 * only say it had no git tool while the surface that raised the question had exactly
 * that tool. So a host with local tools fetches the persona through this and runs the
 * turn in its own loop, AS the agent, with its own tools. The directives are the SAME
 * text the server reply runs under (one lowering, `resolveWorkforceModel`), so the
 * agent speaks with one voice whichever side runs it.
 *
 * Cached by the resolver it delegates to (tenant + agent base, 5 min KV / 1 min L1);
 * only the per-message knowledge recall is layered per call, exactly as the server
 * reply does it.
 */

import type { Env } from '../../env';
import { resolveWorkforceModel, WORKFORCE_MODEL_REF_PREFIX } from '../agent/agentPrompt';

export interface AddressedAgentPersona {
  /** Persona + recalled-knowledge system directives to prepend to the host's prompt. */
  directives: string;
  /** The agent's own pinned base model, or null when it follows the surface's pick. */
  model: string | null;
}

/** Null when `agentRef` is not a workforce agent of this tenant. */
export async function resolveAddressedAgentPersona(
  env: Env,
  tenantId: number,
  agentRef: string,
  query?: string,
): Promise<AddressedAgentPersona | null> {
  const ref = agentRef.trim();
  if (!ref) return null;
  const resolved = await resolveWorkforceModel(env, tenantId, WORKFORCE_MODEL_REF_PREFIX + ref, query);
  if (!resolved) return null;
  return { directives: resolved.directives, model: resolved.baseModel };
}
