import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { CLOSE_TOO_LARGE, MAX_STATE_BYTES, StateAdmission } from './collabRoomAdmission';
import { carriesDocumentData, encodeSyncStep1, encodeUpdate } from './collabFrames';
import { createThrottledReporter } from '../../application/observability/throttledReporter';

describe('StateAdmission', () => {
  it('admits frames until persisted size plus accepted-since would pass the ceiling', () => {
    const admission = new StateAdmission(100);
    admission.settle(60);
    expect(admission.admit(30)).toBe(true); // 90
    expect(admission.admit(10)).toBe(true); // 100, exactly at the ceiling
    expect(admission.admit(1)).toBe(false); // 101
  });

  it('does not count a refused frame, and settle re-bases the bound after a persist', () => {
    const admission = new StateAdmission(100);
    expect(admission.admit(101)).toBe(false);
    expect(admission.admit(100)).toBe(true);
    expect(admission.admit(1)).toBe(false);
    admission.settle(40); // the state was persisted at 40 bytes: the accepted-since count restarts
    expect(admission.admit(60)).toBe(true);
    expect(admission.details(5)).toEqual({ stateBytes: 40, pendingBytes: 60, updateBytes: 5 });
  });

  it('pins the ceiling and the close code', () => {
    expect(MAX_STATE_BYTES).toBe(8 * 1024 * 1024);
    expect(CLOSE_TOO_LARGE).toBe(1009);
  });
});

describe('carriesDocumentData', () => {
  it('is false for a step-1 request and true for an update frame', () => {
    const doc = new Y.Doc();
    doc.getText('t').insert(0, 'x');
    expect(carriesDocumentData(encodeSyncStep1(doc))).toBe(false);
    expect(carriesDocumentData(encodeUpdate(Y.encodeStateAsUpdate(doc)))).toBe(true);
  });

  it('is false for an awareness frame', () => {
    expect(carriesDocumentData(new Uint8Array([1, 0]))).toBe(false);
  });
});

describe('createThrottledReporter', () => {
  it('forwards a kind once per interval and tracks kinds independently', () => {
    let clock = 0;
    const calls: string[] = [];
    const report = createThrottledReporter((error) => { calls.push(String(error)); }, 1000, () => clock);
    report('a', 'first', { operation: 'x' });
    report('a', 'dropped', { operation: 'x' });
    report('b', 'other', { operation: 'x' });
    clock = 1000;
    report('a', 'again', { operation: 'x' });
    expect(calls).toEqual(['first', 'other', 'again']);
  });
});
