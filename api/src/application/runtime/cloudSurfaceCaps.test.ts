/**
 * The two cloud surfaces' DERIVED toolsets. Both capability sets feed a registry that
 * derives the schema array actually advertised to the model, so a one-word edit to a
 * capability set silently changes which tools exist — and the container's set must
 * additionally match what `api/container/server.mjs` really implements, because that
 * image runs its own loop and a tool it doesn't handle 400s mid-run.
 *
 * These lists are therefore pinned deliberately: a diff here should be a conscious
 * decision, checked against the image (and the doc block in `cloudAgentTools.ts`),
 * not an accident. Two real defects this guards:
 *   • the container advertising `shell` while its doc block listed six fewer tools
 *     than `shell` actually unlocks (all six `git_*`, which the image DOES implement);
 *   • `memory` missing from the container set with no explanation, so a fact stored by
 *     a durable run was unreachable from a container run.
 */
import { describe, expect, it } from 'vitest';
import { CLOUD_AGENT_TOOLS, CONTAINER_AGENT_TOOLS, CLOUD_SURFACE_CAPS, CONTAINER_SURFACE_CAPS } from './cloudAgentTools';

const names = (tools: ReadonlyArray<{ function?: { name?: string } }>): string[] =>
  tools.map((t) => t.function?.name ?? '').sort();

describe('CLOUD_SURFACE_CAPS → durable/Worker toolset', () => {
  it('advertises exactly the provider-backed tools (no shell)', () => {
    expect(names(CLOUD_AGENT_TOOLS)).toEqual([
      'ask_human', 'delete_file', 'edit_file', 'finish', 'list_files',
      'memory_recall', 'memory_remember', 'read_file', 'run_checks', 'search_code',
      'web_fetch', 'write_file',
    ]);
  });

  it('includes web_fetch but NOT web_search — search is TENANT-gated, not surface-wide', () => {
    // `web` (fetch) is a property of the surface and is always on. `web.search` needs a
    // BYO search key, so it is added per RUN by `cloudSurfaceCaps({ webSearch: true })`
    // and must never leak into this base constant — see cloudWebSearch.test.ts.
    expect(CLOUD_SURFACE_CAPS.has('web')).toBe(true);
    expect(CLOUD_SURFACE_CAPS.has('web.search')).toBe(false);
    expect(names(CLOUD_AGENT_TOOLS)).toContain('web_fetch');
    expect(names(CLOUD_AGENT_TOOLS)).not.toContain('web_search');
  });

  it('has no shell tool — this surface cannot run a build/test and must not claim to', () => {
    expect(names(CLOUD_AGENT_TOOLS)).not.toContain('run_command');
  });
});

describe('CONTAINER_SURFACE_CAPS → container toolset (must match server.mjs)', () => {
  it('advertises exactly what the image implements', () => {
    expect(names(CONTAINER_AGENT_TOOLS)).toEqual([
      'finish', 'git_diff', 'git_history', 'git_redo', 'git_status', 'git_sync_latest',
      'git_undo', 'list_files', 'memory_recall', 'memory_remember', 'read_file',
      'run_command', 'write_file',
    ]);
  });

  it('`shell` unlocks all six git tools, which the image handles in gitTool()', () => {
    const got = names(CONTAINER_AGENT_TOOLS);
    for (const t of ['git_status', 'git_diff', 'git_history', 'git_sync_latest', 'git_undo', 'git_redo']) {
      expect(got).toContain(t);
    }
  });

  it('backs memory, so a fact stored on either cloud surface is recallable on both', () => {
    expect(CONTAINER_SURFACE_CAPS.has('memory')).toBe(true);
    expect(names(CONTAINER_AGENT_TOOLS)).toContain('memory_recall');
    expect(names(CONTAINER_AGENT_TOOLS)).toContain('memory_remember');
  });

  it('omits the tools the image has no handler for (they would 400 mid-run)', () => {
    const got = names(CONTAINER_AGENT_TOOLS);
    // `repo.edit` — no `edit` container-op; `repo.search` — it greps via the shell;
    // `static-check` — shell-free validator; `human` — not wired in the image.
    for (const t of ['edit_file', 'delete_file', 'search_code', 'run_checks', 'ask_human']) {
      expect(got).not.toContain(t);
    }
  });
});
