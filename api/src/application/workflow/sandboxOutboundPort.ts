/**
 * THE STUB — every outbound-shaped workflow node, captured and dropped rather
 * than fired. This is what makes a Stage-sandbox dry-run possible at all: no
 * connected account, no tenant credential, no real send, and no token spend
 * for the `llm` node either (a dry-run proves control flow and wiring, not
 * prompt quality — the locked product decision).
 *
 * Returns a small JSON envelope rather than an empty string so a downstream
 * node that reads `{{input.field}}` from this one's output degrades to
 * `undefined` rather than crashing on unparseable JSON.
 */

import type { OutboundPort } from './cloudExecutor';

async function stub(kind: string, config: Record<string, unknown>): Promise<string> {
  return JSON.stringify({ stubbed: true, kind, capturedConfig: Object.keys(config) });
}

export function sandboxOutboundPort(): OutboundPort {
  return {
    gmail: (config) => stub('gmail', config),
    connector: (config) => stub('connector', config),
    mcp: (config) => stub('mcp', config),
    llm: (config) => stub('llm', config),
    webSearch: (config) => stub('webSearch', config),
  };
}
