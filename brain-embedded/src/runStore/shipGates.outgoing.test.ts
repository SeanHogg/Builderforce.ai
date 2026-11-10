/**
 * `outgoingEvidenceVerdict` — the evidence half of the outgoing gate that ticket completion
 * (`completionGuard.canCompleteTicket`) and a commit's advisory read (PRD 45 §4.3). A host
 * without a git port, or one whose port fails, gets `undefined` and behaves exactly as today.
 */
import { describe, expect, it } from 'vitest';
import { createEvidenceLedger, type CheckRecord } from '@builderforce/run-guards';
import { outgoingEvidenceVerdict } from './shipGates';
import type { BrainRunContext } from './brainRunContext';
import type { GitPort, VerifierPort } from './runTypes';

const NEW_FILE = '/repo/src/inbound.ts';

const git = (files: { absPath: string; isNew: boolean }[]): GitPort => ({
  outgoing: async () => ({
    files: files.map((f) => ({ ...f, hash: `h:${f.absPath}`, deleted: false })),
    diffHash: 'd',
    baseBranch: true,
  }),
});

const verifier = (outcome: CheckRecord['outcome']): VerifierPort => ({
  diagnostics: async () => null,
  full: async (paths) => new Map(paths.map((p) => [p, [{ kind: 'typecheck' as const, name: 'tsc', outcome, exitCode: outcome === 'fail' ? 2 : 0, findings: [], at: 1 }]])),
});

const runWith = (req: Partial<BrainRunContext['req']>): BrainRunContext =>
  ({ req, evidence: createEvidenceLedger() }) as unknown as BrainRunContext;

describe('outgoingEvidenceVerdict', () => {
  it('is undefined without a git port (hosts that bind none are unchanged)', async () => {
    expect(await outgoingEvidenceVerdict(runWith({}), '')).toBeUndefined();
  });

  it('is undefined when the git port throws', async () => {
    const throwing: GitPort = { outgoing: async () => { throw new Error('not a repo'); } };
    expect(await outgoingEvidenceVerdict(runWith({ git: throwing }), '')).toBeUndefined();
  });

  it('refuses a new source file shipped without its test', async () => {
    const verdict = await outgoingEvidenceVerdict(runWith({ git: git([{ absPath: NEW_FILE, isNew: true }]), verifier: verifier('pass') }), '');
    expect(verdict?.ok).toBe(false);
  });

  it('refuses when the full tier records a failing check for the current bytes', async () => {
    const verdict = await outgoingEvidenceVerdict(runWith({ git: git([{ absPath: NEW_FILE, isNew: false }]), verifier: verifier('fail') }), '');
    expect(verdict?.ok).toBe(false);
  });

  it('passes when the outgoing files carry passing evidence', async () => {
    const verdict = await outgoingEvidenceVerdict(runWith({ git: git([{ absPath: NEW_FILE, isNew: false }]), verifier: verifier('pass') }), '');
    expect(verdict?.ok).toBe(true);
  });
});
