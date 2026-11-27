export {
  fromMcp,
  normalizeInputSchema,
  requiresWriteApproval,
  toAnthropic,
  toMcp,
  toOpenAI,
} from "./tool.js";
export type { McpToolEntry, RelayToolEntry, ToolEffect, ToolInputSchema } from "./tool.js";
export { advertiseName, resolveName } from "./naming.js";
export {
  createMcpCatalogCache,
  createMcpRelay,
  mcpCallRequest,
  mcpCatalogPath,
  platformWireToolName,
  readMcpRelayCatalog,
  relayModelText,
  toRelayModelTool,
  MCP_CALL_PATH,
  MCP_CATALOG_TTL_MS,
  PLATFORM_EXTENSION_ID,
} from "./relay.js";
export type { RelayCallResult, RelayCatalog, RelayToolCall } from "./relay.js";
export type { ConnectorOffer, ConnectorTransport, StdioConnectorInput } from "./connectorCatalog.js";
