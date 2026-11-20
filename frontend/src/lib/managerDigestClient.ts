/**
 * Manager daily digest client — the answer to "what got done today?" for one project:
 * what the manager decided, what the team shipped, and what has been handed back to a
 * person. Read by the Today digest card and folded into the copied manager diagnostics.
 */
import { request, type ManagerActionType } from './builderforceApi';

/** A digest number that carries its own trend, so a headline is never a bare count. */
export interface DigestDelta {
  today: number;
  yesterday: number;
}

/** Who owns a piece of work — the audit timeline's actor vocabulary. */
export type DigestOwnerKind = 'human' | 'hire' | 'cloud_agent' | 'host_agent' | 'system' | 'unassigned';

/** One ticket that reached a done lane today. */
export interface DigestShippedTicket {
  id: number;
  key: string;
  title: string;
  completedAt: string;
  /** Resolved owner label ('' when it finished with nobody assigned). */
  ownerName: string;
  ownerKind: DigestOwnerKind;
  businessValue: number | null;
}

/**
 * One person or agent who moved work today.
 *
 * The three metrics are deliberately NOT summed by the API and must not be summed
 * here: a finished ticket, a completed run and a lane hop are different units, and a
 * total would be a score the data does not support.
 */
export interface DigestContributor {
  id: string;
  kind: Exclude<DigestOwnerKind, 'unassigned'>;
  name: string;
  shipped: number;
  runs: number;
  /** Forward lane moves today, for people AND agents alike — the transition log names
   *  the mover of every hop. Backward hops (redo) are excluded server-side. */
  moves: number;
}

/** One class of decision the manager took today. */
export interface DigestManagerDecision {
  actionType: ManagerActionType | string;
  count: number;
}

/** Work autonomy has handed back to a person. */
export interface DigestAttentionItem {
  taskId: number;
  key: string | null;
  title: string | null;
  reason: 'escalated';
  since: string | null;
}

/** GET /api/manager/:projectId/digest — the answer to "what got done today?". */
export interface ManagerDailyDigest {
  projectId: number;
  /** The reader's local day as absolute instants. */
  dayStart: string;
  dayEnd: string;
  manager: {
    passes: number;
    decisions: DigestDelta;
    byType: DigestManagerDecision[];
    lastRunAt: string | null;
  };
  team: {
    shipped: DigestDelta;
    opened: DigestDelta;
    laneMoves: { forward: number; backward: number; byHuman: number; byAgent: number;
      /** Hops whose actor the log cannot name — automation with no identity. Its own
       *  bucket because folding it into byAgent claimed credit for agents the
       *  contributor table simultaneously showed at zero. */
      bySystem: number };
    runs: {
      completed: number; failed: number;
      /**
       * WHY the failures failed, largest class first. Optional because a client can be
       * newer than the API it talks to — always `?? []`.
       *
       * `sample` is only populated where the raw text adds something (`unknown` and the
       * crash classes); for a named reason it would just repeat three sentences of
       * advice per row. `platform: true` means the class is the platform getting in the
       * way rather than the work failing, which is the difference between "this board is
       * healthy and being interrupted" and "this board is broken".
       */
      failureReasons?: Array<{
        reason: string; label: string; count: number; sample: string | null; platform: boolean;
      }>;
      /** Failures past the API's 50-distinct-message cap. Surfaced so the breakdown can
       *  never read as complete when it is not. */
      failuresUnaccounted?: number;
    };
    prs: { merged: DigestDelta; opened: number };
    contributors: DigestContributor[];
  };
  shipped: DigestShippedTicket[];
  needsAttention: {
    escalatedToday: number;
    openEscalations: number;
    items: DigestAttentionItem[];
  };
  computedAt: string;
}

export const managerDigestApi = {
  /**
   * TODAY's digest — what the manager and the team actually accomplished.
   *
   * The offset is sent so "today" is the READER's day: the server cuts the window on
   * the caller's midnight rather than UTC's, which is otherwise wrong for most of the
   * world for most of the day. `getTimezoneOffset` returns minutes to SUBTRACT from
   * local to reach UTC, so it is negated into the "minutes to add to UTC" the API takes.
   */
  digest: (projectId: number): Promise<ManagerDailyDigest> =>
    request<ManagerDailyDigest>(`/api/manager/${projectId}/digest?tz=${-new Date().getTimezoneOffset()}`),
};
