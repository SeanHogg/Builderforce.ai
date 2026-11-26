import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { listPublishedConnectors } from './connectorRegistry';

type StdioInput =
  | { kind: 'folder'; required: true }
  | { kind: 'secret' | 'text'; key: string; required: true };

type ConnectorTransport =
  | { transport: 'http'; connectorKey: string }
  | {
      transport: 'stdio';
      /** Package and fixed arguments following `npx -y`. The host owns process launch. */
      npx: readonly string[];
      inputs: readonly StdioInput[];
      docsUrl: string;
    };

interface ConnectorOffer {
  id: string;
  name: string;
  transports: ConnectorTransport[];
}

const secret = (key: string): StdioInput => ({ kind: 'secret', key, required: true });

const LOCAL_MCP: readonly {
  id: string;
  name: string;
  npx: readonly string[];
  inputs: readonly StdioInput[];
  docsUrl: string;
}[] = [
  {
    id: 'filesystem', name: 'Filesystem', npx: ['@modelcontextprotocol/server-filesystem'],
    inputs: [{ kind: 'folder', required: true }],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'github', name: 'GitHub', npx: ['@modelcontextprotocol/server-github'],
    inputs: [secret('GITHUB_PERSONAL_ACCESS_TOKEN')],
    docsUrl: 'https://github.com/settings/personal-access-tokens',
  },
  {
    id: 'slack', name: 'Slack', npx: ['@modelcontextprotocol/server-slack'],
    inputs: [secret('SLACK_BOT_TOKEN'), { kind: 'text', key: 'SLACK_TEAM_ID', required: true }],
    docsUrl: 'https://api.slack.com/apps',
  },
  {
    id: 'brave-search', name: 'Brave Search', npx: ['@modelcontextprotocol/server-brave-search'],
    inputs: [secret('BRAVE_API_KEY')],
    docsUrl: 'https://brave.com/search/api/',
  },
  {
    id: 'playwright', name: 'Playwright', npx: ['@playwright/mcp@latest'], inputs: [],
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    id: 'context7', name: 'Context7', npx: ['@upstash/context7-mcp'], inputs: [],
    docsUrl: 'https://github.com/upstash/context7',
  },
  {
    id: 'sequential-thinking', name: 'Sequential Thinking',
    npx: ['@modelcontextprotocol/server-sequential-thinking'], inputs: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
];

/** One chooser entry per registry identity. Each transport retains its own setup details. */
export async function listMcpConnectorCatalog(db: Db, tenantId: number, env: Env): Promise<ConnectorOffer[]> {
  const offers = new Map<string, ConnectorOffer>();
  for (const { manifest } of await listPublishedConnectors(db, tenantId, env)) {
    const id = manifest.key;
    offers.set(id, { id, name: manifest.name, transports: [{ transport: 'http', connectorKey: id }] });
  }
  for (const { id, name, ...local } of LOCAL_MCP) {
    const offer = offers.get(id) ?? { id, name, transports: [] };
    offer.transports.push({ transport: 'stdio', ...local });
    offers.set(id, offer);
  }
  return [...offers.values()].sort((a, b) => a.name.localeCompare(b.name));
}
