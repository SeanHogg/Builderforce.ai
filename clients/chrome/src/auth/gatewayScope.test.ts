import { expect, it, vi } from 'vitest';
import { GATEWAY_WORKSPACE_HEADER } from '@builderforce/device-auth';
import type { ApiFetch } from '../api/apiClient';
import { scopedGatewayFetch } from './gatewayScope';

it('keeps the workspace on the wire and refuses to re-use the request after a switch', async () => {
  let tenantId = 7;
  const session = { tenantId: () => tenantId, scope: () => `tenant:${tenantId}`, key: async () => 'device-key' };
  const fetch = vi.fn<ApiFetch>().mockResolvedValue(new Response(null, { status: 204 }));
  const send = scopedGatewayFetch(session, fetch);

  await send('https://example.test/llm/v1/mcp/call', { headers: { authorization: 'Bearer fixture' } });
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(GATEWAY_WORKSPACE_HEADER)).toBe('7');
  tenantId = 8;
  await expect(send('https://example.test/llm/v1/mcp/call')).rejects.toThrow('workspace changed');
  expect(fetch).toHaveBeenCalledOnce();
});
