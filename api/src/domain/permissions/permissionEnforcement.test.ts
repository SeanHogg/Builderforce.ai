import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALL_PERMISSIONS, ENFORCED_PERMISSIONS, PERMISSIONS } from './permissionRegistry';

/**
 * `ENFORCED_PERMISSIONS` is a promise made to operators: a permission listed
 * there is backed by a real request-time gate, and one that is not is advisory —
 * the admin matrix renders exactly that distinction.
 *
 * A promise nobody checks is how the registry drifted into being decorative in
 * the first place, so these tests check it in BOTH directions:
 *
 *   - a permission gated in the routes but missing from the set would under-report
 *     (an operator would think an override does nothing when it does);
 *   - a permission in the set with no gate anywhere is the original bug — an
 *     admin screen implying control that does not exist.
 */

const ROUTES_DIR = resolve(__dirname, '../../presentation/routes');

/** Reverse map: 'billing:manage' → 'BILLING_MANAGE', for matching source text. */
const CONSTANT_BY_VALUE = new Map(
  Object.entries(PERMISSIONS).map(([constant, value]) => [value as string, constant]),
);

/** Gates that depend on the request body AND the row live in the use case, not the
 *  route — e.g. application/approval/decideApproval.ts (approve vs answer). */
const APPLICATION_DIR = resolve(__dirname, '../../application');

function sourcesIn(dir: string, recursive: boolean): string[] {
  return (readdirSync(dir, { recursive }) as string[])
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => readFileSync(resolve(dir, f), 'utf8'));
}

/** One source per file, so a local gate alias resolves within the file that defines it. */
function gateSources(): string[] {
  return [...sourcesIn(ROUTES_DIR, false), ...sourcesIn(APPLICATION_DIR, true)];
}

/**
 * A file-local alias over `requirePermission` is a gate where it is called — e.g.
 * tenantApiKeyRoutes' `const may = (permission) => (admin ? passThrough :
 * requirePermission(permission))`, which only the superadmin mount bypasses.
 */
function gateNames(source: string): string[] {
  const alias = /const\s+(\w+)\s*=\s*\([^)]*\)\s*=>[^;\n]*\brequirePermission\s*\(/g;
  return ['requirePermission', 'memberHasPermission', ...[...source.matchAll(alias)].map((m) => m[1]!)];
}

/**
 * Permissions that appear in an actual gate — the `requirePermission(...)`
 * middleware (or a local alias of it) or the inline `memberHasPermission(...)`
 * check used where the branch depends on the request body.
 */
function gatedPermissions(source: string): Set<string> {
  const gated = new Set<string>();
  const head = new RegExp(String.raw`\b(?:${gateNames(source).join('|')})\s*\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = head.exec(source)) !== null) {
    // Scan the argument list by balancing parens — an inline check passes
    // `c.get('role')`, so a naive `[^)]*` would stop before reaching the
    // permission argument.
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
    }
    const args = source.slice(m.index + m[0].length, i);
    const constant = args.match(/PERMISSIONS\.(\w+)/)?.[1];
    if (!constant) continue;
    const value = (PERMISSIONS as Record<string, string>)[constant];
    if (value) gated.add(value);
  }
  return gated;
}

describe('permission enforcement registry', () => {
  const gated = new Set(gateSources().flatMap((source) => [...gatedPermissions(source)]));

  it('every permission declared enforced has a gate in the routes', () => {
    const declaredButUngated = [...ENFORCED_PERMISSIONS].filter((p) => !gated.has(p));
    expect(
      declaredButUngated,
      `These are listed in ENFORCED_PERMISSIONS but no route gates them, so the admin ` +
        `matrix would claim control the platform does not have. Add a ` +
        `requirePermission(PERMISSIONS.${declaredButUngated.map((p) => CONSTANT_BY_VALUE.get(p)).join('/')}) ` +
        `gate, or remove the entry.`,
    ).toEqual([]);
  });

  it('every permission gated in the routes is declared enforced', () => {
    const gatedButUndeclared = [...gated].filter((p) => !ENFORCED_PERMISSIONS.has(p as never));
    expect(
      gatedButUndeclared,
      `These are enforced by a route gate but missing from ENFORCED_PERMISSIONS, so the ` +
        `admin matrix would show them as advisory when they are real. Add them to the set.`,
    ).toEqual([]);
  });

  it('only names permissions that exist in the registry', () => {
    const unknown = [...ENFORCED_PERMISSIONS].filter((p) => !(ALL_PERMISSIONS as string[]).includes(p));
    expect(unknown).toEqual([]);
  });

  it('leaves the still-advisory permissions visible rather than silently claiming them', () => {
    // Not a rule about WHICH are enforced — just that the set is a real subset, so
    // "enforced" stays a meaningful label instead of becoming a synonym for "all".
    expect(ENFORCED_PERMISSIONS.size).toBeGreaterThan(0);
    expect(ENFORCED_PERMISSIONS.size).toBeLessThan(ALL_PERMISSIONS.length);
  });
});
