import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { BuilderForceEmbed } from './BuilderForceEmbed';
import { BFEMBED_SOURCE } from './protocol';

const ORIGIN = 'https://app.builderforce.ai';

afterEach(cleanup);

function getFrame(container: HTMLElement): HTMLIFrameElement {
  const frame = container.querySelector('iframe');
  if (!frame) throw new Error('iframe not rendered');
  return frame;
}

describe('BuilderForceEmbed', () => {
  it('renders an iframe pointed at the view embed route (no token in URL)', () => {
    const { container } = render(<BuilderForceEmbed view="kanban" token="jwt-123" />);
    const frame = getFrame(container);
    expect(frame.getAttribute('src')).toBe(`${ORIGIN}/embed/kanban`);
    expect(frame.getAttribute('src')).not.toContain('jwt-123');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
  });

  it('hands the token to the frame over postMessage once the frame is ready', async () => {
    const { container } = render(
      <BuilderForceEmbed view="soc2" token="jwt-xyz" accountId="acct1" companyId="co1" />,
    );
    const frame = getFrame(container);
    const post = vi.fn();
    // Stub the frame's contentWindow.postMessage (jsdom iframes have a window).
    Object.defineProperty(frame, 'contentWindow', { value: { postMessage: post }, configurable: true });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { origin: ORIGIN, data: { source: BFEMBED_SOURCE, type: 'ready' } }));
      await Promise.resolve();
    });

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ source: BFEMBED_SOURCE, type: 'auth', token: 'jwt-xyz', accountId: 'acct1', companyId: 'co1' }),
      ORIGIN,
    );
  });

  it('resizes the iframe when the frame reports a content height', async () => {
    const { container } = render(<BuilderForceEmbed view="ideas" token="t" minHeight={400} />);
    const frame = getFrame(container);
    Object.defineProperty(frame, 'contentWindow', { value: { postMessage: vi.fn() }, configurable: true });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { origin: ORIGIN, data: { source: BFEMBED_SOURCE, type: 'resize', height: 900 } }));
    });
    expect(frame.style.height).toBe('900px');
  });

  it('resolves an async token getter before handing it over', async () => {
    const getter = vi.fn(async () => 'fresh-jwt');
    const { container } = render(<BuilderForceEmbed view="retros" token={getter} />);
    const frame = getFrame(container);
    const post = vi.fn();
    Object.defineProperty(frame, 'contentWindow', { value: { postMessage: post }, configurable: true });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { origin: ORIGIN, data: { source: BFEMBED_SOURCE, type: 'ready' } }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getter).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ token: 'fresh-jwt' }), ORIGIN);
  });
});
