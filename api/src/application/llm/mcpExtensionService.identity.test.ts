import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { updateMcpExtension } from './mcpExtensionService';
import { unchangedMcpAuthorization } from './mcp/mcpExtensionAuth';

const url = 'https://old.example/mcp';
const row = {
  id: 'server-1', tenantId: 1, name: 'Server', serverUrl: url,
  secretEnc: 'old-secret', oauthEnc: 'old-registration', tokenEnc: 'old-grant',
  oauthConnectedAt: new Date(0), createdAt: new Date(0), protocol: 'mcp',
  allowedTools: ['old_tool'], enabled: true,
};

function fakeDb() {
  const set = vi.fn((patch: object) => ({
    where: () => ({ returning: async () => [{ ...row, ...patch }] }),
  }));
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
    update: () => ({ set }),
  } as unknown as Db;
  return { db, set };
}

describe('tenant MCP endpoint identity', () => {
  it('keeps credentials for an unchanged endpoint', async () => {
    const { db, set } = fakeDb();
    const result = await updateMcpExtension(db, { tenantId: 1, id: row.id, name: 'Renamed', serverUrl: url, keyMaterial: 'test' });
    expect(set.mock.calls[0]?.[0]).toEqual({ name: 'Renamed', serverUrl: url });
    expect(result).toMatchObject({ hasSecret: true, authKind: 'oauth', protocol: 'mcp', allowedTools: ['old_tool'] });
  });

  it('clears former credentials and consent when moving to another endpoint', async () => {
    const { db, set } = fakeDb();
    const serverUrl = 'https://new.example/mcp';
    const result = await updateMcpExtension(db, { tenantId: 1, id: row.id, serverUrl, keyMaterial: 'test' });
    expect(set.mock.calls[0]?.[0]).toEqual({
      serverUrl, secretEnc: null, oauthEnc: null, oauthIv: null, tokenEnc: null, tokenIv: null,
      oauthConnectedAt: null, protocol: 'auto', allowedTools: [],
    });
    expect(result).toMatchObject({ serverUrl, transport: 'http', hasSecret: false, authKind: 'none', allowedTools: [] });
  });

  it('binds in-flight authorization writes to the original endpoint and sealed state', () => {
    const where = unchangedMcpAuthorization(row);
    const query = new PgDialect().sqlToQuery(where as SQL);
    expect(query.sql).toContain('"tenant_mcp_extensions"."server_url" =');
    expect(query.params).toEqual([row.id, row.tenantId, row.serverUrl, row.oauthEnc, row.tokenEnc]);
  });
});
