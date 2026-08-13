/**
 * The gate exists to stop two things: an irreversible act with no reviewer, and a figure
 * nobody stood behind. The assertions that matter are the REFUSALS — an agent approving
 * its own change, and a gated act on an object that never declared a mode.
 */
import { describe, expect, it } from 'vitest';
import {
  actionIsGated,
  appendProvenance,
  approvalGuidance,
  describeValue,
  evaluateGate,
  fieldIsAttributed,
  grantApproval,
  pendingApprovals,
  provenanceForPatch,
  readProvenance,
  type Actor,
  type ProvenanceEntry,
} from './canvasApprovalGate';

const HUMAN: Actor = { kind: 'human', ref: 'user:1', name: 'Sam' };
const OTHER: Actor = { kind: 'human', ref: 'user:2', name: 'Ana' };
const AGENT: Actor = { kind: 'agent', ref: 'agent:cfo', name: 'CFO agent' };
const AT = '2026-08-13T10:00:00.000Z';

const entry = (over: Partial<ProvenanceEntry> = {}): ProvenanceEntry => ({
  id: 'amount:1', field: 'amount', from: '100', to: '200', at: AT, by: HUMAN, ...over,
});

describe('the registries', () => {
  it('gates the outbound acts the CMO review named and the attested ones the CFO review named', () => {
    expect(actionIsGated('emailCampaign', 'send')).toBe(true);
    expect(actionIsGated('budget', 'approve')).toBe(true);
    expect(actionIsGated('bill', 'schedule-payment')).toBe(true);
    expect(actionIsGated('note', 'edit')).toBe(false);
  });

  it('attributes money fields and not prose ones', () => {
    expect(fieldIsAttributed('invoice', 'amount')).toBe(true);
    expect(fieldIsAttributed('invoice', 'summary')).toBe(false);
  });

  it('documents the gate from the registry rather than from a prompt paragraph', () => {
    const guidance = approvalGuidance();
    expect(guidance).toContain('budget: approve');
    expect(guidance).toContain('emailCampaign: send');
  });
});

describe('evaluateGate', () => {
  it('lets an ungated act through', () => {
    expect(evaluateGate({ kind: 'note', action: 'edit', actor: HUMAN })).toEqual({ allowed: true, reason: 'open' });
  });

  it('defaults a gated act to required, so an object that never declared a mode is still protected', () => {
    const verdict = evaluateGate({ kind: 'budget', action: 'approve', actor: HUMAN });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toBe('awaiting-approval');
  });

  it('honours an explicit open mode', () => {
    expect(evaluateGate({ kind: 'budget', action: 'approve', mode: 'open', actor: HUMAN }).allowed).toBe(true);
  });

  it('lets a standing delegation through, and records it as delegated rather than reviewed', () => {
    const verdict = evaluateGate({ kind: 'emailCampaign', action: 'send', mode: 'autonomous', actor: AGENT });
    expect(verdict).toEqual({ allowed: true, reason: 'autonomous' });
  });

  it('refuses to let an agent approve its own change', () => {
    const verdict = evaluateGate({
      kind: 'budget', action: 'approve', mode: 'required', actor: AGENT,
      provenance: [entry({ by: AGENT })],
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toBe('self-approval');
    expect(verdict.allowed === false && verdict.message).toContain('human approver');
  });

  it('lets an agent approve when the workspace has explicitly permitted it', () => {
    const verdict = evaluateGate({
      kind: 'budget', action: 'approve', mode: 'required', actor: AGENT,
      provenance: [entry({ by: HUMAN })], agentsMayApprove: true,
    });
    expect(verdict).toEqual({ allowed: true, reason: 'approved' });
  });

  it('refuses human self-approval when every pending change is their own', () => {
    const verdict = evaluateGate({
      kind: 'budget', action: 'approve', mode: 'required', actor: HUMAN,
      provenance: [entry(), entry({ id: 'lines:1', field: 'lines' })],
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.message).toContain('self-approval');
  });

  it('allows a second person to approve', () => {
    const verdict = evaluateGate({
      kind: 'budget', action: 'approve', mode: 'required', actor: OTHER,
      provenance: [entry()],
    });
    expect(verdict).toEqual({ allowed: true, reason: 'approved' });
  });
});

describe('provenance', () => {
  it('records what actually moved and ignores what did not', () => {
    const before = { amount: 100, summary: 'old' };
    const entries = provenanceForPatch('invoice', before, { amount: 200, summary: 'new' }, HUMAN, AT, 'Xero');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ field: 'amount', from: '100', to: '200', source: 'Xero', by: HUMAN });
  });

  it('produces nothing for a no-op patch, so a real change cannot get lost in noise', () => {
    expect(provenanceForPatch('invoice', { amount: 100 }, { amount: 100 }, HUMAN, AT)).toEqual([]);
  });

  it('summarises a table by its size rather than serialising it into the ledger', () => {
    expect(describeValue([1, 2, 3])).toBe('3 rows');
    expect(describeValue({ amount: 1200, currency: 'USD' })).toBe('1,200 USD');
    expect(describeValue(null)).toBe('—');
    expect(describeValue('x'.repeat(300))).toHaveLength(160);
  });

  it('reads back what it wrote and drops entries with no actor', () => {
    const data = { provenance: [entry(), { field: 'x', at: AT }, { field: 'y', at: AT, by: { kind: 'nope', ref: 'z' } }] };
    expect(readProvenance(data)).toHaveLength(1);
  });

  it('appends onto an existing trail', () => {
    const data = { provenance: [entry()] };
    expect(appendProvenance(data, [entry({ id: 'b', field: 'dueAt' })])).toHaveLength(2);
  });

  it('counts what is still waiting on a signature', () => {
    const data = { provenance: [entry(), entry({ id: 'b', approvedBy: OTHER, approvedAt: AT })] };
    expect(pendingApprovals(data).map((item) => item.id)).toEqual(['amount:1']);
  });

  it('stamps every unapproved entry and leaves approved ones alone', () => {
    const already = entry({ id: 'b', approvedBy: HUMAN, approvedAt: '2026-01-01T00:00:00.000Z' });
    const granted = grantApproval([entry(), already], OTHER, AT);
    expect(granted[0].approvedBy).toEqual(OTHER);
    expect(granted[1].approvedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
