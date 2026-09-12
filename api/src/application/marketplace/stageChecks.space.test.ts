/**
 * The `space` harness — what Stage checks before a designed room goes on sale.
 *
 * A buyer installs a copy of the room and meets in it, so the refusals are about
 * the meeting: a snapshot with no room in it, furniture through the walls, and a
 * room that seats nobody and leaves nowhere to stand.
 */

import { describe, expect, it } from 'vitest';
import { ROOM_LAYOUT_IDS, roomLayoutDesign, type StageCheck } from '@builderforce/creation-canvas-contract';
import { runStageChecks, type StageInput } from './stageChecks';

function room(canvasData: Record<string, unknown>): StageInput {
  return {
    listingKind: 'room',
    objectKind: 'room',
    objects: [{ id: 'obj-room', kind: 'room', canvasData: { kind: 'room', title: 'Our room', ...canvasData }, content: null }],
    priceCents: 0,
    trial: 'preview',
    strippedFields: [],
  };
}

const find = (checks: StageCheck[], code: string) => checks.find((check) => check.code === code);

const customRoom = (furniture: unknown[]) => ({
  roomDesign: { layout: 'custom', floor: { width: 14, depth: 10 }, wall: { height: 4 }, furniture },
});

describe('space harness', () => {
  it('refuses a room card that carries no room', async () => {
    const checks = await runStageChecks(room({}));
    expect(find(checks, 'space.design')?.severity).toBe('block');
  });

  it('passes every preset through the walls and the seats', async () => {
    for (const layout of ROOM_LAYOUT_IDS) {
      const checks = await runStageChecks(room({ roomLayout: layout }));
      expect(find(checks, 'space.bounds')?.severity, layout).toBe('pass');
      expect(find(checks, 'space.seats')?.severity, layout).not.toBe('block');
    }
  });

  it('refuses furniture that crosses a wall', async () => {
    // Centred inside the floor, but four times as wide as a sofa — through the wall.
    const checks = await runStageChecks(room(customRoom([{ kind: 'sofa', position: [6.5, 0, 0], yaw: 0, scale: [4, 1, 1] }])));
    expect(find(checks, 'space.bounds')?.severity).toBe('block');
  });

  it('measures a turned piece by its turned footprint', async () => {
    // A long table turned a quarter along the side wall fits; square to it, it would not.
    const along = await runStageChecks(room(customRoom([{ kind: 'tableLong', position: [6, 0, 0], yaw: Math.PI / 2, scale: [1, 1, 1] }])));
    expect(find(along, 'space.bounds')?.severity).toBe('pass');
  });

  it('warns — not refuses — a room where people stand in a ring', async () => {
    const checks = await runStageChecks(room({ roomLayout: 'standup' }));
    expect(find(checks, 'space.seats')?.severity).toBe('warn');
  });

  it('refuses a room whose centre is one big surface and seats nobody', async () => {
    const checks = await runStageChecks(room(customRoom([{ kind: 'tableLong', position: [0, 0, 0], yaw: 0, scale: [3, 1, 3] }])));
    expect(find(checks, 'space.seats')?.severity).toBe('block');
  });

  it('marks an unchanged preset as worth less than a room of its own', async () => {
    const preset = await runStageChecks(room({ roomLayout: 'kitchen' }));
    expect(find(preset, 'space.layout')?.severity).toBe('warn');
    const own = await runStageChecks(room({ roomDesign: { ...roomLayoutDesign('kitchen'), layout: 'custom' } }));
    expect(find(own, 'space.layout')?.severity).toBe('pass');
  });
});
