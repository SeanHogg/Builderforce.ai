export type StdioConnectorInput =
  | { kind: "folder"; required: true }
  | { kind: "secret" | "text"; key: string; required: true };

export type ConnectorTransport =
  | { transport: "http"; connectorKey: string }
  | {
      transport: "stdio";
      /** Package and fixed arguments following `npx -y`. The host owns process launch. */
      npx: readonly string[];
      inputs: readonly StdioConnectorInput[];
      docsUrl: string;
    };

export interface ConnectorOffer {
  id: string;
  name: string;
  transports: ConnectorTransport[];
}

export const CONNECTOR_EXTENSION_ID = "connector";
const TOOL_SEPARATOR = "::";

/** The connector action address sent to the REST relay. */
export function encodeConnectorTool(connectorKey: string, actionKey: string): string {
  return `${connectorKey}${TOOL_SEPARATOR}${actionKey}`;
}

export function decodeConnectorTool(tool: string): { connectorKey: string; actionKey: string } | null {
  const index = tool.indexOf(TOOL_SEPARATOR);
  if (index <= 0) return null;
  const actionKey = tool.slice(index + TOOL_SEPARATOR.length);
  return actionKey ? { connectorKey: tool.slice(0, index), actionKey } : null;
}
