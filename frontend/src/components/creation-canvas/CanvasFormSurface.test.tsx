import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasFormSurface } from './CanvasFormSurface';
import type { CreationNodeData } from './types';

vi.mock('@/lib/founderOpsApi', () => ({
  publishForm: vi.fn(),
  closeForm: vi.fn(),
  summarizeForm: vi.fn(async () => ({ summary: null })),
}));

vi.mock('@/lib/growthApi', () => ({
  growthApi: {
    listAudiences: vi.fn(async () => ({ audiences: [] })),
    createAudience: vi.fn(),
    addMembersFromCrm: vi.fn(),
  },
}));

vi.mock('@/hooks/usePolledResource', () => ({
  usePolledResource: () => ({ refresh: () => {} }),
}));

describe('CanvasFormSurface', () => {
  it('shows Publish for an unpublished editable form and lists its questions', () => {
    render(
      <CanvasFormSurface
        objectId="form-1"
        onExit={() => {}}
        onEdit={() => {}}
        data={{
          kind: 'form',
          title: 'Validation',
          questions: [{ id: 'q1', type: 'boolean', label: 'Would you pay?', required: true }],
        } as CreationNodeData}
      />,
    );
    expect(screen.getByTestId('canvas-form-surface')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'form.publish' })).toBeTruthy();
    expect(screen.getByText('Would you pay?')).toBeTruthy();
    expect(screen.getByText('Would you pay?').closest('li')?.textContent).toContain('boolean');
  });

  it('hides Publish when the viewer cannot edit', () => {
    render(
      <CanvasFormSurface
        objectId="form-1"
        onExit={() => {}}
        data={{ kind: 'form', title: 'Validation', questions: ['Q'] } as CreationNodeData}
      />,
    );
    expect(screen.queryByRole('button', { name: 'form.publish' })).toBeNull();
    expect(screen.getByText('form.readOnlyHint')).toBeTruthy();
  });
});
