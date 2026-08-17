import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CreationNodeData } from './types';

/**
 * The surface behind the Play button.
 *
 * This is the test that would have caught the bug the user reported: pressing
 * Play on a generated Roblox game opened this surface and it said "No game yet.
 * Describe the game you want, then generate it." — about an artifact that was
 * sitting on the board, downloadable, and four thousand words into being real.
 * Every assertion here is about a runtime being CHOSEN rather than a document
 * being found.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

// The 3D runtime is real WebGL and is loaded on demand by the surface. What
// matters here is that it is reached, and with the world the place describes.
vi.mock('./world3d/WorldViewport', () => ({
  WorldViewport: ({ scene, mode }: { scene: { props: unknown[] }; mode: string }) => (
    <div data-testid="world-viewport" data-mode={mode} data-props={scene.props.length} />
  ),
}));

const { CanvasPlaySurface } = await import('./CanvasPlaySurface');

const GAME_HTML = '<!doctype html><html><head><title>Runner</title></head>'
  + "<body><canvas></canvas><script>addEventListener('keydown', () => {});</script></body></html>";

const PLACE = `<roblox version="4">
<Item class="Workspace" referent="RBX0"><Properties><string name="Name">Workspace</string></Properties>
<Item class="Part" referent="RBX1"><Properties>
<bool name="Anchored">true</bool>
<Color3uint8 name="Color3uint8">${(0xff000000 + 0x22c55e) >>> 0}</Color3uint8>
<CoordinateFrame name="CFrame"><X>0</X><Y>6</Y><Z>0</Z></CoordinateFrame>
<string name="Name">Ledge</string>
<Vector3 name="size"><X>12</X><Y>1</Y><Z>6</Z></Vector3>
</Properties>
<Item class="StringValue" referent="RBX2"><Properties><string name="Name">bf_role</string><string name="Value">platform</string></Properties></Item>
</Item></Item></roblox>`;

const htmlUrl = `data:text/html;charset=utf-8,${encodeURIComponent(GAME_HTML)}`;
const placeUrl = `data:application/xml;charset=utf-8,${encodeURIComponent(PLACE)}`;

function renderSurface(data: Partial<CreationNodeData>, props: Record<string, unknown> = {}) {
  return render(
    <CanvasPlaySurface
      data={{ kind: 'game', title: 'Skybound Citadels', ...data } as CreationNodeData}
      onExit={() => {}}
      {...props}
    />,
  );
}

describe('playing a web game', () => {
  it('runs the document in a frame that has scripts and NOT same-origin', () => {
    renderSurface({ outputUrl: htmlUrl });
    const frame = document.querySelector('iframe')!;
    expect(frame.getAttribute('srcdoc')).toContain('<canvas>');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('can be stopped and started from the surface header', () => {
    renderSurface({ outputUrl: htmlUrl });
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /play the game/i }));
    expect(document.querySelector('iframe')).not.toBeNull();
  });
});

describe('playing a Roblox place', () => {
  it('does NOT report a missing game for a place that exists', async () => {
    // The reported bug, exactly. `gameDocumentFrom` returns '' for anything that
    // is not text/html, and '' was read as "nothing has been generated".
    renderSurface({ gamePlatform: 'roblox', outputUrl: placeUrl });
    expect(screen.queryByText(/no game yet/i)).toBeNull();
    expect(await screen.findByTestId('world-viewport')).toBeTruthy();
  });

  it('drops the player straight into walk mode, with the place as the level', async () => {
    // The surface was entered by pressing Play. Landing in Build mode would
    // answer a question nobody asked.
    renderSurface({ gamePlatform: 'roblox', outputUrl: placeUrl });
    const viewport = await screen.findByTestId('world-viewport');
    expect(viewport.getAttribute('data-mode')).toBe('walk');
    expect(viewport.getAttribute('data-props')).toBe('1');
  });

  it('says what is running here and what runs in Roblox', async () => {
    renderSurface({ gamePlatform: 'roblox', outputUrl: placeUrl });
    expect(await screen.findByText(/walkable 3d place/i)).toBeTruthy();
    expect(screen.getByText(/luau rules run in roblox/i)).toBeTruthy();
  });

  it('never mounts a frame for a place — there is no document to put in one', async () => {
    renderSurface({ gamePlatform: 'roblox', outputUrl: placeUrl });
    await screen.findByTestId('world-viewport');
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('with nothing generated', () => {
  it('asks for a game, and offers no controls that cannot do anything', () => {
    renderSurface({});
    expect(screen.getByText(/no game yet/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /full screen/i })).toBeNull();
  });
});

describe('playing together', () => {
  it('names who is on this canvas and offers the canvas’s own invite door', () => {
    const onInvite = vi.fn();
    renderSurface({ outputUrl: htmlUrl }, {
      players: [{ userId: 'a', displayName: 'Sam', role: 'owner' }, { userId: 'b', displayName: null, role: 'editor' }],
      onInvite,
    });
    expect(screen.getByText('Sam')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /invite to play/i }));
    expect(onInvite).toHaveBeenCalled();
  });

  it('draws no roster at all when the surface was given none', () => {
    renderSurface({ outputUrl: htmlUrl });
    expect(screen.queryByRole('button', { name: /invite to play/i })).toBeNull();
  });
});
