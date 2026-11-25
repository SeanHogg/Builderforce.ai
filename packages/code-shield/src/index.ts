/**
 * `@builderforce/code-shield` — the shared code-scanning engine (WebContainers Shield, Visualizer, PR
 * security gate, skill installer). Pure; see the package description.
 */
export type {
  FileVerdict, FindingSeverity, IncompleteReason, ScanAction, ScanFinding, ScanReport, ScanSubject, ThreatCategory,
} from './types.js';
export type { Rule } from './rules/rule.js';
export { TEST_OR_FIXTURE } from './rules/rule.js';
export { SECRET_RULES } from './rules/secretRules.js';
export { SAST_RULES } from './rules/sastRules.js';
export { BEHAVIOR_RULES } from './rules/behaviorRules.js';
export { OBFUSCATION_RULES } from './rules/obfuscationRules.js';
export { scanManifest, withinOneEdit } from './rules/manifestRules.js';
export { POPULAR_PACKAGES } from './rules/popularPackages.js';
export {
  BUILT_IN_SIGNATURES, EICAR_RULE, KNOWN_BAD_SHA256, SIGNATURE_RULES, sha256Hex, type SignatureSource,
} from './signatures.js';
export {
  SCAN_PROFILES, isBinaryAssetPath, isExcludedExecutablePath, isInertAssetPath, isLockfilePath, isScannablePath,
  isSecretScannablePath, type ScanProfile, type ScanProfileId,
} from './profiles.js';
export { createMemoryVerdictCache, scanSubjects, scanText, type ScanOptions, type VerdictCache } from './engine.js';
export { ACTION_THRESHOLDS, CATEGORY_CORRELATIONS, actionFor, riskScore, worstAction } from './scoring.js';
export { toSarif } from './sarif.js';
