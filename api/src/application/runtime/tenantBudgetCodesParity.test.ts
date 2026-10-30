import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TENANT_BUDGET_CODES } from '@builderforce/learned-routing';

/**
 * Three places must agree on which 429s are a TENANT spending its own allowance (not a model throttled):
 * the platform's `TENANT_BUDGET_CODES` (@builderforce/learned-routing), the SDK's `TOKEN_CAP_CODES` (published
 * standalone, so it mirrors the list), and the codes the gateway actually answers with. Set EQUALITY in both
 * directions: a new `*_limit_exceeded` / `*_cap_exceeded` code the gateway starts emitting, or a name left in a
 * list that nothing emits, fails here instead of silently reading as a provider throttle (or never matching).
 */
const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const tsFilesIn = (relative: string): string[] =>
  readdirSync(fileURLToPath(new URL(relative, import.meta.url)), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => `${relative}${file.replace(/\\/g, '/')}`);

/**
 * The emit sites: EVERY route and application file, not a hand-picked few - a code introduced in a new file
 * (the video credit gate was one) must fail this test rather than silently read as a provider throttle.
 */
const EMIT_FILES = [...tsFilesIn('../../presentation/routes/'), ...tsFilesIn('../')];

/**
 * Codes a route emits that are a tenant limit but NOT a model-call 429, so they never reach the failure classifier.
 *  - `ingestion_limit_exceeded`: the repo-import allowance, answered 402 (upgrade required) by `repoRoutes.ts`.
 */
const NOT_A_MODEL_BUDGET: ReadonlySet<string> = new Set(['ingestion_limit_exceeded']);

/** A `code: '…'` field, or an exported code constant (`export const X_CODE = '…'`) - the two ways a code is spelled. */
const CODE_SITE = /\bcode:|^\s*export const \w+(?::[^=]+)?\s*=\s*'/;

/** Every `'…_limit_exceeded' | '…_cap_exceeded'` LITERAL at a code site in the emit files (comment lines are not emitters). */
function emittedBudgetCodes(): Set<string> {
  const found = new Set<string>();
  for (const file of EMIT_FILES) {
    for (const line of read(file).split('\n')) {
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line) || !CODE_SITE.test(line)) continue;
      for (const match of line.matchAll(/'([a-z_]+_(?:limit|cap)_exceeded)'/g)) {
        if (!NOT_A_MODEL_BUDGET.has(match[1]!)) found.add(match[1]!);
      }
    }
  }
  return found;
}

function sdkTokenCapCodes(): Set<string> {
  const source = read('../../../../sdk/src/application/classifyError.ts');
  const body = /const TOKEN_CAP_CODES[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(source)?.[1] ?? '';
  return new Set([...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));
}

/**
 * Codes in the lists that this tree does not emit, each with its reason.
 *  - `claw_token_limit_exceeded`: in the SDK's published `TOKEN_CAP_CODES` since before this work (a public
 *    contract consumers may already branch on), emitted by the claw gateway outside this tree.
 */
const NOT_EMITTED_HERE: ReadonlySet<string> = new Set(['claw_token_limit_exceeded']);

describe('tenant-budget codes', () => {
  it("the SDK's TOKEN_CAP_CODES is exactly the platform's TENANT_BUDGET_CODES", () => {
    expect([...sdkTokenCapCodes()].sort()).toEqual([...TENANT_BUDGET_CODES].sort());
  });

  it('the platform list is exactly what the gateway emits (plus the documented exemption), in both directions', () => {
    const emitted = emittedBudgetCodes();
    const listed = new Set(TENANT_BUDGET_CODES);
    expect([...emitted].filter((code) => !listed.has(code)).sort(), 'emitted by the gateway but missing from TENANT_BUDGET_CODES').toEqual([]);
    expect([...listed].filter((code) => !emitted.has(code) && !NOT_EMITTED_HERE.has(code)).sort(), 'listed but emitted by nothing').toEqual([]);
    // The exemption is real: it is still listed, and still not emitted (else drop it from the exemption list).
    for (const code of NOT_EMITTED_HERE) {
      expect(listed.has(code), code).toBe(true);
      expect(emitted.has(code), code).toBe(false);
    }
  });
});
