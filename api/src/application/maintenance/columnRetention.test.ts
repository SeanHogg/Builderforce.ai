import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { REDACT_BATCH_ROWS } from './boundedPurge';
import {
  COLUMN_RETENTION,
  canvasCommandsStatement,
} from './columnRetention';
import { EXECUTION_OUTPUT_KEEP_CHARS, EXECUTION_OUTPUT_TRUNCATION_MARKER, truncateTerminalOutputStatement } from '../runtime/executionPayloadRetention';

const dialect = new PgDialect();
const toSql = (s: SQL) => dialect.sqlToQuery(s);
const CUTOFF = new Date('2026-10-01T00:00:00.000Z');
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

describe('canvas command body redaction', () => {
  const q = toSql(canvasCommandsStatement(CUTOFF));
  const text = flat(q.sql);

  it('replaces payload.commands with {count, types}', () => {
    expect(text).toContain("jsonb_set(payload, '{commands}'");
    expect(text).toContain("'count', jsonb_array_length(payload->'commands')");
    expect(text).toContain("jsonb_agg(DISTINCT c->>'type')");
  });

  it('only touches canvas.commands_applied rows whose commands are still an array (idempotent)', () => {
    expect(text).toContain("event_type = 'canvas.commands_applied'");
    expect(text).toContain("jsonb_typeof(payload->'commands') = 'array'");
  });

  it('is bounded', () => {
    expect(q.params).toContain(REDACT_BATCH_ROWS);
    expect(q.params).toContain(CUTOFF.toISOString());
  });
});

describe('COLUMN_RETENTION registry', () => {
  it('declares the domain-table entry with a unique name and a non-negative window', () => {
    expect(COLUMN_RETENTION.map((e) => e.name)).toEqual([
      'creation_session_events.commands',
    ]);
    for (const e of COLUMN_RETENTION) expect(e.afterDays).toBeGreaterThanOrEqual(0);
    expect(COLUMN_RETENTION.filter((e) => e.afterDays === 14)).toHaveLength(1);
  });
});

describe('terminal execution output truncation', () => {
  const q = toSql(truncateTerminalOutputStatement(CUTOFF));
  const text = flat(q.sql);

  it('caps result and error_message at ~1 KB with a marker', () => {
    expect(text).toContain('result = CASE WHEN char_length(result) >');
    expect(text).toContain('error_message = CASE WHEN char_length(error_message) >');
    expect(q.params).toContain(EXECUTION_OUTPUT_KEEP_CHARS);
    expect(q.params).toContain(EXECUTION_OUTPUT_TRUNCATION_MARKER);
  });

  it('only touches terminal runs, never live or paused ones', () => {
    expect(text).toContain("status IN ('completed', 'failed', 'cancelled')");
    expect(text).not.toContain("'running'");
    expect(text).not.toContain("'paused'");
  });

  it('is idempotent: a truncated value is exactly KEEP+marker long and the predicate needs strictly more', () => {
    const limit = EXECUTION_OUTPUT_KEEP_CHARS + EXECUTION_OUTPUT_TRUNCATION_MARKER.length;
    expect(q.params).toContain(limit);
    expect(text).toContain('char_length(result) > $');
  });

  it('is bounded', () => {
    expect(q.params).toContain(REDACT_BATCH_ROWS);
  });
});
