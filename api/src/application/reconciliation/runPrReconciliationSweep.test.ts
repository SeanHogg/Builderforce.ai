import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./runPrReconciliationSweep.ts', import.meta.url).href), 'utf8');

describe('scheduled PR reconciliation policy wiring', () => {
  it('runs audited apply mode with only the internal close-candidate policy enabled', () => {
    expect(source).toContain("mode: 'apply'");
    expect(source).toContain('autoApplyCloseCandidates: true');
  });

  it('does not let a recent diagnostic dry run postpone the first cleanup run', () => {
    expect(source).toContain("recent.mode = 'apply'");
  });
});
