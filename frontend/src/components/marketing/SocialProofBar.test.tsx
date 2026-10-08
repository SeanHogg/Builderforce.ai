import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialProofBar } from './SocialProofBar';
import { PROOF_FLOORS, visibleProofMetrics, type PlatformProof } from '@/lib/platformProof';

// A plain stub, not `vi.fn`: vitest tracks a mock's returned promises, and that
// tracking re-surfaces a rejection the component itself already handled.
let nextProof: () => Promise<PlatformProof> = () => new Promise(() => {});
let calls = 0;
vi.mock('@/lib/platformProof', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platformProof')>()),
  fetchPlatformProof: () => { calls += 1; return nextProof(); },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { count: number }) => `${key}:${values?.count}`,
}));

const proof = (overrides: Partial<PlatformProof> = {}): PlatformProof => ({
  builders: 0, buildersThisWeek: 0, projects: 0, agentRunsCompleted: 0, asOf: '2026-10-07T00:00:00.000Z', ...overrides,
});

describe('visibleProofMetrics', () => {
  it('shows a metric only at or above its floor — never a weak number', () => {
    expect(visibleProofMetrics(proof({ builders: PROOF_FLOORS.builders - 1 }))).toEqual([]);
    expect(visibleProofMetrics(proof({ builders: PROOF_FLOORS.builders, buildersThisWeek: 3 }))).toEqual(['builders']);
  });
});

describe('SocialProofBar', () => {
  beforeEach(() => { calls = 0; });

  it('renders the real counts that clear their floors', async () => {
    nextProof = () => Promise.resolve(proof({ builders: 1234, buildersThisWeek: 42, projects: 5 }));
    render(<SocialProofBar />);
    await waitFor(() => expect(screen.getByText('builders:1234')).toBeInTheDocument());
    expect(screen.getByText('buildersThisWeek:42')).toBeInTheDocument();
    expect(screen.queryByText(/^projects:/)).not.toBeInTheDocument();
  });

  it('renders nothing when the counts are unavailable', async () => {
    nextProof = () => Promise.reject(new Error('offline'));
    const { container } = render(<SocialProofBar />);
    await waitFor(() => expect(calls).toBe(1));
    expect(container).toBeEmptyDOMElement();
  });
});
