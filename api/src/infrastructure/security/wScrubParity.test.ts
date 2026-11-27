/**
 * Parity between the platform's secret redactor and the one the browser runtime ships
 * (`@seanhogg/builderforce-webcontainers/security` `scrubString`, published separately and not allowed to import
 * BF packages). Both must hide the same credentials; a shape the runtime does not yet hide is listed in
 * `RUNTIME_GAPS` so the gap is visible, and the list must shrink, never grow, as the runtime adopts the shapes.
 */
import { describe, expect, it } from 'vitest';
import { scrubString } from '@seanhogg/builderforce-webcontainers/security';
import { redactSecrets } from '@builderforce/secret-redaction';

const SAMPLES: ReadonlyArray<readonly [name: string, text: string, secret: string]> = [
  ['bearer header', 'Authorization: Bearer abcdef0123456789abcdef0123456789', 'abcdef0123456789abcdef0123456789'],
  ['url credential', 'postgres://admin:hunter2hunter2@db.internal:5432/app', 'hunter2hunter2'],
  ['key=value secret', 'API_TOKEN=s3cr3tvalue1234567890', 's3cr3tvalue1234567890'],
  ['openai-style key', `failed for sk-proj-${'a1b2c3d4'.repeat(4)}`, `sk-proj-${'a1b2c3d4'.repeat(4)}`],
  ['github fine-grained token', `using github_pat_${'a'.repeat(40)} to push`, `github_pat_${'a'.repeat(40)}`],
  ['stripe key', `key sk_live_${'b'.repeat(24)} rejected`, `sk_live_${'b'.repeat(24)}`],
  ['aws access key', 'AKIAABCDEFGHIJKLMNOP in config', 'AKIAABCDEFGHIJKLMNOP'],
];

/** Sample names the published runtime scrubber does not hide yet. */
const RUNTIME_GAPS: ReadonlySet<string> = new Set([
  'openai-style key',
  'github fine-grained token',
  'stripe key',
  'aws access key',
]);

describe('secret redaction parity with the runtime scrubber', () => {
  it.each(SAMPLES)('the platform redactor hides %s', (_name, text, secret) => {
    expect(redactSecrets(text)).not.toContain(secret);
  });

  it.each(SAMPLES)('the runtime scrubber hides %s (or the gap is listed)', (name, text, secret) => {
    const hidden = !scrubString(text).includes(secret);
    expect(hidden || RUNTIME_GAPS.has(name), `${name}: runtime scrubber leaks it and it is not a listed gap`).toBe(true);
    if (hidden) expect(RUNTIME_GAPS.has(name), `${name}: now hidden by the runtime, remove it from RUNTIME_GAPS`).toBe(false);
  });
});
