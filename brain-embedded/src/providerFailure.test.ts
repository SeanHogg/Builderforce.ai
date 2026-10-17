import { describe, expect, it } from 'vitest';
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
});
