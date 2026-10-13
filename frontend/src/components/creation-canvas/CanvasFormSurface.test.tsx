import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasFormSurface } from './CanvasFormSurface';
import type { CreationNodeData } from './types';

vi.mock('@/lib/founderOpsApi', () => ({
  publishForm: vi.fn(),
  closeForm: vi.fn(),
  summarizeForm: vi.fn(async () => ({ summary: null })),
}));

vi.mock('@/lib/formDistribution', () => ({
  sendForm: vi.fn(),
  postForm: vi.fn(),
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

  it('shows Send and Post for a published editable form that is not closed', () => {
    render(
      <CanvasFormSurface
        objectId="form-1"
        onExit={() => {}}
        onEdit={() => {}}
        data={{
          kind: 'form',
          title: 'Validation',
          questions: [{ id: 'q1', type: 'boolean', label: 'Q?' }],
          questionSetId: 'qs-1',
          status: 'open',
          shareUrl: 'https://builderforce.ai/f/test',
        } as CreationNodeData}
      />,
    );
    expect(screen.getByRole('button', { name: 'form.send' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'form.post' })).toBeTruthy();
  });

  it('hides Send and Post when form is unpublished (no questionSetId)', () => {
    render(
      <CanvasFormSurface
        objectId="form-1"
        onExit={() => {}}
        onEdit={() => {}}
        data={{
          kind: 'form',
          title: 'Validation',
          questions: [{ id: 'q1', type: 'boolean', label: 'Q?' }],
          status: 'open',
        } as CreationNodeData}
      />,
    );
    expect(screen.queryByRole('button', { name: 'form.send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'form.post' })).toBeNull();
  });

  it('hides Send and Post when form is closed', () => {
    render(
      <CanvasFormSurface
        objectId="form-1"
        onExit={() => {}}
        onEdit={() => {}}
        data={{
          kind: 'form',
          title: 'Validation',
          questions: [{ id: 'q1', type: 'boolean', label: 'Q?' }],
          questionSetId: 'qs-1',
          status: 'closed',
          shareUrl: 'https://builderforce.ai/f/test',
        } as CreationNodeData}
      />,
    );
    expect(screen.queryByRole('button', { name: 'form.send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'form.post' })).toBeNull();
  });

  it('hides Send and Post when viewer cannot edit', () => {
    render(
      <CanvasFormSurface
        objectId="form-1"
        onExit={() => {}}
        data={{
          kind: 'form',
          title: 'Validation',
          questions: [{ id: 'q1', type: 'boolean', label: 'Q?' }],
          questionSetId: 'qs-1',
          status: 'open',
          shareUrl: 'https://builderforce.ai/f/test',
        } as CreationNodeData}
      />,
    );
    expect(screen.queryByRole('button', { name: 'form.send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'form.post' })).toBeNull();
  });
});
