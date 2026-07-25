import { describe, it, expect } from 'vitest';
import {
  listBuiltinTools, CLOUD_AGENT_PLATFORM_TOOLS, cloudAgentPlatformToolSchemas,
  resolveCloudAgentPlatformTool,
} from './builtinMcpService';

/**
 * The autonomy diagnostics are only useful if the agents that could ACT on them can
 * actually see and invoke them. Defining a catalog entry is not enough: the cloud loop
 * advertises a curated subset under gateway-safe `builtin_*` names, and a tool missing
 * from that subset is visible in the catalog yet uninvokable — the exact failure mode
 * called out in the allowlist comments. These tests pin the whole path.
 */
const DIAGNOSTIC_TOOLS = ['autonomy.wiring_audit', 'autonomy.summary', 'tickets.lifecycle'] as const;

describe('autonomy diagnostic tools', () => {
  const catalog = listBuiltinTools();
  // Key by the DOTTED catalog id (`t.tool`), not `t.name` — `name` is the flattened,
  // gateway-safe `builtin_*` alias the model calls, and confusing the two is precisely
  // the mismatch that would make a dispatcher lookup miss.
  const byName = new Map(catalog.map((t) => [t.tool, t]));

  it.each(DIAGNOSTIC_TOOLS)('%s is in the catalog (so Brain + VS Code can see it)', (tool) => {
    // Brain and the VS Code extension read the FULL catalog, so catalog membership is
    // what exposes a tool to those two surfaces.
    expect(byName.has(tool)).toBe(true);
  });

  it.each(DIAGNOSTIC_TOOLS)('%s is on the cloud-agent allowlist (so unattended runs can invoke it)', (tool) => {
    expect(CLOUD_AGENT_PLATFORM_TOOLS).toContain(tool);
  });

  it.each(DIAGNOSTIC_TOOLS)('%s resolves back from its advertised builtin_* name', (tool) => {
    // The cloud loop calls tools by the dot-free advertised name and maps back; a broken
    // round-trip means the model emits a call the dispatcher cannot resolve.
    const advertised = cloudAgentPlatformToolSchemas().find((s) => resolveCloudAgentPlatformTool(s.function.name) === tool);
    expect(advertised, `no advertised schema round-trips to ${tool}`).toBeDefined();
    expect(advertised!.function.name.startsWith('builtin_')).toBe(true);
  });

  it('marks every diagnostic as READ-ONLY — diagnosis must not change what it measures', () => {
    for (const tool of DIAGNOSTIC_TOOLS) {
      expect(byName.get(tool)?.mutates, `${tool} must not mutate`).toBe(false);
    }
  });

  it('describes the wiring audit as capability, not throughput', () => {
    // The description is the only thing steering a model to reach for this instead of the
    // outcome funnel; if it stops saying "can", the tool gets used for the wrong question.
    const d = byName.get('autonomy.wiring_audit')?.description ?? '';
    expect(d).toMatch(/can (work )?actually complete/i);
    expect(d).toContain('canCompleteAutonomously');
    // `unknown` must be documented as NOT a pass — that ambiguity is what made the first
    // audit misleading.
    expect(d).toMatch(/unknown.*not a pass/i);
  });

  it('tells the caller the two autonomy lenses answer different questions', () => {
    expect(byName.get('autonomy.summary')?.description ?? '').toContain('wiring_audit');
  });

  it('requires a taskId for the per-ticket lifecycle and nothing for the workspace lenses', () => {
    const lifecycle = byName.get('tickets.lifecycle')?.parameters as { required?: string[] } | undefined;
    expect(lifecycle?.required).toEqual(['taskId']);
    for (const tool of ['autonomy.wiring_audit', 'autonomy.summary'] as const) {
      const p = byName.get(tool)?.parameters as { required?: string[] } | undefined;
      expect(p?.required ?? []).toEqual([]);
    }
  });
});
