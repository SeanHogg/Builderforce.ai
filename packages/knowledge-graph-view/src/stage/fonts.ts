/**
 * The host font-URL port (PRD 43 B3, Labels): where the SDF label pass gets JetBrains Mono. The stage never downloads a
 * font of its own and never lets troika fall back to its CDN — the font is the one the HOST already bundles through
 * `@fontsource/jetbrains-mono` (web, VS Code webview, Rovr), so it is served from the host's own origin and passes the
 * VS Code webview's CSP (`font-src`/`connect-src` grant the webview's `cspSource`; troika fetches from a `blob:` worker,
 * which `worker-src blob:` allows, and needs the ABSOLUTE url this port returns).
 *
 * A host may pass a port explicitly; the default reads the `@font-face` rules the host's @fontsource CSS already put in
 * the document, so every host is covered with no wiring. No URL ⇒ no SDF labels: the names go to the DOM caption layer.
 *
 * The SDF font covers only its subset (@fontsource `latin`); a name with a glyph outside it is drawn by the DOM caption
 * layer instead, which gets the browser's i18n glyph fallback — so troika is never asked for a fallback font.
 */

export type MonoWeight = 400 | 500 | 700;

export interface StageFontPort {
    /** An absolute URL of JetBrains Mono at `weight` (woff, ttf or otf: troika 0.52 cannot read woff2), or null when the host has none. */
    monoUrl(weight: MonoWeight): string | null;
}

/** @fontsource's `latin` subset `unicode-range`, as code-point ranges: what the SDF mono font can draw. */
export const MONO_LATIN_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x0000, 0x00ff], [0x0131, 0x0131], [0x0152, 0x0153], [0x02bb, 0x02bc], [0x02c6, 0x02c6], [0x02da, 0x02da],
    [0x02dc, 0x02dc], [0x0304, 0x0304], [0x0308, 0x0308], [0x0329, 0x0329], [0x2000, 0x206f], [0x20ac, 0x20ac],
    [0x2122, 0x2122], [0x2191, 0x2191], [0x2193, 0x2193], [0x2212, 0x2212], [0x2215, 0x2215], [0xfeff, 0xfeff], [0xfffd, 0xfffd],
];

/** True when every code point of `text` is inside the SDF font's subset. */
export function monoCovers(text: string): boolean {
    for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (!MONO_LATIN_RANGES.some(([a, b]) => cp >= a && cp <= b)) return false;
    }
    return true;
}

const MONO_FAMILY = /jetbrains\s*mono/i;
/** `CSSRule.FONT_FACE_RULE` (a constant every engine, jsdom included, still reports). */
const FONT_FACE_RULE = 5;

const WOFF2 = /\.woff2(\?|#|$)/i;

/**
 * The `url(...)`s of a `src` descriptor that troika can parse: woff / ttf / otf, never woff2 — troika-three-text 0.52
 * ships no woff2 decoder ("woff2 fonts not supported", measured on the real GPU run). @fontsource lists a `.woff`
 * beside every `.woff2`, so the host's bundle already carries one.
 */
export function fontUrlsOf(src: string): string[] {
    return [...src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]!).filter((u) => !WOFF2.test(u));
}

/** An `@font-face` rule's text and the URL its relative `url()`s resolve against (its sheet's, or the document's). */
export interface FaceText { cssText: string; base: string }

function faceTexts(doc: Document): FaceText[] {
    const out: FaceText[] = [];
    for (const sheet of Array.from(doc.styleSheets)) {
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; } // a cross-origin sheet hides its rules
        const base = sheet.href ?? doc.baseURI;
        for (const rule of Array.from(rules)) {
            if (rule.type === FONT_FACE_RULE || /^\s*@font-face/i.test(rule.cssText)) out.push({ cssText: rule.cssText, base });
        }
    }
    return out;
}

/**
 * The absolute URL of the mono face at `weight` (else 400, else any) among `faces`, read from the rules' text (engines
 * differ on what `style.getPropertyValue('src')` returns for a descriptor). Pure.
 */
export function monoFaceUrl(faces: readonly FaceText[], weight: MonoWeight): string | null {
    const parsed = faces.map(({ cssText, base }) => {
        const descriptor = (name: string): string => new RegExp(`(?:^|[{;\\s])${name}\\s*:\\s*([^;}]+)`, 'i').exec(cssText)?.[1]?.trim() ?? '';
        return { family: descriptor('font-family'), weight: descriptor('font-weight'), src: descriptor('src'), base };
    }).filter((f) => MONO_FAMILY.test(f.family))
        // A face whose only source is woff2 cannot be read by troika: drop it BEFORE choosing a weight, so a usable
        // face of another weight wins over an unusable exact match.
        .map((f) => ({ ...f, url: fontUrlsOf(f.src)[0] }))
        .filter((f): f is typeof f & { url: string } => f.url !== undefined);
    const face = parsed.find((f) => f.weight === String(weight)) ?? parsed.find((f) => f.weight === '400') ?? parsed[0];
    if (!face) return null;
    try { return new URL(face.url, face.base).href; } catch { return null; }
}

/** The default port: the host's own @fontsource faces, read from the document's stylesheets (once per weight). */
export function documentFontPort(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): StageFontPort {
    const cache = new Map<MonoWeight, string | null>();
    return {
        monoUrl(weight) {
            if (cache.has(weight)) return cache.get(weight)!;
            const url = doc ? monoFaceUrl(faceTexts(doc), weight) : null;
            cache.set(weight, url);
            return url;
        },
    };
}

/** A port over fixed URLs (a host that imports the font files with `?url`, a test). */
export const fixedFontPort = (urls: Partial<Record<MonoWeight, string>>): StageFontPort => ({
    monoUrl: (weight) => urls[weight] ?? urls[500] ?? urls[400] ?? null,
});
