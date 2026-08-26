import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { emptyCanvasSceneSpec } from '@builderforce/creation-canvas-contract';
import type { CreationNodeData } from './types';

/**
 * `CanvasSceneGeneratorPanel` — the `scene3d` surface's object-bound half.
 *
 * Follows the same render/prop-contract shape `canvasPlaySurface.test.tsx` uses for its
 * sibling object surface: the real catalog for copy, the panel rendered directly against
 * a `scene` object's own data, and no attempt to drive an actual generation (that would
 * reach `@seanhogg/builderforce-studio`'s real `VideoEngine.create`, which needs a real
 * GPU — out of scope for a unit test; see the surrounding hook's own responsibility).
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const { CanvasSceneGeneratorPanel } = await import('./CanvasSceneGeneratorPanel');

function sceneData(overrides: Partial<CreationNodeData> = {}): CreationNodeData {
  return {
    kind: 'scene',
    title: 'Untitled AI scene',
    scene: { ...emptyCanvasSceneSpec(), modelId: 'lcm-tiny-sd' },
    ...overrides,
  } as CreationNodeData;
}

describe('CanvasSceneGeneratorPanel', () => {
  it('renders the scene3d object surface, bound to the scene object', () => {
    render(<CanvasSceneGeneratorPanel objectId="n1" data={sceneData()} onExit={() => {}} onEdit={() => {}} />);
    expect(screen.getByTestId('canvas-scene3d-surface')).toBeTruthy();
    expect(screen.getByText('Untitled AI scene')).toBeTruthy();
  });

  it('shows the object’s own prompt, and writes typing back through onEdit', () => {
    const onEdit = vi.fn();
    render(<CanvasSceneGeneratorPanel
      objectId="n1"
      data={sceneData({ scene: { ...emptyCanvasSceneSpec(), modelId: 'lcm-tiny-sd', prompt: 'a fox in a forest' } })}
      onExit={() => {}}
      onEdit={onEdit}
    />);
    const prompt = screen.getByPlaceholderText(/fox running through autumn forest/i) as HTMLTextAreaElement;
    expect(prompt.value).toBe('a fox in a forest');
    fireEvent.change(prompt, { target: { value: 'a whale in the ocean' } });
    expect(onEdit).toHaveBeenCalledWith({ scene: expect.objectContaining({ prompt: 'a whale in the ocean' }) });
  });

  it('disables Generate until a prompt is written, and never renders it read-only', () => {
    const { rerender } = render(<CanvasSceneGeneratorPanel objectId="n1" data={sceneData()} onExit={() => {}} onEdit={() => {}} />);
    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();

    rerender(<CanvasSceneGeneratorPanel
      objectId="n1"
      data={sceneData({ scene: { ...emptyCanvasSceneSpec(), modelId: 'lcm-tiny-sd', prompt: 'a fox in a forest' } })}
      onExit={() => {}}
      onEdit={() => {}}
    />);
    expect(screen.getByRole('button', { name: /generate/i })).not.toBeDisabled();

    // No `onEdit` — a viewer with no edit rights, same convention `CanvasWorldView`/
    // `CanvasTimelineSurface` use for their own read-only render.
    rerender(<CanvasSceneGeneratorPanel objectId="n1" data={sceneData()} onExit={() => {}} />);
    expect(screen.queryByRole('button', { name: /generate/i })).toBeNull();
    expect(screen.getByPlaceholderText(/fox running through autumn forest/i)).toBeDisabled();
  });

  it('exits back to the board', () => {
    const onExit = vi.fn();
    render(<CanvasSceneGeneratorPanel objectId="n1" data={sceneData()} onExit={onExit} onEdit={() => {}} />);
    fireEvent.click(screen.getByText(/back to the board/i));
    expect(onExit).toHaveBeenCalled();
  });
});
