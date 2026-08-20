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
      'ask_human', 'claim_resource', 'delete_file', 'edit_file', 'finish', 'list_files',
      'memory_forget', 'memory_recall', 'memory_remember', 'read_file', 'release_resource',
      'run_checks', 'search_code', 'update_prd', 'web_fetch', 'web_search', 'workspace_note',
      'workspace_read', 'write_file',
    ]);
  });

  it('backs `coordinate` — several agents can be staffed onto one ticket at once', () => {
    // A stage whose dispatches carry no `dependsOn` releases them ALL at once, and the
    // 'any'/'n_of_m' success policies exist for exactly that. Those agents share one
    // git branch, so this surface must offer the arbiter (migration 0370).
    expect(CLOUD_SURFACE_CAPS.has('coordinate')).toBe(true);
    for (const t of ['claim_resource', 'release_resource', 'workspace_note', 'workspace_read']) {
      expect(names(CLOUD_AGENT_TOOLS)).toContain(t);
    }
  });

  it('backs `memory.forget` — a Postgres delete really deletes', () => {
    // Split from `memory` for the same reason `web.search` is a separate capability
    // from `web` (a surface may back fetch without search): the
    // on-prem SSM store SUPERSEDES a belief rather than erasing it, so only a surface
    // whose delete is authoritative may advertise this.
    expect(CLOUD_SURFACE_CAPS.has('memory.forget')).toBe(true);
    expect(names(CLOUD_AGENT_TOOLS)).toContain('memory_forget');
  });

  it('includes BOTH web_fetch and web_search — search always has a backing', () => {
    // `web.search` was tenant-gated while it needed a BYO key. `resolveWebSearchBacking`
    // now always resolves a vendor (tenant key → operator key → keyless encyclopedic
    // floor), so it belongs to the surface — see cloudWebSearch.test.ts.
    expect(CLOUD_SURFACE_CAPS.has('web')).toBe(true);
    expect(CLOUD_SURFACE_CAPS.has('web.search')).toBe(true);
    expect(names(CLOUD_AGENT_TOOLS)).toContain('web_fetch');
    expect(names(CLOUD_AGENT_TOOLS)).toContain('web_search');
  });

  it('backs `prd.write` — the run can correct the spec it was handed', () => {
    // Prep hands every run its ticket PRD as context. A surface that can serve the PRD
    // and not accept a correction to it leaves the agent reading a wrong requirement it
    // cannot fix — and the next run repeats the mistake.
    expect(CLOUD_SURFACE_CAPS.has('prd.write')).toBe(true);
    expect(names(CLOUD_AGENT_TOOLS)).toContain('update_prd');
  });

  it('has no shell tool — this surface cannot run a build/test and must not claim to', () => {
    expect(names(CLOUD_AGENT_TOOLS)).not.toContain('run_command');
  });
});

describe('CONTAINER_SURFACE_CAPS → container toolset (must match server.mjs)', () => {
  it('advertises exactly what the image implements', () => {
    expect(names(CONTAINER_AGENT_TOOLS)).toEqual([
      'ask_human', 'claim_resource', 'finish', 'git_diff', 'git_history', 'git_redo', 'git_status',
      'git_sync_latest', 'git_undo', 'list_files', 'memory_forget', 'memory_recall', 'memory_remember',
      'read_file', 'release_resource', 'run_command', 'update_prd', 'web_search', 'workspace_note',
      'workspace_read', 'write_file',
    ]);
  });

  it('backs `coordinate` through the Worker-owned lease and blackboard stores', () => {
    expect(CONTAINER_SURFACE_CAPS.has('coordinate')).toBe(true);
    for (const t of ['claim_resource', 'release_resource', 'workspace_note', 'workspace_read']) {
      expect(names(CONTAINER_AGENT_TOOLS)).toContain(t);
    }
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
    // `static-check` — shell-free validator. (`human` USED to be on this list; the
    // image now implements the exit-and-redispatch pause, so it is advertised.)
    for (const t of ['edit_file', 'delete_file', 'search_code', 'run_checks']) {
      expect(got).not.toContain(t);
    }
  });

  it('backs `human` — the image parks the run and is redispatched with the answer', () => {
    expect(CONTAINER_SURFACE_CAPS.has('human')).toBe(true);
    expect(names(CONTAINER_AGENT_TOOLS)).toContain('ask_human');
  });

  it('backs `web.search` — parity with the durable surface, on the shared `search` op', () => {
    // This was the last capability the two cloud surfaces disagreed on, and the
    // disagreement was structural rather than intentional: the container's tools come
    // from its image's own loop, and there was no op behind search, so advertising it
    // would have surfaced a tool that 400s mid-run. The `search` container-op is that
    // backing, and BOTH images that share this capability set dispatch `web_search` to
    // it (api/container/server.mjs and githubActionsRunner.ts).
    expect(CONTAINER_SURFACE_CAPS.has('web.search')).toBe(true);
    expect(names(CONTAINER_AGENT_TOOLS)).toContain('web_search');
    // Still NOT `web` (fetch): there is no `fetch` op, and a shell can curl.
    expect(CONTAINER_SURFACE_CAPS.has('web')).toBe(false);
    expect(names(CONTAINER_AGENT_TOOLS)).not.toContain('web_fetch');
  });

  it('backs `prd.write` — both images relay `update_prd` through the shared `prd` op', () => {
    // The container image (api/container/server.mjs) and the GitHub Actions runner
    // (githubActionsRunner.ts) share this capability set and BOTH dispatch `update_prd`
    // to the Worker's `prd` op. Advertising it to only one of them is the dead seam
    // this set exists to prevent.
    expect(CONTAINER_SURFACE_CAPS.has('prd.write')).toBe(true);
    expect(names(CONTAINER_AGENT_TOOLS)).toContain('update_prd');
  });
});
