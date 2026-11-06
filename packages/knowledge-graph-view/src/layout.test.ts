import { describe, expect, it } from 'vitest';
import { COMPACT_WIDTH } from './graphModel';
import { ACT_STACK_WIDTH, LINES_STACK_WIDTH, PANELS_MENU_WIDTH, PHONE_WIDTH, layoutOf } from './layout';

describe('the rail breakpoints', () => {
    it('are ordered, and the compact width still lives in graphModel', () => {
        expect(PHONE_WIDTH).toBeLessThan(COMPACT_WIDTH);
        expect(COMPACT_WIDTH).toBeLessThan(LINES_STACK_WIDTH);
        expect(LINES_STACK_WIDTH).toBeLessThan(PANELS_MENU_WIDTH);
        expect(PANELS_MENU_WIDTH).toBeLessThan(ACT_STACK_WIDTH);
    });

    it('reads an unmeasured container (0) as the full layout', () => {
        expect(layoutOf(0)).toEqual({ compact: false, phone: false, actBelow: false, linesStacked: false, panelsMenu: false });
    });

    it('wide: both rails beside the scene and the Panels group as buttons', () => {
        expect(layoutOf(1400)).toEqual({ compact: false, phone: false, actBelow: false, linesStacked: false, panelsMenu: false });
    });

    it('below the Act breakpoint only the Act rail moves under the scene', () => {
        expect(layoutOf(ACT_STACK_WIDTH - 1)).toMatchObject({ actBelow: true, linesStacked: false, panelsMenu: false });
        expect(layoutOf(ACT_STACK_WIDTH)).toMatchObject({ actBelow: false });
    });

    it('below the Panels breakpoint the group is one menu', () => {
        expect(layoutOf(PANELS_MENU_WIDTH - 1)).toMatchObject({ panelsMenu: true, linesStacked: false, actBelow: true });
        expect(layoutOf(PANELS_MENU_WIDTH)).toMatchObject({ panelsMenu: false });
    });

    it('below the Lines breakpoint the Lines list stacks too', () => {
        expect(layoutOf(LINES_STACK_WIDTH - 1)).toMatchObject({ linesStacked: true, actBelow: true, panelsMenu: true, compact: false });
        expect(layoutOf(LINES_STACK_WIDTH)).toMatchObject({ linesStacked: false });
    });

    it('below the compact and phone widths those flags turn on', () => {
        expect(layoutOf(COMPACT_WIDTH - 1)).toMatchObject({ compact: true, phone: false });
        expect(layoutOf(PHONE_WIDTH - 1)).toMatchObject({ compact: true, phone: true });
    });
});
