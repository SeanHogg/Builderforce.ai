import { stableStringify } from '@builderforce/agent-tools';
import { toMcp, type RelayToolEntry } from '@seanhogg/builderforce-mcp';
import { describeToolSurfaces } from '../toolSurfaces';

export const INTERACTIVE_MCP_PROFILE = 'interactive';
export const CATALOG_STREAM_LIFETIME_MS = 240_000;

const CATALOG_GUIDE = 'Call tools/list for the tools available to the current workspace and role. Resolve names and IDs with read tools before taking action. Use the readOnlyHint annotation when assessing whether a call changes state.';

export function catalogHelp() {
  const surfaces = describeToolSurfaces().map(({ id, description }) => `- \`${id}\` — ${description}`);
  return {
    textResources: [{
      descriptor: {
        uri: 'builderforce://mcp/catalog',
        name: 'MCP tool catalog guide',
        description: 'Tool discovery and available catalog surfaces.',
        mimeType: 'text/markdown',
      },
      text: ['# Builderforce MCP tool catalog', CATALOG_GUIDE, 'Select a surface with `?surface=<id>`.', ...surfaces].join('\n\n'),
    }],
    textPrompts: [{
      descriptor: { name: 'discover_tools', description: 'Discover the workspace tools available for the current task.' },
      text: CATALOG_GUIDE,
    }],
  };
}

function waitForPoll(signal: AbortSignal, intervalMs: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, intervalMs);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function fingerprint(entries: readonly RelayToolEntry[]): string {
  // Catalog merge order and object key order can vary even when the advertised tools are identical.
  return entries.map((entry) => stableStringify(toMcp(entry))).sort().join('\n');
}

/**
 * Watch exactly the catalog this connection is authorized to discover. A null read
 * ends the stream, for example when its credential is revoked or its workspace changes.
 */
export async function watchCatalog(
  list: () => Promise<readonly RelayToolEntry[] | null>,
  changed: () => Promise<void>,
  signal: AbortSignal,
  intervalMs = 30_000,
): Promise<void> {
  let previous: string | undefined;
  while (!signal.aborted) {
    const entries = await list();
    if (entries === null || signal.aborted) return;
    const current = fingerprint(entries);
    if (previous !== undefined && previous !== current) await changed();
    previous = current;
    await waitForPoll(signal, intervalMs);
  }
}
