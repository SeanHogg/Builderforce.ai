import { describe, it, expect } from 'vitest';
import { buildSignoffRequestInstruction, buildSignoffRequestPayload } from './signoffRequest';

/**
 * The failure these tests guard against is subtle and was live in production.
 *
 * `TicketParticipantsService.syncStates` matches a ledger row to a manifest slot on
 * `${laneKey}:${roleKey}`. Both hand-written sign-off instructions (the lane requirement
 * gate's reviewer round-trip and the AI Manager's `driveOutstandingSignoffs`) told the
 * agent to POST `roleKey` and said NOTHING about `laneKey` — so a compliant agent
 * recorded a verdict with `laneKey = null`, which matched no lane-scoped slot. The
 * sign-off existed in the ledger and was invisible to every gate reading the manifest.
 */

const spec = {
  taskId: 42,
  taskTitle: 'Add rate limiting',
  roleKey: 'code-reviewer',
  roleName: 'Code Reviewer',
  laneKey: 'in_review',
};

describe('buildSignoffRequestInstruction', () => {
  it('tells the agent to pass laneKey IN THE POST BODY — the slot-matching key', () => {
    const text = buildSignoffRequestInstruction(spec);
    expect(text).toContain("roleKey='code-reviewer'");
    expect(text).toContain("laneKey='in_review'");
  });

  it('restates that laneKey must be passed verbatim, so a paraphrasing model still complies', () => {
    expect(buildSignoffRequestInstruction(spec)).toContain('Pass laneKey exactly as given');
  });

  it('names the role, the ticket, the lane and the endpoint', () => {
    const text = buildSignoffRequestInstruction(spec);
    expect(text).toContain('You are the Code Reviewer');
    expect(text).toContain('ticket #42');
    expect(text).toContain('"Add rate limiting"');
    expect(text).toContain("lane 'in_review'");
    expect(text).toContain('POST /api/kanban/tasks/42/signoff');
  });

  it('offers BOTH verdicts — an instruction that only names approval is a rubber stamp', () => {
    const text = buildSignoffRequestInstruction(spec);
    expect(text).toContain("'approved'");
    expect(text).toContain("'changes_requested'");
  });

  it('demands a linked `contribution`, which the accountability report audits for', () => {
    // `getAccountability` raises a `no_contribution` gap for an approval with no linked
    // evidence, so asking up front is cheaper than auditing it after the fact.
    expect(buildSignoffRequestInstruction(spec)).toContain('contribution');
  });

  it('includes the pull request when the caller has one', () => {
    expect(buildSignoffRequestInstruction({ ...spec, prUrl: 'https://x/pr/9' }))
      .toContain('pull request: https://x/pr/9');
  });

  it('omits the laneKey clauses entirely when there is no lane, instead of emitting an empty one', () => {
    // A stage-less slot matches on role alone; telling the agent to send `laneKey=''`
    // would write a ledger row keyed to a lane that does not exist.
    const text = buildSignoffRequestInstruction({ ...spec, laneKey: null });
    expect(text).not.toContain('laneKey');
    expect(text).toContain("roleKey='code-reviewer'");
  });

  it('omits the title clause for an untitled ticket', () => {
    const text = buildSignoffRequestInstruction({ ...spec, taskTitle: null });
    expect(text).toContain('ticket #42');
    expect(text).not.toContain('""');
  });
});

describe('buildSignoffRequestPayload', () => {
  it('stamps reviewRole + laneKey, which is what makes the run role-attributed', () => {
    // `parseActAsRole` reads `reviewRole`, so `attributeRunToManifest` lands the finished
    // run on the right slot; `laneKey` records the lane the run served (and drives the
    // same-lane re-entry loop guard).
    const payload = JSON.parse(buildSignoffRequestPayload({ ...spec, cloudAgentRef: 'agent-7' }));
    expect(payload).toMatchObject({
      cloudAgentRef: 'agent-7',
      laneKey: 'in_review',
      reviewRole: 'code-reviewer',
    });
    expect(payload.reviewInstruction).toContain("laneKey='in_review'");
  });

  it('carries a pinned model when the lane assignment declares one', () => {
    const payload = JSON.parse(buildSignoffRequestPayload({ ...spec, cloudAgentRef: 'a', model: 'opus' }));
    expect(payload.model).toBe('opus');
  });

  it('omits `model` entirely when none is pinned, so the tenant default applies', () => {
    const payload = JSON.parse(buildSignoffRequestPayload({ ...spec, cloudAgentRef: 'a', model: null }));
    expect('model' in payload).toBe(false);
  });
});
