import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SurfaceFrame } from '../SurfaceStates';
import { FONT_MONO, FONT_UI, TYPE, TYPE_VARS } from './type';

describe('type roles', () => {
    it('the section heading is the mockup .h3: 11px / 700 / .06em / uppercase / muted', () => {
        expect(TYPE.sectionHeading).toMatchObject({ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' });
        expect(TYPE.sectionHeading.color).toContain('--kg-muted');
    });

    it('names, paths and code are JetBrains Mono through the root variable; text is Inter through its own', () => {
        for (const role of ['mono', 'monoName', 'monoTitle', 'monoValue', 'monoMeta'] as const) expect(TYPE[role].fontFamily).toBe(FONT_MONO);
        for (const role of ['body', 'meta', 'sectionHeading', 'pill', 'title', 'tag'] as const) expect(TYPE[role].fontFamily).toBe(FONT_UI);
        expect(FONT_MONO).toContain('var(--kg-font-mono');
        expect(FONT_MONO).toContain('JetBrains Mono');
        expect(FONT_UI).toContain('var(--kg-font-ui');
        expect(FONT_UI).toMatch(/Inter/);
    });

    it('carries the mockup scale', () => {
        expect(TYPE.body.fontSize).toBe(12);
        expect(TYPE.meta.fontSize).toBe(11);
        expect(TYPE.caption.fontSize).toBe(10);
        expect(TYPE.title).toMatchObject({ fontSize: 14, fontWeight: 700 });
        expect(TYPE.pill).toMatchObject({ fontSize: 12, fontWeight: 600 });
        expect(TYPE.mono.fontSize).toBe(11.5);
        expect(TYPE.monoName).toMatchObject({ fontSize: 11, fontWeight: 600 });
        expect(TYPE.monoTitle).toMatchObject({ fontSize: 13, fontWeight: 700 });
        expect(TYPE.bandLabel).toMatchObject({ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' });
    });
});

describe('the view root', () => {
    it('defines --kg-font-ui and --kg-font-mono and sets the UI face', () => {
        render(<SurfaceFrame ref={null} label="Knowledge"><span>x</span></SurfaceFrame>);
        const root = screen.getByRole('region', { name: 'Knowledge' });
        expect(root.style.getPropertyValue('--kg-font-ui')).toBe((TYPE_VARS as Record<string, string>)['--kg-font-ui']);
        expect(root.style.getPropertyValue('--kg-font-mono')).toContain('JetBrains Mono');
        expect(root.style.fontFamily).toContain('--kg-font-ui');
    });
});
