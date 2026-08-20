/**
 * The contract between what a seat ADVERTISES and what the platform WRITES.
 *
 * `financeRollup.ts` existed because `DOMAIN_MANIFEST` declared three finance
 * metrics, three surfaces read them by name, and nothing ever INSERTED one — a
 * live promise over an empty read that no guard could see, because a declared
 * metric and a written metric look identical from every other angle. The
 * per-domain source-scanning test that shipped with the sixteenth seat caught it
 * for `operations` only, by regex, one seat at a time.
 *
 * This is that assertion made STRUCTURAL and universal: every domain in the
 * roster has a writer, every key that writer declares is a key some seat charts,
 * and every key a seat charts has a writer. The fourteen domains that were
 * charting nothing cannot recur, and neither can the reverse — a metric computed
 * on every sweep that no surface will ever draw.
 */
import { describe, expect, it } from 'vitest';
import { DOMAINS } from './ObjectRegistry';
import { DOMAIN_MANIFEST, UNIVERSAL_METRICS, metricsFor } from './DomainService';
import { METRIC_ROLLUPS, ROLLUP_BY_DOMAIN, writtenMetricKeys } from './rollupRegistry';

/**
 * Keys a writer produces as INPUTS to another metric rather than for a chart.
 *
 * `finance.runway_months` is cash ÷ net burn, and both halves are read back out
 * of `metric_facts` by the aggregate that computes it. Publishing them is what
 * makes a runway figure checkable against the numbers that produced it — so they
 * are written and not charted, which is a working note and not the defect this
 * file exists to catch. Anything added here needs the same justification.
 */
const INTERMEDIATES = new Set(['finance.revenue', 'finance.cash', 'finance.monthly_burn']);

describe('every seat that charts a number has something that writes it', () => {
  it('gives every domain in the roster a rollup', () => {
    for (const domain of DOMAINS) {
      expect(ROLLUP_BY_DOMAIN[domain], `${domain} charts metrics and has no writer`).toBeDefined();
    }
  });

  it('writes every metric key the manifest declares', () => {
    const written = writtenMetricKeys();
    for (const domain of DOMAINS) {
      for (const metric of DOMAIN_MANIFEST[domain].metrics) {
        expect(written.has(metric), `${metric} is charted by the ${domain} seat and written by nobody`).toBe(true);
      }
    }
  });

  it('charts every metric key it writes', () => {
    const declared = new Set(DOMAINS.flatMap((d) => [...DOMAIN_MANIFEST[d].metrics]));
    for (const key of writtenMetricKeys()) {
      if (INTERMEDIATES.has(key)) continue;
      expect(declared.has(key), `${key} is written on every sweep and charted by no seat`).toBe(true);
    }
  });

  it('leaves the universal item/event keys to the registry projection', () => {
    // `<domain>.items` and `<domain>.events` are written by `registryProjection`
    // for every seat. A second writer for them would be two rollups upserting
    // the same point, which is the duplication the universal pair prevents.
    const written = writtenMetricKeys();
    for (const domain of DOMAINS) {
      for (const universal of UNIVERSAL_METRICS) {
        expect(
          written.has(`${domain}.${universal}`),
          `${domain}.${universal} must come from the registry sweep, not a rollup`,
        ).toBe(false);
      }
    }
    // …and the reverse, through the accessor every surface actually calls.
    expect(metricsFor('growth')).toContain('growth.items');
  });

  it('namespaces every written key to the domain that writes it', () => {
    // Two seats writing into one chart is how `metric_facts` rows from unrelated
    // features end up summed together.
    for (const rollup of METRIC_ROLLUPS) {
      for (const spec of rollup.metrics) {
        expect(spec.key, `${rollup.domain} writes ${spec.key}`).toMatch(new RegExp(`^${rollup.domain}\\.`));
      }
    }
  });

  it('declares each metric key exactly once across all writers', () => {
    // Two specs producing the same key would upsert the same point twice per
    // pass, and the second would silently win.
    const seen = new Set<string>();
    for (const rollup of METRIC_ROLLUPS) {
      for (const spec of rollup.metrics) {
        expect(seen.has(spec.key), `${spec.key} has two writers`).toBe(false);
        seen.add(spec.key);
      }
    }
  });

  it('lists every rollup once, in a stable order', () => {
    expect(METRIC_ROLLUPS.length).toBe(DOMAINS.length);
    expect(new Set(METRIC_ROLLUPS.map((r) => r.domain)).size).toBe(METRIC_ROLLUPS.length);
  });
});

describe('the numbers refuse rather than guess', () => {
  /** Every statement a writer would run against a database with everything present. */
  const allStatements = () => METRIC_ROLLUPS.flatMap((rollup) => {
    const present = new Set(ALL_TABLES);
    return rollup.metrics.flatMap((spec) => {
      const built = spec.build(present);
      return built ? (Array.isArray(built) ? built : [built]) : [];
    });
  });

  /**
   * Every table any writer names. Kept as a literal so a spec that starts
   * requiring a new table has to say so here too — the list is what lets this
   * suite build every statement without a database.
   */
  const ALL_TABLES = [
    'site_records', 'site_collections', 'project_sites', 'marketing_leads', 'site_users',
    'site_subscriptions', 'ad_insights', 'tasks', 'projects', 'executions', 'ai_usage_records',
    'job_applications', 'hiring_decisions', 'offer_letters', 'expenses', 'pay_runs', 'ledger_entries',
    'invoice_line_items', 'metric_facts', 'deals', 'orders', 'tenant_members', 'sessions',
    'people_employees', 'pulse_responses', 'uptime_samples', 'uptime_checks', 'soc_controls',
    'vulnerability_findings', 'qa_findings', 'portfolio_companies', 'investment_opportunities',
    'support_tickets', 'feedback_sentiments', 'creation_sessions', 'artifacts',
    'creation_outcome_events', 'connections', 'connector_connections', 'integration_sync_logs',
    'work_orders', 'work_order_visits', 'legal_matters', 'legal_entities', 'legal_registrations',
    'intellectual_property',
  ];

  it('never zero-fills: every statement is a grouped aggregate, so an absent row writes no fact', () => {
    for (const statement of allStatements()) {
      const text = JSON.stringify(statement);
      expect(text).toContain('INSERT INTO metric_facts');
      expect(text).toContain('ON CONFLICT');
    }
  });

  it('builds a statement for every metric when every source table exists', () => {
    const present = new Set(ALL_TABLES);
    for (const rollup of METRIC_ROLLUPS) {
      for (const spec of rollup.metrics) {
        for (const table of spec.requires) {
          expect(present.has(table), `${spec.key} requires ${table}, which this suite does not list`).toBe(true);
        }
        expect(spec.build(present), `${spec.key} produced no statement with every table present`).toBeTruthy();
      }
    }
  });

  it('skips a metric rather than failing the sweep when its source is absent', () => {
    // The whole point of `requires`: a projection map written against the target
    // schema lands ahead of some of it, and one missing table must not take the
    // other sixteen domains down with it.
    for (const rollup of METRIC_ROLLUPS) {
      for (const spec of rollup.metrics) {
        if (!spec.requires.length) continue;
        expect(() => spec.build(new Set())).not.toThrow();
      }
    }
  });
});
