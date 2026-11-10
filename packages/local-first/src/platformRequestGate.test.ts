import { describe, expect, it } from 'vitest';
import { resolveInferencePolicy, type InferenceMode } from './inferenceMode.js';
import { createPlatformPolicy, platformReachable, platformSendPermission, type PlatformPolicySnapshot } from './policy.js';
import { platformRequestRefusal } from './platformRequestGate.js';

const stance = (mode: InferenceMode, overrides: Partial<PlatformPolicySnapshot> = {}) => {
  const { snapshot } = resolveInferencePolicy({ mode, signedIn: true, overrides });
  return { mode, snapshot };
};
const refusal = (method: string, pathname: string, mode: InferenceMode, overrides?: Partial<PlatformPolicySnapshot>) =>
  platformRequestRefusal({ pathname, method }, stance(mode, overrides));

describe('the ONE platform request gate', () => {
  it("lets a signed-in Hybrid run's ordinary writes, reads and stream through with sync off", () => {
    // The 2026.10.57 editor refused these where the web let them go. Sync is on by default in
    // Hybrid, so "sync off" is the person's explicit override.
    const off = { synchronize: false };
    expect(refusal('POST', '/api/brain/chats', 'hybrid', off)).toBeNull();
    expect(refusal('POST', '/api/projects/11/tickets', 'hybrid', off)).toBeNull();
    expect(refusal('PATCH', '/api/tasks/5', 'hybrid', off)).toBeNull();
    expect(refusal('POST', '/api/brain/chats/3/messages', 'hybrid', off)).toBeNull();
    expect(refusal('POST', '/api/brain/stream', 'hybrid', off)).toBeNull();
    expect(refusal('POST', '/llm/v1/chat/completions', 'hybrid', off)).toBeNull();
    expect(refusal('POST', '/api/limbic/block', 'hybrid', off)).toBeNull();
    expect(refusal('POST', '/api/projects/11/evermind/recall', 'hybrid', off)).toBeNull();
    expect(refusal('GET', '/api/projects', 'hybrid', off)).toBeNull();
  });

  it('holds the named sync transport to the sync switch in every mode', () => {
    // Connected modes sync by default (chat #70776); an explicit "off" refuses the transport.
    expect(refusal('POST', '/api/sync/v1/push', 'hybrid')).toBeNull();
    expect(refusal('POST', '/api/sync/v1/push', 'specific')).toBeNull();
    expect(refusal('POST', '/api/sync/v1/push', 'hybrid', { synchronize: false })).toBe('synchronize');
    expect(refusal('GET', '/api/sync/v1/pull', 'hybrid', { synchronize: false })).toBe('synchronize');
    expect(refusal('POST', '/api/sync/v1/push', 'specific', { synchronize: false })).toBe('synchronize');
    expect(refusal('POST', '/api/sync/v1/push', 'local-only', { synchronize: true })).toBe('synchronize');
  });

  it('Local only refuses gateway inference and every content-carrying request, and nothing else', () => {
    expect(refusal('POST', '/llm/v1/chat/completions', 'local-only')).toBe('gateway-inference');
    expect(refusal('POST', '/api/brain/stream', 'local-only')).toBe('gateway-inference');
    expect(refusal('POST', '/api/limbic/block', 'local-only')).toBe('connected-feature');
    expect(refusal('POST', '/api/brain/chats/3/messages', 'local-only')).toBe('synchronize');
    expect(refusal('POST', '/api/brain/upload', 'local-only')).toBe('synchronize');
    expect(refusal('GET', '/api/projects', 'local-only')).toBeNull();
    expect(refusal('POST', '/api/auth/tenant-api-key-token', 'local-only')).toBeNull();
  });

  it('keeps an advanced override that refuses a capability', () => {
    expect(refusal('POST', '/llm/v1/chat/completions', 'hybrid', { gatewayInference: false })).toBe('gateway-inference');
    expect(refusal('GET', '/api/projects', 'hybrid', { connectedFeatures: false })).toBe('connected-feature');
  });
});

describe('the durable outbox send gate', () => {
  it('is open whenever the mode reaches the platform, not only when sync is on', () => {
    expect(platformReachable(stance('hybrid').snapshot)).toBe(true);
    expect(platformReachable(stance('specific').snapshot)).toBe(true);
    expect(platformReachable(stance('local-only').snapshot)).toBe(false);
    const policy = createPlatformPolicy(stance('hybrid', { synchronize: false }).snapshot);
    expect(policy.allows('synchronize')).toBe(false);
    expect(platformSendPermission(policy).isAllowed()).toBe(true);
    const seen: boolean[] = [];
    platformSendPermission(policy).subscribe((allowed) => seen.push(allowed));
    policy.set(stance('local-only').snapshot);
    expect(seen).toEqual([false]);
  });
});
