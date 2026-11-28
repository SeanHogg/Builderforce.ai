import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { DeviceAuthService } from './DeviceAuthService';
import { mintTenantApiKey } from '../llm/tenantApiKeyService';

vi.mock('../llm/tenantApiKeyService', () => ({ mintTenantApiKey: vi.fn() }));
vi.mock('../../infrastructure/auth/MfaService', () => ({
  decryptSecretFromStorage: async () => 'fixture-key',
}));

describe('device credentials', () => {
  it('verifies active membership in the requested workspace before minting', async () => {
    const where = vi.fn().mockReturnValue({ limit: async () => [] });
    const db = { select: () => ({ from: () => ({ where }) }) } as unknown as Db;
    const service = new DeviceAuthService(db);

    await expect(service.mintEditorKey({ userId: 'fixture-user', tenantId: 7 }))
      .resolves.toEqual({ ok: false, error: 'no_tenant' });
    const condition = new PgDialect().sqlToQuery(where.mock.calls[0]![0]);
    expect(condition.params).toEqual(['fixture-user', true, 7]);
    expect(mintTenantApiKey).not.toHaveBeenCalled();
  });

  it('returns a credential only when the database acknowledges the claim', async () => {
    const row = {
      id: 1,
      status: 'approved',
      expiresAt: new Date(Date.now() + 60_000),
      lastPolledAt: null,
      intervalSecs: 5,
      issuedKeyEnc: 'fixture-ciphertext',
      tenantId: 7,
    };
    const returning = vi.fn().mockResolvedValueOnce([{ id: row.id }]).mockResolvedValueOnce([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
      update: () => ({ set }),
    } as unknown as Db;
    const service = new DeviceAuthService(db);

    const outcomes = await Promise.all([
      service.poll('fixture-device', 'fixture-secret'),
      service.poll('fixture-device', 'fixture-secret'),
    ]);
    expect(outcomes).toEqual(expect.arrayContaining([
      { state: 'approved', accessKey: 'fixture-key', tenantId: 7 },
      { state: 'expired' },
    ]));
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'claimed', issuedKeyEnc: null }));
    const condition = new PgDialect().sqlToQuery(where.mock.calls[0]![0]);
    expect(condition.params).toEqual([row.id, row.status, row.issuedKeyEnc]);
  });
});
