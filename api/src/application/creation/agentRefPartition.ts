/**
 * Split a canvas object's agent refs by the table that can hold them.
 *
 *   numeric  → `agent_registrations.legacy_agent_id` (Postgres int4)
 *   text     → `ide_agents.id` (varchar — workforce AND built-in agents such as
 *              `validator-t12`)
 *   uuid     → the subset of `text` that is UUID-shaped, the only refs that may
 *              reach `agent_registrations.id` (a uuid column: a non-UUID value
 *              there makes Postgres throw, which surfaced as a 500)
 *
 * Null when a numeric ref is outside int4 — it cannot name any row.
 */
import { CREATION_UUID_RE } from './creationGraphWriter';

export interface AgentRefPartition {
  numeric: number[];
  text: string[];
  uuid: string[];
}

export function partitionAgentRefs(agentIds: readonly string[]): AgentRefPartition | null {
  const numeric: number[] = [];
  const text: string[] = [];
  for (const id of agentIds) {
    if (/^\d+$/.test(id)) {
      const n = Number(id);
      if (!Number.isInteger(n) || n < 1 || n > 2_147_483_647) return null;
      numeric.push(n);
    } else {
      text.push(id);
    }
  }
  return { numeric, text, uuid: text.filter((id) => CREATION_UUID_RE.test(id)) };
}
