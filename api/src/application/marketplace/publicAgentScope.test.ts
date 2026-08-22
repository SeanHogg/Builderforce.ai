import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { eq, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ideAgents } from '../../infrastructure/database/schema';
import { demoTenantAgent, notDemoTenant, publicAgentScope, publiclyListedAgent } from './publicAgentScope';

const dialect = new PgDialect();

/** The rendered SQL of a drizzle predicate, for shape assertions. */
function text(predicate: SQL): string {
  return dialect.sqlToQuery(predicate).sql;
}

describe('publicAgentScope', () => {
  it('always carries active + published + not-a-demo-tenant', () => {
    const sql = text(publicAgentScope());
    expect(sql).toContain('status');
    expect(sql).toContain('published');
    expect(sql).toContain('is_demo');
  });

  it('keeps the demo exclusion when a caller adds its own conditions', () => {
    // The failure this pins: a detail read that passes `eq(id, …)` and silently
    // loses the demo filter would make a fixture agent fetchable by id even
    // though the listing hides it.
    const sql = text(publicAgentScope(eq(ideAgents.id, 'agent-1')));
    expect(sql).toContain('is_demo');
    expect(sql).toContain('published');
  });

  it('exposes the demo test in both polarities, over the same table column', () => {
    expect(text(notDemoTenant)).toContain('NOT EXISTS');
    expect(text(demoTenantAgent)).toContain('EXISTS');
    expect(text(demoTenantAgent)).not.toContain('NOT EXISTS');
  });

  it('publiclyListedAgent is the same predicate without the cross-tenant declaration', () => {
    expect(text(publiclyListedAgent())).toContain('is_demo');
  });
});

/**
 * THE DRIFT GUARD.
 *
 * The bug this whole module exists to close was not a missing filter — it was
 * EIGHT independent answers to "which agents are public", of which two excluded
 * demo fixtures and six did not. A ninth hand-rolled `eq(published, true)` next
 * to `eq(status, 'active')` would reopen it silently, so the shape itself is
 * what the test forbids.
 */
describe('no second definition of "a public agent"', () => {
  const FILES = [
    'presentation/routes/workforceRoutes.ts',
    'presentation/routes/ideRoutes.ts',
    'application/marketplace/agentCommerce.ts',
    'application/llm/builtinMcpService.ts',
  ];

  it.each(FILES)('%s reads published agents through publicAgentScope', (relative) => {
    const source = readFileSync(join(__dirname, '../..', relative), 'utf8');
    // Every file that mentions the published flag must import the primitive…
    expect(source).toContain('publicAgentScope');
    // …and must not re-state the predicate inline.
    expect(source).not.toMatch(/eq\(ideAgents\.published,\s*true\)/);
  });
});
