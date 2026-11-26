import { describe, expect, it } from 'vitest';
import type { Station, StationModel } from '../stations';
import type { DrillFrame } from './drillView';
import { ANCHOR_FILES, reanchorDrill } from './reanchorDrill';

/** A world of stations given as id → name + member files (only the fields the drill reads). */
function worldOf(spec: Record<string, { name: string; refs: string[] }>): StationModel {
    const byId = new Map<string, Station>();
    const stationOf = new Map<string, string>();
    for (const [id, s] of Object.entries(spec)) {
        byId.set(id, { id, name: s.name, refs: s.refs } as Station);
        for (const r of s.refs) stationOf.set(r, id);
    }
    return { stations: [...byId.values()], byId, stationOf };
}

const pkg = (ref: string, name: string, files: string[]): DrillFrame => ({ level: 'package', ref, name, files });
const noNodes = (): boolean => true;

describe('reanchorDrill', () => {
    it('returns the same array when the world still has every level', () => {
        const world = worldOf({ a: { name: 'A', refs: ['f1', 'f2'] } });
        const stack = [pkg('a', 'A', ['f1', 'f2']), { level: 'class', ref: 'f1', name: 'f1' } as DrillFrame];
        const out = reanchorDrill(stack, world, noNodes);
        expect(out.stack).toBe(stack);
        expect(out.notice).toBeNull();
        expect(out.moved.size).toBe(0);
    });

    it('re-anchors a package whose station was renamed, keeping the stack depth', () => {
        const world = worldOf({ 'community:9': { name: 'Core', refs: ['f1', 'f2'] } });
        const stack = [pkg('community:3', 'Old', ['f1', 'f2']), { level: 'class', ref: 'f1', name: 'f1' } as DrillFrame];
        const out = reanchorDrill(stack, world, noNodes);
        expect(out.notice).toBeNull();
        expect(out.stack).toHaveLength(2);
        expect(out.stack[0]).toMatchObject({ level: 'package', ref: 'community:9', name: 'Core', files: ['f1', 'f2'] });
        expect(out.stack[1]).toBe(stack[1]);
        expect(out.moved.get('community:3')).toBe('community:9');
    });

    it('picks the station holding most of the files when they were split', () => {
        const world = worldOf({ x: { name: 'X', refs: ['f1'] }, y: { name: 'Y', refs: ['f2', 'f3'] } });
        const out = reanchorDrill([pkg('gone', 'Old', ['f1', 'f2', 'f3'])], world, noNodes);
        expect(out.stack[0]).toMatchObject({ ref: 'y', name: 'Y' });
    });

    it('pops with a notice when no file survives, and everything under it', () => {
        const world = worldOf({ x: { name: 'X', refs: ['other'] } });
        const stack = [pkg('gone', 'Old', ['f1']), { level: 'class', ref: 'f1', name: 'f1' } as DrillFrame];
        const out = reanchorDrill(stack, world, noNodes);
        expect(out.stack).toEqual([]);
        expect(out.notice).toBe('Old');
    });

    it('checks the class frame after the package is re-anchored, and leaves at the first lost level', () => {
        const world = worldOf({ y: { name: 'Y', refs: ['f1'] } });
        const stack = [pkg('gone', 'Old', ['f1']), { level: 'class', ref: 'f9', name: 'f9' } as DrillFrame];
        const out = reanchorDrill(stack, world, noNodes);
        expect(out.stack).toHaveLength(1);
        expect(out.stack[0]).toMatchObject({ ref: 'y' });
        expect(out.notice).toBe('f9');
    });

    it('a frame entered without remembered files cannot be re-anchored', () => {
        const world = worldOf({ y: { name: 'Y', refs: ['f1'] } });
        const out = reanchorDrill([{ level: 'package', ref: 'gone', name: 'Old' }], world, noNodes);
        expect(out.stack).toEqual([]);
        expect(out.notice).toBe('Old');
    });

    it('moves a package whose id survived the rebuild but now holds other files (ids are renumbered per build)', () => {
        const world = worldOf({ 'community:3': { name: 'Other', refs: ['x1', 'x2'] }, 'community:7': { name: 'Core', refs: ['f1', 'f2'] } });
        const out = reanchorDrill([pkg('community:3', 'Core', ['f1', 'f2'])], world, noNodes);
        expect(out.stack[0]).toMatchObject({ ref: 'community:7', name: 'Core' });
        expect(out.moved.get('community:3')).toBe('community:7');
    });

    it('stays on its own id when that station still holds as many of the files as any other', () => {
        const world = worldOf({ a: { name: 'A', refs: ['f1'] }, b: { name: 'B', refs: ['f2'] } });
        const stack = [pkg('b', 'B', ['f1', 'f2'])];
        expect(reanchorDrill(stack, world, noNodes).stack).toBe(stack);
    });

    it('breaks a tie between other stations by the lowest id', () => {
        const world = worldOf({ z: { name: 'Z', refs: ['f1'] }, m: { name: 'M', refs: ['f2'] } });
        expect(reanchorDrill([pkg('gone', 'Old', ['f1', 'f2'])], world, noNodes).stack[0]).toMatchObject({ ref: 'm' });
    });

    it('pops with a notice when its id still exists but neither it nor any station holds a file of it', () => {
        const world = worldOf({ a: { name: 'A', refs: ['other1'] } });
        const out = reanchorDrill([pkg('a', 'A', ['f1', 'f2'])], world, noNodes);
        expect(out.stack).toEqual([]);
        expect(out.notice).toBe('A');
    });

    it('keeps the frames re-anchored above a level that is lost (the stack kept is the re-anchored one)', () => {
        const world = worldOf({ y: { name: 'Y', refs: ['f1'] } });
        const out = reanchorDrill([pkg('gone', 'Old', ['f1']), { level: 'class', ref: 'f9', name: 'f9' } as DrillFrame], world, noNodes);
        expect(out.stack).toHaveLength(1);
        expect(out.stack[0]).toMatchObject({ ref: 'y' });
    });

    it('keeps at most ANCHOR_FILES files on a re-anchored frame', () => {
        const refs = Array.from({ length: ANCHOR_FILES + 10 }, (_, i) => `f${i}`);
        const world = worldOf({ y: { name: 'Y', refs } });
        const out = reanchorDrill([pkg('gone', 'Old', refs.slice(0, 3))], world, noNodes);
        expect(out.stack[0]!.files).toHaveLength(ANCHOR_FILES);
    });
});
