import { describe, it, expect } from 'vitest';
import { formatChatDiagnostics, type ChatDiagnosticsData } from './chatDiagnostics';

/**
 * A tool-less Brain answers every data question with "I don't have that data" and
 * records ZERO tool calls — identical on the surface to a weak model choosing not
 * to act. The report must state which one it is.
 */
const base: ChatDiagnosticsData = { surface: 'Web', chatId: 71, projectId: 11 };

const render = (d: ChatDiagnosticsData) => formatChatDiagnostics(d).join('\n');

describe('tool availability in chat diagnostics', () => {
  it('reports how many tools the model could call', () => {
    expect(render({ ...base, tools: { count: 43 } })).toContain('Tools available to the model: 43');
  });

  it('names a ZERO-tool Brain as a wiring fault, not a model fault', () => {
    const out = render({ ...base, tools: { count: 0, loading: false } });
    expect(out).toContain('Tools available to the model: 0');
    expect(out).toContain('ZERO tools registered');
    expect(out).toContain('0 tool calls');
  });

  it('surfaces a failed catalog fetch with its reason', () => {
    const out = render({ ...base, tools: { count: 0, error: 'tool catalog unavailable (HTTP 401)', loading: false } });
    expect(out).toContain('catalog error: tool catalog unavailable (HTTP 401)');
    expect(out).toContain('MCP tool catalog FAILED to load');
    expect(out).toContain('wiring fault, not a model fault');
  });

  it('stays quiet while the catalog is still loading', () => {
    const out = render({ ...base, tools: { count: 0, loading: true } });
    expect(out).toContain('catalog still loading');
    expect(out).not.toContain('ZERO tools registered');
  });

  it('says nothing at all when the host did not gather tool state', () => {
    expect(render(base)).not.toContain('Tools available');
  });
});
