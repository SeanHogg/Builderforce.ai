/**
 * Every domain's metric writer, as ONE list.
 *
 * The registry is what makes "a seat's numbers are real" a property the platform
 * can ASSERT rather than a thing seventeen separate cron entries each hope is
 * true. `rollupRegistry.test.ts` walks `DOMAIN_MANIFEST` against this map and
 * fails when a declared metric key has no writer — the defect that left fourteen
 * of seventeen domains charting an empty read, and the one that is invisible from
 * every other angle because a declared metric and a written metric look identical
 * until somebody opens the panel.
 *
 * ORDER IS LOAD-BEARING. `finance` runs before nothing in particular but AFTER
 * the `object-registry` sweep (see `CRON_SWEEPS`), because `finance.runway_months`
 * reads back the burn/revenue/cash facts written earlier in the same pass, and
 * every attributed metric resolves its `object_id` against the registry that
 * sweep just refreshed.
 *
 * ADDING A DOMAIN'S NUMBERS is a module of `MetricSpec`s plus a line here.
 * Nothing else changes: the sweep, the log line and the contract test all read
 * this list.
 */

import type { Domain } from './ObjectRegistry';
import type { DomainRollup } from './metricRollup';

import { AGENTS_ROLLUP } from './rollups/agents';
import { CANVAS_ROLLUP } from './rollups/canvas';
import { COMMERCE_ROLLUP } from './rollups/commerce';
import { DELIVERY_ROLLUP } from './rollups/delivery';
import { FINANCE_ROLLUP } from './rollups/finance';
import { GOVERNANCE_ROLLUP } from './rollups/governance';
import { GROWTH_ROLLUP } from './rollups/growth';
import { HIRING_ROLLUP } from './rollups/hiring';
import { IDENTITY_ROLLUP } from './rollups/identity';
import { INTEGRATIONS_ROLLUP } from './rollups/integrations';
import { INVESTOR_ROLLUP } from './rollups/investor';
import { LEGAL_ROLLUP } from './rollups/legal';
import { OPERATIONS_ROLLUP } from './rollups/operations';
import { PEOPLE_ROLLUP } from './rollups/people';
import { PLATFORM_ROLLUP } from './rollups/platform';
import { REVENUE_ROLLUP } from './rollups/revenue';
import { SUPPORT_ROLLUP } from './rollups/support';

/**
 * In sweep order.
 *
 * `growth` leads deliberately: it is the path a built artifact's own customers
 * arrive on, and the one key the canvas prompt names by hand.
 */
export const METRIC_ROLLUPS: readonly DomainRollup[] = [
  GROWTH_ROLLUP,
  DELIVERY_ROLLUP,
  AGENTS_ROLLUP,
  HIRING_ROLLUP,
  FINANCE_ROLLUP,
  REVENUE_ROLLUP,
  COMMERCE_ROLLUP,
  IDENTITY_ROLLUP,
  PEOPLE_ROLLUP,
  PLATFORM_ROLLUP,
  GOVERNANCE_ROLLUP,
  INVESTOR_ROLLUP,
  SUPPORT_ROLLUP,
  CANVAS_ROLLUP,
  INTEGRATIONS_ROLLUP,
  OPERATIONS_ROLLUP,
  LEGAL_ROLLUP,
];

/** The same list by domain, for the contract test and for a targeted re-run. */
export const ROLLUP_BY_DOMAIN: Readonly<Partial<Record<Domain, DomainRollup>>> =
  Object.fromEntries(METRIC_ROLLUPS.map((r) => [r.domain, r]));

/** Every metric key any writer produces. */
export function writtenMetricKeys(): Set<string> {
  return new Set(METRIC_ROLLUPS.flatMap((r) => r.metrics.map((m) => m.key)));
}
