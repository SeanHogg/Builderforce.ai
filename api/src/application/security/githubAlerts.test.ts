import { describe, it, expect } from 'vitest';
import {
  mapAlertSeverity,
  alertMarker,
  openAlertMarkers,
  codeScanningFinding,
  dependabotFinding,
  ingestAlertWebhook,
  INGESTABLE_ALERT_ACTIONS,
  ALERT_EVENTS,
} from './githubAlerts';
import { tasks, projectRepositories, projects } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

// ── Fakes ────────────────────────────────────────────────────────────────────
// A thenable drizzle-ish query builder: every chained call returns itself and the
// awaited value is whatever `rows(table)` yields for the table passed to .from().
// Enough for the two reads under test (resolveRepoLink + openAlertMarkers) without
// standing up a database.
function fakeDb(rows: (table: unknown) => unknown[]): Db {
  const builder: Record<string, unknown> = {};
  let current: unknown = null;
  Object.assign(builder, {
    select: () => builder,
    from: (t: unknown) => { current = t; return builder; },
    where: () => builder,
    limit: () => builder,
    orderBy: () => builder,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(rows(current)).then(res, rej),
  });
  return builder as unknown as Db;
}

const csAlert = (over: Record<string, unknown> = {}) => ({
  number: 42,
  state: 'open',
  html_url: 'https://github.com/acme/app/security/code-scanning/42',
  tool: { name: 'CodeQL' },
  rule: {
    id: 'js/sql-injection',
    description: 'Database query built from user-controlled sources',
    severity: 'error',
    security_severity_level: 'high',
    full_description: 'Building a SQL query from user input is unsafe.',
    help: 'Use a parameterised query.',
  },
  most_recent_instance: {
    message: { text: 'user input flows to a query' },
    location: { path: 'src/db/query.ts', start_line: 88, end_line: 88 },
  },
  ...over,
});

const dbAlert = (over: Record<string, unknown> = {}) => ({
  number: 7,
  state: 'open',
  html_url: 'https://github.com/acme/app/security/dependabot/7',
  dependency: { package: { ecosystem: 'npm', name: 'lodash' }, manifest_path: 'api/package.json' },
  security_advisory: {
    ghsa_id: 'GHSA-xxxx', cve_id: 'CVE-2021-23337', severity: 'high',
    summary: 'Command injection in lodash', description: 'lodash template allows command injection.',
  },
  security_vulnerability: {
    severity: 'high',
    vulnerable_version_range: '< 4.17.21',
    first_patched_version: { identifier: '4.17.21' },
  },
  ...over,
});

const hook = (event: string, action: string, alert: unknown) => ({
  action,
  alert,
  repository: { full_name: 'acme/app' },
  __event: event,
});

// ── Severity mapping ─────────────────────────────────────────────────────────

describe('mapAlertSeverity', () => {
  it('maps GitHub\'s CVSS-derived scale 1:1', () => {
    expect(mapAlertSeverity('critical')).toBe('critical');
    expect(mapAlertSeverity('high')).toBe('high');
    expect(mapAlertSeverity('medium')).toBe('medium');
    expect(mapAlertSeverity('low')).toBe('low');
  });

  it('treats GHSA "moderate" as medium', () => {
    expect(mapAlertSeverity('moderate')).toBe('medium');
  });

  it('maps the lint-style rule.severity scale conservatively downward', () => {
    // error must NOT become critical — a non-security CodeQL rule would mint URGENT.
    expect(mapAlertSeverity('error')).toBe('high');
    expect(mapAlertSeverity('warning')).toBe('medium');
    expect(mapAlertSeverity('note')).toBe('info');
    expect(mapAlertSeverity('none')).toBe('info');
  });

  it('prefers the first recognised candidate (security_severity_level over severity)', () => {
    expect(mapAlertSeverity('low', 'error')).toBe('low');
    expect(mapAlertSeverity(null, 'error')).toBe('high');
    expect(mapAlertSeverity(undefined, null, 'critical')).toBe('critical');
  });

  it('defaults to medium on unknown/absent — an unclassified alert is not low risk', () => {
    expect(mapAlertSeverity()).toBe('medium');
    expect(mapAlertSeverity(null, undefined)).toBe('medium');
    expect(mapAlertSeverity('wat')).toBe('medium');
  });

  it('is case/whitespace insensitive', () => {
    expect(mapAlertSeverity('  HIGH ')).toBe('high');
  });
});

// ── Payload mapping ──────────────────────────────────────────────────────────

describe('codeScanningFinding', () => {
  it('maps rule + location + severity', () => {
    const f = codeScanningFinding(csAlert(), 'acme/app')!;
    expect(f.source).toBe('code-scanning');
    expect(f.number).toBe(42);
    expect(f.severity).toBe('high');                       // security_severity_level wins
    expect(f.location).toBe('src/db/query.ts:88');         // path + start_line
    expect(f.title).toContain('CodeQL');
    expect(f.title).toContain('Database query built from user-controlled sources');
    expect(f.title).toContain('[gh:code-scanning:acme/app#42]');
    expect(f.recommendation).toBe('Use a parameterised query.');
    expect(f.detail).toContain('js/sql-injection');
  });

  it('falls back to rule.severity when no security_severity_level is present', () => {
    const a = csAlert({ rule: { id: 'js/unused', severity: 'note', description: 'Unused variable' } });
    expect(codeScanningFinding(a, 'acme/app')!.severity).toBe('info');
  });

  it('degrades to a path-only location when there is no line', () => {
    const a = csAlert({ most_recent_instance: { location: { path: 'src/x.ts' } } });
    expect(codeScanningFinding(a, 'acme/app')!.location).toBe('src/x.ts');
  });

  it('returns null rather than throwing on a payload with no alert number', () => {
    expect(codeScanningFinding({}, 'acme/app')).toBeNull();
    expect(codeScanningFinding(null, 'acme/app')).toBeNull();
  });
});

describe('dependabotFinding', () => {
  it('maps advisory + manifest path + patched version', () => {
    const f = dependabotFinding(dbAlert(), 'acme/app')!;
    expect(f.source).toBe('dependabot');
    expect(f.severity).toBe('high');
    expect(f.location).toBe('api/package.json');          // manifest is the actionable location
    expect(f.title).toContain('Command injection in lodash');
    expect(f.title).toContain('[gh:dependabot:acme/app#7]');
    expect(f.recommendation).toContain('4.17.21');
    expect(f.detail).toContain('CVE-2021-23337');
  });

  it('falls back to the per-vulnerability severity', () => {
    const a = dbAlert({ security_advisory: { summary: 's' }, security_vulnerability: { severity: 'critical' } });
    expect(dependabotFinding(a, 'acme/app')!.severity).toBe('critical');
  });

  it('says so when no patched version exists', () => {
    const a = dbAlert({ security_vulnerability: { severity: 'low' } });
    expect(dependabotFinding(a, 'acme/app')!.recommendation).toContain('No patched version');
  });

  it('returns null on an unmappable payload', () => {
    expect(dependabotFinding({ dependency: {} }, 'acme/app')).toBeNull();
  });
});

// ── Action filtering ─────────────────────────────────────────────────────────

describe('action filtering', () => {
  const emptyDb = fakeDb(() => []);

  it('declares only the opening half of the lifecycle ingestable', () => {
    for (const a of ['created', 'reopened', 'reopened_by_user', 'reintroduced', 'auto_reopened', 'appeared_in_branch']) {
      expect(INGESTABLE_ALERT_ACTIONS.has(a)).toBe(true);
    }
    for (const a of ['fixed', 'closed_by_user', 'dismissed', 'auto_dismissed', 'resolved']) {
      expect(INGESTABLE_ALERT_ACTIONS.has(a)).toBe(false);
    }
  });

  it.each(['fixed', 'closed_by_user', 'dismissed', 'auto_dismissed'])(
    'mints NO work for action=%s', async (action) => {
      const res = await ingestAlertWebhook(emptyDb, 'code_scanning_alert', hook('code_scanning_alert', action, csAlert()));
      expect(res.ok).toBe(false);
      expect(res.ok === false && res.code).toBe('action_not_ingestable');
    },
  );

  it('gets past the action filter on created (and then fails on repo linkage, not action)', async () => {
    const res = await ingestAlertWebhook(emptyDb, 'dependabot_alert', hook('dependabot_alert', 'created', dbAlert()));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.code).toBe('no_repo_link');
  });

  it('rejects a non-alert event', async () => {
    expect(ALERT_EVENTS.has('code_scanning_alert')).toBe(true);
    expect(ALERT_EVENTS.has('push')).toBe(false);
    const res = await ingestAlertWebhook(emptyDb, 'push', hook('push', 'created', csAlert()));
    expect(res.ok === false && res.code).toBe('unsupported_event');
  });

  it('rejects a payload with no repository', async () => {
    const res = await ingestAlertWebhook(emptyDb, 'code_scanning_alert', { action: 'created', alert: csAlert() });
    expect(res.ok === false && res.code).toBe('bad_payload');
  });
});

// ── Dedupe guard ─────────────────────────────────────────────────────────────

describe('dedupe', () => {
  it('produces a stable, case-normalised marker per repo + alert number', () => {
    expect(alertMarker('code-scanning', 'Acme/App', 42)).toBe('[gh:code-scanning:acme/app#42]');
    expect(alertMarker('dependabot', 'acme/app', 7)).toBe('[gh:dependabot:acme/app#7]');
    // The marker is what the finding title carries — the two must agree.
    expect(codeScanningFinding(csAlert(), 'acme/app')!.title)
      .toContain(alertMarker('code-scanning', 'acme/app', 42));
  });

  it('extracts markers from open task titles', async () => {
    const db = fakeDb((t) => (t === tasks ? [
      { title: 'CodeQL: something [gh:code-scanning:acme/app#42]' },
      { title: 'Dependabot: lodash [gh:dependabot:acme/app#7]' },
      { title: 'An unrelated ticket' },
    ] : []));
    const markers = await openAlertMarkers(db, 1);
    expect(markers.has('[gh:code-scanning:acme/app#42]')).toBe(true);
    expect(markers.has('[gh:dependabot:acme/app#7]')).toBe(true);
    expect(markers.size).toBe(2);
  });

  it('returns an empty set (always-file fallback) when the read fails', async () => {
    const boom = { select: () => { throw new Error('db down'); } } as unknown as Db;
    expect((await openAlertMarkers(boom, 1)).size).toBe(0);
  });

  it('re-delivery of the same alert mints no second ticket', async () => {
    // repo IS linked, and an OPEN ticket already carries this alert's marker.
    const db = fakeDb((t) => {
      if (t === projectRepositories) return [{ tenantId: 3, projectId: 9 }];
      if (t === projects) return [];
      if (t === tasks) return [{ title: 'CodeQL: dupe [gh:code-scanning:acme/app#42]' }];
      return [];
    });
    const res = await ingestAlertWebhook(db, 'code_scanning_alert', hook('code_scanning_alert', 'created', csAlert()));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ingested).toBe(0);
      expect(res.deduped).toBe(1);
      expect(res.taskIds).toEqual([]);
      expect(res.auditId).toBeNull();   // no empty audit row for a redelivery
    }
  });

  it('does not dedupe a different alert number on the same repo', async () => {
    const db = fakeDb((t) => {
      if (t === projectRepositories) return [{ tenantId: 3, projectId: 9 }];
      if (t === tasks) return [{ title: 'CodeQL: other [gh:code-scanning:acme/app#41]' }];
      return [];
    });
    // #42 is not tracked → it survives dedupe and reaches startAudit, which fails
    // against this fake (no real project row). The point is that it was NOT skipped.
    const res = await ingestAlertWebhook(db, 'code_scanning_alert', hook('code_scanning_alert', 'created', csAlert()));
    expect(res.ok === false && res.code).toBe('no_project');
  });
});
