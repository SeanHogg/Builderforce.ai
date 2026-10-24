/**
 * A cloud run's DERIVED toolset. The capability set feeds a registry that derives the
 * schema array actually advertised to the model, so a one-word edit to the set silently
 * changes which tools exist. There is ONE set for every cloud run; a run with a SANDBOX
 * (the Cloudflare Container or its Actions runner) adds exactly what the sandbox backs —
 * `shell` — and every tool stays the shared definition the one engine dispatches.
 *
 * These lists are therefore pinned deliberately: a diff here should be a conscious
 * decision, checked against the doc block in `cloudAgentTools.ts`, not an accident.
 */
import { describe, expect, it } from 'vitest';
import { CLOUD_AGENT_TOOLS, CLOUD_SURFACE_CAPS, cloudAgentToolsFor } from './cloudAgentTools';
import { SANDBOX_CAPABILITIES } from './sandbox/sandboxProvider';
import { prepSurfaceCaps } from './cloudAgent/runSurfaceCaps';

const names = (tools: ReadonlyArray<{ function?: { name?: string } }>): string[] =>
  tools.map((t) => t.function?.name ?? '').sort();

describe('CLOUD_SURFACE_CAPS → durable/Worker toolset', () => {
  it('advertises exactly the provider-backed tools (no shell)', () => {
    expect(names(CLOUD_AGENT_TOOLS)).toEqual([
      'ask_human', 'claim_resource', 'delete_file', 'edit_file', 'finish', 'list_files',
      'memory_forget', 'memory_recall', 'memory_remember', 'message_agent', 'read_file', 'release_resource',
      'run_checks', 'search_code', 'skill_list', 'skill_propose', 'spawn_agent', 'spawn_agents', 'stop_agent', 'update_prd',
      'wait_agents', 'web_fetch', 'web_search', 'workspace_note', 'workspace_read', 'write_file',
    ]);
  });

  it('delegates one way — every child is its own durable run with an owner pointer', () => {
    for (const cap of ['orchestrate', 'orchestrate.fanout', 'orchestrate.live'] as const) {
      expect(CLOUD_SURFACE_CAPS.has(cap)).toBe(true);
    }
    for (const t of ['spawn_agent', 'spawn_agents', 'wait_agents', 'message_agent', 'stop_agent']) {
      expect(names(CLOUD_AGENT_TOOLS)).toContain(t);
    }
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

  it('has no shell tool without a sandbox — it cannot run a build/test and must not claim to', () => {
    expect(names(CLOUD_AGENT_TOOLS)).not.toContain('run_command');
  });
});

describe('a sandboxed cloud run → the cloud toolset plus what the shell backs', () => {
  const sandboxed = cloudAgentToolsFor(prepSurfaceCaps({}, 1, true));

  it('adds exactly the shell tools, and drops nothing', () => {
    const shellTools = ['analyze_codebase', 'git_diff', 'git_history', 'git_redo', 'git_status', 'git_sync_latest', 'git_undo', 'run_command'];
    expect(names(sandboxed)).toEqual([...names(CLOUD_AGENT_TOOLS), ...shellTools].sort());
  });

  it("the sandbox backs only `shell` — everything else is the engine's own provider", () => {
    expect([...SANDBOX_CAPABILITIES]).toEqual(['shell']);
  });

  it('keeps the provider-backed tools a container image used to lack', () => {
    // The container's own loop could not search, delete, statically check or fetch; the
    // one engine can, so a sandboxed run keeps all four.
    for (const t of ['search_code', 'delete_file', 'run_checks', 'web_fetch']) expect(names(sandboxed)).toContain(t);
  });

  it('never unlocks the publishing verbs — those need `git.write`, not a shell', () => {
    for (const t of ['git_commit', 'git_push', 'open_pull_request']) expect(names(sandboxed)).not.toContain(t);
  });
});
