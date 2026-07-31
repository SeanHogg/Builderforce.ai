import { describe, expect, it } from 'vitest';
import { parseRoleInstruction } from '../runtime/cloudDispatch';
import {
  SIGNOFF_TOOL_NAME,
  buildProducerRequestPayload,
  buildSignoffRequestPayload,
} from './signoffRequest';

/**
 * The producer/consumer contract for the role-participation ask.
 *
 * `reviewInstruction` was written into the dispatch payload by both builders and
 * read by NOTHING — so a reviewer was dispatched to judge work and never asked to
 * record the judgement. Measured on tenant 1: `builtin_kanban_signoff` invoked
 * zero times ever, 0 of 2,263 reviewer slots ever completed, and all 327 ledger
 * rows written by the producer auto-attest fallback rather than by an agent.
 *
 * These tests bind the writer to the reader. A rename on either side, or a payload
 * builder that forgets the field, fails here rather than silently reproducing a
 * board that cannot complete a ticket.
 */
describe('role instruction reaches the run', () => {
  const spec = {
    taskId: 42,
    roleKey: 'code-reviewer',
    roleName: 'Code Reviewer',
    laneKey: 'in_review',
    taskTitle: 'Add retry to the webhook handler',
    prUrl: 'https://github.com/o/r/pull/7',
    cloudAgentRef: 'agent-1',
  };

  it('carries the REVIEWER ask from the payload builder to the parser', () => {
    const instruction = parseRoleInstruction(buildSignoffRequestPayload(spec));
    expect(instruction).toBeTruthy();
    // The three things the round-trip is worthless without.
    expect(instruction).toContain(SIGNOFF_TOOL_NAME);
    expect(instruction).toContain('taskId=42');
    expect(instruction).toContain("laneKey='in_review'");
  });

  it('carries the PRODUCER ask the same way', () => {
    const instruction = parseRoleInstruction(buildProducerRequestPayload(spec));
    expect(instruction).toBeTruthy();
    expect(instruction).toContain(SIGNOFF_TOOL_NAME);
    expect(instruction).toContain("roleKey='code-reviewer'");
  });

  it('names the ADVERTISED tool, not the catalog id', () => {
    // A prior round of this defect shipped the dotted catalog id (`kanban.signoff`),
    // which the agent cannot call — it only ever sees the flattened name.
    const instruction = parseRoleInstruction(buildSignoffRequestPayload(spec)) ?? '';
    expect(SIGNOFF_TOOL_NAME).toBe('builtin_kanban_signoff');
    expect(instruction).not.toMatch(/`kanban\.signoff`/);
  });

  it('returns null for payloads that carry no role ask', () => {
    expect(parseRoleInstruction(undefined)).toBeNull();
    expect(parseRoleInstruction(null)).toBeNull();
    expect(parseRoleInstruction('not json')).toBeNull();
    expect(parseRoleInstruction(JSON.stringify({ cloudAgentRef: 'a' }))).toBeNull();
    expect(parseRoleInstruction(JSON.stringify({ reviewInstruction: '   ' }))).toBeNull();
  });

  /**
   * The delivery fix alone would leave every slot that already burned its attempt
   * ceiling exhausted against an ask that never arrived — the trap `attestRoleRun`
   * documents from two prior rounds. Re-arming is automatic ONLY because the
   * counted silence is stamped with a hash of the instruction text, so the
   * instruction must actually differ from the one those counts were taken under.
   */
  it('states the deadline that makes the ask answerable before the turn ends', () => {
    const instruction = parseRoleInstruction(buildSignoffRequestPayload(spec)) ?? '';
    expect(instruction).toContain('BEFORE you finish');
  });
});
