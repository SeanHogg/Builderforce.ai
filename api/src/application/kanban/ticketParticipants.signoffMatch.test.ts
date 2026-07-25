import { describe, it, expect } from 'vitest';
import { TicketParticipantsService, type ManifestParticipant } from './ticketParticipants';
import { decideSignoffGate } from './signoffGate';
import { ticketParticipants, ticketRoleSignoffs } from '../../infrastructure/database/schema';
import type { Env } from '../../env';

/**
 * `syncStates` is the ONE place a sign-off in the append-only ledger becomes a manifest
 * slot state, and therefore the only way any gate ever learns that a role approved.
 *
 * It matched a ledger row to a slot on `${laneKey}:${roleKey}` ONLY. `laneKey` is
 * optional on both `POST /api/kanban/tasks/:id/signoff` and the `kanban.signoff` MCP
 * tool, and neither hand-written reviewer instruction asked the agent to send it — so a
 * verdict recorded with `laneKey = null` produced a ledger row keyed `:role` that matched
 * no lane-scoped slot. The approval was recorded and then ignored, and the slot sat at
 * `in_progress` forever. These tests cover both the exact match and that fallback.
 */

type Row = Record<string, unknown>;

/**
 * Minimal Drizzle stand-in for `syncStates`: `select().from(t).where(...)` is awaited
 * directly for the participant rows and `.orderBy(...)`-chained for the ledger, so the
 * `where` result is both a thenable and an object with `orderBy`. Collects the `set`
 * payload of every `update`, which is exactly the observable behaviour under test.
 */
function makeDb(participantRows: Row[], signoffRows: Row[]) {
  const updates: Row[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = table === ticketParticipants ? participantRows
            : table === ticketRoleSignoffs ? signoffRows
            : [];
          return {
            orderBy: async () => rows,
            then: (resolve: (v: Row[]) => unknown) => Promise.resolve(rows).then(resolve),
          };
        },
      }),
    }),
    update: () => ({ set: (values: Row) => ({ where: async () => { updates.push(values); } }) }),
  } as never;
  return { db, updates };
}

/** A lane-agent-sourced required reviewer slot, mid-flight (its work has run). */
function laneAgentSlot(over: Row = {}): Row {
  return {
    id: 'p1',
    stageKey: 'in_review',
    roleKey: 'code-reviewer',
    responsibility: 'reviewer',
    required: true,
    source: 'lane_agent',
    assigneeKind: 'agent',
    assigneeRef: 'agent-7',
    assigneeName: 'Review Bot',
    state: 'in_progress',
    signoffId: null,
    childTaskId: null,
    evidence: null,
    note: null,
    ...over,
  };
}

function signoff(over: Row = {}): Row {
  return {
    id: 's1', laneKey: 'in_review', roleKey: 'code-reviewer', verdict: 'approved',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
  };
}

const env = {} as Env;

describe('TicketParticipantsService.syncStates — ledger → manifest matching', () => {
  it('completes the slot on an EXACT lane+role approval (unchanged behaviour)', async () => {
    const { db, updates } = makeDb([laneAgentSlot()], [signoff()]);
    await new TicketParticipantsService(db).syncStates(env, 1, 42);
    expect(updates).toEqual([expect.objectContaining({ state: 'completed', signoffId: 's1' })]);
  });

  it('completes the slot on a LANE-LESS approval — the verdict that used to be ignored', async () => {
    // The regression this guards: an agent that omits `laneKey` (both the route and the
    // MCP tool make it optional) recorded an approval that matched nothing, so the slot
    // stayed `in_progress` and `decideSignoffGate` never opened.
    const { db, updates } = makeDb([laneAgentSlot()], [signoff({ laneKey: null })]);
    await new TicketParticipantsService(db).syncStates(env, 1, 42);
    expect(updates).toEqual([expect.objectContaining({ state: 'completed', signoffId: 's1' })]);
  });

  it('lets an EXACT lane match WIN over a lane-less one — the fallback is only a fallback', async () => {
    // A lane-scoped verdict is the more specific statement about this stage. If the
    // fallback could override it, a stale unscoped approval would mask a live
    // changes-requested on the very lane being gated.
    const { db, updates } = makeDb([laneAgentSlot()], [
      signoff({ id: 'sA', laneKey: null, verdict: 'approved' }),
      signoff({ id: 'sB', laneKey: 'in_review', verdict: 'changes_requested', createdAt: new Date('2026-07-02T00:00:00Z') }),
    ]);
    await new TicketParticipantsService(db).syncStates(env, 1, 42);
    expect(updates).toEqual([expect.objectContaining({ state: 'changes_requested', signoffId: 'sB' })]);
  });

  it('does not apply one role\'s lane-less verdict to a DIFFERENT role', async () => {
    // The fallback widens lane scope, never role scope: it is still an assertion about
    // one role, and a security approval must never satisfy the reviewer's slot.
    const { db, updates } = makeDb(
      [laneAgentSlot({ roleKey: 'security', state: 'in_progress' })],
      [signoff({ laneKey: null, roleKey: 'code-reviewer' })],
    );
    await new TicketParticipantsService(db).syncStates(env, 1, 42);
    // No verdict for `security`, so the slot falls back to its assignee-derived state.
    expect(updates).toEqual([expect.objectContaining({ state: 'assigned' })]);
  });

  it('records a waiver as `waived` rather than `completed`, keeping it auditable', async () => {
    const { db, updates } = makeDb([laneAgentSlot()], [signoff({ verdict: 'waived' })]);
    await new TicketParticipantsService(db).syncStates(env, 1, 42);
    expect(updates).toEqual([expect.objectContaining({ state: 'waived' })]);
  });
});

describe('composition: a staffed lane reaches "all required roles signed off" with no template', () => {
  /** The manifest shape the lane-agent path materialises, as `listParticipants` returns it. */
  function manifest(state: ManifestParticipant['state']): ManifestParticipant[] {
    return [{
      id: 'p1', stageKey: 'in_review', roleKey: 'code-reviewer', roleName: 'Code Reviewer',
      responsibility: 'reviewer', required: true, source: 'lane_agent',
      assigneeKind: 'agent', assigneeRef: 'agent-7', assigneeName: 'Review Bot',
      state, signoffId: null, childTaskId: null, evidence: null, note: null,
    }];
  }

  it('is UNSATISFIED while the lane agent has not yet recorded its verdict', () => {
    const gate = decideSignoffGate(manifest('in_progress'));
    expect(gate.satisfied).toBe(false);
    expect(gate.reason).toBe('outstanding_signoffs');
    expect(gate.outstanding[0]).toMatchObject({ roleName: 'Code Reviewer', assigneeRef: 'agent-7' });
  });

  it('OPENS once the lane agent\'s approval completes its slot — agent action alone', () => {
    // The end-to-end claim: a board with no `swimlane_requirements` and no human in the
    // loop can now reach unanimous sign-off. Before the lane-approver tier there was no
    // required slot at all, so this manifest was empty and the gate reported
    // `no_required_participants` — permanently unsatisfiable rather than merely unmet.
    const gate = decideSignoffGate(manifest('completed'));
    expect(gate.satisfied).toBe(true);
    expect(gate.reason).toBe('all_signed_off');
    expect(gate.requiredCount).toBe(1);
  });

  it('still FAILS CLOSED when no approver could be resolved (no slot materialised)', () => {
    // Tier (c) of the lane-approver precedence deliberately writes no slot, which leaves
    // the manifest empty — and an empty manifest is NOT unanimity.
    const gate = decideSignoffGate([]);
    expect(gate.satisfied).toBe(false);
    expect(gate.reason).toBe('no_required_participants');
  });
});
