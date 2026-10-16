/**
 * Role-based ordering, BOUND to this Worker's catalog.
 *
 * The ordering itself — role objective, learned re-rank, vendor health, price within a
 * tier — lives in `@builderforce/model-router` so the editor, the on-prem runtime and
 * an offline browser rank exactly as the gateway does. This module is the one place the
 * api binds it to the vendor registry (`catalogView.ts`): every gateway and cloud-run
 * caller asks here, and none of them has to know a view exists.
 *
 * The vocabulary is not restated: `ModelRole` comes from `@builderforce/agent-tools`,
 * `ArcStage` from `@builderforce/workload`, the objectives from the router.
 */

import { rankConnectedForRole as rankConnectedIn, type RankConnectedOptions } from '@builderforce/model-router';
import type { CatalogView } from '@builderforce/model-catalog';
import { REGISTRY_CATALOG_VIEW } from './catalogView';

/**
 * THE order of a tenant's connected models for one call — shared by the gateway
 * completion seed and the cloud-run pick, so a chat turn and a cloud run with the same
 * role and the same evidence lead with the same model. See the router for the rules.
 */
export function rankConnectedForRole(
  models: readonly string[],
  opts: RankConnectedOptions = {},
  view: CatalogView = REGISTRY_CATALOG_VIEW,
): string[] {
  return rankConnectedIn(models, view, opts);
}
