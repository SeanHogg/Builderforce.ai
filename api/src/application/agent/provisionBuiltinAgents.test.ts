import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { BUILTIN_AGENTS } from './provisionBuiltinAgents';
import { listBuiltinTools } from '../llm/builtinMcpService';

/**
 * A PERSISTED PROMPT MAY NOT NAME A TOOL.
 *
 * `ide_agents.bio` is the agent's persona — it is compiled straight into the system
 * prompt by `resolveWorkforceModel`. Unlike every other prompt in this codebase it is
 * DATA: written once per tenant at provision time, then never touched by a deploy
 * (`provisionBuiltinAgents` skips a tenant that already has the agent). A tool name
 * baked into it therefore outlives every fix.
 *
 * That is not hypothetical. Migration 0376 wrote `manager.digest, manager.decisions,
 * manager.census, manager.policy` into every tenant's Manager row; the TypeScript seed
 * was later corrected to emit the advertised names and the stored rows kept reciting the
 * dead ones. Measured on project 11 / chat 86, 2026-07-28 (api 2026.7.172, served by
 * `xai-oauth/grok-4.3`): 7 model turns, 102 tools advertised, ZERO tool calls, the
 * manager answering "The tools required are manager.digest, manager.decisions,
 * manager.census and manager.policy" three questions in a row.
 *
 * `agentReplyPrompt.test.ts` guards the CODE prompts (they must name the advertised
 * name); this guards the persisted ones (they must name nothing at all, because there is
 * no name that stays correct in a row nobody rewrites). Repaired by migration 0379.
 */
describe('built-in agent personas', () => {
  const CATALOG_IDS = listBuiltinTools().map((t) => t.tool);

  it('name no catalog tool id — the row outlives the catalog', () => {
    for (const seed of BUILTIN_AGENTS) {
      for (const id of CATALOG_IDS) {
        expect(seed.bio, `${seed.kind} bio names '${id}'`).not.toContain(id);
      }
    }
  });

  it('name no ADVERTISED tool name either — a rename would strand it just the same', () => {
    for (const seed of BUILTIN_AGENTS) {
      expect(seed.bio, `${seed.kind} bio`).not.toMatch(/\bbuiltin_[a-z0-9_]+/i);
      expect(seed.bio, `${seed.kind} bio`).not.toMatch(/\bmcp__[a-z0-9_]+/i);
    }
  });

  /**
   * The Manager's persona is the one that must positively instruct ACTION: the failure
   * it shipped with was narration, and a persona that merely describes reading the
   * record leaves the model free to describe reading it.
   */
  it('tells the Manager to CALL its tools rather than describe them', () => {
    const manager = BUILTIN_AGENTS.find((a) => a.kind === 'manager');
    expect(manager).toBeDefined();
    expect(manager?.bio).toMatch(/CALLING the manager tools/);
    expect(manager?.bio).toMatch(/never by describing them/);
  });
});

/**
 * The seed and the migrations must agree, or a tenant's persona depends on WHEN it was
 * created: 0376 backfills existing tenants, 0379 repairs them, and the seed covers every
 * tenant made since. Three writers, one text.
 */
describe('Manager persona · seed ⇄ migration parity', () => {
  const migration = (file: string): string =>
    readFileSync(fileURLToPath(new URL(`../../../migrations/${file}`, import.meta.url)), 'utf8');

  const managerBio = BUILTIN_AGENTS.find((a) => a.kind === 'manager')?.bio ?? '';
  /** SQL doubles a single quote to escape it; the seed is plain TypeScript. */
  const asSql = (text: string): string => text.replace(/'/g, "''");

  it('0376 seeds exactly the persona the code seeds', () => {
    expect(migration('0376_manager_chat.sql')).toContain(asSql(managerBio));
  });

  it('0379 repairs an existing row to exactly that persona', () => {
    const sql = migration('0379_manager_persona_no_tool_names.sql');
    // The replacement clause the repair writes must be the clause the seed carries —
    // otherwise a repaired tenant and a new tenant run different managers.
    const clause = managerBio.slice(
      managerBio.indexOf('it READS ITS OWN RECORD'),
      managerBio.indexOf('results are missing.') + 'results are missing.'.length,
    );
    expect(clause.length).toBeGreaterThan(80);
    expect(sql).toContain(asSql(clause));
  });

  it('0379 targets both spellings that were ever persisted', () => {
    const sql = migration('0379_manager_persona_no_tool_names.sql');
    // Rows from 0376 carry the catalog ids; rows from the corrected seed (api
    // 2026.7.171+) carry the advertised names. Repairing only one leaves half the
    // tenants narrating.
    expect(sql).toContain('manager.digest for what finished today');
    expect(sql).toContain('builtin_manager_digest for what finished today');
  });
});
