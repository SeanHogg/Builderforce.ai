/**
 * rules/index.ts — the built-in rule ROWS (principle 5: a new check is one row here plus its file).
 */

import type { DeltaRule, MetricRule } from '../contract.js';
import { anyCastMetric } from './anyCastMetric.js';
import { apiAdded } from './apiAdded.js';
import { apiBreaking } from './apiBreaking.js';
import { assertionEditedWithImpl } from './assertionEditedWithImpl.js';
import { assertionsReduced } from './assertionsReduced.js';
import { capabilityAdded } from './capabilityAdded.js';
import { complexityMetric } from './complexityMetric.js';
import { deltaConfigChanged } from './deltaConfigChanged.js';
import { destructiveDdl } from './destructiveDdl.js';
import { entryAdded } from './entryAdded.js';
import { entryRemoved } from './entryRemoved.js';
import { factFindingRules } from './factFindings.js';
import { forcePush } from './forcePush.js';
import { godFileGrowth } from './godFileGrowth.js';
import { guardRemoved } from './guardRemoved.js';
import { guardWeakened } from './guardWeakened.js';
import { ioInLoop } from './ioInLoop.js';
import { matcherWeakened } from './matcherWeakened.js';
import { onlyAdded } from './onlyAdded.js';
import { rmRf } from './rmRf.js';
import { secretAdded } from './secretAdded.js';
import { snapshotUpdatedWithImpl } from './snapshotUpdatedWithImpl.js';
import { suppressionAdded } from './suppressionAdded.js';
import { syncIo } from './syncIo.js';
import { testDeleted } from './testDeleted.js';
import { testSkipped } from './testSkipped.js';
import { timeoutRaised } from './timeoutRaised.js';
import { todoMetric } from './todoMetric.js';
import { weakCrypto } from './weakCrypto.js';
// PRD 41 WS9: the remaining C6.1 performance, C7 -ilities and C8.2 quality rules.
import { a11yViolation } from './ilities/a11yViolation.js';
import { catchSwallowed } from './ilities/catchSwallowed.js';
import { couplingMetric } from './ilities/couplingMetric.js';
import { enginesChanged } from './ilities/enginesChanged.js';
import { envVarAdded } from './ilities/envVarAdded.js';
import { envVarRemoved } from './ilities/envVarRemoved.js';
import { errorHandlingRemoved } from './ilities/errorHandlingRemoved.js';
import { floatingPromise } from './ilities/floatingPromise.js';
import { nodeOnlyImport } from './ilities/nodeOnlyImport.js';
import { platformSpecificApi } from './ilities/platformSpecificApi.js';
import { processExit } from './ilities/processExit.js';
import { routeSchemaChanged } from './ilities/routeSchemaChanged.js';
import { timeoutRetryChanged } from './ilities/timeoutRetryChanged.js';
import { untestedChange } from './ilities/untestedChange.js';
import { bundleWeight } from './performance/bundleWeight.js';
import { cacheBypass } from './performance/cacheBypass.js';
import { nestedIteration } from './performance/nestedIteration.js';
import { regexRedos } from './performance/regexRedos.js';
import { renderHot } from './performance/renderHot.js';
import { unboundedQuery } from './performance/unboundedQuery.js';
import { catchAllAdded } from './quality/catchAllAdded.js';
import { outOfScopeChange } from './quality/outOfScopeChange.js';
import { hotspotMetric } from './ilities/hotspotMetric.js';
// PRD 41 WS8: the remaining C5 security rules.
import { withStride } from '../registry/stride.js';
import { containerRoot } from './containerRoot.js';
import { cookieInsecure } from './cookieInsecure.js';
import { corsPermissive } from './corsPermissive.js';
import { cspPermissive } from './cspPermissive.js';
import { debugEnabled } from './debugEnabled.js';
import { infraSurfaceAdded } from './infraSurfaceAdded.js';
import { installScriptAdded } from './installScriptAdded.js';
import { methodWidened } from './methodWidened.js';
import { newUntrustedInput } from './newUntrustedInput.js';
import { taintPath } from './taintPath.js';
import { tlsVerifyDisabled } from './tlsVerifyDisabled.js';
import { workflowPermissive } from './workflowPermissive.js';

export const BUILT_IN_RULES: readonly DeltaRule[] = [
    // security (C5), each finding tagged with its C5.7 STRIDE category (`registry/stride.ts`)
    ...[
        guardRemoved, guardWeakened, entryAdded, entryRemoved, capabilityAdded, weakCrypto, secretAdded, deltaConfigChanged,
        methodWidened, newUntrustedInput, taintPath,
        tlsVerifyDisabled, corsPermissive, cookieInsecure, cspPermissive, debugEnabled, workflowPermissive, containerRoot, infraSurfaceAdded,
        installScriptAdded,
    ].map(withStride),
    // performance (C6.1)
    ioInLoop, syncIo, unboundedQuery, cacheBypass, nestedIteration, regexRedos, bundleWeight, renderHot,
    // quality: test integrity (C8.2)
    testDeleted, testSkipped, onlyAdded, assertionsReduced, matcherWeakened,
    suppressionAdded, timeoutRaised, snapshotUpdatedWithImpl, assertionEditedWithImpl, catchAllAdded,
    // quality: scope drift (C8.3)
    outOfScopeChange,
    // ilities (C7)
    apiBreaking, apiAdded, ...factFindingRules, godFileGrowth, destructiveDdl, forcePush, rmRf,
    untestedChange, envVarAdded, envVarRemoved, enginesChanged, routeSchemaChanged, a11yViolation,
    catchSwallowed, floatingPromise, errorHandlingRemoved, timeoutRetryChanged, processExit,
    platformSpecificApi, nodeOnlyImport,
];

export const BUILT_IN_METRICS: readonly MetricRule[] = [complexityMetric, todoMetric, anyCastMetric, couplingMetric, hotspotMetric];
