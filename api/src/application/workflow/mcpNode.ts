/** Compatibility exports for consumers of the original workflow executor. */
export { executeDataProviderNode as executeMcpNode, providerIdFromConfig, resolveParams } from './dataProviderNode';
export type {
  DataProviderNodeConfig as McpNodeConfig,
  DataProviderNodeContext as McpNodeContext,
  DataProviderNodeOutcome as McpNodeOutcome,
} from './dataProviderNode';
