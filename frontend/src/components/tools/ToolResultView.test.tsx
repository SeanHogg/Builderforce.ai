import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolResultView } from './ToolResultView';
vi.mock('@/components/charts/GaugeChart', () => ({ GaugeChart: () => null }));
vi.mock('@/components/charts/RadarChart', () => ({ RadarChart: () => null }));

describe('audit result presentation', () => {
  it('distinguishes a provisional scan from a completed source review', () => {
    const { rerender } = render(<ToolResultView result={{ headline: 'Preview', metrics: [], recommendations: [],
      audit: { runId: 'r', projectId: 42, status: 'preview', ticketIds: [] } }} />);
    expect(screen.getByText('tools.auditPreview')).toBeInTheDocument();
    rerender(<ToolResultView result={{ headline: 'Reviewed', metrics: [], recommendations: [],
      audit: { runId: 'r', projectId: 42, status: 'completed', ticketIds: [123] } }} />);
    expect(screen.queryByText('tools.auditPreview')).not.toBeInTheDocument();
    expect(screen.getByText('tools.auditComplete')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/projects?tab=tasks&task=123&project=42');
  });
});
