/**
 * The editor chat's connected-accounts port: the shared client
 * (`@builderforce/provider-connect`) over the webview's own bearer call, and the
 * provider's sign-in page opened in the person's browser by the host (`open.external`).
 * The composer's Status tab lists, tests and reconnects through it — the same section
 * the web app and Rovr show.
 */
import { createProviderConnectionsClient, type ProviderTestResult } from '@builderforce/provider-connect';
import type { ComposerConnections } from '@seanhogg/builderforce-brain-ui';
import { authedGateway } from './authedFetch';
import { getToken, post, refreshToken, request } from './vscodeBridge';

export function editorConnections(baseUrl: string): ComposerConnections {
  return {
    // Test of an account the editor calls itself (Kimi Code) runs on the host, from this
    // machine (`connections.testLocally`); every other provider gets the gateway's Test.
    client: createProviderConnectionsClient(authedGateway(baseUrl, getToken, refreshToken), undefined, {
      testLocally: (provider) => request<ProviderTestResult | null>('connections.testLocally', { provider }),
    }),
    openUrl: (url) => post('open.external', { url }),
  };
}
