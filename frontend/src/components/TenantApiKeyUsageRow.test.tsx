import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TenantApiKeyUsageRow, type UsageResult } from './TenantApiKeyUsageRow';

const emptyResult = (over: Partial<UsageResult> = {}): UsageResult => ({
  summary: { total: 12, totalTokens: 3400, modelCount: 2 },
  rows: [],
  days: 30,
  page: 1,
  limit: 50,
  ...over,
});

describe('TenantApiKeyUsageRow', () => {
  it('renders nothing when collapsed', () => {
    const load = vi.fn();
    const { container } = render(<TenantApiKeyUsageRow expanded={false} load={load} />);
    expect(container).toBeEmptyDOMElement();
    expect(load).not.toHaveBeenCalled();
  });

  it('renders shared StatTile summaries when expanded', async () => {
    const load = vi.fn().mockResolvedValue(emptyResult());
    render(<TenantApiKeyUsageRow expanded load={load} />);
    await waitFor(() => expect(screen.getByText('Requests')).toBeInTheDocument());
    expect(screen.getByText('Total tokens')).toBeInTheDocument();
    expect(screen.getByText('Distinct models')).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith({ days: 30, page: 1, limit: 50 });
  });
});
