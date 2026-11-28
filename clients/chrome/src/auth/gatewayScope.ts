import { GATEWAY_WORKSPACE_HEADER } from '@builderforce/device-auth';
import type { ApiFetch } from '../api/apiClient';
import type { Session } from './session';

/** Pin a gateway request to the workspace active when its caller prepared it. */
export function scopedGatewayFetch(
  session: Pick<Session, 'scope' | 'tenantId' | 'key'>,
  fetch: ApiFetch,
  workspaceChanged: () => string = () => 'The gateway workspace changed',
): ApiFetch {
  const scope = session.scope();
  const tenantId = session.tenantId();
  const key = session.key();
  return async (url, init) => {
    const originalKey = await key;
    if (!originalKey || originalKey !== await session.key() || session.scope() !== scope || tenantId === null) {
      throw new Error(workspaceChanged());
    }
    const headers = new Headers(init?.headers);
    headers.set(GATEWAY_WORKSPACE_HEADER, Str