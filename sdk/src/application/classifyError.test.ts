import { describe, expect, it } from 'vitest';
import { classifyError } from './classifyError';
import { BuilderforceApiError } from '../infrastructure/httpClient';

/** Build a BuilderforceApiError the way httpClient.toApiError would, exercising
 *  the `details.failovers` extraction. */
function apiError(
  status: number,
  code?: string,
  extras?: { terminal?: boolean; retryAfter?: number },
  details?: unknown,
): BuilderforceApiError {
  return new BuilderforceApiError('boom', status, code, details, undefined, extras);
}

describe('classifyError', () => {
  it('classifies schema_too_complex as terminal + non-retryable', () => {
    const c = classifyError(apiError(422, 'schema_too_complex', { terminal: true }));
    expect(c.kind).toBe('schema_too_complex');
    expect(c.terminal).toBe(true);
    expect(c.retryable).toBe(false);
  });

  it('recognises a schema rejection from the failover breakdown even without a top-level code', () => {
    const err = apiError(422, undefined, { terminal: true }, {
      failovers: [{ model: 'gemini', vendor: 'googleai', code: 422, kind: 'schema', reason: 'schema_too_complex', upstreamStatus: 400 }],
    });
    const c = classifyError(err);
    expect(c.kind).toBe('schema_too_complex');
    expect(c.terminal).toBe(true);
  });

  it('classifies token-cap codes as terminal token_cap', () => {
    for (const code of ['plan_token_limit_exceeded', 'plan_monthly_token_limit_exceeded', 'claw_token_limit_exceeded', 'image_credit_limit_exceeded']) {
      const c = classifyError(apiError(429, code, { terminal: true, retryAfter: 3600 }));
      expect(c.kind).toBe('token_cap');
      expect(c.terminal).toBe(true);
      expect(c.retryable).toBe(false);
      expect(c.retryAfter).toBe(3600);
    }
  });

  it('classifies a plain 429 cascade_exhausted as retryable rate_limit (not terminal)', () => {
    const c = classifyError(apiError(429, undefined));
    expect(c.kind).toBe('rate_limit');
    expect(c.terminal).toBe(false);
    expect(c.retryable).toBe(true);
  });

  it('classifies timeout / service_unavailable as retryable', () => {
    expect(classifyError(apiError(408, 'timeout')).retryable).toBe(true);
    expect(classifyError(apiError(503, 'worker_subrequest_exhausted')).retryable).toBe(true);
    expect(classifyError(apiError(502)).kind).toBe('service_unavailable');
  });

  it('classifies auth / invalid_request as terminal', () => {
    expect(classifyError(apiError(401, 'missing_api_key')).kind).toBe('auth');
    expect(classifyError(apiError(401, 'missing_api_key')).terminal).toBe(true);
    expect(classifyError(apiError(400)).kind).toBe('invalid_request');
    expect(classifyError(apiError(400)).terminal).toBe(true);
  });

  it('classifies model_unavailable as non-terminal (drop the pin)', () => {
    const c = classifyError(apiError(503, 'model_unavailable'));
    expect(c.kind).toBe('model_unavailable');
    expect(c.terminal).toBe(false);
  });

  it('handles non-gateway throws: AbortError, network TypeError, unknown', () => {
    const abort = new Error('aborted'); abort.name = 'AbortError';
    expect(classifyError(abort).kind).toBe('aborted');
    expect(classifyError(abort).terminal).toBe(true);

    const net = new TypeError('Failed to fetch');
    expect(classifyError(net).kind).toBe('network');
    expect(classifyError(net).retryable).toBe(true);

    expect(classifyError({ weird: true }).kind).toBe('unknown');
  });
});
