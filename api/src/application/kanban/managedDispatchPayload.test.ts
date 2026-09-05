import { describe, it, expect } from 'vitest';
import { buildRoleRunPayload } from './requestRoleRun';
import { parseActAsRole, parseCloudAgentRef, parseLaneKey, parseOriginatingChatId } from '../runtime/cloudDispatch';

/**
 * THE CONTRACT BETWEEN A ROLE RUN'S PAYLOAD AND THE MANAGED-BOARD GUARD.
 *
 * `authorizeManagedTaskExecution` reads exactly three fields off a dispatch payload —
 * `actAsRole` (or `reviewRole`), `cloudAgentRef` and `laneKey` — and refuses the run
 * when any is missing. `buildRoleRunPayload` is the ONLY builder that is supposed to
 * satisfy it. Nothing tied the two together, so a dispatcher could hand-roll a payload
 * that looked complete and be refused: that is precisely what `/api/tasks/:id/run-now`
 * did, on every lifecycle-managed board, for every Run-now click and every
 * `chats.dispatch_agent` call — and the refusal was then reported to the user as an
 * exhausted monthly cloud-run allowance on a workspace with unlimited runs.
 *
 * These assertions pin the agreement in both directions: what the builder emits is
 * accepted, and the bare role-less payload that used to be sent is not.
 */
describe('a role run payload satisfies every field the managed guard reads', () => {
  const base = {
    tenantId: 1,
    projectId: 11,
    taskId: 2395,
    roleKey: 'developer',
    roleName: 'Developer',
    agentRef: 'agent-dev',
    laneKey: 'todo',
    submittedBy: 'user:sean',
  } as const;

  it('stamps actAsRole for a PRODUCER — the key the guard requires', () => {
    const payload = buildRoleRunPayload({ ...base, kind: 'producer' });

    expect(parseActAsRole(payload)).toBe('developer');
    expect(parseCloudAgentRef(payload)).toBe('agent-dev');
    expect(parseLaneKey(payload)).toBe('todo');
  });

  it('stamps reviewRole for a REVIEWER, which the guard reads the same way', () => {
    const payload = buildRoleRunPayload({ ...base, kind: 'reviewer' });

    // `parseActAsRole` resolves either key — a judgement and a production are both
    // role-attributed runs, which is what the guard is actually asking about.
    expect(parseActAsRole(payload)).toBe('developer');
    expect(parseCloudAgentRef(payload)).toBe('agent-dev');
  });

  /**
   * Without the chat id the run is invisible to the conversation that asked for it: it
   * narrates nowhere and cannot be followed or steered from there. That is the whole
   * point of dispatching an agent from a chat, so it rides the payload the same way.
   */
  it('carries the originating Brain chat when one asked for the run', () => {
    expect(parseOriginatingChatId(buildRoleRunPayload({ ...base, kind: 'producer', chatId: 99 }))).toBe(99);
    // Absent for a board/headless dispatch — and never a `chatId: null` the parser
    // would have to defend against.
    expect(parseOriginatingChatId(buildRoleRunPayload({ ...base, kind: 'producer' }))).toBeUndefined();
  });

  it('REJECTS the bare payload run-now used to send — the measured refusal', () => {
    const bare = JSON.stringify({ cloudAgentRef: 'agent-dev', laneKey: 'todo' });

    expect(parseCloudAgentRef(bare)).toBe('agent-dev');
    expect(parseLaneKey(bare)).toBe('todo');
    // No role ⇒ `authorizeManagedTaskExecution` declines, the dispatcher returns a
    // refusal, and no run is ever created.
    expect(parseActAsRole(bare)).toBeUndefined();
  });
});
