/**
 * The editor chat's connected-accounts port: the shared client
 * (`@builderforce/provider-connect`) over the webview's own bearer call, and the
 * provider's sign-in page opened in the person's browser by the host (`open.external`).
 * The composer's Status tab lists, tests and reconnects through it — the same section
 * the web app and Rovr show.
 */
import { createProviderConnectionsClient } from '@builderforce/provider-connect';
import type { ComposerConnections } from '@seanhogg/builderforce-brain-ui';
import { authedGateway } from './authedFetch';
import { getToken, post, refreshToken } from './vscodeBridge';

export function editorConnections(baseUrl: string): ComposerConnections {
  return {
    client: createProviderConnectionsClient(authedGateway(baseUrl, getToken, refreshToken)),
    openUrl: (url) => post('open.external', { url }),
  };
}
