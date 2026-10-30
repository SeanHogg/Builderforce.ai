/**
 * A run with an OWNER — what makes a sub-agent a sub-agent, and nothing else.
 *
 * A delegated child is not a second kind of loop. It is an ordinary run of THIS store —
 * the same tools, gates, ticket backstop, failure-streak breaker and persistence as the
 * run that spawned it — given its own run key (its own transcript, Stop and approval
 * prompt) and this pointer back to who spawned it. Everything a child does differently
 * follows from the pointer:
 *
 *   • it lives in its OWNER'S conversation: every message it persists goes to the root
 *     chat, attributed to the child (`authoredBy`) and marked as whose sub-agent it is
 *     (`subagentOf`), so the chat reads as Owner and Agent (name), never as one voice;
 *   • its messages are progress inside someone else's work, so they are marked mid-turn
 *     (Evermind does not learn a child's report as the chat's answer);
 *   • it can itself spawn children — the pointer nests, which is all recursion needs.
 */

import { MID_TURN_META_KEY } from '@builderforce/agent-loop';
import { AUTHORED_BY_META_KEY } from './directedMessage';
import type { BrainMessage } from './types';

/** Who a child run is, and whose. */
export interface RunLineage {
  /** The server chat the whole tree persists into — the top-level owner's chat. */
  rootChatId: number;
  /** The run key of the run that spawned this one (the root chat id for a top-level owner). */
  ownerKey: number;
  /** The owner's display name, as the chat shows it. */
  ownerName: string;
  /** Short handle the owner and the person address this child by (`a1`, `a2`, …). */
  handle: string;
  /** A few words naming the slice. */
  label: string;
  /** Who the child IS in the chat — a workspace agent it runs as, or a named helper. */
  agent: { ref: string; name: string };
  /** 1 for a child of a top-level run, 2 for a grandchild, … */
  depth: number;
}

/** Metadata key under which a child's message names its owner. */
export const SUBAGENT_OF_META_KEY = 'subagentOf';

/** What a persisted message says about the run that wrote it. */
export interface SubagentOrigin {
  handle: string;
  owner: string;
  label: string;
}

/**
 * Merge a child's identity into one message's metadata (keeping every key it already
 * carries — provenance, the trace step, a stopped-turn marker).
 */
export function lineageMetadata(lineage: RunLineage, metadata?: string): string {
  let base: Record<string, unknown> = {};
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed as Record<string, unknown>;
    } catch {
      /* not JSON — replaced by the identity below */
    }
  }
  return JSON.stringify({
    ...base,
    [MID_TURN_META_KEY]: true,
    [AUTHORED_BY_META_KEY]: { kind: 'agent', ref: lineage.agent.ref, name: lineage.agent.name },
    [SUBAGENT_OF_META_KEY]: { handle: lineage.handle, owner: lineage.ownerName, label: lineage.label } satisfies SubagentOrigin,
  });
}

/** The owner a persisted message was written for, or null for anything not a child's. */
export function parseSubagentOrigin(msg: { metadata?: string | null }): SubagentOrigin | null {
  if (!msg.metadata) return null;
  try {
    const o = (JSON.parse(msg.metadata) as Record<string, unknown>)[SUBAGENT_OF_META_KEY] as Partial<SubagentOrigin> | undefined;
    if (o && typeof o.handle === 'string' && typeof o.owner === 'string') {
      return { handle: o.handle, owner: o.owner, label: typeof o.label === 'string' ? o.label : '' };
    }
  } catch {
    /* not a child's message */
  }
  return null;
}

/** The persistence port a run writes through — the slice of it lineage wraps. */
export interface LineagePersistence {
  sendMessages(
    chatId: number,
    messages: Array<{ role: string; content: string; metadata?: string; eventKey?: string }>,
  ): Promise<BrainMessage[]>;
}

/**
 * A child's persistence: its owner's, with every message attributed to the child — and
 * every conversational message (not a trace row) handed to `onPersisted`, so the host can
 * splice it into the OWNER'S live view the moment it lands rather than after a reload.
 */
export function lineagePersistence<P extends LineagePersistence>(
  base: P,
  lineage: RunLineage,
  onPersisted: (msg: BrainMessage) => void,
): P {
  return {
    ...base,
    async sendMessages(chatId, messages) {
      const saved = await base.sendMessages(
        chatId,
        messages.map((m) => ({ ...m, metadata: lineageMetadata(lineage, m.metadata) })),
      );
      for (const msg of saved) if (msg.role !== 'tool') onPersisted(msg);
      return saved;
    },
  };
}
