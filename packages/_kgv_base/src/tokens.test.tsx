// @vitest-environment node
/**
 * The view's neutrals are the design mockup's (`B-Surface.dc.html`: `.kg` for dark, `.kg.light` for light), set in
 * `tokens.css` and nowhere else: no host re-points them, and dark/light follows the host's `html[data-theme]`.
 */
import { describe, expect, it } from 'vitest';
import TOKENS from './tokens.css?raw';
import MAIN from '../../../clients/vscode/webview/src/main.tsx?raw';
import HOST from '../../../clients/vscode/webview/src/knowledgeGraph/hostTokens.css?raw';

/** The declarations of the first rule whose selector is exactly `selector` (the rule bodies here hold no nested braces). */
function rule(css: string, selector: string): Map<string, string> {
    const at = css.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`no rule ${selector}`);
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
    const out = new Map<string, string>();
    for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.replace(/\s+/g, ' ').trim());
    return out;
}

const DARK = {
    '--kg-bg': '#14161b', '--kg-panel': '#1b1e25', '--kg-panel2': '#22262f', '--kg-raise': '#2a2f3a', '--kg-border': '#333947',
    '--kg-text': '#e7e9ef', '--kg-muted': '#a0a9ba', '--kg-accent': '#5b95ff', '--kg-accent-soft': 'rgba(91, 149, 255, 0.16)', '--kg-on-accent': '#0a1226',
};
const LIGHT = {
    '--kg-bg': '#f1f5f9', '--kg-panel': '#ffffff', '--kg-panel2': '#f7f9fc', '--kg-raise': '#eef2f7', '--kg-border': '#d6dce6',
    '--kg-text': '#0f172a', '--kg-muted': '#475569', '--kg-accent': '#2d60ff', '--kg-accent-soft': 'rgba(45, 96, 255, 0.1)', '--kg-on-accent': '#ffffff',
};

/** WCAG 2.x contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
    const lum = (hex: string) => {
        const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
}

describe('the knowledge view\'s neutrals', () => {
    it('are the mockup\'s dark values by default', () => {
        const dark = rule(TOKENS, ':where(:root)');
        for (const [name, value] of Object.entries(DARK)) expect(dark.get(name), name).toBe(value);
    });

    it('are the mockup\'s light values under html[data-theme=light], the switch the web, the VS Code canvas and Rovr already flip', () => {
        const light = rule(TOKENS, ":where(html[data-theme='light'])");
        for (const [name, value] of Object.entries(LIGHT)) expect(light.get(name), name).toBe(value);
    });

    it('are not re-pointed by the VS Code host outside high-contrast themes, which keep only its hues', () => {
        const host = rule(HOST, ':root');
        for (const name of Object.keys(DARK)) expect(host.has(name), name).toBe(false);
        // Everything but the high-contrast blocks (the one place the host re-points the neutrals).
        const outsideHighContrast = HOST.replace(/body\.vscode-high-contrast[^{]*\{[^}]*\}/g, '');
        expect(outsideHighContrast).not.toMatch(/--kg-muted\s*:/);
        expect(outsideHighContrast).not.toMatch(/--kg-text\s*:/);
        expect(outsideHighContrast).not.toMatch(/--kg-border\s*:/);
    });

    it('points text, muted and border at the VS Code contrast colours in the high-contrast themes', () => {
        // Every rule of the host sheet that sets --kg-text, with its selector (the sheet's rule bodies hold no nested braces).
        const setting = [...HOST.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[2]!.includes('--kg-text:'));
        expect(setting.length).toBeGreaterThanOrEqual(2);
        const selectors = setting.map((m) => m[1]!.replace(/\s+/g, ' ').trim());
        expect(selectors[0]).toBe('body.vscode-high-contrast, body.vscode-high-contrast-light');
        expect(selectors[1]).toBe('body.vscode-high-contrast-light');
        for (const m of setting) {
            expect(m[2]).toMatch(/--kg-text:\s*var\(--vscode-foreground/);
            expect(m[2]).toMatch(/--kg-muted:\s*var\(--vscode-descriptionForeground/);
            expect(m[2]).toMatch(/--kg-border:\s*var\(--vscode-contrastBorder/);
        }
    });

    it('define the tower\'s side-face shade in both themes (a token, not a literal in the mark)', () => {
        expect(rule(TOKENS, ':where(:root)').get('--kg-tower-side')).toMatch(/^rgba\(/);
        expect(rule(TOKENS, ":where(html[data-theme='light'])").get('--kg-tower-side')).toMatch(/^rgba\(/);
    });

    it('keep the quiet heat cell visible against the page in light (1.5:1 at least) and the ramp a visible step apart', () => {
        const light = rule(TOKENS, ":where(html[data-theme='light'])");
        expect(contrast(light.get('--kg-w-1')!, LIGHT['--kg-bg'])).toBeGreaterThanOrEqual(1.5);
        expect(contrast(light.get('--kg-w-2')!, LIGHT['--kg-bg'])).toBeGreaterThanOrEqual(1.5);
        expect(light.get('--kg-w-1')).not.toBe(light.get('--kg-w-2'));
    });

    it('define --kg-raise and --kg-scrim, which the Tower and the drawer read, in the one stylesheet the webview bundles', () => {
        expect(rule(TOKENS, ':where(:root)').has('--kg-scrim')).toBe(true);
        expect(rule(TOKENS, ":where(html[data-theme='light'])").has('--kg-scrim')).toBe(true);
        expect(MAIN).toContain("'@builderforce/knowledge-graph-view/tokens.css'");
    });

    it('define the file-category tones and the area tone in both themes (each distinct from the non-file tones)', () => {
        const dark = rule(TOKENS, ':where(:root)');
        const light = rule(TOKENS, ":where(html[data-theme='light'])");
        const cats = ['--kg-cat-source', '--kg-cat-test', '--kg-cat-doc', '--kg-cat-config', '--kg-cat-style', '--kg-cat-data', '--kg-cat-other'];
        for (const set of [dark, light]) {
            for (const name of cats) expect(set.get(name), name).toBeTruthy();
            expect(set.get('--kg-node-area')).toBeTruthy();
        }
        // Each category tone differs from every other (the redundant encoding would be lost otherwise).
        const seen = new Set(cats.map((c) => dark.get(c)!));
        expect(seen.size).toBe(cats.length);
    });

    it('keep text legible on every surface, in both themes (text 4.5:1, muted 4.5:1, on-accent 4.5:1)', () => {
        for (const set of [DARK, LIGHT]) {
            for (const surface of ['--kg-bg', '--kg-panel', '--kg-panel2', '--kg-raise'] as const) {
                expect(contrast(set['--kg-text'], set[surface]), `text on ${surface}`).toBeGreaterThanOrEqual(4.5);
                expect(contrast(set['--kg-muted'], set[surface]), `muted on ${surface}`).toBeGreaterThanOrEqual(4.5);
            }
            expect(contrast(set['--kg-on-accent'], set['--kg-accent']), 'on-accent on accent').toBeGreaterThanOrEqual(4.5);
        }
    });
});
