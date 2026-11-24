import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { CodeTrail, type CodeTrailProps } from './CodeTrail';

const stack = [{ level: 'package', name: 'orders' }, { level: 'class', name: 'OrderService' }] as const;
const methods = [{ ref: 'src:o.ts#placeOrder', name: 'placeOrder' }, { ref: 'src:o.ts#validate', name: 'validate' }];

function trail(over: Partial<CodeTrailProps> = {}) {
    const p: CodeTrailProps = {
        stack, onClimb: vi.fn(), methods, onMethod: vi.fn(), onLeaveCode: vi.fn(), across: null, follow: true, onFollow: vi.fn(), labels: L, ...over,
    };
    const view = render(<CodeTrail {...p} />);
    const crumbs = () => [...view.container.querySelectorAll<HTMLElement>('[data-trail-crumb]')];
    return { p, crumbs, ...view };
}

describe('the map\'s zoom-path bar', () => {
    it('reads system › levels › methods, and the crumb you are on is not a control', () => {
        const { crumbs } = trail();
        expect(crumbs().map((c) => c.textContent)).toEqual([L.surface.depth.system, 'orders', 'OrderService', 'placeOrder', 'validate']);
        const here = crumbs().at(-1)!;
        expect(here.tagName).toBe('SPAN');
        expect(here.getAttribute('aria-current')).toBe('location');
    });

    it('goes back up: a level climbs the drill, the level you are on leaves the code, a method goes back along the trail', () => {
        const { p, crumbs } = trail();
        fireEvent.click(crumbs()[1]!);
        expect(p.onClimb).toHaveBeenCalledWith(1);
        fireEvent.click(crumbs()[2]!);
        expect(p.onLeaveCode).toHaveBeenCalledTimes(1);
        fireEvent.click(crumbs()[3]!);
        expect(p.onMethod).toHaveBeenCalledWith(0);
    });

    it('a callee opened in another file is the last crumb; its method goes back to the code', () => {
        const { p, crumbs } = trail({ across: 'src:pay.ts#charge' });
        expect(crumbs().at(-1)!.textContent).toBe('charge ↗');
        fireEvent.click(crumbs().at(-2)!);
        expect(p.onMethod).toHaveBeenCalledWith(1);
    });

    it('with no method open, the level you are on is plain text', () => {
        const { crumbs } = trail({ methods: [] });
        expect(crumbs().at(-1)!.tagName).toBe('SPAN');
    });

    it('Follow toggles, and Out shows only when there is a level to leave', () => {
        const onOut = vi.fn();
        const { p, container } = trail({ follow: false, onOut });
        const follow = container.querySelector('[data-action="follow"]') as HTMLButtonElement;
        expect(follow.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(follow);
        expect(p.onFollow).toHaveBeenCalledTimes(1);
        fireEvent.click(container.querySelector('[data-action="out"]') as HTMLButtonElement);
        expect(onOut).toHaveBeenCalledTimes(1);
    });
});
