import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ONE fix card (PRD 33 §6 "one of each"): every surface that shows a fix renders
 * `PrescriptionCard` and reads through `usePrescriptionsFor` (or the client the
 * hook wraps) — none draws its own fix row. Source-level, so a new entry point
 * that forks the card fails here, not in review.
 */

const SRC = resolve(__dirname, '../../..');

const ENTRY_POINTS = [
  'components/replay/overview/OverviewView.tsx',
  'components/replay/funnels/FunnelsView.tsx',
  'components/replay/heatmap/HeatmapInsights.tsx',
  'components/replay/ReplayPlayer.tsx',
  'components/creation-canvas/ProofScoreboard.tsx',
  'components/insights/bands/pageStageLenses.tsx',
  'components/insights/bands/DoNext.tsx',
  'components/insights/kinds/FixesKind.tsx',
  'components/insights/kinds/FixKind.tsx',
] as const;

const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8');

describe('fix entry points', () => {
  it.each(ENTRY_POINTS)('%s renders THE fix card', (path) => {
    const source = read(path);
    expect(source).toMatch(/import \{[^}]*\bPrescriptionCard\b[^}]*\} from '[^']*prescriptions\/PrescriptionCard'/);
    expect(source).toMatch(/<PrescriptionCard\b/);
  });

  it.each(ENTRY_POINTS.filter((path) => !path.endsWith('FixKind.tsx')))('%s reads fixes through usePrescriptionsFor', (path) => {
    expect(read(path)).toMatch(/\busePrescriptionsFor\(/);
  });

  it('only the card file defines a fix card', () => {
    for (const path of ENTRY_POINTS) expect(read(path)).not.toMatch(/function PrescriptionCard\b/);
  });
});
