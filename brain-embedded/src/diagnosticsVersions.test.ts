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
  it('reports both the client and API versions', () => {
    expect(render({ ...base, versions: { ui: '2026.7.84', api: '2026.7.114' } }))
      .toContain('- Versions: client 2026.7.84 · API 2026.7.114');
  });

  it('is the FIRST fact after the surface — everything else depends on it', () => {
    const lines = formatChatDiagnostics({ ...base, versions: { ui: '1.0.0', api: '2.0.0' } });
    const surface = lines.findIndex((l) => l.startsWith('- Surface:'));
    const versions = lines.findIndex((l) => l.startsWith('- Versions:'));
    expect(versions).toBe(surface + 1);
  });

  it('names the half it could not determine rather than omitting the line', () => {
    // /health unreachable must not silently drop the client version too.
    expect(render({ ...base, versions: { ui: '2026.7.84', api: null } }))
      .toContain('client 2026.7.84 · API unknown');
  });

  /**
   * THE AMBIGUITY THIS BLOCK EXISTS FOR.
   *
   * A run reported the raw `cmd.exe` error `Environment variable -e not defined` from
   * `git_sync_latest` on a build whose version was AHEAD of the one the POSIX-shell
   * guard shipped in. Two explanations fitted equally — an extension host older than
   * the version it reported, or a live hole in the guard — and nothing in the report
   * could separate them: the single version line was labelled "UI" while carrying the
   * HOST's number, the webview half was never identified at all, and whether the
   * machine even had a POSIX shell was not stated anywhere.
   *
   * All three are now facts in the report rather than inferences about it.
   */
  it('names the extension host, not "UI" — the number is the half that runs the tools', () => {
    const out = render({ ...base, versions: { ui: '2026.9.5', api: '2026.9.5', uiBuildId: 'aaaaaaaaaaaa' } });
    expect(out).toContain('- Versions: client 2026.9.5+aaaaaaaaaaaa');
    expect(out).not.toContain('Versions: UI');
  });

  it('prints the webview bundle stamp beside the host one', () => {
    const out = render({
      ...base,
      versions: { ui: '2026.9.5', api: null, uiBuildId: 'aaaaaaaaaaaa', webviewBuildId: 'aaaaaaaaaaaa' },
    });
    expect(out).toContain('Webview bundle: aaaaaaaaaaaa');
    // Matching ids are ONE artifact — no warning to give.
    expect(out).not.toContain('DIFFERENT source');
  });

  it('warns when the two halves were built from different source', () => {
    // The `watch:webview` case: the panel is rebuilt, the host keeps its old stamp, and
    // the version line describes whichever half the reader assumed.
    const out = render({
      ...base,
      versions: { ui: '2026.9.5', api: null, uiBuildId: 'aaaaaaaaaaaa', webviewBuildId: 'bbbbbbbbbbbb' },
    });
    expect(out).toContain('DIFFERENT source');
    expect(out).toContain('Reinstall the packaged extension');
  });

  it('does not cry mismatch against an unpackaged host', () => {
    // "dev" is not a source hash, so comparing it to one proves nothing.
    const out = render({
      ...base,
      versions: { ui: '2026.9.5', api: null, uiBuildId: 'dev', webviewBuildId: 'bbbbbbbbbbbb' },
    });
    expect(out).not.toContain('DIFFERENT source');
  });

  it('states whether this machine can run the POSIX git scripts', () => {
    const out = render({
      ...base,
      versions: { ui: '2026.9.5', api: null, posixShell: 'POSIX scripts: routed to C:/Git/bin/bash.exe' },
    });
    expect(out).toContain('POSIX scripts: routed to C:/Git/bin/bash.exe');
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

describe('build identity — a version names a release, not an artifact', () => {
  /**
   * Two VSIXes carrying the SAME version and different code is not hypothetical: a
   * rebuilt `2026.7.104` fixed an agent-stall bug the earlier `2026.7.104` had, and the
   * user who hit that exact bug filed a report reading `UI 2026.7.104` — true of both
   * builds, useful for neither. The build id is what separates them.
   */
  it('rides the client version rather than taking its own line', () => {
    const out = render({ ...base, versions: { ui: '2026.7.104', api: '2026.7.114', uiBuildId: 'a1b2c3d4e5f6' } });
    expect(out).toContain('- Versions: client 2026.7.104+a1b2c3d4e5f6 · API 2026.7.114');
  });

  it('states when the artifact was built, so same-source rebuilds stay orderable', () => {
    const out = render({
      ...base,
      versions: { ui: '2026.7.104', api: null, uiBuildId: 'a1b2c3d4e5f6', uiBuiltAt: '2026-07-25T22:09:00.000Z' },
    });
    expect(out).toContain('client 2026.7.104+a1b2c3d4e5f6 (built 2026-07-25T22:09:00.000Z)');
  });

  it('warns when a client reports a version but no build id at all', () => {
    const out = render({ ...base, versions: { ui: '2026.7.104', api: null } });
    expect(out).toContain('No client build id');
    expect(out).toContain('indistinguishable from the build it replaced');
  });

  it('warns that a "dev" stamp did not come from a packaged build', () => {
    const out = render({ ...base, versions: { ui: '2026.7.104', api: null, uiBuildId: 'dev' } });
    expect(out).toContain('did NOT come from a packaged build');
  });

  it('still renders the line when only a build id was gathered', () => {
    expect(render({ ...base, versions: { ui: null, api: null, uiBuildId: 'a1b2c3d4e5f6' } }))
      .toContain('- Versions: client unknown+a1b2c3d4e5f6');
  });
});

describe("the panel's selected project is ALWAYS reported", () => {
  /**
   * "no project is selected in the sidebar" and "a project IS selected but the chat is
   * unattached" have OPPOSITE causes and opposite fixes, and both used to render as the
   * single line `Chat's project: none` — reading it as the first once cost a wrong revert.
   */
  it('prints "none" rather than omitting the line when nothing is selected', () => {
    expect(render({ ...base, projectId: null, selectedProjectId: null }))
      .toContain("- Panel's selected project: none");
  });

  it('prints the line even when it matches the chat, and says so', () => {
    expect(render({ ...base, projectId: 7, selectedProjectId: 7 }))
      .toContain("- Panel's selected project: #7 (same as the chat's)");
  });

  it('names the selected project when the host holds one', () => {
    expect(render({ ...base, projectId: null, selectedProjectId: 7, selectedProjectName: 'Atlas' }))
      .toContain("- Panel's selected project: Atlas (#7)");
  });

  it('blames the SELECTION when an unattached chat had nothing to adopt', () => {
    const out = render({ ...base, projectId: null, selectedProjectId: null });
    expect(out).toContain('No project is selected in the sidebar either');
    expect(out).toContain('Not an adopt bug');
  });

  it('blames the ADOPT PATH when a project was selected and still not adopted', () => {
    const out = render({ ...base, projectId: null, selectedProjectId: 7, selectedProjectName: 'Atlas' });
    expect(out).toContain('A project IS selected (Atlas (#7))');
    expect(out).toContain('the ADOPT path is the fault, not the selection');
    expect(out).not.toContain('Not an adopt bug');
  });
});
