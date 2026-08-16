import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { CreationNodeData } from './types';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const { CreationNode } = await import('./CreationNode');

function renderNode(data: Partial<CreationNodeData>, onOpenSurface?: (nodeId: string, surface: string) => void) {
  const nodeData = { kind: 'website', title: 'GreenEdge Yard Care', pages: [], ...data } as unknown as CreationNodeData;
  return render(
    <ReactFlowProvider>
      <CreationNode
        id="site-1"
        type="creation"
        data={nodeData}
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        draggable={false}
        selectable={false}
        deletable={false}
        {...(onOpenSurface ? { onOpenSurface } : {})}
      />
    </ReactFlowProvider>,
  );
}

describe('opening a card at full size from its own header', () => {
  it('draws nothing when the board has no way to open a surface for it', () => {
    renderNode({});
    expect(screen.queryByTestId('open-site-surface')).toBeNull();
  });

  it('draws the open-surface control on the card header once the board can', () => {
    renderNode({}, vi.fn());
    expect(screen.getByTestId('open-site-surface')).toBeInTheDocument();
  });

  it('asks for the surface without also selecting the card underneath it', () => {
    const onOpenSurface = vi.fn();
    renderNode({}, onOpenSurface);
    fireEvent.click(screen.getByTestId('open-site-surface'));
    expect(onOpenSurface).toHaveBeenCalledWith('site-1', 'site');
  });

  it('draws nothing for a kind with no surface at all, even when the board offers one', () => {
    const onOpenSurface = vi.fn();
    render(
      <ReactFlowProvider>
        <CreationNode
          id="note-1"
          type="creation"
          data={{ kind: 'note', title: 'Quick note' } as unknown as CreationNodeData}
          selected={false}
          dragging={false}
          zIndex={1}
          isConnectable={false}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          draggable={false}
          selectable={false}
          deletable={false}
          onOpenSurface={onOpenSurface}
        />
      </ReactFlowProvider>,
    );
    expect(screen.queryByRole('button', { name: /open/i })).toBeNull();
  });
});
