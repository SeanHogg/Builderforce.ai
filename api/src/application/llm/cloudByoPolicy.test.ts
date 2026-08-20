/**
 * GAP-B2 / GAP-B4 — a cloud agent execution must never silently bill the platform
 * key when the workspace's own provider credential is missing or unusable.
 *
 * These cover the pure policy: which requests the rule applies to, and how a
 * resolved (or unresolvable) credential is classified into the two typed codes.
 * The gateway wiring is covered in `presentation/routes/llmRoutes.test.ts`
 * ("POST /v1/messages cloud-agent BYO gate").
 */
import { describe, expect, it } from 'vitest';
import {
  isCloudAgentExecutionRequest,
  cloudExecutionIdFromRequest,
  classifyCloudByoAnthropic,
  assertCloudRunByo,
  cloudByoFailureBody,
  CLOUD_BYO_FAILURE_STATUS,
  CLOUD_SURFACE_HEADER,
  CLOUD_EXECUTION_HEADER,
} from './cloudByoPolicy';
import type { TenantLlmCredentials } from './tenantProviderKeyService';

function headers(h: Record<string, string>) {
  return (name: string) => h[name];
}

function creds(over: Partial<TenantLlmCredentials> = {}): TenantLlmCredentials {
  return {
    anthropicOAuthToken: null,
    openaiCodexAuth: null,
    xaiOAuthToken: null,
    vendorKeys: {},
    configuredProviders: [],
    unresolvedReasons: {},
    vendorPriority: [],
    ...over,
  } as TenantLlmCredentials;
}

describe('isCloudAgentExecutionRequest — the ONE discriminator for the rule', () => {
  it('matches a declared cloud execution', () => {
    expect(isCloudAgentExecutionRequest(headers({
      [CLOUD_SURFACE_HEADER]: 'cloud',
      [CLOUD_EXECUTION_HEADER]: '42',
    }))).toBe(true);
  });

  it('is case/whitespace tolerant on the surface value', () => {
    expect(isCloudAgentExecutionRequest(headers({
      [CLOUD_SURFACE_HEADER]: ' Cloud ',
      [CLOUD_EXECUTION_HEADER]: '7',
    }))).toBe(true);
  });

  it('does NOT match ordinary gateway traffic (web chat, VSIX, on-prem host)', () => {
    expect(isCloudAgentExecutionRequest(headers({}))).toBe(false);
    expect(isCloudAgentExecutionRequest(headers({ [CLOUD_SURFACE_HEADER]: 'web', [CLOUD_EXECUTION_HEADER]: '42' }))).toBe(false);
    expect(isCloudAgentExecutionRequest(headers({ [CLOUD_SURFACE_HEADER]: 'vsix', [CLOUD_EXECUTION_HEADER]: '42' }))).toBe(false);
    expect(isCloudAgentExecutionRequest(headers({ [CLOUD_SURFACE_HEADER]: 'on_prem', [CLOUD_EXECUTION_HEADER]: '42' }))).toBe(false);
  });

  it('needs a real execution id — a bare surface hint is attribution, not policy', () => {
    expect(isCloudAgentExecutionRequest(headers({ [CLOUD_SURFACE_HEADER]: 'cloud' }))).toBe(false);
    expect(isCloudAgentExecutionRequest(headers({ [CLOUD_SURFACE_HEADER]: 'cloud', [CLOUD_EXECUTION_HEADER]: 'abc' }))).toBe(false);
    expect(isCloudAgentExecutionRequest(headers({ [CLOUD_SURFACE_HEADER]: 'cloud', [CLOUD_EXECUTION_HEADER]: '0' }))).toBe(false);
    expect(isCloudAgentExecutionRequest(headers({ [CLOUD_SURFACE_HEADER]: 'cloud', [CLOUD_EXECUTION_HEADER]: '-3' }))).toBe(false);
  });

  it('exposes the execution id so a refusal is attributable to the run', () => {
    expect(cloudExecutionIdFromRequest(headers({ [CLOUD_EXECUTION_HEADER]: '91' }))).toBe(91);
    expect(cloudExecutionIdFromRequest(headers({}))).toBeNull();
  });
});

describe('classifyCloudByoAnthropic — the two typed outcomes', () => {
  it('BYO api key present → the tenant credential serves the run', () => {
    const gate = classifyCloudByoAnthropic({ auth: { mode: 'api_key', key: 'sk-ant-x' } });
    expect(gate).toEqual({ ok: true, auth: { mode: 'api_key', key: 'sk-ant-x' } });
  });

  it('a connected subscription counts as BYO too', () => {
    const gate = classifyCloudByoAnthropic({ auth: { mode: 'oauth', accessToken: 'tok' } });
    expect(gate.ok).toBe(true);
  });

  it('nothing connected → byo_key_missing (never a platform-key fallback)', () => {
    const gate = classifyCloudByoAnthropic({ auth: null });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.code).toBe('byo_key_missing');
    expect(gate.provider).toBe('anthropic');
    expect(gate.reason).toBeUndefined();
    expect(gate.message).toMatch(/no Anthropic provider is connected/i);
  });

  it.each(['undecryptable', 'revoked', 'expired', 'lookup_failed', 'unsupported-auth'] as const)(
    'a connected-but-unusable credential (%s) → byo_key_error carrying the reason',
    (reason) => {
      const gate = classifyCloudByoAnthropic({ auth: null, reason });
      expect(gate.ok).toBe(false);
      if (gate.ok) return;
      expect(gate.code).toBe('byo_key_error');
      expect(gate.reason).toBe(reason);
      // The operator needs the cause, not a raw provider error.
      expect(gate.message).toContain(reason);
    },
  );

  it('encodes a refusal as a typed body on a 402 (billed-to-the-wrong-account, not an auth error)', () => {
    const gate = classifyCloudByoAnthropic({ auth: null, reason: 'revoked' });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(cloudByoFailureBody(gate)).toEqual({
      error: gate.message,
      code: 'byo_key_error',
      provider: 'anthropic',
      reason: 'revoked',
    });
    expect(CLOUD_BYO_FAILURE_STATUS).toBe(402);
  });
});

describe('assertCloudRunByo — the cloud loop pre-flight (GAP-B4)', () => {
  it('allows a workspace that connected NOTHING (cloud runs are a funded platform surface)', () => {
    expect(assertCloudRunByo(creds())).toBeNull();
  });

  it('allows a run where at least one connected provider resolved', () => {
    expect(assertCloudRunByo(creds({
      configuredProviders: ['anthropic', 'openai'],
      vendorKeys: { openai: 'sk-openai' },
      unresolvedReasons: { anthropic: 'revoked' },
    }))).toBeNull();
  });

  it('REFUSES when providers are connected but none resolved — no operator-pool spend', () => {
    const failure = assertCloudRunByo(creds({
      configuredProviders: ['anthropic'],
      unresolvedReasons: { anthropic: 'undecryptable' },
    }));
    expect(failure).not.toBeNull();
    expect(failure!.code).toBe('byo_key_error');
    expect(failure!.provider).toBe('anthropic');
    expect(failure!.reason).toBe('undecryptable');
    expect(failure!.message).toContain('anthropic (undecryptable)');
  });

  it('names EVERY unusable provider so the operator knows what to repair', () => {
    const failure = assertCloudRunByo(creds({
      configuredProviders: ['anthropic', 'openai'],
      unresolvedReasons: { anthropic: 'revoked', openai: 'undecryptable' },
    }));
    expect(failure!.message).toContain('anthropic (revoked)');
    expect(failure!.message).toContain('openai (undecryptable)');
  });

  it('a connected subscription (no api key row) still counts as resolved', () => {
    expect(assertCloudRunByo(creds({
      configuredProviders: ['anthropic'],
      anthropicOAuthToken: 'tok',
    }))).toBeNull();
  });
});
