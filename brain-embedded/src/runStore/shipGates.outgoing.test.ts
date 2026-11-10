/**
 * `outgoingEvidenceVerdict` — the evidence half of the outgoing gate that ticket completion
 * (`completionGuard.canCompleteTicket`) and a commit's advisory read (PRD 45 §4.3). A host
 * without a git port gets `undefined` and behaves exactly as today; a bound port (or verifier)
 * that throws fails CLOSED with a refusing verdict.
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

  it('regression: a throwing git port FAILS CLOSED with a refusal naming the error (was undefined = ungated completion)', async () => {
    const throwing: GitPort = { outgoing: async () => { throw new Error('not a repo'); } };
    const verdict = await outgoingEvidenceVerdict(runWith({ git: throwing }), '');
    expect(verdict?.ok).toBe(false);
    expect(verdict && !verdict.ok ? verdict.reason : '').toContain('not a repo');
  });

  it('regression: a throwing verifier fails closed too', async () => {
    const broken: VerifierPort = { diagnostics: async () => null, full: async () => { throw new Error('tsc crashed'); } };
    const verdict = await outgoingEvidenceVerdict(runWith({ git: git([{ absPath: NEW_FILE, isNew: false }]), verifier: broken }), '');
    expect(verdict?.ok).toBe(false);
    expect(verdict && !verdict.ok ? verdict.reason : '').toContain('tsc crashed');
  });

  it('regression: verifies only EXISTING files that lack fresh evidence (never deleted ones, never already-checked bytes)', async () => {
    const asked: string[][] = [];
    const recording: VerifierPort = {
      diagnostics: async () => null,
      full: async (paths) => {
        asked.push([...paths]);
        return new Map(paths.map((p) => [p, ['diagnostics', 'typecheck', 'test'].map((kind) => ({ kind: kind as CheckRecord['kind'], name: kind, outcome: 'pass' as const, exitCode: 0, findings: [], at: 1 }))]));
      },
    };
    const files = [
      { absPath: '/repo/src/kept.ts', isNew: false, hash: 'h1', deleted: false },
      { absPath: '/repo/src/gone.ts', isNew: false, hash: 'h2', deleted: true },
    ];
    const port: GitPort = { outgoing: async () => ({ files, diffHash: 'd', baseBranch: true }) };
    const run = runWith({ git: port, verifier: recording });
    await outgoingEvidenceVerdict(run, '');
    expect(asked).toEqual([['/repo/src/kept.ts']]);
    // Same bytes again: the evidence is fresh, so the verifier is not asked a second time.
    await outgoingEvidenceVerdict(run, '');
    expect(asked).toHaveLength(1);
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
