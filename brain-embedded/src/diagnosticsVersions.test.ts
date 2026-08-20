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
  /**
   * ONE REPORT MUST NOT ANSWER ONE QUESTION TWICE.
   *
   * This line used to render a CEILING derived from the registry size ("up to 64
   * advertised per turn") while the Diagnostics block directly below it rendered the
   * MEASURED range off the very same run's trace. Two numbers, one question, and the
   * ceiling was the one that could never look wrong enough to investigate — so it now
   * reports what was actually sent, or says plainly that nothing was measured.
   */
  it('reports the OBSERVED per-turn range, not a ceiling', () => {
    const out = render({ ...base, tools: { count: 317, loading: false, advertisedMin: 40, advertisedLastTurn: 64 } });
    expect(out).toContain('317 registered');
    expect(out).toContain('40–64 advertised per turn (measured)');
    expect(out).not.toContain('up to');
  });

  it('collapses the range when every measured turn saw the same count', () => {
    const out = render({ ...base, tools: { count: 317, loading: false, advertisedMin: 64, advertisedLastTurn: 64 } });
    expect(out).toContain('64 advertised per turn (measured)');
    expect(out).not.toContain('64–64');
  });

  it('says the selection is UNMEASURED rather than inventing a bound', () => {
    const out = render({ ...base, tools: { count: 308, loading: false } });
    expect(out).toContain('308 registered');
    expect(out).toContain('not yet measured');
    expect(out).not.toContain('advertised per turn (measured)');
  });

  it('does not claim selection when the catalog is already under the limit', () => {
    const out = render({ ...base, tools: { count: 12, loading: false } });
    expect(out).toContain('12 registered');
    expect(out).not.toContain('advertised per turn');
    expect(out).not.toContain('not yet measured');
  });

  it('names a turn that was handed NOTHING despite a healthy catalog', () => {
    const out = render({ ...base, tools: { count: 317, loading: false, advertisedMin: 0, advertisedLastTurn: 64 } });
    expect(out).toContain('⚠ a turn was offered NONE');
    expect(out).toContain('the per-turn relevance selection, not the catalog');
  });
});
