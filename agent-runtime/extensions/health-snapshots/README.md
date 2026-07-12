# Health Snapshots Extension

BuilderForce diagnostic plugin that captures, stores, and compares historical health snapshots across components, resources, and versions.

## Overview

This extension discovers the current system health from BuilderForce diagnostic events (model usage, webhooks, sessions, heartbeats) and creates point-in-time snapshots. It retains them for a configurable period and supports listing, retrieving, and diffing snapshots to identify regressions and validate deployments.

## Prerequisites

- BuilderForce Agents runtime (workspace: `@seanhogg/builderforce-agents`)
- TypeScript 5.5+ and Node 18+

## Installation

Add to your Workspace (`packages/health-snapshots/package.json`) with a workspace dependency on the builderforce-agents SDK:

```json
{
  "name": "@builderforce/health-snapshots",
  "version": "2026.3.21",
  "description": "BuilderForce Agents historical health snapshots capture, storage, and comparison",
  "type": "module",
  "dependencies": {},
  "devDependencies": {
    "@seanhogg/builderforce-agents": "workspace:*"
  },
  "builderforce": {
    "extensions": [
      "./index.ts"
    ]
  }
}
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `scheduleIntervalMs` | `number` | `300_000` (`5 min`) | Interval at which to capture scheduled snapshots |
| `retentionDays` | `number` | `90` | Snapshot days before archival/deletion |
| `trackComponents` | `boolean` | `true` | Capture per-component metrics |
| `trackResourceUsage` | `boolean` | `true` | Capture CPU/Memory/Disk utilization |
| `trackVersion` | `boolean` | `true` | Capture software version/build |
| `incidentThreshold` | `number` | `1` | Active alerts count tested for status promotion |

Optionally override defaults via `ABUILDERFORCE_PLUGINS_HEALTH_SNAPSHOTS_CONFIG` environment variables.

## Quick Start

Enable the plugin in your BuilderForce Agents config (`builderforce/extensions/index.ts`):

```ts
import { createHealthSnapshotsService } from '@builderforce/health-snapshots';

api.registerService(createHealthSnapshotsService());
```

By default, a snapshot is created every 5 minutes from current component states. Use `updateResource()` in your `diagnostic.heartbeat` signal to supply current resource metrics.

## Plugin Library vs RESTful API

This extension is a BuilderForce Agents plugin that exposes a service via `api.registerService`. It is NOT a standalone RESTful HTTP API — HTTP routes and UI integration that consume health snapshots live in a separate service tier (not included or reachable in this extension). To reach snapshots via UI or HTTP in a real deployment, wire an HTTP controller (e.g., Express/Router) to call the plugin service methods. This extension focuses solely on the capture/storage/retrieval/comparison domain within the agent runtime.

## Usage

### From agent-runtime code

```ts
// Obtain reference via api.service('health-snapshots')
const service = api.service('health-snapshots');

// Manual capture
const snapshot = await service.captureSnapshot('manual', 'd-123', 'abc123');

// List with filters
const list = await service.listSnapshots({
  start: '2025-10-01T00:00:00Z',
  end: '2025-10-02T00:00:00Z',
  sources: ['scheduled', 'manual'],
  limit: 100,
});
console.log(list.snapshots);

// Get one snapshot
const one = await service.getSnapshot(snapshot.id);

// Compare two snapshots
const diff = await service.compareSnapshots(baseId, targetId);
console.log(diff.healthStatusChange);
console.log(diff.componentDeltas);
console.log(diff.significantChangesSummary);

// Legacy sync methods for on-demand cleanup
await service.purgeStaleSnapshots();
await service.clean();
```

### Diagnostics.heartbeat integration

Provider a resource usage update every period to stay current for diffs and snapshots:

```ts
api.service('health-snapshots').updateResource({
  cpuPercent: 45.2,
  memoryPercent: 62.8,
  diskPercent: 78.1,
});
```

## Types

`ComponentHealth`: `{ component: string; status: 'healthy'|'degraded'|'unhealthy'; errorRatePercent: number; latencyMs: number; }`

`SnapshotSource`: `'scheduled'|'manual'|'deployment-hook'`

`HealthSnapshot`: `{ id: string; timestamp: string; status: 'healthy'|'degraded'|'unhealthy'; components: ComponentHealth[]; resourceUsage?: ResourceUsage; activeIncidentCount: number; version?: string; source: SnapshotSource; deploymentId?: string; commitSha?: string; }`

`SnapshotComparison`: `{ base: HealthSnapshot; target: HealthSnapshot; healthStatusChange: { from: HealthStatus; to: HealthStatus }; componentDeltas: Array<{ component: string; from: ComponentHealth; to: ComponentHealth; errorRateDeltaPercent: number; latencyDeltaMs: number; statusChange: HealthStatus; added: boolean; }>; versionDiff?: { old?: string; new?: string }; significantChangesSummary: string; }`

## Testing

Run tests:

```bash
npm test
```

## Dependencies

- `@seanhogg/builderforce-agents/plugin-sdk` (workspace)

Options:
- `@opentelemetry/api` and `@opentelemetry/tracing` options are retained to match diagnostics-otel patterns, but no telemetry is emitted by this extension (unlike diagnostics-otel).

## License

See LICENSE file.