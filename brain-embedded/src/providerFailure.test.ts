import { describe, expect, it } from 'vitest';
import { initialRunPolicy, reduceRunPolicy } from '@builderforce/run-policy';
import { brainRequestError } from './chatError';
import { providerFailureEvent } from './providerFailure';
import { RepetitionLoopError, StreamInterruptedError, TransportError } from './streamChatCompletion';

describe('providerFailureEvent — the one classification every browser loop reports', () => {
  it('reports a model that broke mid-answer as interrupted, naming it', () => {
    const error = new StreamInterruptedError('the model failed mid-answer: Upstream error from Nvidia: Service temporarily overloaded', 'nvidia/nemotron');
    expect(providerFailureEvent(error)).toEqual({ type: 'transport_failed', kind: 'interrupted', model: 'nvidia/nemotron' });
  });

  it('reports a repetition loop as an interruption of that model', () => {
    const error = new RepetitionLoopError({ block: 'again', copies: 3, kept: 'said' }, 'free/model');
    expect(providerFailureEvent(error)).toEqual({ type: 'transport_failed', kind: 'interrupted', model: 'free/model' });
  });

  it('omits the model when the stream never learned it', () => {
    expect(providerFailureEvent(new StreamInterruptedError('the gateway sent nothing for 75s', undefined))).toEqual({ type: 'transport_failed', kind: 'interrupted' });
  });

  it('tells a reached-gateway failure from an unreachable one', () => {
    expect(providerFailureEvent(new TransportError('reset'))).toEqual({ type: 'transport_failed', kind: 'transport' });
    expect(providerFailureEvent(new TransportError('refused', undefined, { unreachable: true }))).toEqual({ type: 'transport_failed', kind: 'unreachable' });
  });

  it('leaves every other error to surface as it is', () => {
    expect(providerFailureEvent(new Error('402: needs a validated card'))).toBeNull();
    expect(providerFailureEvent(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBeNull();
  });

  it('reports an HTTP status the gateway answered with, so run-policy can act on it', () => {
    for (const status of [413, 429, 503, 500, 502, 408]) {
      expect(providerFailureEvent(brainRequestError(status, { error: 'upstream' }))).toEqual({ type: 'transport_failed', kind: 'transport', status });
    }
    // A declining backend's 400 is reported: the policy decides whether it is a decline.
    expect(providerFailureEvent(brainRequestError(400, { error: 'declined' }))).toEqual({ type: 'transport_failed', kind: 'transport', status: 400 });
  });

  it('leaves a refused request (auth, entitlement, not found) to surface as it is', () => {
    for (const status of [401, 402, 403, 404, 422]) {
      expect(providerFailureEvent(brainRequestError(status, { error: 'refused', code: 'needs_card' }))).toBeNull();
    }
  });

  it('a 429 on a releasable pin releases it and retries — the policy firing in the browser', () => {
    const event = providerFailureEvent(brainRequestError(429, { error: 'rate limited' }))!;
    const s = reduceRunPolicy(initialRunPolicy({ pinnedModel: 'opus', strictPin: true, pinReleasable: true }), event);
    expect(s.outcome).toEqual({ kind: 'retry_turn', released: 'opus', status: 429 });
  });
});

