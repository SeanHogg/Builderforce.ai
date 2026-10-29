/** personOf: ONE rule for "is the caller a person" — the tenant door, not a machine token. */
import { describe, expect, it } from 'vitest';
import type { Context } from 'hono';
import { personOf } from './personOf';

const ctx = (vars: Record<string, unknown>): Context => ({ get: (k: string) => vars[k] }) as unknown as Context;

describe('personOf', () => {
  it('is the user behind a tenant-door request', () => {
    expect(personOf(ctx({ userId: 'u1' }), { agentHost: false })).toBe('u1');
  });
  it('is nobody behind the agent-host key door', () => {
    expect(personOf(ctx({ userId: 'agentHost:17' }), { agentHost: true })).toBeNull();
  });
  it('is nobody for a machine token, even through the tenant door', () => {
    expect(personOf(ctx({ userId: 'agentHost:17', machineActor: { kind: 'agent_host', agentHostId: 17 } }), { agentHost: false })).toBeNull();
  });
  it('is nobody when no user was published', () => {
    expect(personOf(ctx({}), { agentHost: false })).toBeNull();
  });
});
