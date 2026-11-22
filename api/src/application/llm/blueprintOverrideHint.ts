/**
 * How an agent overrides blueprint detection — the one designed path, quoted by both
 * `app_blueprint` tools (`appBlueprintToolCatalog.ts`): the repo's `.builderforce/builderforce.json`
 * (`MANIFEST_PATH`), never a root `builderforce.json`.
 *
 * Always an app manifest v1 (`"version": 1`): the runtime reads an unversioned file only as its
 * legacy format (an info issue asking for `"version": 1`), so that format is never recommended,
 * though the detector still reads one an older version left. The example is data, so a test
 * holds it to the runtime's parser (`blueprintOverrideHint.test.ts`).
 */
import { MANIFEST_PATH } from '@builderforce/app-detect';
import { advertisedName } from './toolNaming';

export const OVERRIDE_EXAMPLE = {
  version: 1,
  services: { api: { runtime: 'node', root: '/api', command: 'npm start', port: 8000 } },
  resources: { db: { type: 'postgres' } },
  environments: { local: { target: 'browser', tier: 'non-production' } },
} as const;

export const OVERRIDE_HINT =
  `To override detection, write ${MANIFEST_PATH} in the repo (never a root builderforce.json): an app manifest v1, ` +
  `e.g. ${JSON.stringify(OVERRIDE_EXAMPLE)}, with write_file, then run ${advertisedName('app_blueprint.detect')} again. ` +
  'Detection lays its services, resources and env over what it found. ' +
  `Before writing, call ${advertisedName('app_manifest.schema')} for the v1 JSON schema, field guide and per-target ` +
  `capability matrix (including the ai resource), and check the manifest with ${advertisedName('app_manifest.validate')} ` +
  '(content-only validation needs no projectId).';
