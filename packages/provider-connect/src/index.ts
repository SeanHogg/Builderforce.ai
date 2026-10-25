/**
 * `@builderforce/provider-connect` — connect a BYO model provider's subscription through
 * the gateway, and use it from the person's own machine. See `connect.ts` (the connect
 * flow) and `localCredential.ts` (the short-lived token a local runtime sends).
 */
export type { GatewayRequest } from './port.js';
export {
  DEVICE_APPROVAL_WINDOW_MS,
  ProviderConnectError,
  awaitDeviceApproval,
  startProviderConnect,
  type DeviceApprovalDeps,
  type ProviderConnectFailure,
  type ProviderConnectStart,
} from './connect.js';
export {
  completePasteConnect,
  connectionHealth,
  createProviderConnectionsClient,
  listProviderConnections,
  testProviderConnection,
  type ConnectionHealth,
  type ProviderConnection,
  type ProviderConnectionsClient,
  type ProviderTestResult,
} from './connections.js';
export {
  LOCAL_CREDENTIAL_REFRESH_MARGIN_MS,
  createLocalCredentialStore,
  fetchLocalCredential,
  parseLocalCredential,
  type CredentialStringStore,
  type LocalCredential,
  type LocalCredentialModel,
  type LocalCredentialOutcome,
  type LocalCredentialStore,
} from './localCredential.js';
