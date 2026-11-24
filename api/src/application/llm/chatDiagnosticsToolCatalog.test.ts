import { describe, expect, it } from 'vitest';
import { summarizeDiagnosticCaptures } from './chatDiagnosticsToolCatalog';

describe('chat diagnostics capture evidence', () => {
  it('distinguishes an uncaptured chat from any health verdict', () => {
    expect(summarizeDiagnosticCaptures({ diagnostics: [] })).toEqual({
      diagnostics: [],
      evidence: 'no_capture',
      note: expect.stringContaining('health and recurring failure patterns are unknown'),
    });
  });

  it('preserves pressure and timing without treating an older edit count as shipment', () => {
    const report = {
      running: true,
      run: { contextPressureOnly: true, truncatedToolResults: 4, errors: 0, sessionShipped: 1 },
    };
    const result = summarizeDiagnosticCaptures({
      diagnostics: [
        { id: 2, schemaVersion: 3, capturedAt: '2026-11-24T05:00:00Z', likelyCause: 'run-in-progress', report },
        { id: 1, schemaVersion: 2, likelyCause: 'healthy', report },
      ],
    });
    expect(result).toMatchObject({
      evidence: 'stored_snapshots',
      diagnostics: [
        { id: 2, running: true, contextPressureOnly: true, truncatedToolResults: 4, sessionShipped: 1 },
        { id: 1, running: true, contextPressureOnly: true, likelyCause: 'healthy' },
      ],
    });
    expect((result.diagnostics as object[])[1]).not.toHaveProperty('sessionShipped');
  });
});
