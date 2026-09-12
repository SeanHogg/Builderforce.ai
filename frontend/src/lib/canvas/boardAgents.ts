import type { RoomOccupant } from './roomSeating';

/**
 * WHICH TEAMMATES ARE ON THIS BOARD — read off the board's own agent cards.
 *
 * ── WHY THE CARDS ARE THE ANSWER ─────────────────────────────────────────────
 * Seating a teammate (`seatTeammate`, or Brain answering an `@CMO`) puts an agent
 * card on the board, and that card is the only record there is: no membership row,
 * no seat table. So "who is working on this board" is a reading of the cards, asked
 * once here, and every place that shows the team answers from the same list — the
 * command bar's team strip rings the seats that are on the board, and the room
 * stands them at the table. Two readings would be two answers that can disagree.
 *
 * ── WHY A NAME CAN MATCH ─────────────────────────────────────────────────────
 * A card seated from the roster carries the roster row's id (`agentRef`). A card
 * Brain made from an `@CMO` may carry only a title. The same title rule the board
 * already uses for duplicates (`canvasObjectTwin`: trimmed, case-insensitive) is
 * applied here, against the seat as well as the name, so "CMO" on a card is the
 * CMO seat in the roster.
 */

export interface BoardAgent {
  /** The card's object id — the one identity every card is guaranteed to have. */
  objectId: string;
  /** The roster row it was seated from (`ide_agents.id` or `seat:<domain>`), when known. */
  ref: string | null;
  name: string;
  /** The built-in seat it fills ('CMO', 'CRO', …), when it is one. */
  seat: string | null;
}

/** The fields of a canvas object this reads — structural, so any board node fits. */
interface AgentCardLike {
  id: string;
  data: {
    kind?: unknown;
    title?: unknown;
    agentName?: unknown;
    agentRef?: unknown;
    agentSeat?: unknown;
    placementHidden?: unknown;
  };
}

const text = (value: unknown): string | null =>
  (typeof value === 'string' && value.trim() ? value.trim() : null);

const sameName = (first: string | null, second: string | null): boolean =>
  !!first && !!second && first.toLowerCase() === second.toLowerCase();

/** Every agent card on the board, in board order. Hidden placements are not on it. */
export function boardAgents(nodes: readonly AgentCardLike[]): BoardAgent[] {
  return nodes.flatMap((node) => {
    if (node.data.kind !== 'agent' || node.data.placementHidden === true) return [];
    const name = text(node.data.agentName) ?? text(node.data.title);
    if (!name) return [];
    return [{ objectId: node.id, ref: text(node.data.agentRef), name, seat: text(node.data.agentSeat) }];
  });
}

/** The roster fields a teammate is recognised by. */
export interface TeammateIdentity {
  id: string;
  name: string;
  seat: string | null;
}

/** Whether this roster row has a card on the board. */
export function isTeammateOnBoard(member: TeammateIdentity, agents: readonly BoardAgent[]): boolean {
  return agents.some((agent) => (
    agent.ref === member.id
    || sameName(agent.seat, member.seat)
    || sameName(agent.name, member.name)
    || sameName(agent.name, member.seat)
  ));
}

/**
 * The agents as room occupants. An agent has no browser to relay a body from, so
 * it is seated by the ring like anyone the relay has not heard from — its card on
 * the board is its presence (see `RoomSeat.present`). One occupant per identity:
 * two cards naming the same agent are one agent at the table.
 */
export function boardAgentOccupants(agents: readonly BoardAgent[]): RoomOccupant[] {
  const seen = new Set<string>();
  return agents.flatMap((agent) => {
    const userId = `agent:${agent.ref ?? agent.name.toLowerCase()}`;
    if (seen.has(userId)) return [];
    seen.add(userId);
    return [{ userId, displayName: agent.name, kind: 'agent' as const }];
  });
}
