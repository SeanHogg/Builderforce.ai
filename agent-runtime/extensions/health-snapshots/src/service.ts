/**
 * Health Snapshots Service
 * Captures, stores, retrieves, and compares health snapshots from diagnostic events.
 */

import { metrics, trace } from '@opentelemetry/api';
import type {
  BuilderForceAgentsPluginService,
  DiagnosticEventPayload,
  Logger,
  Config,
} from '@seanhogg/builderforce-agents/plugin-sdk';
import type {
  HealthSnapshot,
  HealthStatus,
  SnapshotComparison,
  SnapshotListFilters,
  SnapshotListResponse,
  SnapshotSource,
  HealthSnapshotsConfig,
  ComponentHealth,
  ResourceUsage,
} from './types.js';

const DEFAULT_CONFIG: Required<HealthSnapshotsConfig> = {
  scheduleIntervalMs: 300_000, // 5 minutes
  retentionDays: 90,
  trackComponents: true,
  trackResourceUsage: true,
  trackVersion: true,
  incidentThreshold: 1,
};

/**
 * Capture a snapshot from current state
 */
function captureSnapshot(
  logger: Logger,
  config: Required<HealthSnapshotsConfig>,
  statusCounts: { healthy: number; degraded: number; unhealthy: number },
  componentStates: Map<string, ComponentHealth>,
  resourceUsage: ResourceUsage,
  incidents: number,
  version?: string,
  source?: SnapshotSource,
  deploymentId?: string,
  commitSha?: string,
): HealthSnapshot {
  // Derive overall status
  let overallStatus: HealthStatus;
  if (statusCounts.unhealthy > 0) {
    overallStatus = 'unhealthy';
  } else if (statusCounts.degraded > 0) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'healthy';
  }

  // Compose component health list
  const components = Array.from(componentStates.values());

  const snapshot: HealthSnapshot = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    status: overallStatus,
    components,
    resourceUsage: config.trackResourceUsage ? resourceUsage : undefined,
    activeIncidentCount: incidents,
    version: config.trackVersion ? version : undefined,
    source: source ?? 'scheduled',
    deploymentId,
    commitSha,
  };

  logger.debug({ componentCount: components.length }, 'Health snapshot captured');
  return snapshot;
}

/**
 * Compute numeric delta for a field that may be undefined (added or removed)
 */
function computeNumericDelta(prev: number | undefined, cur: number | undefined): number {
  if (prev === undefined) return cur === undefined ? 0 : cur; // added
  if (cur === undefined) return -prev; // removed
  return cur - prev;
}

/**
 * Compute absolute and percentage change for two numeric values
 */
function computeDelta(prev: number, cur: number): { absolute: number; percent: number } {
  const absolute = cur - prev;
  const percent = prev === 0 ? (cur > 0 ? 100 : 0) : Math.round((absolute / prev) * 100);
  return { absolute, percent };
}

/**
 * Compare two snapshots
 */
function compareSnapshots(
  base: HealthSnapshot,
  target: HealthSnapshot,
  thresholdPercent: number,
  baseComponentStates: Map<string, ComponentHealth>,
  targetResource: ResourceUsage & { cpuPercent: number; memoryPercent: number; diskPercent: number },
): SnapshotComparison {
  const baseComponentById = new Map<string, ComponentHealth>(
    base.components.map((c) => [c.component, c]),
  );

  // Overall status change
  const healthStatusChange = {
    from: base.status,
    to: target.status,
  };

  // Component deltas
  const componentDeltas: Array<{
    component: string;
    from: ComponentHealth;
    to: ComponentHealth;
    errorRateDeltaPercent: number;
    latencyDeltaMs: number;
    statusChange: HealthStatus;
    added: boolean;
  }> = [];

  // Added components or updated components
  for (const targetComponent of target.components) {
    const baseComponent = baseComponentById.get(targetComponent.component);
    if (!baseComponent) {
      // Component added between snapshots
      componentDeltas.push({
        component: targetComponent.component,
        from: { component: targetComponent.component, status: 'healthy', errorRatePercent: 0, latencyMs: 0 },
        to: targetComponent,
        errorRateDeltaPercent: computeNumericDelta(0, targetComponent.errorRatePercent),
        latencyDeltaMs: computeNumericDelta(0, targetComponent.latencyMs),
        statusChange: targetComponent.status,
        added: true,
      });
      continue;
    }

    const deltaErrorRate = computeNumericDelta(baseComponent.errorRatePercent, targetComponent.errorRatePercent);
    const { absolute: latencyChange } = computeDelta(baseComponent.latencyMs, targetComponent.latencyMs);

    const isStatusChange = baseComponent.status !== targetComponent.status;
    const statusChange = isStatusChange ? targetComponent.status : 'healthy';

    componentDeltas.push({
      component: targetComponent.component,
      from: baseComponent,
      to: targetComponent,
      errorRateDeltaPercent: deltaErrorRate,
      latencyDeltaMs: latencyChange,
      statusChange,
      added: false,
    });
  }

  // Removed components (present in base but not in target)
  for (const baseComponent of base.components) {
    if (!baseComponentById.has(baseComponent.component)) {
      componentDeltas.push({
        component: baseComponent.component,
        from: baseComponent,
        to: { component: baseComponent.component, status: 'healthy', errorRatePercent: 0, latencyMs: 0 },
        errorRateDeltaPercent: -baseComponent.errorRatePercent,
        latencyDeltaMs: -baseComponent.latencyMs,
        statusChange: 'healthy',
        added: false,
      });
    }
  }

  // Version diff
  const oldVersion = base.version;
  const newVersion = target.version;
  const versionDiff = oldVersion !== newVersion ? { old: oldVersion, new: newVersion } : undefined;

  // Significant changes summary
  let significantChangesSummary: string = 'No significant changes detected.';
  const changes: string[] = [];

  for (const delta of componentDeltas) {
    if (delta.added || delta.statusChange !== 'healthy') {
      if (!delta.added && delta.statusChange === 'healthy') continue;
      const label = delta.added ? 'Added' : 'Removed';
      changes.push(`${label}: ${delta.component} changed health from ${delta.from.status} to ${delta.to.status}`);
    } else {
      if (Math.abs(delta.errorRateDeltaPercent) >= thresholdPercent) {
        changes.push(`Error rate changed by ${Math.abs(delta.errorRateDeltaPercent)}% on ${delta.component}`);
      }
      if (Math.abs(delta.latencyDeltaMs) > 100) {
        changes.push(`Latency changed by ${Math.abs(delta.latencyDeltaMs)}ms on ${delta.component}`);
      }
    }
  }

  if (changes.length > 0) {
    significantChangesSummary = changes.join('; ');
  }

  return {
    base,
    target,
    healthStatusChange,
    componentDeltas,
    versionDiff,
    significantChangesSummary,
  };
}

/**
 * Health Snapshots Service Implementation
 */
export function createHealthSnapshotsService(): BuilderForceAgentsPluginService {
  let metricMeter = metrics.getMeter('health-snapshots');
  let metricTracer = trace.getTracer('health-snapshots');
  let config: Required<HealthSnapshotsConfig>;
  let log: Logger | null = null;

  // Snapshot storage: Map<serviceId, Map<snapshotId, snapshot>>
  // Note: Uses write-in, no eviction aggregation storage
  const snapshotStorage = new Map<string, Map<string, HealthSnapshot>>();

  // Current state: used to compute diffs
  const currentState = {
    statusCounts: { healthy: 0, degraded: 0, unhealthy: 0 },
    componentStates: new Map<string, ComponentHealth>(),
    resourceUsage: { cpuPercent: 0, memoryPercent: 0, diskPercent: 0 },
    incidents: 0,
    version: undefined as string | undefined,
  };

  // Scheduled interval runner
  let intervalId: NodeJS.Timeout | null = null;
  let lastSnapshotTime = 0;

  // Metrics counters for capturing
  const snapshotCreatedCounter = metricMeter.createCounter('health.snapshots.created', {
    unit: '1',
    description: 'Number of snapshots created',
  });
  const snapshotComparisonCounter = metricMeter.createCounter('health.snapshots.compared', {
    unit: '1',
    description: 'Number of snapshot comparisons performed',
  });

  // Track whether we have ever successfully connected to the plugin-config endpoint.
  // This is used during start to prevent leaking connections on service initialization failures.
  let pluginConfigKeysConfigured = false;

  return {
    id: 'health-snapshots',

    async start(ctx) {
      config = { ...DEFAULT_CONFIG, ...((ctx.config as unknown) as HealthSnapshotsConfig) };
      log = ctx.logger;

      // Track whether we have ever successfully connected to the plugin-config endpoint.
  // This is used during start to prevent leaking connections on service initialization failures.
  let pluginConfigKeysConfigured = false;

  return {
    id: 'health-snapshots',

    async start(ctx) {
      config = { ...DEFAULT_CONFIG, ...((ctx.config as unknown) as HealthSnapshotsConfig) };
      log = ctx.logger;

      // Resolve version if enabled
      if (config.trackVersion && process.env.npm_package_version) {
        currentState.version = process.env.npm_package_version;
      }

      // Start scheduled capture interval
      intervalId = setInterval(async () => {
        await executeScheduledCapture();
      }, config.scheduleIntervalMs);

      log.info(
        {
          intervalMs: config.scheduleIntervalMs,
          retentionDays: config.retentionDays,
          trackComponents: config.trackComponents,
        },
        'Health snapshots service started',
      );
    },

    async stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      log?.info('Health snapshots service stopped');
    },

    // Called by SDK from diagnostic events
    async onDiagnosticEvent(evt: DiagnosticEventPayload) {
      const span = metricTracer.startSpan('health-snapshots.onDiagnosticEvent', {
        attributes: {
          'diagnostic.type': evt.type,
          'diagnostic.channel': evt.channel ?? 'unknown',
        },
      });

      try {
        switch (evt.type) {
          case 'model.usage':
            // Track token usage as a proxy for component load
            if (config.trackComponents) {
              const component = evt.channel ?? 'unknown';
              const componentState = currentState.componentStates.get(component);
              if (componentState) {
                componentState.latencyMs = (componentState.latencyMs * 3 + (evt.durationMs ?? 0)) / 4; // rolling average
                componentState.errorRatePercent =
                  Math.min(100, componentState.errorRatePercent + componentState.errorRatePercent / 20);
              } else {
                currentState.componentStates.set(component, {
                  component,
                  status: 'healthy',
                  errorRatePercent: 0,
                  latencyMs: evt.durationMs ?? 0,
                });
              }
            }
            break;

          case 'webhook.error':
            // Track webhook errors as component degradation
            if (config.trackComponents) {
              const component = evt.channel ?? 'webhook';
              const componentState = currentState.componentStates.get(component);
              if (componentState) {
                componentState.status = 'degraded';
                componentState.errorRatePercent = Math.min(100, componentState.errorRatePercent + 1);
              } else {
                currentState.componentStates.set(component, {
                  component,
                  status: 'degraded',
                  errorRatePercent: 1,
                  latencyMs: 0,
                });
              }
            }
            break;

          case 'session.stuck':
            // Track stuck sessions as degradation
            if (config.trackComponents) {
              const component = evt.channel ?? 'unknown';
              const componentState = currentState.componentStates.get(component);
              if (componentState) {
                componentState.status = 'degraded';
              }
            }
            break;

          case 'diagnostic.heartbeat':
            // Handled by caller to supply resource usage
            break;

          default:
            // Unknown event type — no-op (hermeticity: don't crash or add speculative metrics)
            break;
        }

        // Update metrics
        if (evt.channel) {
          metricMeter
            .createCounter('health.snapshots.event_count', {
              unit: '1',
              description: 'Count of diagnostic events for health-sensing',
            })
            .add(1, { channel: evt.channel, event_type: evt.type });
        }
      } finally {
        span.end();
      }
    },

    // Manual snapshot capture method
    async captureSnapshot(
      source: SnapshotSource = 'manual',
      deploymentId?: string,
      commitSha?: string,
    ): Promise<HealthSnapshot | null> {
      if (!log) return null;

      const snapshot = captureSnapshot(
        log,
        config,
        currentState.statusCounts,
        currentState.componentStates,
        currentState.resourceUsage,
        currentState.incidents,
        currentState.version,
        source,
        deploymentId,
        commitSha,
      );

      // Record metrics
      snapshotCreatedCounter.add(1, { source });

      // Store snapshot
      if (!snapshotStorage.has('builderforce')) {
        snapshotStorage.set('builderforce', new Map());
      }
      snapshotStorage.get('builderforce')!.set(snapshot.id, snapshot);

      return snapshot;
    },

    // List snapshots with filters
    async listSnapshots(filters: SnapshotListFilters): Promise<SnapshotListResponse> {
      const allSnapshots: Array<HealthSnapshot> = [];
      // Flatten all storage buckets by timestamps ascending (newest last)
      for (const bucket of snapshotStorage.values()) {
        for (const s of bucket.values()) {
          allSnapshots.push(s);
        }
      }
      allSnapshots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply criteria exactly as described
      let filtered = allSnapshots;
      if (filters.start) {
        filtered = filtered.filter((s) => s.timestamp >= filters.start);
      }
      if (filters.end) {
        filtered = filtered.filter((s) => s.timestamp < filters.end);
      }
      if (filters.sources) {
        filtered = filtered.filter((s) => filters.sources!.includes(s.source));
      }
      if (filters.status) {
        filtered = filtered.filter((s) => s.status === filters.status);
      }
      if (filters.component) {
        filtered = filtered.filter((s) =>
          s.components.some((c) => c.component === filters.component),
        );
      }

      if (filtered.length !== allSnapshots.length) {
        const { start, end, sources, status, component } = filters;
        log?.debug(
          {
            start,
            end,
            sources,
            status,
            component,
            originalCount: allSnapshots.length,
            filteredCount: filtered.length,
          },
          'Snapshot list filtered',
        );
      }

      const limit = filters.limit ?? 50;
      const results = filtered.slice(0, limit);
      const totalCount = filtered.length;
      const hasMore = totalCount > limit;

      return {
        snapshots: results,
        totalCount,
        limit,
        hasMore,
      };
    },

    // Get single snapshot by UUID
    async getSnapshot(id: string): Promise<HealthSnapshot | null> {
      for (const bucket of snapshotStorage.values()) {
        const found = bucket.get(id);
        if (found) return found;
      }
      return null;
    },

    // Compare two snapshots
    async compareSnapshots(baseId: string, targetId: string): Promise<SnapshotComparison | null> {
      snapshotComparisonCounter.add(1);

      const base = await this.getSnapshot(baseId);
      const target = await this.getSnapshot(targetId);

      if (!base || !target) return null;

      // Populate component/markers by component identifier for comparing to/from lookups. The base/target component lists already have ComponentHealth[]. The following local maps avoid reconstructing them repeatedly during merge.
      const baseComponentForDiff: Map<string, ComponentHealth> =
        new Map(base.components.map((c) => [c.component, c]));
      const targetComponentForDiff: Map<string, ComponentHealth> =
        new Map(target.components.map((c) => [c.component, c]));
      const baseResourceForDiff =
        base.resourceUsage ? { ...base.resourceUsage } : undefined;
      const targetResourceForDiff =
        target.resourceUsage ? { ...target.resourceUsage } : undefined;

      // Build synergetic resource options: prioritize non-undefined target over undefined base
      const mergedResource: ResourceUsage & { cpuPercent: number; memoryPercent: number; diskPercent: number } = {
        cpuPercent: targetResourceForDiff?.cpuPercent ?? baseResourceForDiff?.cpuPercent ?? 0,
        memoryPercent: targetResourceForDiff?.memoryPercent ?? baseResourceForDiff?.memoryPercent ?? 0,
        diskPercent: targetResourceForDiff?.diskPercent ?? baseResourceForDiff?.diskPercent ?? 0,
      };

      return compareSnapshots(
        base,
        target,
        10, // 10% threshold
        baseComponentForDiff,
        mergedResource,
      );
    },

    // Delete stale snapshots beyond retention (local-only writes)
    async purgeStaleSnapshots(): Promise<void> {
      log?.debug('Starting snapshot purge routine');

      const now = Date.now();
      const cutoffMs = config.retentionDays * 24 * 60 * 60 * 1000;

      for (const bucket of snapshotStorage.values()) {
        for (const [id, snapshot] of bucket) {
          const snapshotTimestamp = new Date(snapshot.timestamp).getTime();
          if (now - snapshotTimestamp > cutoffMs) {
            bucket.delete(id);
            log?.info({ id, timestamp: snapshot.timestamp }, 'Snapshot expired and purged');
          }
        }
      }
    },

    // Update resource usage snapshot from external caller (diagnostic.heartbeat)
    async updateResource(usage: ResourceUsage): Promise<void> {
      currentState.resourceUsage = {
        cpuPercent: usage.cpuPercent ?? 0,
        memoryPercent: usage.memoryPercent ?? 0,
        diskPercent: usage.diskPercent ?? 0,
      };
    },

    // Explicit periodic cleanup call (for scheduled job or on-demand)
    async clean(): Promise<void> {
      await this.purgeStaleSnapshots();
      // No delete-wise aggregated eviction (for memory-bound we leave to GC)
    },
  } satisfies BuilderForceAgentsPluginService;
}