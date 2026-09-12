import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { CANVAS_WIDGET_PROTOCOL_VERSION, CANVAS_WIDGET_SANDBOX } from '@builderforce/canvas-widget-protocol';
import type { CanvasWidgetRecord } from '@/lib/canvasWidgetApi';
import type { WidgetHostBridge } from '@/lib/canvasWidgetHost';
import { CanvasWidgetFrame } from './CanvasWidgetFrame';

/**
 * The browser host's four doors, exercised the way a real widget reaches them: a
 * `message` event whose `source` is (or is not) the frame's own window, with the
 * `'null'` origin every document in our sandbox posts from.
 */

const widget: CanvasWidgetRecord = {
  id: 'w1', key: 'acme.chart', name: 'Acme chart', description: null,
  entryUrl: 'https://widget.example.com/app', entryOrigin: 'https://widget.example.com',
  iconUrl: null, permissions: ['board:read'], version: '1.0.0', width: 480, height: 360, status: 'active',
};

const bridge: WidgetHostBridge = {
  board: () => ({ id: 'board-1', title: 'Board' }),
  items: () => [],
  createItem: () => ({ ok: true }),
  updateItem: () => ({ ok: true }),
  deleteItem: () => ({ ok: true }),
  user: () => null,
  storage: () => ({}),
  setStorage: () => ({ ok: true }),
  notify: () => {},
};

const labels = { frameTitle: 'Acme chart (third-party widget)', navigated: 'Left', reload: 'Reload', closed: 'Closed', reopen: 'Reopen' };

function mount() {
  render(<CanvasWidgetFrame widget={widget} bridge={bridge} boardVersion={1} labels={labels} />);
  const frame = screen.getByTestId('canvas-widget-frame') as HTMLIFrameElement;
  const target = frame.contentWindow!;
  const post = vi.spyOn(target, 'postMessage').mockImplementation(() => {});
  const send = (data: unknown, source: MessageEventSource | null = target) => act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: 'null', source }));
  });
  return { frame, post, send };
}

const ready = { channel: 'bfwidget', protocol: CANVAS_WIDGET_PROTOCOL_VERSION, type: 'widget.ready', requestId: 'r1' };

describe('CanvasWidgetFrame', () => {
  it('frames the entry URL with the contract\'s sandbox and never same-origin', () => {
    const { frame } = mount();
    expect(frame.getAttribute('src')).toBe(widget.entryUrl);
    expect(frame.getAttribute('sandbox')).toBe(CANVAS_WIDGET_SANDBOX);
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('title')).toBe(labels.frameTitle);
  });

  it('answers its own frame\'s handshake with what was granted', () => {
    const { post, send } = mount();
    send(ready);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toMatchObject({ type: 'host.init', requestId: 'r1', payload: { board: { id: 'board-1' } } });
  });

  it('ignores a message from any other window', () => {
    const { post, send } = mount();
    send(ready, window);
    expect(post).not.toHaveBeenCalled();
  });

  it('tells its own widget when it asks for something it was not granted', () => {
    const { post, send } = mount();
    send({ ...ready, type: 'widget.getItems' });
    expect(post.mock.calls[0]![0]).toMatchObject({ type: 'host.error', payload: { error: 'permission-denied' } });
  });

  it('stops answering once the frame navigates away from its entry', () => {
    const { frame } = mount();
    act(() => { frame.dispatchEvent(new Event('load')); });
    act(() => { frame.dispatchEvent(new Event('load')); });
    expect(screen.getByTestId('canvas-widget-stopped')).toHaveTextContent('Left');
  });
});
