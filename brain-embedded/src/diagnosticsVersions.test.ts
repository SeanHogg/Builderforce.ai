import { describe, it, expect } from 'vitest';
import { formatChatDiagnostics, type ChatDiagnosticsData } from './chatDiagnostics';

/**
 * A capture with no build stamp is ambiguous in the worst way: a dump taken
 * minutes BEFORE a deploy is byte-identical to one taken after, so a fixed bug
 * reads as unfixed. (That is exactly what happened debugging chat #71 — the same
 * capture was re-read three times without anyone noticing it predated the fix.)
 */
const base: ChatDiagnosticsData = { surface: 'Web', chatId: 71 };
const render = (d: ChatDiagnosticsData) => formatChatDiagnostics(d).join('\n');

describe('version stamp in chat diagnostics', () => {
  it('reports both UI and API versions', () => {
    expect(render({ ...base, versions: { ui: '2026.7.84', api: '2026.7.114' } }))
      .toContain('- Versions: UI 2026.7.84 · API 2026.7.114');
  });

  it('is the FIRST fact after the surface — everything else depends on it', () => {
    const lines = formatChatDiagnostics({ ...base, versions: { ui: '1.0.0', api: '2.0.0' } });
    const surface = lines.findIndex((l) => l.startsWith('- Surface:'));
    const versions = lines.findIndex((l) => l.startsWith('- Versions:'));
    expect(versions).toBe(surface + 1);
  });

  it('names the half it could not determine rather than omitting the line', () => {
    // /health unreachable must not silently drop the UI version too.
    expect(render({ ...base, versions: { ui: '2026.7.84', api: null } }))
      .toContain('UI 2026.7.84 · API unknown');
  });

  it('says nothing when the host gathered no versions at all', () => {
    expect(render(base)).not.toContain('- Versions:');
    expect(render({ ...base, versions: { ui: null, api: null } })).not.toContain('- Versions:');
  });
});

describe('tool counts distinguish registered from advertised', () => {
  it('separates the full registry from the per-turn selection', () => {
    const out = render({ ...base, tools: { count: 308, loading: false } });
    expect(out).toContain('308 registered');
    expect(out).toContain('advertised per turn (relevance-selected)');
  });

  it('does not claim selection when the catalog is already under the limit', () => {
    const out = render({ ...base, tools: { count: 12, loading: false } });
    expect(out).toContain('12 registered');
    expect(out).not.toContain('advertised per turn');
  });
});
