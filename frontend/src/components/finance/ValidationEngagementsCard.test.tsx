import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ValidationEngagementsResult } from '@/lib/builderforceApi';

/**
 * The card's four answers — loading, failed, empty, rows — plus the two things
 * the rows must say: what each engagement IS, and its status in a badge that
 * never renders empty for a status the API adds later.
 */
const source = vi.fn<() => { data: ValidationEngagementsResult | null; error: string | null }>();
vi.mock('@/lib/bi/useValidationEngagements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bi/useValidationEngagements')>()),
  useValidationEngagements: () => source(),
}));

import { ValidationEngagementsCard } from './ValidationEngagementsCard';

beforeEach(() => { source.mockReset(); });

describe('ValidationEngagementsCard', () => {
  it('shows the loading state until the read resolves', () => {
    source.mockReturnValue({ data: null, error: null });
    render(<ValidationEngagementsCard />);
    expect(screen.getByText('financeHub.validation.loading')).toBeInTheDocument();
  });

  it('surfaces a failed read', () => {
    source.mockReturnValue({ data: null, error: 'boom' });
    render(<ValidationEngagementsCard />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('shows the empty state when nothing is being validated', () => {
    source.mockReturnValue({ data: { available: false, source: 'builderforce', engagements: [] }, error: null });
    render(<ValidationEngagementsCard />);
    expect(screen.getByText('financeHub.validation.empty')).toBeInTheDocument();
  });

  it('lists engagements with their kind, responses and status', () => {
    source.mockReturnValue({
      data: {
        available: true,
        source: 'builderforce',
        engagements: [
          { id: '1', name: 'Founders will pay for runway alerts', kind: 'smoke_test', status: 'validated' },
          { id: 'dashboard:2', name: 'Pricing page', kind: 'dashboard', status: 'brand_new_status' },
          { id: '3', name: 'NPS', kind: 'feedback_collector', status: 'active', responses: 12 },
        ],
      },
      error: null,
    });
    render(<ValidationEngagementsCard />);
    expect(screen.getByText('Founders will pay for runway alerts')).toBeInTheDocument();
    expect(screen.getByText('financeHub.validation.kind.validation')).toBeInTheDocument();
    expect(screen.getByText('financeHub.validation.status.validated')).toBeInTheDocument();
    expect(screen.getByText('brand_new_status')).toBeInTheDocument();
    expect(screen.getByText(/financeHub\.validation\.responses 12/)).toBeInTheDocument();
    expect(screen.getByText(/financeHub\.validation\.count\.validation 1/)).toBeInTheDocument();
  });

  it('caps the list and says how many more there are', () => {
    source.mockReturnValue({
      data: {
        available: true,
        source: 'builderforce',
        engagements: Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: `E${i}`, kind: 'validation' })),
      },
      error: null,
    });
    render(<ValidationEngagementsCard />);
    expect(screen.queryByText('E6')).toBeNull();
    expect(screen.getByText(/financeHub\.validation\.more 3/)).toBeInTheDocument();
  });
});
