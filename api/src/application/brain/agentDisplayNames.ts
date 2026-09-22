/**
 * agentDisplayNames — ref → the name a human would recognise, resolved in ONE query.
 *
 * Every chat-facing surface that mentions an agent needs this: the run-milestone line
 * ("**Bob** finished task #2466"), the dispatch notice, the chat's Agents list, the
 * diagnostics report, and the Work directive's roster. They were all reaching for
 * `ChatTicketService.agentDisplayName`, which is a SINGLE-ref select — correct for one
 * milestone and an N+1 the moment a caller has a list. A chat with three agents and a
 * report that names all of them paid three round trips to print three words.
 *
 * So the resolver takes a SET. The single-ref helper is kept as a thin wrapper rather
 * than a second query, because two spellings of "what is this agent called" is exactly
 * how a milestone and a roster end up disagreeing about who ran something.
 *
 * ── WHY `builtinKind` COMES WITH THE NAME ────────────────────────────────────────
 * A name alone cannot tell a reader whether "Manager" is the platform's own backlog
 * manager or an agent somebody named Manager, and those have different remedies when
 * a chat's work never starts. `builtin_kind` is the stable identity marker (0289) —
 * decoupled from `name` precisely so the display name can be changed freely — so it
 * rides along and the caller never has to guess from the string.
 *
 * A ref with no row resolves to the ref itself: an agent removed from the workspace
 * still has to render as SOMETHING in a report about the chat it used to work in, and
 * a blank there reads as "no agent" rather than "an agent that is gone".
 */

import { and, eq, inArray } from 'drizzle-orm';
import { ideAgents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

/** What a surface needs to name an agent and say what KIND of agent it is. */
export interface AgentIdentity {
  ref: string;
  name: string;
  /** `ide_agents.builtin_kind` — 'manager' | 'validator' | … ; null for a user/marketplace agent. */
  builtinKind: string | null;
}

/**
 * Resolve every ref in one round trip. Refs that match no row come back as their own
 * name with a null kind, so the result always has an entry for every ref asked for and
 * a caller never has to handle a miss.
 *
 * Deliberately NOT read-through cached. It is a single primary-key `IN` lookup over a
 * handful of refs — not a fan-out, not a recomputation, and not an unbounded scan — and
 * a cached agent NAME is the one thing that must never be stale here: the surfaces that
 * call this are a run milestone attributing work to somebody and a support report naming
 * who is in a chat. Both are read by a human deciding whether the right agent did the
 * work, so a rename that has not propagated is worse than the round trip it saves.
 */
export async function resolveAgentIdentities(
  db: Db,
  tenantId: number,
  refs: readonly string[],
): Promise<Map<string, AgentIdentity>> {
  const wanted = [...new Set(refs.filter((r) => typeof r === 'string' && r.length > 0))];
  const out = new Map<string, AgentIdentity>(
    wanted.map((ref) => [ref, { ref, name: ref, builtinKind: null }]),
  );
  if (wanted.length === 0) return out;
  const rows = await db
    .select({ id: ideAgents.id, name: ideAgents.name, builtinKind: ideAgents.builtinKind })
    .from(ideAgents)
    .where(and(eq(ideAgents.tenantId, tenantId), inArray(ideAgents.id, wanted)));
  for (const row of rows) {
    out.set(row.id, { ref: row.id, name: row.name || row.id, builtinKind: row.builtinKind ?? null });
  }
  return out;
}

/** One ref's display name, through the same resolver the list path uses. */
export async function resolveAgentDisplayName(db: Db, tenantId: number, ref: string): Promise<string> {
  const identities = await resolveAgentIdentities(db, tenantId, [ref]);
  return identities.get(ref)?.name ?? ref;
}
