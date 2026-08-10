/**
 * Platform & observability entities — owned by **the platform** (PRD 20 §3.2,
 * migration 0427).
 *
 * A monitor and a dashboard are things a person opens; a check is a measurement
 * and a queue row is work in flight, so neither is editable through a generic
 * surface — a queue row a human moves is a job that runs twice or never.
 */
import {
  dashboardLayouts,
  metricThresholds,
  platformPricing,
  platformPricingConfiguration,
  queueJobToProcess,
  queueJobToResume,
  reportApprovals,
  systemFeatures,
  uptimeChecks,
  uptimeMonitors,
} from '../../../infrastructure/database/schema/platform';
import { defineDomainEntities, entity } from '../entityDefinition';

export const PLATFORM_ENTITIES = defineDomainEntities('platform', [
  entity(uptimeMonitors, { kind: 'monitor', registers: true }),
  entity(dashboardLayouts, { kind: 'dashboard', registers: true }),
  metricThresholds,
  reportApprovals,
  systemFeatures,
  platformPricing,
  entity(uptimeChecks, { readOnly: true }),
  entity(queueJobToProcess, { readOnly: true }),
  entity(queueJobToResume, { readOnly: true }),
  /** The pricing publisher owns draft/published promotion as one transaction. */
  entity(platformPricingConfiguration, { readOnly: true }),
]);
