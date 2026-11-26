import { describe, expect, it } from 'vitest';
import { COMPACT_WIDTH } from './graphModel';
import { DRAWER_SHEET_WIDTH, LINES_STACK_WIDTH, PHONE_WIDTH, layoutOf } from './layout';

describe('the rail breakpoints', () => {
    it('are ordered, and the compact width still lives in graphModel', () => {
        expect(PHONE_WIDTH).toBeLessThan(COMPACT_WIDTH);
        expect(COMPACT_WIDTH).toBeLessThan(LINES_STACK_WIDTH);
        expect(LINES_STACK_WIDTH).toBeLessThan(DRAWER_SHEET_WIDTH);
    });

    it('reads an unmeasured container (0) as the full layout', () => {
        expect(layoutOf(0)).toEqual({ compact: false, phone: false, linesStacked: false, drawerSheet: false });
    });

    it('wide: the desktop grid, the drawer a column', () => {
        expect(layoutOf(1400)).toEqual({ compact: false, phone: false, linesStacked: false, drawerSheet: false });
    });

    it("at or under 900px (the prototype's max-width) the drawer is a bottom sheet and the header wraps", () => {
        expect(layoutOf(DRAWER_SHEET_WIDTH)).toMatchObject({ drawerSheet: true });
        expect(layoutOf(DRAWER_SHEET_WIDTH + 1)).toMatchObject({ drawerSheet: false });
    });

    it('below the Lines breakpoint the Lines list stacks too', () => {
        expect(layoutOf(LINES_STACK_WIDTH - 1)).toMatchObject({ linesStacked: true, drawerSheet: true, compact: false });
        expect(layoutOf(LINES_STACK_WIDTH)).toMatchObject({ linesStacked: false });
    });

    it('below the compact and phone widths those flags turn on', () => {
        expect(layoutOf(COMPACT_WIDTH - 1)).toMatchObject({ compact: true, phone: false });
        expect(layoutOf(PHONE_WIDTH - 1)).toMatchObject({ compact: true, phone: true });
    });
});
