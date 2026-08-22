// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ERROR_EVENT, type ApiErrorEvent } from './apiErrorEvent';
import {
  ApiTransportError,
  TRANSPORT_FAILURE_STATUS,
  classifyTransportFailure,
  reportTransportFailure,
  resetTransportFailureWindow,
} from './transportFailure';

function captureEvents(): ApiErrorEvent[] {
  const seen: ApiErrorEvent[] = [];
  window.addEventListener(API_ERROR_EVENT, (e) => seen.push((e as CustomEvent<ApiErrorEvent>).detail));
  return seen;
}

/** What `fetch` actually rejects with when a response never arrives. */
function opaqueFetchRejection(): TypeError {
  return new TypeError('Failed to fetch');
}

describe('classifyTransportFailure', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads a genuine abort as ours, not as an incident', () => {
    expect(classifyTransportFailure(new DOMException('aborted', 'AbortError'))).toBe('aborted');
    expect(classifyTransportFailure({ name: 'AbortError' })).toBe('aborted');
  });

  it('trusts navigator.onLine only in the negative', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(classifyTransportFailure(opaqueFetchRejection())).toBe('offline');
    vi.stubGlobal('navigator', { onLine: true });
    expect(classifyTransportFailure(opaqueFetchRejection())).toBe('unreachable');
  });
});

describe('reportTransportFailure', () => {
  beforeEach(() => {
    resetTransportFailureWindow();
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('puts a status-0 record on the API-error bus so the outage leaves a trace', () => {
    const seen = captureEvents();

    const failure = reportTransportFailure({
      url: 'https://api.builderforce.test/api/auth/login',
      method: 'post',
      error: opaqueFetchRejection(),
    });

    expect(failure).toBeInstanceOf(ApiTransportError);
    expect(failure.reason).toBe('unreachable');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.status).toBe(TRANSPORT_FAILURE_STATUS);
    expect(seen[0]!.code).toBe('unreachable');
    expect(seen[0]!.method).toBe('POST');
  });

  /**
   * The message a person and the Quality feed see must not repeat the browser's
   * own CORS wording. Chasing that wording is what cost the 2026-07-09 incident
   * its diagnosis: the console said CORS, the worker's CORS config was fine, and
   * the actual candidates were never looked at.
   */
  it('never blames CORS, and names what actually could have happened', () => {
    const seen = captureEvents();
    reportTransportFailure({ url: '/x', method: 'GET', error: opaqueFetchRejection() });

    const message = seen[0]!.message;
    expect(message).not.toMatch(/Access-Control-Allow-Origin/i);
    expect(message).toContain('1101/1102');
    expect(message).toMatch(/WAF|challenge/i);
  });

  it('reports an outage ONCE, not once per in-flight request', () => {
    const seen = captureEvents();
    for (let i = 0; i < 20; i += 1) {
      reportTransportFailure({ url: `/api/thing/${i}`, method: 'GET', error: opaqueFetchRejection() });
    }
    expect(seen).toHaveLength(1);
  });

  it('still distinguishes a different reason inside the same window', () => {
    const seen = captureEvents();
    reportTransportFailure({ url: '/a', method: 'GET', error: opaqueFetchRejection() });
    vi.stubGlobal('navigator', { onLine: false });
    reportTransportFailure({ url: '/b', method: 'GET', error: opaqueFetchRejection() });
    expect(seen.map((e) => e.code)).toEqual(['unreachable', 'offline']);
  });

  it('stays silent for a cancelled request', () => {
    const seen = captureEvents();
    const failure = reportTransportFailure({
      url: '/a',
      method: 'GET',
      error: new DOMException('aborted', 'AbortError'),
    });
    expect(failure.reason).toBe('aborted');
    expect(seen).toHaveLength(0);
  });

  it('stays silent when the caller handles the outage itself', () => {
    const seen = captureEvents();
    reportTransportFailure({ url: '/a', method: 'GET', error: opaqueFetchRejection(), silent: true });
    expect(seen).toHaveLength(0);
  });
});
