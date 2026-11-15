import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project360 } from '@seanhogg/builderforce-brain-ui';
import { getProject360, getProjectSpend, type ProjectSpend } from '@/lib/project360Api';
import { toolsApi } from '@/lib/builderforceApi';
import type { ProjectScore } from '@/lib/tools';
import { ProjectAnalyticsPanel } from './ProjectAnalyticsPanel';

// NOTE — next-intl is globally mocked in `src/test/setup.ts`: `useTranslations`
// returns the raw `ns.key` and `NextIntlClientProvider` is inert. So these
// assertions match the KEYS, not the English copy (the project convention —
// see the ProjectRunDeltas test). The i18n key-check script is what guarantees
// each key resolves to real copy in the catalog.
vi.mock('@/lib/project360Api', () => ({ getProject360: vi.fn(), getProjectSpend: vi.fn() }));
vi.mock('@/lib/builderforceApi', () => ({ toolsApi: { projectScore: vi.fn() } }));
// `@seanhogg/builderforce-brain-ui` (via ProjectHealthPanel / the Project360 type) pulls
// `brain-embedded/dist`, a built artifact whose chunk hashes drift; the type is erased
// at runtime, so stub the module to keep this spec hermetic and fast. A module mock
// must provide a `default` export or the importing module sees `undefined`.
vi.mock('@seanhogg/builderforce-brain-ui', () => ({
  default: {},
  Project360View: () => null,
  DEFAULT_PROJECT360_LABELS: {},
}));
// The leaf panels are integration-tested elsewhere; stub them to focus this spec
// on the consolidated layout (which section renders, and in what order). Alias
// paths — the probe confirmed both relative and alias specifiers resolve to the
// same module, but alias keeps the mock unambiguous.
vi.mock('@/components/project360/ProjectHealthPanel', () => ({ default: {}, ProjectHealthPanel: () => <div data-testid="health" /> }));
vi.mock('@/components/project360/ProjectSpendWidget', () => ({ default: {}, ProjectSpendWidget: () => <div data-testid="spend" /> }));
vi.mock('@/components/runDelta/ProjectRunDeltas', () => ({ default: {}, ProjectRunDeltas: () => <div data-testid="rundeltas" /> }));

const get360 = vi.mocked(getProject360);
const getSpend = vi.mocked(getProjectSpend);
const projectScore = vi.mocked(toolsApi.projectScore);

const spend = (): ProjectSpend => ({
  projectId: 42,
  window: 'month',
  windowStart: '2026-11-01T00:00:00Z',
  costUsd: 0,
  totalTokens: 0,
  byoTokens: 0,
  requests: 0,
  topModels: [],
});

const health = (over: Partial<Project360> = {}): Project360 => ({
  project: { id: 42, name: 'Acme' },
  hasData: true,
  overall: { score: 72, tier: 'healthy', color: '#30a46c', progressPct: 40 },
  counts: { total: 10, completed: 4, open: 5, blocked: 1, overdue: 0, unassigned: 2, inProgress: 1, activeRuns: 0, workers: 0 },
  pillars: [],
  dimensions: [
    { key: 'direction', label: 'Direction', pillar: 'Strategy', score: 85, tier: 'healthy', color: '#30a46c', summary: 'Clear', gaps: [] },
    { key: 'delivery', label: 'Delivery', pillar: 'Build', score: 60, tier: 'watch', color: '#f5a524', summary: 'Slipping', gaps: [] },
  ],
  gaps: [
    { id: 'g1', dimension: 'delivery', severity: 'high', title: 'No architecture spec', detail: 'Add a spec' },
    { id: 'g2', dimension: 'direction', severity: 'low', title: 'No deadline' },
  ],
  workforce: [],
  generatedAt: '2026-11-14T10:00:00Z',
  ...over,
});

const score = (diagnostics: ProjectScore['diagnostics'] = []): ProjectScore => ({
  result: { headline: '', metrics: [], recommendations: [] },
  diagnostics,
});

const diagnostic = (toolId: string, name: string, s: number | null, gapCount = 0): ProjectScore['diagnostics'][number] => ({
  toolId, name, icon: '🧪', score: s, scoreLabel: s != null ? 'Strong' : null,
  headline: s != null ? `${name} looks good` : `${name} has not been run`,
  gapCount,
  remediation: { state: 'none', total: 0, open: 0, prUrl: null },
  kind: 'analyzer', createdAt: '2026-11-14T09:00:00Z',
  result: { headline: '', metrics: [], recommendations: [] },
});

function renderPanel(projectId = 42) {
  return render(<ProjectAnalyticsPanel projectId={projectId} />);
}

describe('ProjectAnalyticsPanel', () => {
  it('composes the consolidated Analytics surface: health pulse, dimensions, diagnostics, run deltas, spend, and the full health view', async () => {
    get360.mockResolvedValue(health());
    getSpend.mockResolvedValue(spend());
    projectScore.mockResolvedValue(score([diagnostic('quality', 'Quality', 78, 2)]));
    renderPanel();

    // Health pulse: overall score, progress, and the top insights.
    expect(await screen.findByText('72')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.getByText(/No architecture spec/)).toBeTruthy();

    // Dimensions strip renders the dimension labels from the data.
    expect(screen.getByText('Direction')).toBeTruthy();
    expect(screen.getByText('Delivery')).toBeTruthy();

    // Diagnostics scoreboard shows the diagnostic name + a Results link (scored row).
    expect(await screen.findByText('Quality')).toBeTruthy();
    expect(screen.getByRole('link', { name: /projectAnalytics\.results/ })).toBeTruthy();

    // The leaf panels the surface composes: run deltas, spend, and the full health view.
    expect(screen.getByTestId('rundeltas')).toBeTruthy();
    expect(screen.getByTestId('spend')).toBeTruthy();
    expect(screen.getByTestId('health')).toBeTruthy();
  });

  it('orders insights by severity (highest first) and caps at four', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `g${i}`, dimension: 'd', severity: (i === 3 ? 'high' : 'low') as 'high' | 'low',
      title: `Gap ${i}`,
    }));
    get360.mockResolvedValue(health({ gaps: many }));
    getSpend.mockResolvedValue(spend());
    projectScore.mockResolvedValue(score());
    renderPanel();
    await screen.findByText('72');
    const shown = screen.getAllByText(/Gap \d/).map((n) => n.textContent);
    expect(shown).toHaveLength(4);
    expect(shown[0]).toContain('Gap 3'); // the single high-severity gap leads
  });

  it('hides the pulse/dimensions when the project has no data, and shows the empty diagnostics state', async () => {
    get360.mockResolvedValue(health({ hasData: false, dimensions: [], gaps: [] }));
    getSpend.mockResolvedValue(spend());
    projectScore.mockResolvedValue(score());
    renderPanel();
    await waitFor(() => expect(get360).toHaveBeenCalled());
    expect(screen.getByText('projectAnalytics.noDiagnostics')).toBeTruthy();
    expect(screen.queryByText('Direction')).toBeNull(); // dimension labels come from data, not copy
    expect(screen.getByTestId('health')).toBeTruthy(); // full health view still renders
  });

  it('renders the diagnostics strip even when the health read fails', async () => {
    get360.mockRejectedValue(new Error('boom'));
    getSpend.mockResolvedValue(spend());
    projectScore.mockResolvedValue(score([diagnostic('security', 'Security', null)]));
    renderPanel();
    expect(await screen.findByText('Security')).toBeTruthy();
    // Unscored diagnostic → a Run link, not a Results link.
    expect(screen.getByRole('link', { name: /projectAnalytics\.run/ })).toBeTruthy();
    expect(screen.queryByText('Direction')).toBeNull();
  });
});
