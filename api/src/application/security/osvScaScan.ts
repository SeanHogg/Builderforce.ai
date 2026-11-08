/**
 * osvScaScan — real software-composition analysis for a pull request (PRD 08 §10), against OSV.dev
 * (public, no key): the dependency manifests a change touched are parsed into `{ecosystem, name,
 * version}` triples, looked up through `POST /v1/querybatch`, and each advisory is read for its
 * severity (`GET /v1/vulns/<id>`).
 *
 * THREE PARTS, deliberately separate:
 *   - PURE parsers (`parseManifests`, `parseCvss3`, `osvSeverity`, `buildOsvFindings`) — no IO, unit-tested.
 *   - The CLIENT (`queryOsv`) — the only network code. A failed lookup is `{ ok: false, reason }`, which
 *     the caller records as a FAILED scan: an advisory database that could not be asked is never a
 *     clean result.
 *   - Ingestion stays where every finding goes: `ingestScanFindings`, in prSecurityScan.
 *
 * WHAT IS COVERED
 *   npm    package.json `dependencies` / `devDependencies` / `optionalDependencies`: an exact version is
 *          used as is; a `^` / `~` range is resolved to the version in a lockfile (package-lock.json or
 *          pnpm-lock.yaml in the same directory) that is part of the same read. Anything else (git URLs,
 *          `workspace:`, `*`, `>=`, `||`) is UNRESOLVABLE.
 *   PyPI   requirements*.txt `name==version` pins; other specifiers are unresolvable.
 *   Go     go.mod `require` lines (single and block).
 * Unresolvable entries are returned (and listed in the scan's notes); they never fail the scan.
 *
 * FINGERPRINT. A finding's `ruleId` is `osv:<id>:<pkg>@<version>`, and the findings fingerprint
 * (`findingFingerprint`) hashes the rule id, so the same advisory against the same package version is
 * one finding across re-scans.
 */
import type { FindingSeverity, NormalizedFinding } from '../../domain/security/scanReportParsers';
import { normalizeSeverity } from '../../domain/security/scanReportParsers';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export const OSV_BASE = 'https://api.osv.dev';
/** Packages per scan. A change that adds more than this is scanned for the first 500 and says so. */
export const OSV_MAX_PACKAGES = 500;
/** Advisories whose detail (severity, fix) is fetched per scan; the rest default to MEDIUM. */
export const OSV_MAX_DETAIL_FETCHES = 150;
const DETAIL_CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 15_000;

export type OsvEcosystem = 'npm' | 'PyPI' | 'Go';

export interface OsvPackage { ecosystem: OsvEcosystem; name: string; version: string; manifest: string }
export interface ManifestFile { path: string; content: string }
export interface ParsedManifests { packages: OsvPackage[]; unresolved: string[]; capped: boolean }

/** True for a file `parseManifests` understands (manifests and the lockfiles that resolve them). */
export const isScaManifestPath = (path: string): boolean =>
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|requirements[^/]*\.txt|go\.mod)$/.test(path);

const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const RANGE_SEMVER = /^[\^~]\s*(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;

// ── lockfiles → name -> resolved version, per directory ──────────────────────

function npmLockVersions(content: string): Map<string, string> {
  const out = new Map<string, string>();
  let doc: unknown;
  try { doc = JSON.parse(content); } catch { return out; }
  const rec = doc as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
  for (const [key, val] of Object.entries(rec.packages ?? {})) {
    const m = /^node_modules\/(@[^/]+\/[^/]+|[^/]+)$/.exec(key);
    if (m && val?.version) out.set(m[1]!, val.version);
  }
  for (const [name, val] of Object.entries(rec.dependencies ?? {})) {
    if (val?.version && !out.has(name)) out.set(name, val.version);
  }
  return out;
}

function pnpmLockVersions(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of content.split('\n')) {
    const m = /^\s*'?\/?((?:@[^/@\s'"]+\/)?[^@\s'"/][^@\s'"]*)@(\d+\.\d+\.\d+[^:'"\s(]*)/.exec(line);
    if (m && !out.has(m[1]!)) out.set(m[1]!, m[2]!);
  }
  return out;
}

// ── manifests ────────────────────────────────────────────────────────────────

function npmPackages(file: ManifestFile, locks: Map<string, string> | undefined, out: ParsedManifests): void {
  let doc: unknown;
  try { doc = JSON.parse(file.content); } catch { out.unresolved.push(`${file.path} (not valid JSON)`); return; }
  const pkg = doc as Record<string, Record<string, string> | undefined>;
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      if (typeof spec !== 'string') continue;
      const s = spec.trim();
      if (EXACT_SEMVER.test(s)) { out.packages.push({ ecosystem: 'npm', name, version: s, manifest: file.path }); continue; }
      const range = RANGE_SEMVER.exec(s);
      const locked = range ? locks?.get(name) : undefined;
      if (locked) out.packages.push({ ecosystem: 'npm', name, version: locked, manifest: file.path });
      else out.unresolved.push(`${name}@${s} (${file.path})`);
    }
  }
}

function pypiPackages(file: ManifestFile, out: ParsedManifests): void {
  for (const raw of file.content.split('\n')) {
    const line = raw.split('#')[0]!.split(';')[0]!.trim();
    if (!line || line.startsWith('-')) continue;
    const pin = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*==\s*([0-9][^\s,]*)$/.exec(line);
    if (pin) out.packages.push({ ecosystem: 'PyPI', name: pin[1]!.toLowerCase(), version: pin[2]!, manifest: file.path });
    else out.unresolved.push(`${line} (${file.path})`);
  }
}

function goPackages(file: ManifestFile, out: ParsedManifests): void {
  let inBlock = false;
  for (const raw of file.content.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (/^require\s*\(/.test(line)) { inBlock = true; continue; }
    if (inBlock && line === ')') { inBlock = false; continue; }
    const m = (inBlock ? /^(\S+)\s+v(\S+)$/ : /^require\s+(\S+)\s+v(\S+)$/).exec(line);
    if (m) out.packages.push({ ecosystem: 'Go', name: m[1]!, version: m[2]!, manifest: file.path });
  }
}

/** Parse every understood manifest in `files` (lockfiles included, as resolvers). PURE. */
export function parseManifests(
  files: readonly ManifestFile[],
  /** The BASE branch's content of each changed lockfile (path -> content). A lockfile-only change has no
   *  package.json to read, so what the change introduced is the lockfile entries that are new or whose
   *  version differs from the base; a lockfile absent from this map is new, and all of it counts. */
  baseLockfiles: ReadonlyMap<string, string> = new Map(),
): ParsedManifests {
  const out: ParsedManifests = { packages: [], unresolved: [], capped: false };
  const locks = new Map<string, Map<string, string>>();
  const lockOf = (path: string, content: string): Map<string, string> =>
    (baseOf(path) === 'pnpm-lock.yaml' ? pnpmLockVersions(content) : npmLockVersions(content));
  // package-lock.json wins over pnpm-lock.yaml when both sit in one directory.
  for (const f of files) if (baseOf(f.path) === 'pnpm-lock.yaml') locks.set(dirOf(f.path), lockOf(f.path, f.content));
  for (const f of files) if (baseOf(f.path) === 'package-lock.json') locks.set(dirOf(f.path), lockOf(f.path, f.content));

  // Changed lockfile entries (added / version-changed) are scanned in their own right.
  for (const f of files) {
    const base = baseOf(f.path);
    if (base !== 'package-lock.json' && base !== 'pnpm-lock.yaml') continue;
    const head = lockOf(f.path, f.content);
    const before = baseLockfiles.has(f.path) ? lockOf(f.path, baseLockfiles.get(f.path)!) : new Map<string, string>();
    for (const [name, version] of head) {
      if (before.get(name) !== version) out.packages.push({ ecosystem: 'npm', name, version, manifest: f.path });
    }
  }

  for (const f of files) {
    const base = baseOf(f.path);
    if (base === 'package.json') npmPackages(f, locks.get(dirOf(f.path)), out);
    else if (/^requirements[^/]*\.txt$/.test(base)) pypiPackages(f, out);
    else if (base === 'go.mod') goPackages(f, out);
  }

  const seen = new Set<string>();
  out.packages = out.packages.filter((p) => {
    const key = `${p.ecosystem}|${p.name}|${p.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (out.packages.length > OSV_MAX_PACKAGES) {
    out.capped = true;
    out.packages = out.packages.slice(0, OSV_MAX_PACKAGES);
  }
  return out;
}

// ── severity ─────────────────────────────────────────────────────────────────

const CVSS3_WEIGHT = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
} as const;

const roundUp1 = (x: number): number => Math.ceil(x * 10 - 1e-9) / 10;

/** The CVSS v3.x base score of a vector string, or null when it is not a readable v3 vector. PURE. */
export function parseCvss3(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null;
  const m: Record<string, string> = {};
  for (const part of vector.split('/').slice(1)) {
    const [k, v] = part.split(':');
    if (k && v) m[k] = v;
  }
  const av = CVSS3_WEIGHT.AV[m.AV as keyof typeof CVSS3_WEIGHT.AV];
  const ac = CVSS3_WEIGHT.AC[m.AC as keyof typeof CVSS3_WEIGHT.AC];
  const ui = CVSS3_WEIGHT.UI[m.UI as keyof typeof CVSS3_WEIGHT.UI];
  const c = CVSS3_WEIGHT.CIA[m.C as keyof typeof CVSS3_WEIGHT.CIA];
  const i = CVSS3_WEIGHT.CIA[m.I as keyof typeof CVSS3_WEIGHT.CIA];
  const a = CVSS3_WEIGHT.CIA[m.A as keyof typeof CVSS3_WEIGHT.CIA];
  const changed = m.S === 'C';
  const pr = ({ N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 } as Record<string, number>)[m.PR ?? ''];
  if ([av, ac, ui, c, i, a, pr].some((x) => x === undefined) || (m.S !== 'C' && m.S !== 'U')) return null;
  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av! * ac! * pr! * ui!;
  return roundUp1(Math.min(changed ? 1.08 * (impact + exploitability) : impact + exploitability, 10));
}

export const cvssToSeverity = (score: number): FindingSeverity =>
  score >= 9 ? 'CRITICAL' : score >= 7 ? 'HIGH' : score >= 4 ? 'MEDIUM' : 'LOW';

export interface OsvVuln {
  id: string;
  summary?: string;
  aliases?: string[];
  severity?: Array<{ type?: string; score?: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{
    package?: { name?: string; ecosystem?: string };
    ranges?: Array<{ events?: Array<{ fixed?: string }> }>;
  }>;
}

/** OSV advisory -> the platform's four severities: the database's own word, else CVSS v3, else MEDIUM. PURE. */
export function osvSeverity(v: OsvVuln | undefined): FindingSeverity {
  const word = v?.database_specific?.severity;
  if (typeof word === 'string' && word.trim()) return normalizeSeverity(word);
  for (const s of v?.severity ?? []) {
    const score = typeof s.score === 'string' ? parseCvss3(s.score) : null;
    if (score !== null) return cvssToSeverity(score);
  }
  // UNKNOWN severity (no detail could be read, or the advisory carries nothing we can score) is HIGH,
  // not MEDIUM: an advisory we cannot weigh must hold the merge until a person has, not slip under it.
  return 'HIGH';
}

function fixedVersionOf(v: OsvVuln | undefined, pkg: OsvPackage): string | null {
  for (const aff of v?.affected ?? []) {
    if (aff.package?.name !== pkg.name) continue;
    for (const r of aff.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) return e.fixed.slice(0, 64);
  }
  return null;
}

/** (package, advisory ids, advisory details) -> findings. PURE. */
export function buildOsvFindings(
  packages: readonly OsvPackage[],
  idsByPackage: ReadonlyArray<readonly string[]>,
  details: ReadonlyMap<string, OsvVuln>,
): NormalizedFinding[] {
  const out: NormalizedFinding[] = [];
  packages.forEach((pkg, idx) => {
    for (const id of idsByPackage[idx] ?? []) {
      const v = details.get(id);
      const cve = v?.aliases?.find((a) => a.startsWith('CVE-')) ?? (id.startsWith('CVE-') ? id : null);
      out.push({
        severity: osvSeverity(v),
        ruleId: `osv:${id}:${pkg.name}@${pkg.version}`.slice(0, 120),
        title: `${id}: ${v?.summary?.trim() || `vulnerable ${pkg.name}`}`.slice(0, 255),
        filePath: pkg.manifest.slice(0, 500),
        line: null,
        packageName: pkg.name.slice(0, 255),
        vulnerableVersion: pkg.version.slice(0, 64),
        fixedVersion: fixedVersionOf(v, pkg),
        cwe: null,
        cve: cve ? cve.slice(0, 40) : null,
        description: `${pkg.ecosystem} package ${pkg.name}@${pkg.version} is affected by ${id}. See ${OSV_BASE}/v1/vulns/${id}.`,
        remediation: fixedVersionOf(v, pkg) ? `Upgrade ${pkg.name} to ${fixedVersionOf(v, pkg)} or later.` : `Upgrade or replace ${pkg.name}; no fixed version is listed.`,
      });
    }
  });
  return out;
}

// ── client ───────────────────────────────────────────────────────────────────

export type OsvQueryResult =
  /** `truncated`: more advisories matched than we read the detail of (they stand at HIGH, unweighed). */
  | { ok: true; findings: NormalizedFinding[]; vulnerablePackages: number; truncated: boolean }
  | { ok: false; reason: string };

/** Look the packages up on OSV. Network / HTTP failure of the batch query is `{ ok: false }`. */
export async function queryOsv(packages: readonly OsvPackage[], fetchFn: typeof fetch = fetch): Promise<OsvQueryResult> {
  if (packages.length === 0) return { ok: true, findings: [], vulnerablePackages: 0, truncated: false };
  let results: Array<{ vulns?: Array<{ id: string }> }>;
  try {
    const res = await fetchFn(`${OSV_BASE}/v1/querybatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: packages.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `OSV.dev answered HTTP ${res.status}` };
    const body = (await res.json()) as { results?: Array<{ vulns?: Array<{ id: string }> }> };
    if (!Array.isArray(body.results) || body.results.length !== packages.length) {
      return { ok: false, reason: 'OSV.dev returned a result list that does not match the query' };
    }
    results = body.results;
  } catch (error) {
    return { ok: false, reason: `OSV.dev could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }

  const idsByPackage = results.map((r) => (r.vulns ?? []).map((v) => v.id));
  const allIds = [...new Set(idsByPackage.flat())];
  const uniqueIds = allIds.slice(0, OSV_MAX_DETAIL_FETCHES);
  const detailsTruncated = allIds.length > OSV_MAX_DETAIL_FETCHES;
  const details = new Map<string, OsvVuln>();
  for (let i = 0; i < uniqueIds.length; i += DETAIL_CONCURRENCY) {
    await Promise.all(uniqueIds.slice(i, i + DETAIL_CONCURRENCY).map(async (id) => {
      try {
        const res = await fetchFn(`${OSV_BASE}/v1/vulns/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        // A detail we cannot read still stands as a finding, at HIGH (unknown severity fails closed):
        // the package IS listed as vulnerable, so dropping it would hide it.
        if (res.ok) details.set(id, (await res.json()) as OsvVuln);
      } catch (error) {
        // The finding is kept without detail; the failed lookup is recorded, not dropped.
        reportCaughtError(error, {
          source: 'application/security/osvScaScan.ts',
          operation: 'fetchOsvVulnDetail',
          context: { vulnId: id },
          level: 'warning',
        });
      }
    }));
  }
  return {
    ok: true,
    findings: buildOsvFindings(packages, idsByPackage, details),
    vulnerablePackages: idsByPackage.filter((ids) => ids.length > 0).length,
    truncated: detailsTruncated,
  };
}
