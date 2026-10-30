import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TENANT_BUDGET_CODES } from '@builderforce/learned-routing';

/**
 * The SDK is published standalone and cannot import `@builderforce/learned-routing`, so its
 * `TOKEN_CAP_CODES` is a mirror of the platform's `TENANT_BUDGET_CODES`. Two lists that must agree
 * are one list in two places: this fails the moment they differ, and checks every code against the
 * gateway that actually emits it.
 */
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

function sdkTokenCapCodes(): string[] {
  const source = read('../../../../sdk/src/application/classifyError.ts');
  const body = /const TOKEN_CAP_CODES[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(source)?.[1] ?? '';
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe('tenant-budget codes', () => {
  it("the SDK's TOKEN_CAP_CODES is exactly the platform's TENANT_BUDGET_CODES", () => {
    expect(sdkTokenCapCodes().sort()).toEqual([...TENANT_BUDGET_CODES].sort());
  });

  it('every code is one the api actually answers with (so the list cannot hold a dead name)', () => {
    const emitters = [
      read('../../presentation/routes/llm/gatewayGuards.ts'),
      read('../../presentation/routes/videoRoutes.ts'),
    ].join('\n');
    // `claw_token_limit_exceeded` is emitted by the claw gateway outside this tree; it is listed in the SDK today.
    const external = new Set(['claw_token_limit_exceeded']);
    for (const code of TENANT_BUDGET_CODES) {
      if (!external.has(code)) expect(emitters, code).toContain(`'${code}'`);
    }
  });
});
