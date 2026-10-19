import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyQueue, isDurableUserWorkQueue, isTelemetryQueue } from '@builderforce/write-outbox';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'telemetry.ts'), 'utf8');

describe('qa-capture telemetry stamp', () => {
  it('stamps the existing outbox from the classifier and does not add a retry policy', () => {
    expect(isTelemetryQueue('qa-capture')).toBe(true);
    expect(isDurableUserWorkQueue('qa-capture')).toBe(false);
    expect(classifyQueue('qa-capture')?.retention).toBe('best-effort');
    expect(source).toContain('work: qaCaptureWork');
    expect(source).toContain("isTelemetryQueue(QA_CAPTURE)");
    expect(source).toContain("classifyQueue(QA_CAPTURE)");
    expect(source).not.toContain('retry:');
    expect(source.match(/createOutbox/g)).toHaveLength(2);
  });
});
