/**
 * The web app's authenticated API call in the shape `@builderforce/provider-connect` takes:
 * a refusal comes back as its status and `{ code, error }` instead of throwing, because the
 * connect flow decides on WHICH refusal it got (`oauth_denied`, `oauth_state_expired`, …).
 *
 * Built over `request` so it carries the same headers (emulation, locale) as every other
 * call. Anything that is not an API answer — offline, aborted — still throws, which the
 * package treats as "no answer, try again".
 */
import type { GatewayRequest } from '@builderforce/provider-connect';
import { ApiRequestError } from './apiClient';
import { request } from './builderforceApi';

export const gatewayRequest: GatewayRequest = async (path, init) => {
  try {
    const body = await request<unknown>(path, {
      method: init?.method ?? 'GET',
      ...(init?.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    return { status: 200, body };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return { status: error.status, body: { code: error.code, error: error.message } };
    }
    throw error;
  }
};
