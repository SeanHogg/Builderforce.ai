import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { rollUpLlmUsage } from './llmUsageRollup';

/** Flatten a drizzle `sql` template into its text (parameters as their values). */
function dump(q: unknown): string {
  const o = q as { queryChunks?: unknown[]; value?: unknown };
  if (Array.isArray(o.queryChunks)) return o.queryChunks.map((c) => (typeof c === 'string' ? c : dump(c))).join('');
  if (Array.isArray(o.value)) return o.value.join('');
  if (o.value !== undefined) return String(o.value);
  return String(q);
}

async function foldStatement(): Promise<string> {
  const sqls: string[] = [];
  const db = {
    execute: (q: unknown) => {
      sqls.push(dump(q));
      return sqls.length === 1 ? { rows: [{ day: '2026-01-01' }] } : { rows: [{ tallies: 0, folded: 0 }] };
    },
  };
  await rollUpLlmUsage(db as unknown as Db, new Date('2026-06-01T00:00:00Z'), { maxDays: 1 });
  return sqls[1] ?? '';
}

describe('llmUsageRollup — per-turn telemetry survives the day fold', () => {
  it('sums reasoning + tool-schema tokens and keeps the max turn index', async () => {
    const fold = (await foldStatement()).replace(/\s+/g, ' ');
    expect(fold).toContain('SUM(reasoning_tokens)::int AS reasoning_tokens');
    expect(fold).toContain('SUM(tool_schema_tokens)::int AS tool_schema_tokens');
    expect(fold).toContain('MAX(turn_index) AS turn_index');
  });

  it('writes every new column back in the same order it selects them', async () => {
    const fold = (await foldStatement()).replace(/\s+/g, ' ');
    const insertCols = fold.match(/INSERT INTO llm_usage_log \(([^)]*)\)/)?.[1] ?? '';
    expect(insertCols).toContain('reasoning_tokens, tool_schema_tokens, turn_index, created_at');
    expect(fold).toContain('reasoning_tokens, tool_schema_tokens, turn_index, created_at FROM folded');
  });
});
