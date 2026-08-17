import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { CreationNodeData } from './types';
import { GAME_FRAME_SANDBOX, gameDocumentFrom, gamePayloadFrom } from '@/lib/gameTargets';
import { controlLabels, gameAccent, gamePosterSvg, readGameControls } from '@/lib/gamePoster';
import { buildBrowserCreativeArtifact } from '@/lib/creationDeliverables';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const { CreationNode } = await import('./CreationNode');

const GAME_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Runner</title></head>'
  + '<body><canvas id="c"></canvas><script>'
  + "addEventListener('keydown', () => {}); addEventListener('pointerdown', () => {});"
  + '</script></body></html>';

const asDataUrl = (html: string) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

function renderGame(data: Partial<CreationNodeData> = {}) {
  const nodeData = { kind: 'game', title: 'Space Blaster', ...data } as CreationNodeData;
  return render(
    <ReactFlowProvider>
      <CreationNode
        id="game-1"
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
      />
    </ReactFlowProvider>,
  );
}

describe('the game node', () => {
  it('asks for a game before it has one, rather than showing an empty player', () => {
    renderGame();
    expect(screen.getByText(/no game yet/i)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('does not mount the frame until the player asks for it', () => {
    // A board with a dozen games must not be a dozen animation loops competing
    // with the canvas for frames.
    renderGame({ outputUrl: asDataUrl(GAME_HTML) });
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /play the game/i }));
    expect(document.querySelector('iframe')).not.toBeNull();
  });

  it('runs the game with scripts but WITHOUT same-origin', () => {
    // This is the load-bearing security property of the whole feature: the
    // document is model-authored code from a free-text brief. `allow-scripts`
    // plus `allow-same-origin` lets a frame remove its own sandbox attribute,
    // which would give generated code access to this app's session.
    renderGame({ outputUrl: asDataUrl(GAME_HTML) });
    fireEvent.click(screen.getByRole('button', { name: /play the game/i }));
    const frame = document.querySelector('iframe')!;
    const sandbox = frame.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('passes the document through srcDoc, not a blob URL that would inherit our origin', () => {
    renderGame({ outputUrl: asDataUrl(GAME_HTML) });
    fireEvent.click(screen.getByRole('button', { name: /play the game/i }));
    const frame = document.querySelector('iframe')!;
    expect(frame.getAttribute('srcdoc')).toContain('<canvas id="c">');
    expect(frame.getAttribute('src')).toBeNull();
  });

  it('can be stopped, and tears the frame down when it is', () => {
    renderGame({ outputUrl: asDataUrl(GAME_HTML) });
    fireEvent.click(screen.getByRole('button', { name: /play the game/i }));
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('reports the inputs the game actually binds', () => {
    renderGame({ outputUrl: asDataUrl(GAME_HTML) });
    expect(screen.getByText('keyboard')).toBeTruthy();
    expect(screen.getByText('touch')).toBeTruthy();
  });

  it('does not claim touch for a game that only listens for keys', () => {
    const keysOnly = GAME_HTML.replace("addEventListener('pointerdown', () => {});", '');
    renderGame({ outputUrl: asDataUrl(keysOnly) });
    expect(screen.getByText('keyboard')).toBeTruthy();
    expect(screen.queryByText('touch')).toBeNull();
  });

  it('renders one body, not a body plus the generic fallback underneath it', () => {
    // `game` was in the creative-kind set but missing from `specialized`, so it
    // rendered its studio tile AND the catch-all block below it.
    renderGame({ outputUrl: asDataUrl(GAME_HTML), status: 'Generated' });
    expect(screen.queryByText('Live session context')).toBeNull();
  });
});

describe('a Roblox place on the board', () => {
  const PLACE = '<roblox version="4"><Item class="Workspace"/></roblox>';
  const placeUrl = `data:application/xml;charset=utf-8,${encodeURIComponent(PLACE)}`;

  it('says where it opens instead of offering a play button that cannot work', () => {
    // `.rbxlx` runs in Roblox Studio, a desktop application. A play frame here
    // would be a control that silently does nothing.
    renderGame({ gamePlatform: 'roblox', outputUrl: placeUrl, status: 'Generated' });
    expect(screen.getByText(/opens in roblox studio/i)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('button', { name: /play the game/i })).toBeNull();
  });

  it('does not claim the place is missing just because it is not HTML', () => {
    // The play surface reads `text/html`; a place is XML, so the naive path
    // reported "no game yet" for an artifact that demonstrably exists.
    renderGame({ gamePlatform: 'roblox', outputUrl: placeUrl, status: 'Generated' });
    expect(screen.queryByText(/no game yet/i)).toBeNull();
    expect(screen.getByText(/\.rbxlx place/i)).toBeTruthy();
  });

  it('still asks for generation when the place has not been built yet', () => {
    renderGame({ gamePlatform: 'roblox' });
    expect(screen.getByText(/generate to play/i)).toBeTruthy();
  });
});

describe('reading a game off a canvas object', () => {
  it('decodes the document the object is holding', () => {
    expect(gameDocumentFrom({ kind: 'game', title: 'Runner', outputUrl: asDataUrl(GAME_HTML) } as CreationNodeData))
      .toBe(GAME_HTML);
  });

  it('decodes a base64 data URL too', () => {
    const url = `data:text/html;base64,${btoa(GAME_HTML)}`;
    expect(gameDocumentFrom({ kind: 'game', title: 'Runner', outputUrl: url } as CreationNodeData)).toBe(GAME_HTML);
  });

  it('returns nothing for an object with no game, or a non-HTML artifact', () => {
    expect(gameDocumentFrom({ kind: 'game', title: 'Runner' } as CreationNodeData)).toBe('');
    expect(gameDocumentFrom({ kind: 'game', title: 'Runner', outputUrl: 'data:model/stl,solid x' } as CreationNodeData)).toBe('');
    expect(gamePayloadFrom({ kind: 'game', title: 'x' } as CreationNodeData)).toBeNull();
  });

  it('carries the brief through, so a target has the context the game was made from', () => {
    const payload = gamePayloadFrom({
      kind: 'game',
      title: 'Space Blaster',
      prompt: 'Shoot the asteroids',
      outputUrl: asDataUrl(GAME_HTML),
    } as CreationNodeData);
    expect(payload).toEqual({ title: 'Space Blaster', brief: 'Shoot the asteroids', html: GAME_HTML });
  });

  it('never advertises same-origin in the shared sandbox contract', () => {
    expect(GAME_FRAME_SANDBOX).not.toContain('allow-same-origin');
  });
});

describe('the game poster', () => {
  it('derives one stable colour per title, shared with the app icon', () => {
    expect(gameAccent('Space Blaster')).toBe(gameAccent('Space Blaster'));
    expect(gameAccent('Space Blaster')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('reads the controls out of the document rather than assuming them', () => {
    expect(controlLabels(readGameControls(GAME_HTML))).toEqual(['keys', 'touch']);
    expect(controlLabels(readGameControls('<script>void 0;</script>'))).toEqual([]);
  });

  it('escapes a title that would otherwise break the SVG', () => {
    const svg = gamePosterSvg({ title: '</text><script>alert(1)</script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;/text&gt;');
  });

  it('carries its own background, because an image cannot follow the theme', () => {
    expect(gamePosterSvg({ title: 'Runner' })).toContain('stop-color="#0b0e1a"');
  });

  it('gives the browser baseline a poster instead of a broken tile', () => {
    // The whole reason this exists: `creativePreviewImageUrl` only trusts a real
    // picture, so a game with no poster fell through to the placeholder.
    const artifact = buildBrowserCreativeArtifact({ kind: 'game', title: 'Runner' } as CreationNodeData);
    expect(artifact.previewImageUrl).toMatch(/^data:image\/svg\+xml/);
  });

  it('makes the browser baseline a real, playable, touch-capable game', () => {
    // It is what a guest session falls back to AND what every phone target
    // would ship, so "a button that increments a counter" is not good enough.
    const artifact = buildBrowserCreativeArtifact({ kind: 'game', title: 'Runner' } as CreationNodeData);
    const html = decodeURIComponent(artifact.url.slice(artifact.url.indexOf(',') + 1));
    expect(html).toContain('pointerdown');
    expect(html).toContain('keydown');
    expect(html).toContain('viewport-fit=cover');
  });
});
