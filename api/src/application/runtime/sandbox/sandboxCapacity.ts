/**
 * sandboxCapacity — telling "the container pool is full" from every other way opening the run
 * sandbox can fail.
 *
 * `AgentContainerDO` has a fixed `max_instances` shared with live previews. When it is spent,
 * `@cloudflare/containers` answers the proxied request with a 503 whose body says there is "no
 * Container instance available" (or throws "there is no container instance that can be provided
 * to this durable object" when the start itself is refused). Only those two shapes are capacity:
 * a bad clone, a missing token, a crash or any other 5xx is not a reason to wait.
 */

/** The error `@cloudflare/containers` raises when the platform has no instance to hand the DO. */
const NO_INSTANCE_ERROR = 'there is no container instance that can be provided to this durable object';
/** The 503 body the library answers a proxied request with when the pool is spent. */
const NO_INSTANCE_BODY = /no container instance available/i;

/** The failure of one `/sandbox/open`: the HTTP status and body text, or the error it threw. */
export interface SandboxOpenFailure {
  status?: number;
  text?: string;
  message?: string;
}

export function isSandboxCapacityFailure(f: SandboxOpenFailure): boolean {
  if (f.message?.toLowerCase().includes(NO_INSTANCE_ERROR)) return true;
  if (f.text?.toLowerCase().includes(NO_INSTANCE_ERROR)) return true;
  return f.status === 503 && NO_INSTANCE_BODY.test(f.text ?? '');
}
