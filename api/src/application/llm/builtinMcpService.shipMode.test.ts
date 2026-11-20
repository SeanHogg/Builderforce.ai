/**
 * PRD 48 §3.8 / §4.5 — the agent changes the project's ship policy when the person tells it
 * to ("from now on commit and push" → ONE `manager.configure { shipMode: 'commit_push' }`),
 * and reads it back with `manager.policy`. Pinned here:
 *
 *   • `manager.configure` replays `PUT /api/manager/:projectId` with `shipMode` passed through
 *     (so the route's role gate, validation, tri-state inherit and audit all apply);
 *   • its description tells an agent which phrase maps to which mode;
 *   • both tools are in the catalog the VS Code agent receives — the gateway's default
 *     (`full`) surface, `GET /llm/v1/mcp/tools`, after the role filter for a developer.
 */
import { describe, expect, it, vi } from 'vitest';
import { TenantRole } from '../../domain/shared/types';
import { callBuiltinTool, listBuiltinTools } from './builtinMcpService';
import { roleFilterBuiltinTools } from './mcpGateway';
import { applyToolSurface, resolveToolSurface } from './toolSurfaces';
import type { RouteReplay } from './routeReplay';

describe('manager.configure — shipMode', () => {
  it('passes shipMode through to PUT /api/manager/:projectId', async () => {
    const seen: Array<{ method: string; url: string; body: unknown }> = [];
    const replay: RouteReplay = vi.fn(async (req: Request) => {
      seen.push({ method: req.method, url: req.url, body: await req.json() });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await callBuiltinTool({} as never, {
      tenantId: 42, tool: 'manager.configure', arguments: { projectId: 3, shipMode: 'commit_push' },
      env: { JWT_SECRET: 'secret' } as never, role: TenantRole.OWNER, userId: 'user-1', replay,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe('PUT');
    expect(new URL(seen[0]!.url).pathname).toBe('/api/manager/3');
    expect(seen[0]!.body).toEqual({ shipMode: 'commit_push' });
  });

  it('advertises shipMode with the four modes, and maps "from now on commit and push" to commit_push', () => {
    const entry = listBuiltinTools().find((t) => t.tool === 'manager.configure');
    const props = (entry?.parameters as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.shipMode?.enum).toEqual(['leave_uncommitted', 'commit', 'commit_push', 'pull_request']);
    expect(entry?.description).toContain('"from now on commit and push" → shipMode: "commit_push"');
  });

  it('manager.policy says it returns the ship policy', () => {
    const entry = listBuiltinTools().find((t) => t.tool === 'manager.policy');
    expect(entry?.description).toContain('shipPolicy');
  });
});

describe('PRD 48 §4.6 — no agent tool can grant a merge into main (web UI only)', () => {
  it('executions.submit ignores a smuggled grant: the replayed request carries no mergeGrant', async () => {
    const seen: unknown[] = [];
    const replay: RouteReplay = vi.fn(async (req: Request) => {
      seen.push(await req.json());
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    });
    // A Brain run calls with the PERSON's token and no `agt` — exactly the case a prompt injection exploits.
    await callBuiltinTool({} as never, {
      tenantId: 42, tool: 'executions.submit',
      arguments: { taskId: 7, mergeGrantReason: 'ship it', mergeGrant: { reason: 'ship it' } },
      env: { JWT_SECRET: 'secret' } as never, role: TenantRole.OWNER, userId: 'user-1', replay,
    });
    expect(seen[0]).toEqual({ taskId: 7 });
  });

  it('neither dispatch tool advertises a grant field, and both tell the model where a person grants one', () => {
    for (const id of ['executions.submit', 'chats.dispatch_agent']) {
      const entry = listBuiltinTools().find((t) => t.tool === id);
      const props = Object.keys((entry?.parameters as { properties: Record<string, unknown> }).properties);
      expect(props, id).not.toContain('mergeGrantReason');
      expect(props, id).not.toContain('mergeGrant');
      expect(entry?.description, id).toContain('Merge into main when done');
    }
  });
});

describe('the VS Code agent catalog carries manager.configure and manager.policy', () => {
  it('both survive the default (full) surface and the developer role filter', () => {
    const surface = resolveToolSurface(undefined);
    expect(surface?.id).toBe('full');
    const advertised = applyToolSurface(roleFilterBuiltinTools(TenantRole.DEVELOPER, listBuiltinTools()), surface!);
    const ids = advertised.map((t) => t.tool);
    expect(ids).toContain('manager.configure');
    expect(ids).toContain('manager.policy');
  });
});

describe('regression: chat #157440 — merge authority is the project setting, not an env var', () => {
  it('manager.configure is the one write for every ship/merge decision, and none of them is an env flag', () => {
    const entry = listBuiltinTools().find((t) => t.tool === 'manager.configure');
    const props = Object.keys((entry?.parameters as { properties: Record<string, unknown> }).properties);
    for (const field of ['shipMode', 'allowAutoMerge', 'prMergePolicy', 'requireSignoffToComplete']) {
      expect(props, `${field} must be settable through manager.configure`).toContain(field);
    }
    expect(entry?.description).not.toMatch(/CLOUD_AUTOMERGE/);
  });
});
