import { describe, expect, it, vi } from 'vitest';
import {
  CANVAS_WIDGET_PROTOCOL_VERSION,
  WIDGET_STORAGE_MAX_BYTES,
  effectiveWidgetOrigin,
  parseWidgetMessage,
  widgetAcceptsOrigin,
  type WidgetToHostMessage,
} from '@builderforce/canvas-widget-protocol';
import { handleWidgetMessage, rejectionReply, type WidgetHostBridge } from './canvasWidgetHost';

const ORIGIN = 'https://widget.example.com';

function bridge(overrides: Partial<WidgetHostBridge> = {}): WidgetHostBridge {
  return {
    board: () => ({ id: 'board-1', title: 'Board' }),
    items: () => [{ id: 'a', kind: 'note', title: 'A' }],
    createItem: vi.fn(() => ({ ok: true as const, id: 'new' })),
    updateItem: vi.fn(() => ({ ok: true as const, id: 'a' })),
    deleteItem: vi.fn(() => ({ ok: true as const, id: 'a' })),
    user: () => ({ displayName: 'Ana' }),
    storage: () => ({ saved: 1 }),
    setStorage: vi.fn(() => ({ ok: true as const })),
    notify: vi.fn(),
    ...overrides,
  };
}

const frame = () => ({ resize: vi.fn(), close: vi.fn() });
const grant = (permissions: string[]) => ({ id: 'w1', key: 'acme.chart', version: '1.0.0', permissions });

function message(type: WidgetToHostMessage['type'], payload?: unknown): WidgetToHostMessage {
  return { channel: 'bfwidget', protocol: CANVAS_WIDGET_PROTOCOL_VERSION, type, requestId: 'r1', payload };
}

describe('effectiveWidgetOrigin — the opaque-origin sandbox', () => {
  it('lets our own un-navigated frame speak for its registered origin', () => {
    expect(effectiveWidgetOrigin({ eventOrigin: 'null', fromOwnFrame: true, navigated: false, entryOrigin: ORIGIN })).toBe(ORIGIN);
  });

  it('never lets another window or a navigated frame speak for it', () => {
    expect(effectiveWidgetOrigin({ eventOrigin: ORIGIN, fromOwnFrame: false, navigated: false, entryOrigin: ORIGIN })).toBe('null');
    expect(effectiveWidgetOrigin({ eventOrigin: 'null', fromOwnFrame: true, navigated: true, entryOrigin: ORIGIN })).toBe('null');
  });

  it('refuses a disabled widget even from the right origin', () => {
    expect(widgetAcceptsOrigin({ status: 'active', entryOrigin: ORIGIN }, ORIGIN)).toBe(true);
    expect(widgetAcceptsOrigin({ status: 'disabled', entryOrigin: ORIGIN }, ORIGIN)).toBe(false);
  });
});

describe('handleWidgetMessage', () => {
  it('answers the handshake with only what was granted', () => {
    const reply = handleWidgetMessage(message('widget.ready'), bridge(), frame(), grant(['board:read']));
    expect(reply).toMatchObject({ type: 'host.init', requestId: 'r1', payload: { board: { id: 'board-1' }, user: null, permissions: ['board:read'] } });
  });

  it('clamps a resize and tells the frame', () => {
    const controls = frame();
    const reply = handleWidgetMessage(message('widget.resize', { height: 99999 }), bridge(), controls, grant([]));
    expect(controls.resize).toHaveBeenCalledWith(1600);
    expect(reply).toMatchObject({ type: 'host.result', payload: { height: 1600 } });
  });

  it('closes without a reply', () => {
    const controls = frame();
    expect(handleWidgetMessage(message('widget.close'), bridge(), controls, grant([]))).toBeNull();
    expect(controls.close).toHaveBeenCalled();
  });

  it('routes writes through the bridge and reports its refusals', () => {
    const board = bridge({ updateItem: vi.fn(() => ({ ok: false as const, error: 'read-only' })) });
    expect(handleWidgetMessage(message('widget.createItem', { kind: 'note', title: ' Hi ' }), board, frame(), grant(['item:write'])))
      .toMatchObject({ type: 'host.result', payload: { ok: true, id: 'new' } });
    expect(board.createItem).toHaveBeenCalledWith({ kind: 'note', title: 'Hi' });
    expect(handleWidgetMessage(message('widget.updateItem', { id: 'a', patch: { title: 'B' } }), board, frame(), grant(['item:write'])))
      .toMatchObject({ type: 'host.error', payload: { error: 'read-only' } });
    expect(handleWidgetMessage(message('widget.createItem', {}), board, frame(), grant(['item:write'])))
      .toMatchObject({ type: 'host.error' });
  });

  it('bounds the storage blob', () => {
    const board = bridge();
    const big = { blob: 'x'.repeat(WIDGET_STORAGE_MAX_BYTES) };
    expect(handleWidgetMessage(message('widget.setStorage', { value: big }), board, frame(), grant(['storage:write'])))
      .toMatchObject({ type: 'host.error' });
    expect(board.setStorage).not.toHaveBeenCalled();
  });
});

describe('the full gate, in the protocol\'s order', () => {
  it('a message from our frame passes; a permission it lacks is answered, a stranger is not', () => {
    const origin = effectiveWidgetOrigin({ eventOrigin: 'null', fromOwnFrame: true, navigated: false, entryOrigin: ORIGIN });
    const ok = parseWidgetMessage(message('widget.getItems'), { origin, expectedOrigin: ORIGIN, granted: ['item:read'] });
    expect(ok.ok).toBe(true);
    const denied = parseWidgetMessage(message('widget.getItems'), { origin, expectedOrigin: ORIGIN, granted: [] });
    expect(denied).toEqual({ ok: false, reason: 'permission-denied' });
    expect(rejectionReply('permission-denied', message('widget.getItems'))).toMatchObject({ type: 'host.error', requestId: 'r1' });
    expect(rejectionReply('untrusted-origin', message('widget.getItems'))).toBeNull();
  });
});
