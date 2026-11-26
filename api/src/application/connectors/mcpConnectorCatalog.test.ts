import { expect, it, vi } from 'vitest';
import { listMcpConnectorCatalog } from './mcpConnectorCatalog';

vi.mock('./connectorRegistry', () => ({
  listPublishedConnectors: async () => [
    { manifest: { key: 'github', name: 'GitHub' } },
    { manifest: { key: 'http-only', name: 'HTTP only' } },
  ],
}));

it('merges credential-specific HTTP and local launch options into one provider offer', async () => {
  const catalog = await listMcpConnectorCatalog({} as never, 1, {} as never);
  expect(catalog.filter((offer) => offer.id === 'github')).toEqual([
    expect.objectContaining({
      transports: [
        { transport: 'http', connectorKey: 'github' },
        expect.objectContaining({ transport: 'stdio', inputs: [{ kind: 'secret', key: 'GITHUB_PERSONAL_ACCESS_TOKEN', required: true }] }),
      ],
    }),
  ]);
  expect(catalog.find((offer) => offer.id === 'filesystem')?.transports).toHaveLength(1);
  expect(catalog.find((offer) => offer.id === 'http-only')?.transports).toEqual([{ transport: 'http', connectorKey: 'http-only' }]);
});
