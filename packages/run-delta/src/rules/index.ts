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

export const BUILT_IN_RULES: readonly DeltaRule[] = [
    // security (C5)
    guardRemoved, guardWeakened, entryAdded, entryRemoved, capabilityAdded, weakCrypto, secretAdded,
    // performance (C6.1)
    ioInLoop, syncIo,
    // quality: test integrity (C8.2)
    testDeleted, testSkipped, onlyAdded, assertionsReduced, matcherWeakened,
    suppressionAdded, timeoutRaised, snapshotUpdatedWithImpl, assertionEditedWithImpl,
    // ilities (C7)
    apiBreaking, apiAdded, ...factFindingRules, godFileGrowth, destructiveDdl, forcePush, rmRf,
];

export const BUILT_IN_METRICS: readonly MetricRule[] = [complexityMetric, todoMetric, anyCastMetric];

export {
    anyCastMetric, apiAdded, apiBreaking, assertionEditedWithImpl, assertionsReduced, capabilityAdded, complexityMetric,
    destructiveDdl, entryAdded, entryRemoved, factFindingRules, forcePush, godFileGrowth, guardRemoved, guardWeakened,
    ioInLoop, matcherWeakened, onlyAdded, rmRf, secretAdded, snapshotUpdatedWithImpl, suppressionAdded, syncIo,
    testDeleted, testSkipped, timeoutRaised, todoMetric, weakCrypto,
};
