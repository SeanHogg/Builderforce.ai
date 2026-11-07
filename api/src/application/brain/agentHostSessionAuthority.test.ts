import { describe, expect, it } from 'vitest';
import { agentHostSessionOwnedBy } from './agentHostSessionAuthority';

const dbWith = (rows: Array<{ registeredBy: string | null }>) => ({
  select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => rows }) }) }) }),
}) as never;

describe('agentHostSessionOwnedBy', () => {
  it('is true for the member who registered the host', async () => {
    expect(await agentHostSessionOwnedBy(dbWith([{ registeredBy: 'u1' }]), 1, 4, 'u1')).toBe(true);
  });
  it('is false for any other member, a missing session, or no user', async () => {
    expect(await agentHostSessionOwnedBy(dbWith([{ registeredBy: 'u1' }]), 1, 4, 'u2')).toBe(false);
    expect(await agentHostSessionOwnedBy(dbWith([]), 1, 4, 'u1')).toBe(false);
    expect(await agentHostSessionOwnedBy({} as never, 1, 4, null)).toBe(false);
  });
});
