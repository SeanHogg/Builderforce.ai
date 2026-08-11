import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityArtifactNotice } from './CapabilityArtifactNotice';

vi.mock('@/lib/brain', () => ({
  getBrainCapability: () => ({ id: 'document' }),
  replyHasArtifact: () => false,
}));

describe('CapabilityArtifactNotice', () => {
  it('acknowledges a retry with a checkmark state', () => {
    const onRetry = vi.fn();
    render(
      <CapabilityArtifactNotice
        capability="document"
        content="Stub"
        isLatest
        onRetry={onRetry}
      />,
    );

    const retry = screen.getByRole('button', { name: 'brain.capabilities.missing.retry' });
    fireEvent.click(retry);

    expect(onRetry).toHaveBeenCalledOnce();
    expect(retry).toHaveAttribute('data-state', 'complete');
    expect(retry).toBeDisabled();
    expect(retry).toHaveTextContent('');
  });
});
