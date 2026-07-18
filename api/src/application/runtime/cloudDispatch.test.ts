import { describe, it, expect } from 'vitest';
import {
  resolveCloudSurface, chooseCloudExecutor, probeContainerHealth, isTerminalExecutionStatus,
  parseFollowUp, buildFollowUpPayload,
  parseModel, parseCloudAgentRef, parseRepoId, parseRemediation,
  markReaperRequeued, wasReaperRequeued, withDefaultModel,
  parseExecutor, withExecutor,
} from './cloudDispatch';

describe('chooseCloudExecutor', () => {
  it('uses the container ONLY when wanted, bound, AND proven healthy', () => {
    expect(chooseCloudExecutor({ wantsContainer: true, hasContainerBinding: true, containerHealthy: true, hasCloudRunner: true })).toBe('container');
  });
  it('REGRESSION: a bound-but-unhealthy container falls back to durable, not container', () => {
    // The exact bug the user hit: the container DO acked /run 202 while the image
    // was dead, and the run was orphan-reaped instead of running on durable.
    expect(chooseCloudExecutor({ wantsContainer: true, hasContainerBinding: true, containerHealthy: false, hasCloudRunner: true })).toBe('durable');
  });
  it('falls back to durable when the container is wanted but not bound', () => {
    expect(chooseCloudExecutor({ wantsContainer: true, hasContainerBinding: false, containerHealthy: false, hasCloudRunner: true })).toBe('durable');
  });
  it('uses durable for non-container runs (V1 / V2 durable)', () => {
    expect(chooseCloudExecutor({ wantsContainer: false, hasContainerBinding: false, containerHealthy: false, hasCloudRunner: true })).toBe('durable');
  });
  it('fails closed when no durable runner is bound', () => {
    // Never return the old in-request Worker executor: that multi-step loop times out.
    expect(chooseCloudExecutor({ wantsContainer: false, hasContainerBinding: false, containerHealthy: false, hasCloudRunner: false })).toBe('unavailable');
    expect(chooseCloudExecutor({ wantsContainer: true, hasContainerBinding: true, containerHealthy: false, hasCloudRunner: false })).toBe('unavailable');
  });
});

describe('probeContainerHealth', () => {
  it('returns true when /health responds ok', async () => {
    const stub = { fetch: async () => new Response('{"ok":true}', { status: 200 }) };
    expect(await probeContainerHealth(stub)).toBe(true);
  });
  it('returns false on a non-200 (container up but unhealthy)', async () => {
    const stub = { fetch: async () => new Response('nope', { status: 503 }) };
    expect(await probeContainerHealth(stub)).toBe(false);
  });
  it('returns false when the probe throws/times out (container not live)', async () => {
    const stub = { fetch: async () => { throw new Error('container failed to start'); } };
    expect(await probeContainerHealth(stub)).toBe(false);
  });
});

describe('isTerminalExecutionStatus', () => {
  it('treats completed/failed/cancelled as terminal', () => {
    expect(isTerminalExecutionStatus('completed')).toBe(true);
    expect(isTerminalExecutionStatus('failed')).toBe(true);
    expect(isTerminalExecutionStatus('cancelled')).toBe(true);
  });
  it('treats live/queued states as non-terminal (steerable)', () => {
    expect(isTerminalExecutionStatus('pending')).toBe(false);
    expect(isTerminalExecutionStatus('submitted')).toBe(false);
    expect(isTerminalExecutionStatus('running')).toBe(false);
    expect(isTerminalExecutionStatus(null)).toBe(false);
    expect(isTerminalExecutionStatus(undefined)).toBe(false);
  });
});

describe('parseFollowUp', () => {
  it('extracts a trimmed directive and prior execution id', () => {
    const r = parseFollowUp(JSON.stringify({ followUp: { directive: '  add retries  ', priorExecutionId: 55 } }));
    expect(r).toEqual({ directive: 'add retries', priorExecutionId: 55 });
  });
  it('returns null when there is no follow-up block', () => {
    expect(parseFollowUp(JSON.stringify({ model: 'x' }))).toBeNull();
    expect(parseFollowUp(undefined)).toBeNull();
    expect(parseFollowUp('not json')).toBeNull();
  });
  it('returns null for an empty/whitespace directive', () => {
    expect(parseFollowUp(JSON.stringify({ followUp: { directive: '   ' } }))).toBeNull();
    expect(parseFollowUp(JSON.stringify({ followUp: {} }))).toBeNull();
  });
  it('defaults priorExecutionId to null when missing or non-finite', () => {
    expect(parseFollowUp(JSON.stringify({ followUp: { directive: 'go' } }))?.priorExecutionId).toBeNull();
    expect(parseFollowUp(JSON.stringify({ followUp: { directive: 'go', priorExecutionId: Number.NaN } }))?.priorExecutionId).toBeNull();
  });
});

describe('buildFollowUpPayload', () => {
  it('preserves the prior run agent/model pin and attaches the directive', () => {
    const prior = JSON.stringify({ cloudAgentRef: 'agent-7', model: 'claude-opus-4-8', repoId: 'r1' });
    const out = JSON.parse(buildFollowUpPayload(prior, { directive: 'use Go', priorExecutionId: 42 }));
    expect(out.cloudAgentRef).toBe('agent-7');
    expect(out.model).toBe('claude-opus-4-8');
    expect(out.repoId).toBe('r1');
    expect(out.followUp).toEqual({ directive: 'use Go', priorExecutionId: 42 });
  });
  it('drops a stale remediation block from the prior payload', () => {
    const prior = JSON.stringify({ remediation: { kind: 'build_failure', buildError: 'boom' }, model: 'm' });
    const out = JSON.parse(buildFollowUpPayload(prior, { directive: 'next', priorExecutionId: 1 }));
    expect(out.remediation).toBeUndefined();
    expect(out.model).toBe('m');
    expect(out.followUp.directive).toBe('next');
  });
  it('tolerates a missing/invalid prior payload', () => {
    const out = JSON.parse(buildFollowUpPayload(undefined, { directive: 'd', priorExecutionId: 9 }));
    expect(out.followUp).toEqual({ directive: 'd', priorExecutionId: 9 });
    const out2 = JSON.parse(buildFollowUpPayload('not json', { directive: 'd', priorExecutionId: 9 }));
    expect(out2.followUp.priorExecutionId).toBe(9);
  });
});

describe('resolveCloudSurface', () => {
  it('an explicitly-pinned host is a long-lived (container/relay) runtime', () => {
    expect(resolveCloudSurface('durable', true)).toBe('container');
    expect(resolveCloudSurface(undefined, true)).toBe('container');
  });

  it('honors the agent\'s chosen surface when no host is pinned', () => {
    expect(resolveCloudSurface('container', false)).toBe('container');
    expect(resolveCloudSurface('durable', false)).toBe('durable');
  });

  it('defaults to durable for an unset/unknown surface (on-demand, no always-on infra)', () => {
    expect(resolveCloudSurface(undefined, false)).toBe('durable');
    expect(resolveCloudSurface(null, false)).toBe('durable');
    expect(resolveCloudSurface('something-else', false)).toBe('durable');
  });
});

describe('executor stamping (per-surface orphan ceiling)', () => {
  it('withExecutor stamps the executor while preserving existing payload keys', () => {
    const stamped = withExecutor('{"model":"x","cloudAgentRef":"a1"}', 'durable');
    expect(JSON.parse(stamped)).toEqual({ model: 'x', cloudAgentRef: 'a1', executor: 'durable' });
    // Absent/garbage payload → a fresh object carrying just the executor.
    expect(JSON.parse(withExecutor(null, 'worker'))).toEqual({ executor: 'worker' });
    expect(JSON.parse(withExecutor('not json', 'container'))).toEqual({ executor: 'container' });
    // Re-stamping overwrites (idempotent).
    expect(parseExecutor(withExecutor(stamped, 'worker'))).toBe('worker');
  });

  it('parseExecutor round-trips a stamped executor and rejects unknown/garbage', () => {
    for (const e of ['durable', 'container', 'worker'] as const) {
      expect(parseExecutor(withExecutor(undefined, e))).toBe(e);
    }
    expect(parseExecutor('{"executor":"bogus"}')).toBeUndefined();
    expect(parseExecutor('{"model":"x"}')).toBeUndefined();
    expect(parseExecutor('null')).toBeUndefined();
    expect(parseExecutor(undefined)).toBeUndefined();
    expect(parseExecutor('not json')).toBeUndefined();
  });
});

// ── Defensive boundaries: every payload reader is fed hostile/malformed input ──
// These parsers are the dispatch input layer — they take an UNTRUSTED execution
// payload string. A bad payload must degrade to a safe default (undefined/null/
// unchanged), NEVER throw and abort a dispatch. We inject the wrong JSON shape,
// the wrong value type, and non-JSON garbage at each one.
describe('payload parsers — malformed / wrong-type input is defended', () => {
  // Inputs that are NOT a JSON object with the expected field. `'null'` is the
  // sharp edge: JSON.parse('null') === null, so a naive `p.field` would throw.
  const GARBAGE = [undefined, '', 'not json at all', '{bad', 'null', '[]', '"a string"', '42'] as const;

  it('parseModel: garbage in → undefined out, valid string trimmed, wrong type ignored', () => {
    for (const g of GARBAGE) expect(parseModel(g)).toBeUndefined();
    expect(parseModel(JSON.stringify({ model: 42 }))).toBeUndefined();          // wrong type
    expect(parseModel(JSON.stringify({ model: '   ' }))).toBeUndefined();        // blank
    expect(parseModel(JSON.stringify({ model: '  claude-x ' }))).toBe('claude-x'); // trimmed
  });

  it('parseCloudAgentRef: garbage in → undefined out, wrong type ignored, valid trimmed', () => {
    for (const g of GARBAGE) expect(parseCloudAgentRef(g)).toBeUndefined();
    expect(parseCloudAgentRef(JSON.stringify({ cloudAgentRef: { id: 1 } }))).toBeUndefined();
    expect(parseCloudAgentRef(JSON.stringify({ cloudAgentRef: '  agent-7 ' }))).toBe('agent-7');
  });

  it('parseRepoId: tri-state survives garbage (absent=undefined, wrong-type=clear, valid=trimmed)', () => {
    for (const g of GARBAGE) expect(parseRepoId(g)).toBeUndefined();             // absent / unparseable → leave pin
    expect(parseRepoId(JSON.stringify({ other: 1 }))).toBeUndefined();           // key absent → leave pin
    expect(parseRepoId(JSON.stringify({ repoId: 42 }))).toBe('');                // wrong type → explicit clear
    expect(parseRepoId(JSON.stringify({ repoId: null }))).toBe('');              // explicit null → clear
    expect(parseRepoId(JSON.stringify({ repoId: ' r1 ' }))).toBe('r1');          // valid → trimmed pin
  });

  it('parseRemediation: only a well-formed build_failure block parses; everything else → null', () => {
    for (const g of GARBAGE) expect(parseRemediation(g)).toBeNull();
    expect(parseRemediation(JSON.stringify({ remediation: { kind: 'other', buildError: 'x' } }))).toBeNull();
    expect(parseRemediation(JSON.stringify({ remediation: { kind: 'build_failure', buildError: 99 } }))).toBeNull();
    // attempt/maxAttempts of the wrong type fall back to their safe defaults.
    expect(
      parseRemediation(JSON.stringify({ remediation: { kind: 'build_failure', buildError: 'boom', attempt: '3', runUrl: 5 } })),
    ).toEqual({ attempt: 1, maxAttempts: 2, buildError: 'boom', runUrl: null, phase: 'post_merge' });
    // An explicit pre-merge phase is preserved (a PR-branch failure, not a deploy one).
    expect(
      parseRemediation(JSON.stringify({ remediation: { kind: 'build_failure', buildError: 'boom', phase: 'pre_merge' } })),
    ).toEqual({ attempt: 1, maxAttempts: 2, buildError: 'boom', runUrl: null, phase: 'pre_merge' });
  });

  it('markReaperRequeued / wasReaperRequeued: a non-JSON payload resets to a clean flagged object', () => {
    // Garbage prior payload must not corrupt the one-retry flag (else the reaper loops).
    expect(JSON.parse(markReaperRequeued('not json')).reaperRequeued).toBe(true);
    expect(JSON.parse(markReaperRequeued(undefined)).reaperRequeued).toBe(true);
    expect(JSON.parse(markReaperRequeued(JSON.stringify({ model: 'm' }))).model).toBe('m'); // preserves real fields
    // The reader is strict-`=== true`: a stringy "true" must NOT count as flagged.
    expect(wasReaperRequeued(JSON.stringify({ reaperRequeued: 'true' }))).toBe(false);
    expect(wasReaperRequeued('not json')).toBe(false);
    expect(wasReaperRequeued(undefined)).toBe(false);
    expect(wasReaperRequeued(JSON.stringify({ reaperRequeued: true }))).toBe(true);
  });

  it('withDefaultModel: an unparseable payload is returned UNCHANGED (never clobbered)', () => {
    expect(withDefaultModel('not json', 'm')).toBe('not json');                  // can't parse → leave as-is
    expect(withDefaultModel(undefined, undefined)).toBeUndefined();              // nothing to add
    expect(withDefaultModel(JSON.stringify({ model: 'pinned' }), 'm')).toBe(JSON.stringify({ model: 'pinned' })); // pin wins
    expect(JSON.parse(withDefaultModel(undefined, 'm')!).model).toBe('m');       // seeds the fallback
    expect(JSON.parse(withDefaultModel(JSON.stringify({ x: 1 }), 'm')!)).toEqual({ x: 1, model: 'm' });
  });
});
