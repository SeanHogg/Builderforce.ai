/**
 * The audit export sweep against REAL Postgres (PGlite): the per-source cursor,
 * the at-least-once retry after a failed batch, and tenant scoping are SQL, so
 * they are proven on SQL. `admin_audit_log` is never a source — the operator
 * trail stays on the platform.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

vi.mock('./caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

import { signalsIncludeAudit, runOtelAuditSweep } from './otelAuditSweep';

let pg: PGlite;
let db: Db;
const env = {} as never;

const BASE = 'https://collector.test';

/** One call per source batch; each entry records the URL and parsed body. */
function collector() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response('{}', { status: 200 });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const logRecordIds = (body: Record<string, unknown>): string[] => {
  const logs = (body.resourceLogs as Array<{ scopeLogs: Array<{ logRecords: Array<{ attributes: Array<{ key: string; value: { stringValue?: string } }> }> }> }>)[0]!;
  return logs.scopeLogs[0]!.logRecords.map((r) => {
    const attr = r.attributes.find((a) => a.key === 'builderforce.audit.event_id');
    return attr?.value.stringValue ?? '';
  });
};

beforeAll(async () => {
  pg = new PGlite();
  // The tables the seven readers touch. `tenant_members` serves twice: it is
  // itself the memberships source AND the tenant scope for auth_user_sessions.
  await pg.exec(`CREATE TABLE tenants (id integer PRIMARY KEY)`);
  await pg.exec(`CREATE TABLE users (id varchar(36) PRIMARY KEY)`);
  await pg.exec(`CREATE TABLE tenant_members (
    id serial PRIMARY KEY, tenant_id integer NOT NULL, user_id varchar(36) NOT NULL,
    role varchar(32) NOT NULL DEFAULT 'developer', is_active boolean NOT NULL DEFAULT true,
    joined_at timestamp NOT NULL DEFAULT now(), seat_kind varchar(16) NOT NULL DEFAULT 'seat',
    monthly_spend_cap_millicents bigint, spend_notify_period varchar(7), spend_notify_level smallint NOT NULL DEFAULT 0)`);
  await pg.exec(`CREATE TABLE auth_user_sessions (
    id uuid PRIMARY KEY, user_id varchar(36) NOT NULL, session_name varchar(120),
    ip_address varchar(64), revoked_at timestamp, created_at timestamp NOT NULL DEFAULT now(),
    last_seen_at timestamp NOT NULL DEFAULT now())`);
  await pg.exec(`CREATE TABLE tenant_api_keys (
    id uuid PRIMARY KEY, tenant_id integer NOT NULL, name varchar(255) NOT NULL,
    key_hash varchar(64) NOT NULL, created_by_user_id varchar(36), allowed_origins jsonb,
    scopes text, last_used_at timestamptz, client varchar(32),
    revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`);
  await pg.exec(`CREATE TABLE audit_report_runs (
    id serial PRIMARY KEY, tenant_id integer NOT NULL, period_month varchar(7) NOT NULL,
    generated_by varchar(36), summary jsonb, created_at timestamp NOT NULL DEFAULT now())`);
  await pg.exec(`CREATE TABLE connector_connections (
    id uuid PRIMARY KEY, tenant_id integer NOT NULL, connector_key varchar(64) NOT NULL,
    name varchar(255) NOT NULL, credentials_enc text NOT NULL, iv varchar(64) NOT NULL,
    base_url_override varchar(500), enabled boolean NOT NULL DEFAULT true,
    last_tested_at timestamp, last_test_ok boolean, last_used_at timestamp,
    created_by_user_id varchar(36), created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now())`);
  await pg.exec(`CREATE TABLE approval_actions (
    id serial PRIMARY KEY, tenant_id integer NOT NULL, subject_kind varchar(32) NOT NULL,
    subject_ref varchar(64) NOT NULL, approver_kind varchar(16) NOT NULL DEFAULT 'user',
    approver_ref varchar(64) NOT NULL, step integer NOT NULL DEFAULT 1,
    state varchar(16) NOT NULL DEFAULT 'waiting', requested_at timestamp, acted_at timestamp,
    created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`);
  // tool_audit_events lives on the OPERATIONAL endpoint in production, resolved
  // through runTelemetryDatabase(); with no split configured PGlite is both.
  await pg.exec(`CREATE TABLE tool_audit_events (
    id serial PRIMARY KEY, tenant_id integer NOT NULL, agent_host_id integer,
    cloud_agent_ref varchar(64), execution_id integer, run_id varchar(255),
    session_key varchar(255), tool_call_id varchar(255), tool_name varchar(255) NOT NULL,
    category varchar(100), args text, result text, duration_ms integer,
    ts timestamp NOT NULL DEFAULT now(), created_at timestamp NOT NULL DEFAULT now())`);
  await pg.exec(`CREATE TABLE otel_exporters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id integer NOT NULL,
    name varchar(255) NOT NULL, endpoint text NOT NULL,
    headers_enc text, headers_iv varchar(64), service_name varchar(255),
    sample_rate real NOT NULL DEFAULT 1, signals varchar(16) NOT NULL DEFAULT 'traces',
    audit_cursor jsonb, enabled boolean NOT NULL DEFAULT true,
    last_export_at timestamptz, last_error text, consecutive_failures integer NOT NULL DEFAULT 0,
    created_by varchar(36), created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now())`);
  db = drizzle(pg) as unknown as Db;
});
afterAll(async () => { await pg.close(); });

beforeEach(async () => {
  await pg.exec('TRUNCATE tenants, users, tenant_members, auth_user_sessions, tenant_api_keys, audit_report_runs, connector_connections, approval_actions, tool_audit_events, otel_exporters');
});

async function seedExporter(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  await pg.query(
    `INSERT INTO otel_exporters (id, tenant_id, name, endpoint, signals, enabled) VALUES ($1, 1, 'test', $2, $3, $4)`,
    [id, BASE, overrides.signals ?? 'audit', overrides.enabled ?? true],
  );
  return id;
}

const row = async (id: string) => (await pg.query(`SELECT * FROM otel_exporters WHERE id = $1`, [id])).rows[0] as Record<string, unknown>;
const cursorOf = async (id: string) => (await row(id)).audit_cursor as Record<string, unknown> | null;
const failuresOf = async (id: string) => (await row(id)).consecutive_failures as number;

describe('signalsIncludeAudit', () => {
  it('gates the sweep to audit-enabled exporters only', () => {
    expect(signalsIncludeAudit('traces')).toBe(false);
    expect(signalsIncludeAudit('audit')).toBe(true);
    expect(signalsIncludeAudit('both')).toBe(true);
  });
});

describe('runOtelAuditSweep', () => {
  it('ships every source events as OTLP logs to the collector logs path', async () => {
    await seedExporter();
    await pg.query(`INSERT INTO tenants (id) VALUES (1), (2)`);
    await pg.query(`INSERT INTO users (id) VALUES ('u1'), ('u2')`);
    await pg.query(`INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (1, 'u1', 'manager'), (2, 'u2', 'viewer')`);
    await pg.query(`INSERT INTO auth_user_sessions (id, user_id) VALUES ('${crypto.randomUUID()}', 'u1'), ('${crypto.randomUUID()}', 'u2')`);
    await pg.query(`INSERT INTO tenant_api_keys (id, tenant_id, name, key_hash) VALUES ('${crypto.randomUUID()}', 1, 'k1', 'h1')`);
    await pg.query(`INSERT INTO audit_report_runs (tenant_id, period_month) VALUES (1, '2026-11')`);
    await pg.query(`INSERT INTO connector_connections (id, tenant_id, connector_key, name) VALUES ('${crypto.randomUUID()}', 1, 'slack', 'team')`);
    await pg.query(`INSERT INTO approval_actions (tenant_id, subject_kind, subject_ref, approver_ref) VALUES (1, 'run', '42', 'u1')`);
    await pg.query(`INSERT INTO tool_audit_events (tenant_id, tool_name) VALUES (1, 'read_file'), (2, 'delete_file')`);

    const { calls, fetchImpl } = collector();
    const result = await runOtelAuditSweep(env, db, fetchImpl);
    expect(result).toEqual({ tenants: 1, sent: 7, failed: 0 });

    // Every batch posted to the logs path, never a signal-suffixed base.
    const urls = [...new Set(calls.map((c) => c.url))];
    expect(urls).toEqual([`${BASE}/v1/logs`]);

    const allIds = calls.flatMap((c) => logRecordIds(c.body));
    expect(allIds).toHaveLength(7);
    // Tenant 2's membership, session and tool call are not this tenant's events.
    expect(allIds.some((i) => i.startsWith('memberships:'))).toBe(true);
    expect(allIds.some((i) => i.startsWith('tool_calls:'))).toBe(true);
    const toolCallEvents = calls.flatMap((c) => logRecordIds(c.body)).filter((i) => i.startsWith('tool_calls:'));
    expect(toolCallEvents).toHaveLength(1); // only tenant 1's tool call
  });

  it('advances a per-source cursor and exports nothing on the next pass', async () => {
    const id = await seedExporter();
    await pg.query(`INSERT INTO tenants (id) VALUES (1)`);
    await pg.query(`INSERT INTO audit_report_runs (tenant_id, period_month) VALUES (1, '2026-10'), (1, '2026-11')`);

    const first = collector();
    expect((await runOtelAuditSweep(env, db, first.fetchImpl)).sent).toBe(2);
    const cursor = await cursorOf(id);
    expect(cursor).not.toBeNull();

    const second = collector();
    expect((await runOtelAuditSweep(env, db, second.fetchImpl)).sent).toBe(0);
    expect(second.calls).toHaveLength(0); // no new events, no posts

    // A new event beyond the cursor is picked up; the cursor moves on.
    await pg.query(`INSERT INTO audit_report_runs (tenant_id, period_month) VALUES (1, '2026-12')`);
    const third = collector();
    expect((await runOtelAuditSweep(env, db, third.fetchImpl)).sent).toBe(1);
    expect(logRecordIds(third.calls[0]!.body)).toEqual([`exports:3`]);
    const later = await cursorOf(id);
    expect(later!['exports']).toBeGreaterThan(cursor!['exports'] as number);
  });

  it('the cursor survives a failed batch: no loss on retry, no duplication', async () => {
    const id = await seedExporter();
    await pg.query(`INSERT INTO tenants (id) VALUES (1)`);
    await pg.query(`INSERT INTO audit_report_runs (tenant_id, period_month) VALUES (1, '2026-10'), (1, '2026-11')`);

    // First batch fails (collector 500). The cursor must NOT advance.
    const failing = vi.fn(async () => new Response('err', { status: 500 })) as unknown as typeof fetch;
    const failed = await runOtelAuditSweep(env, db, failing);
    expect(failed).toEqual({ tenants: 1, sent: 0, failed: 1 });
    expect(await cursorOf(id)).toBeNull(); // nothing confirmed, cursor untouched
    expect(await failuresOf(id)).toBe(1); // outage shows on the exporter row

    // Retry succeeds: BOTH events are delivered (at-least-once), deduped by id.
    const retry = collector();
    const recovered = await runOtelAuditSweep(env, db, retry.fetchImpl);
    expect(recovered).toEqual({ tenants: 1, sent: 2, failed: 0 });
    expect(retry.calls.flatMap((c) => logRecordIds(c.body))).toHaveLength(2);
    expect(await failuresOf(id)).toBe(0);
    expect((await row(id)).last_error).toBeNull();
  });

  it('skips exporters that are disabled or traces-only', async () => {
    await seedExporter({ signals: 'traces' });
    await seedExporter({ signals: 'audit', enabled: false });
    await pg.query(`INSERT INTO tenants (id) VALUES (1)`);
    await pg.query(`INSERT INTO audit_report_runs (tenant_id, period_month) VALUES (1, '2026-11')`);

    const { calls, fetchImpl } = collector();
    const result = await runOtelAuditSweep(env, db, fetchImpl);
    expect(result.tenants).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
