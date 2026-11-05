import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Menu, Segmented, StatusDot } from './index';

const ITEMS = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta', disabled: true }, { id: 'c', label: 'Gamma' }];

describe('Segmented', () => {
    it('select mode: arrow keys skip disabled, wrap, and select', () => {
        const Host = () => {
            const [v, setV] = useState('a');
            return <Segmented label="View" items={ITEMS} value={v} onChange={setV} />;
        };
        render(<Host />);
        const group = screen.getByRole('radiogroup', { name: 'View' });
        expect(screen.getByRole('radio', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('radio', { name: 'Alpha' }).tabIndex).toBe(0);
        expect(screen.getByRole('radio', { name: 'Gamma' }).tabIndex).toBe(-1);
        fireEvent.keyDown(group, { key: 'ArrowRight' });
        expect(screen.getByRole('radio', { name: 'Gamma' }).getAttribute('aria-checked')).toBe('true');
        expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Gamma' }));
        fireEvent.keyDown(group, { key: 'ArrowRight' });
        expect(screen.getByRole('radio', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('true');
    });

    it('toggle mode: aria-pressed, none selected, click again clears', () => {
        const onChange = vi.fn();
        const Host = () => {
            const [v, setV] = useState<string | null>(null);
            return <Segmented mode="toggle" label="Panels" items={ITEMS} value={v} onChange={(id) => { onChange(id); setV(id); }} />;
        };
        render(<Host />);
        expect(screen.getByRole('group', { name: 'Panels' })).toBeTruthy();
        const alpha = screen.getByRole('button', { name: 'Alpha' });
        expect(alpha.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(alpha);
        expect(alpha.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(alpha);
        expect(onChange).toHaveBeenLastCalledWith(null);
        expect(alpha.getAttribute('aria-pressed')).toBe('false');
    });
});

describe('Menu', () => {
    const setup = (onSelect = vi.fn()) => {
        render(<div><button type="button">outside</button><Menu trigger="More" label="More questions" items={[{ id: 'x', label: 'Ex', sub: 'was the X lens' }, { id: 'y', label: 'Why' }]} onSelect={onSelect} /></div>);
        return onSelect;
    };

    it('opens, shows the sub-line, and Esc closes returning focus to the trigger', () => {
        setup();
        const trigger = screen.getByRole('button', { name: 'More' });
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(trigger);
        expect(screen.getByRole('menu', { name: 'More questions' })).toBeTruthy();
        expect(screen.getByText('was the X lens')).toBeTruthy();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        fireEvent.keyDown(screen.getByRole('menuitem', { name: /Ex/ }), { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('closes on an outside press', () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('roving tabindex with Home/End and arrow wrap', () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        const [ex, why] = [screen.getByRole('menuitem', { name: /Ex/ }), screen.getByRole('menuitem', { name: /Why/ })];
        expect(ex.tabIndex).toBe(0);
        expect(why.tabIndex).toBe(-1);
        expect(document.activeElement).toBe(ex);
        fireEvent.keyDown(ex, { key: 'End' });
        expect(document.activeElement).toBe(why);
        expect(why.tabIndex).toBe(0);
        expect(ex.tabIndex).toBe(-1);
        fireEvent.keyDown(why, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(ex);
        fireEvent.keyDown(ex, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(why);
        fireEvent.keyDown(why, { key: 'Home' });
        expect(document.activeElement).toBe(ex);
    });

    it('closes when focus leaves the menu', () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        const outside = screen.getByRole('button', { name: 'outside' });
        fireEvent.focusOut(screen.getByRole('menuitem', { name: /Ex/ }), { relatedTarget: outside });
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('children mode is a dialog', () => {
        render(<Menu trigger="Overlays" label="Overlay settings"><p>form</p></Menu>);
        const trigger = screen.getByRole('button', { name: 'Overlays' });
        expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
        fireEvent.click(trigger);
        expect(screen.getByRole('dialog', { name: 'Overlay settings' })).toBeTruthy();
    });

    it('selecting an item reports it, closes, and returns focus', () => {
        const onSelect = setup();
        const trigger = screen.getByRole('button', { name: 'More' });
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('menuitem', { name: /Why/ }));
        expect(onSelect).toHaveBeenCalledWith('y');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });
});

describe('StatusDot', () => {
    it.each(['synced', 'syncing', 'error', 'idle'] as const)('%s exposes its state in the accessible name', (state) => {
        render(<StatusDot state={state} label="Sync" stateLabel={`is ${state}`} onClick={() => undefined} />);
        const el = screen.getByRole('button', { name: `Sync is ${state}` });
        expect(el.getAttribute('data-state')).toBe(state);
    });

    it('without onClick it is a status region', () => {
        render(<StatusDot state="error" label="Sync" stateLabel="failed" />);
        expect(screen.getByRole('status').textContent).toContain('failed');
    });
});
