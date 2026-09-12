import { describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({ deserializeRowDelta: vi.fn(), verifyCrcTrailer: vi.fn() }));
vi.mock('@seanhogg/builderforce-memory-engine', () => engine);

const {
  MAX_DELTA_B64_CHARS,
  admitDeltaAgainstHead,
  decodeDeltaB64,
  deltaUnusableReason,
  parseDeltaLearnRequest,
} = await import('./evermindDeltaLearn');

/**
 * The delta door's contract, shared by the gateway route and the coordinator DO.
 * The on-prem producer (agent-runtime `project-evermind-delta.ts`) branches on exactly
 * these answers, so they are pinned here rather than inferred from either caller.
 */
describe('parseDeltaLearnRequest', () => {
  it('accepts the producer payload shape', () => {
    const r = parseDeltaLearnRequest({ diff: 'AAAA', baseVersion: 7, weight: 0.7, label: '  ticket 12  ' });
    expect(r).toEqual({ ok: true, request: { diff: 'AAAA', baseVersion: 7, weight: 0.7, label: 'ticket 12' } });
  });

  it('requires a diff and an INTEGER baseVersion', () => {
    expect(parseDeltaLearnRequest({ diff: 'AAAA' })).toMatchObject({ ok: false, status: 400 });
    expect(parseDeltaLearnRequest({ diff: 'AAAA', baseVersion: 7.5 })).toMatchObject({ ok: false, status: 400 });
    expect(parseDeltaLearnRequest({ baseVersion: 7 })).toMatchObject({ ok: false, status: 400 });
    expect(parseDeltaLearnRequest(null)).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses non-base64 at the door, so it can never throw inside the merge alarm', () => {
    expect(parseDeltaLearnRequest({ diff: 'not base64!', baseVersion: 1 })).toMatchObject({ ok: false, status: 400 });
    expect(parseDeltaLearnRequest({ diff: 'AAA', baseVersion: 1 })).toMatchObject({ ok: false, status: 400 });
  });

  it('bounds the payload: over the cap is a 413', () => {
    const huge = 'A'.repeat(MAX_DELTA_B64_CHARS + 4);
    expect(parseDeltaLearnRequest({ diff: huge, baseVersion: 1 })).toMatchObject({ ok: false, status: 413 });
  });

  it('drops a non-positive weight rather than letting it void the contribution', () => {
    const r = parseDeltaLearnRequest({ diff: 'AAAA', baseVersion: 1, weight: -2 });
    expect(r.ok && r.request.weight).toBeUndefined();
  });
});

describe('admitDeltaAgainstHead', () => {
  it('admits a delta taken against the current head', () => {
    expect(admitDeltaAgainstHead({ baseVersion: 8 }, { version: 8, mode: 'connected' })).toBeNull();
  });

  it('refuses a stale base with 409 AND the head to rebase onto', () => {
    expect(admitDeltaAgainstHead({ baseVersion: 7 }, { version: 8, mode: 'connected' }))
      .toEqual({ status: 409, body: expect.objectContaining({ headVersion: 8 }) });
  });

  it('answers unseeded and frozen before stale — neither is fixed by rebasing', () => {
    const unseeded = admitDeltaAgainstHead({ baseVersion: 3 }, { version: 0, mode: 'connected' });
    expect(unseeded?.status).toBe(409);
    expect(unseeded?.body.headVersion).toBeUndefined();
    expect(admitDeltaAgainstHead({ baseVersion: 2 }, { version: 3, mode: 'offline-frozen' })?.status).toBe(423);
  });
});

describe('deltaUnusableReason', () => {
  const base = new ArrayBuffer(16); // body of 4 f32 elements once the trailer is stripped

  it('passes an element-granular in-range finite delta', () => {
    engine.verifyCrcTrailer.mockReturnValue({ body: base });
    engine.deserializeRowDelta.mockReturnValue({ rowSize: 1, rows: [0, 3], data: new Float32Array([1, 2]) });
    expect(deltaUnusableReason(decodeDeltaB64('AAAA'), base)).toBeNull();
  });

  it('names what is wrong with a delta that is not a diff of this base', () => {
    engine.verifyCrcTrailer.mockReturnValue({ body: base });
    engine.deserializeRowDelta.mockReturnValueOnce({ rowSize: 4, rows: [0], data: new Float32Array(4) });
    expect(deltaUnusableReason(new ArrayBuffer(3), base)).toMatch(/rowSize 1/);
    engine.deserializeRowDelta.mockReturnValueOnce({ rowSize: 1, rows: [4], data: new Float32Array([1]) });
    expect(deltaUnusableReason(new ArrayBuffer(3), base)).toMatch(/outside the base/);
    engine.deserializeRowDelta.mockReturnValueOnce({ rowSize: 1, rows: [1], data: new Float32Array([Number.NaN]) });
    expect(deltaUnusableReason(new ArrayBuffer(3), base)).toMatch(/non-finite/);
    engine.deserializeRowDelta.mockImplementationOnce(() => { throw new Error('bad magic'); });
    expect(deltaUnusableReason(new ArrayBuffer(3), base)).toMatch(/not a serialized RowDelta: bad magic/);
  });
});
