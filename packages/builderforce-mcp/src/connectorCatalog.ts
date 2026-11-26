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
