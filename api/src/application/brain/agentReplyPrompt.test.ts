import { describe, it, expect } from 'vitest';
import { accountabilityFraming, ACCOUNTABILITY_TOOL_IDS } from './BrainService';
import {
  advertisedName, listBuiltinTools,
  CLOUD_AGENT_PLATFORM_TOOLS, CHAT_SCOPED_AGENT_TOOLS,
} from '../llm/builtinMcpService';

/**
 * THE PROMPT → TOOL-LIST CONTRACT.
 *
 * This file exists because of a defect that shipped with tests around it and was caught
 * by a human reading a transcript instead. The manager's accountability framing named its
 * tools by CATALOG ID (`manager.digest`), while a model is advertised those tools under a
 * transformed name (`builtin_manager_digest`). Nothing errored. There is no such thing as
 * an error for "the prompt referenced a tool that does not exist" — the model simply could
 * not find what it had been told to call, so it DESCRIBED the calls instead:
 *
 *     "The tools required are manager.digest, manager.decisions, manager.census and
 *      manager.policy. No other tools provide the needed data."
 *     "The required tools have not returned results yet, so I have no new data."
 *
 * Three accountability questions in a row answered with nothing, from a page whose entire
 * purpose is to answer them. Every other test in the suite passed.
 *
 * The lesson generalises past this one bug: a system prompt is a CROSS-BOUNDARY CONTRACT
 * with the model, exactly like the pass-summary prose the manager diagnostics parse back.
 * It has to be asserted against the other side of the boundary, which for a tool name
 * means the advertised tool list — not against a hand-written copy of what we intended.
 */

const ADVERTISED = new Set(listBuiltinTools().map((t) => t.name));
const AGENT_TOOL_IDS = [...CLOUD_AGENT_PLATFORM_TOOLS, ...CHAT_SCOPED_AGENT_TOOLS];
const AGENT_ENTRIES = listBuiltinTools().filter((t) => AGENT_TOOL_IDS.includes(t.tool));
const nameFor = (toolId: string): string | null =>
  AGENT_ENTRIES.find((t) => t.tool === toolId)?.name ?? null;

describe('the accountability framing names tools the model actually has', () => {
  it('advertises every tool the framing instructs the manager to call', () => {
    // The assertion that was missing. Each id must resolve to a tool on the agent's OWN
    // allowlist — being in the catalog is not enough, because an addressed-agent reply
    // only advertises the allowlisted subset.
    const missing = ACCOUNTABILITY_TOOL_IDS.filter((id) => nameFor(id) == null);
    expect(missing).toEqual([]);
  });

  it('writes the ADVERTISED name into the prompt, never the catalog id', () => {
    const prompt = accountabilityFraming(11, nameFor);
    for (const id of ACCOUNTABILITY_TOOL_IDS) {
      const name = nameFor(id);
      expect(name).not.toBeNull();
      expect(prompt).toContain(name as string);
    }
    // The exact shape of the bug: a dotted catalog id anywhere in the instruction text.
    // `manager.digest` matches nothing in the model's tool list, so instructing the model
    // to call it produces narration rather than a call — and no error at all.
    for (const id of ACCOUNTABILITY_TOOL_IDS) {
      expect(prompt).not.toContain(id);
    }
    expect(prompt).not.toMatch(/\b(manager|autonomy|tickets|chats)\.[a-z_]+/);
  });

  it('every name it emits is a real advertised tool', () => {
    const prompt = accountabilityFraming(11, nameFor);
    const emitted = [...prompt.matchAll(/\bbuiltin_[a-z0-9_]+/gi)].map((m) => m[0]);
    expect(emitted.length).toBeGreaterThan(0);
    for (const name of emitted) expect(ADVERTISED.has(name)).toBe(true);
  });

  it('threads the project id into every call it asks for', () => {
    // The model has no other way to learn which project it is accountable for; a call
    // without it fails argument validation and the manager reports "no data" again.
    const prompt = accountabilityFraming(42, nameFor);
    expect(prompt).toContain('projectId=42');
    expect(prompt).toContain('project #42');
  });

  it('DROPS a clause whose tool is not advertised rather than pointing at nothing', () => {
    // The safety property that makes this robust against a future allowlist edit: remove
    // a tool from the agent's tools and the sentence naming it disappears, instead of the
    // prompt instructing the model to call something it was never given.
    const withoutDigest = (id: string) => (id === 'manager.digest' ? null : nameFor(id));
    const prompt = accountabilityFraming(11, withoutDigest);
    expect(prompt).not.toContain('what finished today and yesterday');
    // …and the rest of the instruction survives intact.
    expect(prompt).toContain(nameFor('manager.policy') as string);
  });

  it('tells the model to CALL the tools, not to describe them', () => {
    // The failure mode was narration, so the instruction is asserted verbatim: a model
    // that lists tool names instead of invoking them has answered nothing.
    const prompt = accountabilityFraming(11, nameFor);
    expect(prompt).toMatch(/MUST actually CALL/);
    expect(prompt).toMatch(/do not describe them/);
    expect(prompt).toMatch(/has not returned results/);
  });
});

describe('advertisedName', () => {
  it('is the single transform every prompt and tool list must share', () => {
    expect(advertisedName('manager.digest')).toBe('builtin_manager_digest');
    expect(advertisedName('autonomy.wiring_audit')).toBe('builtin_autonomy_wiring_audit');
  });

  it('agrees with what the catalog actually advertises', () => {
    // If these ever diverge, every prompt built from `advertisedName` silently names
    // tools the model does not have — the same class of failure, one level down.
    for (const t of listBuiltinTools()) expect(t.name).toBe(advertisedName(t.tool));
  });
});
