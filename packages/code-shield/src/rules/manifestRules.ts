import { buildFinding } from '../finding.js';
import type { ScanFinding } from '../types.js';
import { POPULAR_PACKAGES } from './popularPackages.js';

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'] as const;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
const DANGEROUS_SCRIPT = /curl|wget|node\s+-e|base64|eval|https?:/i;
const REMOTE_SPEC = /^(?:git\+|git:\/\/|https?:|github:)/i;
/** Short names are one edit from half the registry; only compare against names long enough to be distinctive. */
const MIN_TYPOSQUAT_TARGET_LENGTH = 4;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** True when `a` and `b` differ by at most one insertion, deletion, substitution or adjacent transposition. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  return longer.slice(i + 1) === shorter.slice(i);
}

/** Heuristics over a package.json: install hooks, remote dependencies and look-alike names. */
export function scanManifest(path: string, text: string): ScanFinding[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    // error-logging: an unparseable manifest yields no findings here; the caller marks nothing clean on parse failure alone because other rules still run on the text
    return [];
  }
  if (!isObject(manifest)) return [];
  const out: ScanFinding[] = [];
  const packageName = typeof manifest.name === 'string' ? manifest.name : undefined;

  if (isObject(manifest.scripts)) {
    for (const hook of INSTALL_HOOKS) {
      const script = manifest.scripts[hook];
      if (typeof script !== 'string') continue;
      const dangerous = DANGEROUS_SCRIPT.test(script);
      out.push(buildFinding({
        ruleId: 'supply-chain.install-script', category: 'supply-chain', path, packageName, attack: 'T1195.002',
        severity: dangerous ? 'HIGH' : 'LOW', weight: dangerous ? 30 : 5,
        title: dangerous ? `Install script "${hook}" downloads or evaluates code` : `Package runs a "${hook}" install script`,
        remediation: 'Review the script; install with lifecycle scripts disabled unless the package is trusted.',
      }));
    }
  }

  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (!isObject(deps)) continue;
    for (const [dep, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string' || !REMOTE_SPEC.test(spec)) continue;
      out.push(buildFinding({
        ruleId: 'supply-chain.remote-dependency', category: 'supply-chain', severity: 'MEDIUM', weight: 15, path,
        packageName: dep, attack: 'T1195.001',
        title: `Dependency "${dep}" is fetched from a remote URL, bypassing the registry`,
        remediation: 'Depend on a published, version-pinned registry release.',
      }));
    }
  }

  if (packageName && !packageName.startsWith('@') && !POPULAR_PACKAGES.includes(packageName)) {
    const target = POPULAR_PACKAGES.find((p) => p.length >= MIN_TYPOSQUAT_TARGET_LENGTH && withinOneEdit(packageName, p));
    if (target) {
      out.push(buildFinding({
        ruleId: 'typosquat.name', category: 'typosquat', severity: 'MEDIUM', weight: 20, path, packageName, attack: 'T1195.001',
        title: `Package name "${packageName}" is one edit from the popular package "${target}"`,
        remediation: 'Confirm the package is the one intended, not an impersonation.',
      }));
    }
  }
  return out;
}
