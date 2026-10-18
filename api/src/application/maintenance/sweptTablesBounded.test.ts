import { describe, expect, it } from 'vitest';
import { buildDatabase } from '../../infrastructure/database/connection';
import { MACHINE_LIFECYCLE_VERBS, purgeVisitorActivity } from '../marketing/visitorActivity';
import type { PurgeStatement } from './boundedPurge';
import { SWEPT_TABLES } from './sweptTables';
import { BOUNDED_TELEMETRY_TABLES, EXPIRED_CREDENTIAL_TABLES } from './sweptTablesBounded';

const realDb = buildDatabase({ NEON_DATABASE_URL: 'postgresql://user:pw@localhost/db' } as Parameters<typeof buildDatabase>[0]);
const toSQL = (s: PurgeStatement) => (s as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL();
const CUTOFF = new Date('2026-01-01T00:00:00.000Z');
const byName = (relation: string) => {
  const entry = SWEPT_TABLES.find((t) => t.relation === relation);
  if (!entry) throw new Error(`no SWEPT_TABLES entry for ${relation}`);
  return entry;
};

const TELEMETRY_WINDOWS: Record<string, number> = {
  telemetry_spans: 30, connector_call_logs: 90, outbound_fetch_log: 90, agent_inference_logs: 90,
  catalog_adoption_events: 180, newsletter_events: 400, email_delivery_failures: 90, webhook_deliveries: 90,
  deliveries: 180, monitor_events: 90, alert_events: 180, ide_training_logs: 90,
  marketing_sessions: 90, marketing_session_prompts: 90, marketing_heatmap_pages: 90,
  project_insight_events: 180,
  usage_snapshots: 90, run_model_outcomes: 400,
  replay_visit_summaries: 400, replay_releases: 400,
};

describe('bounded telemetry retention entries', () => {
  it('registers every table once, on the declared window', () => {
    for (const [relation, days] of Object.entries(TELEMETRY_WINDOWS)) {
      expect(byName(relation).retentionDays, relation).toBe(days);
    }
    const names = SWEPT_TABLES.map((t) => t.relation);
    expect(new Set(names).size).toBe(names.length);
    expect(BOUNDED_TELEMETRY_TABLES.map((t) => t.relation).sort()).toEqual(Object.keys(TELEMETRY_WINDOWS).sort());
  });

  it('puts the run-telemetry tables on BOTH endpoints and everything else on core only', () => {
    const both = ['usage_snapshots', 'run_model_outcomes', 'replay_visit_summaries', 'replay_releases'];
    for (const relation of Object.keys(TELEMETRY_WINDOWS)) {
      expect([...byName(relation).connections].sort(), relation).toEqual(both.includes(relation) ? ['primary', 'transactional'] : ['primary']);
    }
  });

  it('deletes through a bounded ctid statement on the right table', () => {
    for (const table of [...BOUNDED_TELEMETRY_TABLES, ...EXPIRED_CREDENTIAL_TABLES]) {
      const q = toSQL(table.purge(realDb, CUTOFF));
      expect(q.sql, table.relation).toMatch(new RegExp(`^delete from "${table.relation}" where ctid = any\\(array\\(select ctid from "${table.relation}" where .* limit \\$\\d+\\)\\)$`));
    }
  });

  it('never deletes a webhook still awaiting retry or a delivery still queued', () => {
    expect(toSQL(byName('webhook_deliveries').purge(realDb, CUTOFF)).sql).toContain('"next_retry_at" is null');
    const deliveries = toSQL(byName('deliveries').purge(realDb, CUTOFF));
    expect(deliveries.sql).toContain('"status" in');
    expect(deliveries.params).toEqual(expect.arrayContaining(['sent', 'delivered', 'bounced', 'failed']));
    expect(deliveries.params).not.toContain('queued');
  });
});

describe('immutable audit tables', () => {
  it('are deliberately not swept (their immutability triggers reject every DELETE)', () => {
    for (const relation of ['execution_claims', 'execution_claim_evidence', 'agent_context_contributions', 'agent_outbound_inspections', 'agent_run_principals']) {
      expect(SWEPT_TABLES.some((t) => t.relation === relation), relation).toBe(false);
    }
  });
});

describe('expired credential retention entries', () => {
  const EXPECTED = ['auth_tokens', 'auth_user_sessions', 'magic_link_tokens', 'email_otp_challenges', 'device_authorizations',
    'execution_limits', 'preview_sessions', 'resource_leases'];

  it('declares each expiry purge on core, never rewritable (credentials are not best-effort logs)', () => {
    expect(EXPIRED_CREDENTIAL_TABLES.map((t) => t.relation)).toEqual(EXPECTED);
    for (const table of EXPIRED_CREDENTIAL_TABLES) {
      expect(table.connections, table.relation).toEqual(['primary']);
      expect(table.reclaimable, table.relation).toBe(false);
    }
  });

  it('ages token-like rows by their own expiry plus a 7-day grace', () => {
    for (const relation of ['auth_tokens', 'magic_link_tokens', 'email_otp_challenges', 'device_authorizations', 'resource_leases']) {
      expect(byName(relation).retentionDays, relation).toBe(7);
      expect(toSQL(byName(relation).purge(realDb, CUTOFF)).sql, relation).toContain('"expires_at" <');
    }
  });

  it('removes sessions revoked, or deactivated, more than 90 days ago and no live ones', () => {
    const entry = byName('auth_user_sessions');
    expect(entry.retentionDays).toBe(90);
    const sql = toSQL(entry.purge(realDb, CUTOFF)).sql;
    expect(sql).toContain('"revoked_at" is not null');
    expect(sql).toContain('"is_active" = $');
    expect(sql).toContain('"last_seen_at" <');
  });

  it('drops execution limits only when their run has no unexpired principal (the principals themselves are immutable-cascaded and not swept)', () => {
    const q = toSQL(byName('execution_limits').purge(realDb, CUTOFF));
    expect(q.sql).toContain('not exists (select 1 from "agent_run_principals"');
    expect(q.sql).toContain('"agent_run_principals"."expires_at" >=');
    expect(q.sql).toContain('"execution_limits"."created_at" <');
  });
});

describe('activity_log machine lifecycle verbs', () => {
  it('names exactly the eight machine verbs', () => {
    expect([...MACHINE_LIFECYCLE_VERBS]).toEqual([
      'execution.running', 'execution.submitted', 'execution.completed', 'execution.failed',
      'execution.snapshot', 'agent.replied', 'manager.pass', 'ticket.role.dispatched',
    ]);
  });

  it('purges visitor rows OR those verbs, older than the window, and nothing else', () => {
    const q = toSQL(purgeVisitorActivity(realDb, CUTOFF));
    expect(q.sql).toContain('"actor_type" = $');
    expect(q.sql).toContain('"verb" in (');
    expect(q.sql).toContain('"occurred_at" <');
    expect(q.params).toEqual(expect.arrayContaining(['visitor', ...MACHINE_LIFECYCLE_VERBS]));
  });
});
