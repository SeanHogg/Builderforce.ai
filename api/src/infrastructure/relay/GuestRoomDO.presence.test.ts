import { describe, it, expect } from 'vitest';
import { CANVAS_PRESENCE_FRAME, guestRoomOccupantId } from '@builderforce/creation-canvas-contract';
import { guestRoomRelayFrame } from './GuestRoomDO';

/**
 * An account-less shared canvas rides the guest room's relay. Its presence frame is
 * keyed by `userId` on the canvas, so the room — not the sender — must say who sent it.
 */
const ADA = { name: 'Ada', joinedAt: '2026-09-13T10:00:00.000Z' };

describe('guestRoomRelayFrame — canvas presence in an account-less room', () => {
  it("stamps the ROOM's id for the sender, whatever the client claimed", () => {
    expect(guestRoomRelayFrame({ type: CANVAS_PRESENCE_FRAME, userId: 'someone-else', cursor: { x: 1, y: 2 } }, 'chat', ADA))
      .toEqual({ type: CANVAS_PRESENCE_FRAME, userId: guestRoomOccupantId(ADA), cursor: { x: 1, y: 2 } });
  });

  it('carries only the contract fields — a Brain run is its start instant, never its prompt', () => {
    expect(guestRoomRelayFrame(
      { type: CANVAS_PRESENCE_FRAME, brainRun: { startedAt: 1_700_000_000_000, prompt: 'secret' }, objects: [1] },
      'chat',
      ADA,
    )).toEqual({ type: CANVAS_PRESENCE_FRAME, userId: guestRoomOccupantId(ADA), brainRun: { startedAt: 1_700_000_000_000 } });
  });

  it('drops presence from a socket with no roster row, on the media channel, or with nothing in it', () => {
    expect(guestRoomRelayFrame({ type: CANVAS_PRESENCE_FRAME, typing: true }, 'chat', null)).toBeNull();
    expect(guestRoomRelayFrame({ type: CANVAS_PRESENCE_FRAME, typing: true }, 'media', ADA)).toBeNull();
    expect(guestRoomRelayFrame({ type: CANVAS_PRESENCE_FRAME }, 'chat', ADA)).toBeNull();
  });

  it('relays every other frame exactly as before', () => {
    const offer = { type: 'rtc-offer', sdp: 'v=0', to: 'g2' };
    expect(guestRoomRelayFrame(offer, 'media', null)).toBe(offer);
    const busy = { type: 'busy', busy: true, name: 'Ada' };
    expect(guestRoomRelayFrame(busy, 'chat', ADA)).toBe(busy);
  });
});
