import type { Rule } from './rules/rule.js';
import { BEHAVIOR_RULES } from './rules/behaviorRules.js';
import { OBFUSCATION_RULES } from './rules/obfuscationRules.js';
import { SAST_RULES } from './rules/sastRules.js';
import { SECRET_RULES } from './rules/secretRules.js';
import { SIGNATURE_RULES } from './signatures.js';

const norm = (path: string): string => path.replace(/\\/g, '/');

/** Pure binary assets: reading them as text means nothing, for ANY rule. */
export function isBinaryAssetPath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|ico|avif|mp[34]|wav|ogg|woff2?|ttf|otf|pdf|zip|gz|wasm|map)$/i.test(norm(path));
}

/** Assets that cannot execute (images, fonts, media, source maps): safe to call scanned without reading them. */
export function isInertAssetPath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|avif|mp[34]|wav|ogg|woff2?|ttf|otf|map)$/i.test(norm(path));
}

/**
 * Executable code the SAST rules and the reviewer DO NOT read - minified bundles, and scripts under
 * vendored / generated trees (`dist`, `build`, `vendor`, `node_modules`, `.next`) - plus WebAssembly.
 * They can still run, so a change that touches one has not been fully scanned: the scan is recorded
 * TRUNCATED with the reason "excluded executable path", the gate blocks, and a manager's override is
 * the way through. (Images, fonts and lockfiles are not executable and are excluded quietly.)
 */
export function isExcludedExecutablePath(path: string): boolean {
  const p = norm(path);
  if (/\.wasm$/i.test(p)) return true;
  if (/\.min\.js$/i.test(p)) return true;
  return /\.(?:m?js|cjs)$/i.test(p) && /(^|\/)(node_modules|dist|build|\.next|vendor)\//.test(p);
}

/** Lockfiles: machine-generated, hundreds of KB, and covered by the SCA scan (OSV), not by text rules. */
export const isLockfilePath = (path: string): boolean => /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(norm(path));

/**
 * What the SECRET rules read: every changed file except pure binary assets and lockfiles - minified and
 * vendored files INCLUDED (a credential committed into a bundle is still committed).
 */
export function isSecretScannablePath(path: string): boolean {
  return !isBinaryAssetPath(path) && !isLockfilePath(path);
}

/** What the SAST rules and the reviewer read: not binary, not an excluded executable, not a vendored tree or a lockfile. */
export function isScannablePath(path: string): boolean {
  const p = norm(path);
  if (isBinaryAssetPath(p) || isExcludedExecutablePath(p)) return false;
  if (/(^|\/)(node_modules|dist|build|\.next|vendor|coverage)\//.test(p)) return false;
  return !isLockfilePath(p);
}

const PATH_FILTERS: Record<NonNullable<Rule['paths']>, (path: string) => boolean> = {
  secret: isSecretScannablePath,
  code: isScannablePath,
  any: (path) => !isBinaryAssetPath(path),
};

/** Whether `rule` reads the file at `path`. */
export const ruleReadsPath = (rule: Rule, path: string): boolean => PATH_FILTERS[rule.paths ?? 'any'](path);

export type ScanProfileId = 'pr-diff' | 'skill-install' | 'runtime' | 'visualizer';

export interface ScanProfile {
  readonly ruleSets: readonly (readonly Rule[])[];
  /** Run package.json heuristics on files named `package.json`. */
  readonly manifest: boolean;
  /** Check content hashes against the signature sources. */
  readonly signatures: boolean;
}

/** Which detectors each caller runs. A new detector is a row here, never a branch in the engine. */
export const SCAN_PROFILES: Readonly<Record<ScanProfileId, ScanProfile>> = {
  'pr-diff': { ruleSets: [SECRET_RULES, SAST_RULES], manifest: false, signatures: false },
  'skill-install': { ruleSets: [BEHAVIOR_RULES, OBFUSCATION_RULES], manifest: false, signatures: false },
  runtime: { ruleSets: [SECRET_RULES, BEHAVIOR_RULES, OBFUSCATION_RULES, SIGNATURE_RULES], manifest: true, signatures: true },
  visualizer: { ruleSets: [SECRET_RULES, SAST_RULES, BEHAVIOR_RULES, OBFUSCATION_RULES, SIGNATURE_RULES], manifest: true, signatures: true },
};
