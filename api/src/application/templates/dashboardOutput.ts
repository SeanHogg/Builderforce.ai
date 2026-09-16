/**
 * Dashboard output kind — installing a template materialises a named preset
 * onto the tenant's saved dashboards (PRD 25 A1).
 *
 * Lives in its own file so `outputKinds.ts` stays a registry of kinds, not a
 * growing dump of every materialiser. Side-effect-imported from there.
 *
 * Unknown presets refuse with the known-key list. Known presets go through
 * `applyDashboardPreset` (idempotent) and, when the manifest named a sector /
 * size band, through the existing benchmark-profile writers so the cohort the
 * tiles compare against matches the vertical the founder just picked.
 */

import { isStartupSector } from '@builderforce/creation-canvas-contract';
import type { DashboardOutput } from '../../domain/template/templateManifest';
import { applyDashboardPreset, isPresetKey, listPresetKeys } from '../dashboards/dashboardPresets';
import {
  alignBenchmarkIndustry,
  resolveBenchmarkProfilePatch,
  setBenchmarkProfile,
} from '../insights/benchmarkProfile';
import { reportCaughtError } from '../observability/caughtErrorReporter';
// TYPE-ONLY import. `outputKinds.ts` imports the spec below to register it, so a
// value import here would close a runtime cycle in which this module's top-level
// `registerOutputKind` call runs before that binding is initialised. The
// registration therefore lives in the registry, and this file stays a leaf.
import type { MaterializeOutputContext, OutputKindSpec, OutputResult } from './outputKinds';

const SIZE_BANDS = ['small', 'mid', 'large'] as const;
type SizeBand = (typeof SIZE_BANDS)[number];

function isSizeBand(value: string): value is SizeBand {
  return (SIZE_BANDS as readonly string[]).includes(value);
}

export const dashboardOutputKind: OutputKindSpec<DashboardOutput> = {
  kind: 'dashboard',
  async materialize(output, ctx) {
    const base: Omit<OutputResult, 'ok' | 'detail' | 'href' | 'ref'> = {
      outputId: output.id,
      kind: 'dashboard',
      label: output.preset,
    };
    if (!isPresetKey(output.preset)) {
      return {
        ...base,
        ok: false,
        ref: null,
        href: null,
        detail: 'Not created',
        error: `Unknown dashboard preset "${output.preset}". Known: ${listPresetKeys().join(', ')}.`,
      };
    }
    // Dashboards GET/owns/preset POST all eq(savedDashboards.segmentId, scope().segmentId).
    // A null here would write a row the finance tab can never list.
    const segmentId = ctx.segmentId ?? '';
    try {
      const applied = await applyDashboardPreset(
        ctx.db,
        ctx.tenantId,
        segmentId,
        output.preset,
        ctx.installedByUserId ?? null,
      );
      if (output.sector && isStartupSector(output.sector)) {
        await alignBenchmarkIndustry(ctx.db, ctx.env, ctx.tenantId, output.sector);
      }
      if (output.sizeBand && isSizeBand(output.sizeBand)) {
        // Industry is left blank on purpose: the patch resolver keeps the
        // current value for a blank field, and the sector alignment above is
        // the only writer that should move the industry.
        const patch = await resolveBenchmarkProfilePatch(ctx.db, ctx.tenantId, { sizeBand: output.sizeBand });
        await setBenchmarkProfile(ctx.db, ctx.env, ctx.tenantId, patch);
      }
      return {
        ...base,
        ok: true,
        ref: String(applied.dashboardId),
        href: '/finance?tab=dashboard',
        detail: `${applied.addedWidgets} tile(s) placed`,
      };
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/templates/dashboardOutput.ts',
        operation: `materialize:dashboard:${output.id}`,
      });
      return {
        ...base,
        ok: false,
        ref: null,
        href: null,
        detail: 'Not created',
        error: error instanceof Error ? error.message : 'Could not create the dashboard',
      };
    }
  },
};

/** Used by tests that drive the materialiser without going through the registry. */
export async function materializeDashboardOutput(
  output: DashboardOutput,
  ctx: MaterializeOutputContext,
): Promise<OutputResult> {
  return dashboardOutputKind.materialize(output, ctx);
}
