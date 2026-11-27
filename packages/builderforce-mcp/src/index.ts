export {
  fromMcp,
  normalizeInputSchema,
  requiresWriteApproval,
  toAnthropic,
  toMcp,
  toOpenAI,
} from "./tool.js";
export type { McpToolEntry, RelayToolEntry, ToolEffect, ToolInputSchema } from "./tool.js";
export { advertiseName, legacyExtensionToolName, resolveName, toolWireNameCodec } from "./naming.js";
export {
  createMcpCatalogCache,
  createMcpRelay,
  mcpCallRequest,
  mcpCatalogPath,
  platformWireToolName,
  relayDispatchCatalog,
  readMcpRelayCatalog,
  relayModelText,
  toRelayModelTool,
  MCP_CALL_PATH,
  MCP_CATALOG_TTL_MS,
  PLATFORM_EXTENSION_ID,
} from "./relay.js";
export type { RelayCallResult, RelayCatalog, RelayDispatchToolEntry, RelayToolCall } from "./relay.js";
export type { ConnectorOffer, ConnectorTransport, StdioConnectorInput } from "./connectorCatalog.js";
export { CONNECTOR_EXTENSION_ID, decodeConnectorTool, encodeConnectorTool } from "./connectorCatalog.js";
export { isRemoteMcpEndpoint } from "./endpoint.js";
