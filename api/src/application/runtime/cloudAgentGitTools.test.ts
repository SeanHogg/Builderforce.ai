import { describe, expect, it, vi } from 'vitest';
import { buildGitCommand, buildCoreToolRegistry, type CapabilityProvider, type ShellResult } from '@builderforce/agent-tools';
import { CLOUD_AGENT_TOOLS, cloudAgentToolsFor } from './cloudAgentTools';
import { prepSurfaceCaps } from './cloudAgent/runSurfaceCaps';

// ---------------------------------------------------------------------------
// Git / VCS tools — added to the shared registry so a run with a shell (a cloud run
// with its sandbox, on-prem Node) gets first-class "get latest / undo / redo" verbs.
// The on-prem agent previously had only a read-only `git_history` (pi-only, never
// migrated); the mutating verbs lived nowhere. These tests pin the surface gating,
// the (injection-safe) command text, and the result decoding.
// ---------------------------------------------------------------------------

const GIT_TOOLS = ['git_status', 'git_diff', 'git_history', 'git_sync_latest', 'git_undo', 'git_redo'];
const names = (tools: Array<{ function?: { name?: string }; name?: string }>): string[] =>
  tools.map((t) => t.function?.name ?? t.name ?? '');

describe('git tools — surface gating', () => {
  it('a sandboxed cloud run (real shell) advertises every git tool', () => {
    const have = names(cloudAgentToolsFor(prepSurfaceCaps({}, 1, true)));
    for (const t of GIT_TOOLS) expect(have, `a sandboxed run should expose ${t}`).toContain(t);
  });

  it('a cloud run without a sandbox advertises NONE of them', () => {
    const have = names(CLOUD_AGENT_TOOLS);
    for (const t of GIT_TOOLS) expect(have, `a shell-less run must NOT expose ${t}`).not.toContain(t);
  });
});

describe('buildGitCommand', () => {
  it('sync_latest defaults to the remote default branch and aborts cleanly on conflict', () => {
    const cmd = buildGitCommand('sync_latest');
    expect(cmd).toContain('HEAD branch:'); // autodetect the remote default
    expect(cmd).toContain('|| BASE=main');  // safe fallback
    expect(cmd).toContain('git merge --no-edit "origin/$BASE"');
    expect(cmd).toContain('git merge --abort'); // never leave a half-merged tree
    expect(cmd).toContain('MERGE_CONFLICT');
  });

  it('sync_latest pins an explicit base branch', () => {
    expect(buildGitCommand('sync_latest', { baseBranch: 'develop' })).toContain('BASE="develop"');
  });

  it('undo / redo are the reflog pair and refuse a dirty tree', () => {
    expect(buildGitCommand('undo')).toContain('git reset --hard HEAD~1');
    expect(buildGitCommand('redo')).toContain('git reset --hard "HEAD@{1}"');
    for (const a of ['undo', 'redo'] as const) {
      expect(buildGitCommand(a)).toContain('git status --porcelain'); // dirty guard
      expect(buildGitCommand(a)).toContain('DIRTY');
    }
  });

  it('rejects shell-injection in branch/path args (drops the unsafe value)', () => {
    // A metacharacter-laden base is treated as absent → falls back to autodetect,
    // never interpolated into the command.
    const evil = buildGitCommand('sync_latest', { baseBranch: 'main; rm -rf /' });
    expect(evil).not.toContain('rm -rf');
    expect(evil).toContain('HEAD branch:'); // fell back to autodetect
    const evilPath = buildGitCommand('diff', { path: '$(touch pwned)' });
    expect(evilPath).toBe('git --no-pager diff'); // unsafe path dropped, no `-- ...`
  });

  it('history clamps the commit limit and scopes to a safe path', () => {
    expect(buildGitCommand('history', { limit: 5, path: 'src/app' })).toBe('git --no-pager log --oneline -n 5 -- "src/app"');
    expect(buildGitCommand('history', { limit: 99999 })).toContain('-n 200'); // clamped
  });
});

describe('git tool execute() via the shell capability', () => {
  /** A fake CapabilityProvider whose shell records the command and returns a scripted result. */
  function fakeCtx(result: ShellResult): { ctx: { caps: CapabilityProvider }; calls: string[] } {
    const calls: string[] = [];
    const caps = {
      capabilities: new Set(['shell'] as const),
      shell: { run: async (command: string): Promise<ShellResult> => { calls.push(command); return result; } },
    } as unknown as CapabilityProvider;
    return { ctx: { caps }, calls };
  }

  const registry = buildCoreToolRegistry();

  it('git_status runs git status and returns its output', async () => {
    const { ctx, calls } = fakeCtx({ ok: true, stdout: '## main\n M src/a.ts', exitCode: 0 });
    const r = await registry.dispatch('git_status', {}, ctx as never);
    expect(calls[0]).toBe('git status --short --branch');
    expect((r.data as { ok: boolean; output: string }).ok).toBe(true);
    expect((r.data as { output: string }).output).toContain('src/a.ts');
  });

  it('decodes a merge conflict into an actionable error', async () => {
    const { ctx } = fakeCtx({ ok: false, stdout: 'MERGE_CONFLICT', exitCode: 3 });
    const r = await registry.dispatch('git_sync_latest', {}, ctx as never);
    const d = r.data as { ok: boolean; error?: string };
    expect(d.ok).toBe(false);
    expect(d.error).toMatch(/merge conflict/i);
  });

  it('decodes the dirty-tree guard for undo', async () => {
    const { ctx } = fakeCtx({ ok: false, stdout: 'DIRTY', exitCode: 4 });
    const r = await registry.dispatch('git_undo', {}, ctx as never);
    const d = r.data as { ok: boolean; error?: string };
    expect(d.ok).toBe(false);
    expect(d.error).toMatch(/uncommitted changes/i);
  });
});

describe('git tools with the remote half routed through the sandbox (a clone with no credential)', () => {
  it('buildGitCommand drops git fetch / git push when the sandbox does them', () => {
    const sync = buildGitCommand('sync_latest', { baseBranch: 'main', trackedBranch: 'bf/5', remoteViaSandbox: true });
    expect(sync).not.toContain('git fetch');
    expect(sync).not.toContain('git push');
    expect(sync).toContain('git merge --no-edit "origin/$BASE"');
    expect(sync).toContain('git merge --ff-only "origin/bf/5"');
    for (const a of ['undo', 'redo'] as const) {
      const cmd = buildGitCommand(a, { trackedBranch: 'bf/5', remoteViaSandbox: true });
      expect(cmd).not.toContain('git fetch');
      expect(cmd).not.toContain('git push');
    }
  });

  it('the local (non-sandbox) command is unchanged: it still fetches and pushes itself', () => {
    const sync = buildGitCommand('sync_latest', { baseBranch: 'main', trackedBranch: 'bf/5' });
    expect(sync).toContain('git fetch origin "$BASE"');
    expect(sync).toContain('git push origin HEAD');
  });

  function sandboxCtx(script: ShellResult, git: { sync: unknown; publish: unknown }) {
    const calls: string[] = [];
    const caps = {
      capabilities: new Set(['shell'] as const),
      shell: { run: async (c: string) => { calls.push(c); return script; }, trackedBranch: 'bf/5', git },
    } as unknown as CapabilityProvider;
    return { ctx: { caps }, calls };
  }

  it('git_sync_latest syncs through the sandbox, runs the local script against its base, then publishes', async () => {
    const order: string[] = [];
    const git = {
      sync: async (o: { baseBranch?: string }) => { order.push(`sync:${o.baseBranch ?? ''}`); return { ok: true, baseBranch: 'develop' }; },
      publish: async (o: { force: boolean }) => { order.push(`publish:${o.force}`); return { ok: true }; },
    };
    const { ctx, calls } = sandboxCtx({ ok: true, stdout: 'Synced', exitCode: 0 }, git);
    const r = await buildCoreToolRegistry().dispatch('git_sync_latest', {}, ctx as never);
    expect((r.data as { ok: boolean }).ok).toBe(true);
    expect(order).toEqual(['sync:', 'publish:false']);
    expect(calls[0]).toContain('BASE="develop"');
    expect(calls[0]).not.toContain('git fetch');
  });

  it('git_undo force-publishes; a failed sync stops before any local change; a failed publish is reported', async () => {
    const ok = { sync: async () => ({ ok: true }), publish: vi.fn(async () => ({ ok: true })) };
    const a = sandboxCtx({ ok: true, stdout: 'Undid', exitCode: 0 }, ok);
    await buildCoreToolRegistry().dispatch('git_undo', {}, a.ctx as never);
    expect(ok.publish).toHaveBeenCalledWith({ force: true });

    const noSync = { sync: async () => ({ ok: false, error: 'remote unreachable' }), publish: vi.fn() };
    const b = sandboxCtx({ ok: true, stdout: '', exitCode: 0 }, noSync);
    const rb = await buildCoreToolRegistry().dispatch('git_undo', {}, b.ctx as never);
    expect((rb.data as { error: string }).error).toMatch(/remote unreachable/);
    expect(b.calls).toHaveLength(0);
    expect(noSync.publish).not.toHaveBeenCalled();

    const noPublish = { sync: async () => ({ ok: true }), publish: async () => ({ ok: false, error: 'push refused' }) };
    const c = sandboxCtx({ ok: true, stdout: 'Undid', exitCode: 0 }, noPublish);
    const rc = await buildCoreToolRegistry().dispatch('git_redo', {}, c.ctx as never);
    expect((rc.data as { ok: boolean; error: string }).ok).toBe(false);
    expect((rc.data as { error: string }).error).toMatch(/push refused/);
  });
});
