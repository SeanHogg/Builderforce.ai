/**
 * The web app's connected-accounts port — the shared client (`@builderforce/provider-connect`)
 * over the app's gateway call, with a provider's sign-in page opened in a new tab. The
 * composer's Status tab and the settings card both reconnect through this one object.
 */
import { createProviderConnectionsClient } from '@builderforce/provider-connect';
import type { ComposerConnections } from '@seanhogg/builderforce-brain-ui';
import { gatewayRequest } from './gatewayRequest';

export const webConnections: ComposerConnections = {
  client: createProviderConnectionsClient(gatewayRequest),
  openUrl: (url) => { window.open(url, '_blank', 'noopener,noreferrer'); },
};
