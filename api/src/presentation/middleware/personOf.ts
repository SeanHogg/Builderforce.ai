/**
 * personOf — the ONE answer to "is the caller a person, and which?".
 *
 * A request is a person's only when it came through the tenant JWT door AND is not a
 * machine token (`machineActor`, minted for an agent host or another service). Everything
 * else — the agent-host key door, a machine token — acts for a machine and has no user to
 * attribute provenance, authorship or savings to, so it is `null`. Surfaces use it to
 * decide the writer's provenance (`human` only from a person), a human fact's author, and
 * who a delete is authorised for.
 *
 * Type-only imports: it must stay loadable by any route module without pulling auth in.
 */
import type { Context } from 'hono';
import type { FrontDoor } from './frontDoor';

export function personOf(c: Context, door: Pick<FrontDoor, 'agentHost'>): string | null {
  if (door.agentHost || c.get('machineActor')) return null;
  return (c.get('userId') as string | undefined) ?? null;
}
