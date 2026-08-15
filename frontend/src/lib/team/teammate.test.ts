// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  TEAMMATE_DND_MIME,
  TEAMMATE_JOIN_EVENT,
  parseTeammate,
  requestTeammateJoin,
  serializeTeammate,
  teammateFromDrag,
  type TeammatePayload,
} from './teammate';

/**
 * PRD 21 §3.3 / §6.5 — "A teammate can be added to a session by drag **and** by
 * keyboard." What makes that true is not two handlers that agree today but ONE
 * payload both routes carry, so this locks the round trip and the parsing that
 * keeps a drop target from trusting whatever it was handed.
 */

const payload: TeammatePayload = {
  kind: 'agent', ref: 'manager-t1', name: 'Ada', role: 'AI Manager', seat: 'Manager', domain: 'delivery',
};

describe('teammate payload', () => {
  it('round-trips through a drag', () => {
    const data = new Map<string, string>([[TEAMMATE_DND_MIME, serializeTeammate(payload)]]);
    const transfer = { getData: (mime: string) => data.get(mime) ?? '' } as unknown as DataTransfer;
    expect(teammateFromDrag(transfer)).toEqual(payload);
  });

  it('rejects a drag that carries something else', () => {
    const transfer = { getData: () => '' } as unknown as DataTransfer;
    expect(teammateFromDrag(transfer)).toBeNull();
    expect(teammateFromDrag(null)).toBeNull();
  });

  it('refuses malformed or foreign payloads rather than seating a ghost', () => {
    expect(parseTeammate('not json')).toBeNull();
    expect(parseTeammate('{"ref":"x"}')).toBeNull();
    expect(parseTeammate('{"kind":"alien","ref":"x","name":"X"}')).toBeNull();
    // A missing role is legitimate — an invited human may have none.
    expect(parseTeammate('{"kind":"human","ref":"u1","name":"Sean"}')).toEqual({
      kind: 'human', ref: 'u1', name: 'Sean', role: null, seat: null, domain: null,
    });
  });

  it('the keyboard route carries the identical payload', () => {
    const heard: TeammatePayload[] = [];
    const listener = (event: Event) => heard.push((event as CustomEvent<TeammatePayload>).detail);
    window.addEventListener(TEAMMATE_JOIN_EVENT, listener);
    requestTeammateJoin(payload);
    window.removeEventListener(TEAMMATE_JOIN_EVENT, listener);

    expect(heard).toEqual([payload]);
    // Same object shape as the drag route produces — one seating path, not two.
    const data = new Map([[TEAMMATE_DND_MIME, serializeTeammate(payload)]]);
    expect(heard[0]).toEqual(teammateFromDrag({ getData: (m: string) => data.get(m) ?? '' } as unknown as DataTransfer));
  });

  it('is inert without a window rather than throwing into a server render', () => {
    const original = globalThis.window;
    // @ts-expect-error — deliberately simulating the server environment.
    delete globalThis.window;
    const spy = vi.fn();
    expect(() => requestTeammateJoin(payload)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    globalThis.window = original;
  });
});
