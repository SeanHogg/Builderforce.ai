/**
 * knowledge/codeEntryPoints.ts — the entry points a root's manifests name (PRD 38, Option B+
 * Contract 2). Read ONCE, at review time; the result travels as data (the `entry` badge of the
 * root-level signals), so building a graph — anywhere, from stored output — never reads a file
 * to place a layer. THE one rule set, by manifest kind:
 *
 *   - `package.json`             — `main` / `module` / `bin` / `exports` targets;
 *   - `index.html`               — each `<script type="module" src>` (a Vite app's real entry);
 *   - `wrangler.toml` / `.json(c)` — the Worker's top-level `main`;
 *   - `vite.config.*`            — `build.rollupOptions.input` when it is a literal (a string, an
 *                                  array of strings or an object of strings); an `.html` input is
 *                                  read for its module scripts like `index.html`.
 *
 * A target that is a CONFIG file (`eslint.config.js`, `.prettierrc.cjs`, `vite.config.ts` …) is
 * never an entry: a workspace root's `"main": "eslint.config.js"` names no program. Targets are
 * relative to the manifest's folder (an html `src="/x.ts"` to the html's folder, Vite's root);
 * one that leaves the root, or is a URL, names nothing. Deterministic and bounded.
 */

import type { DirectorySource } from '@seanhogg/builderforce-memory/knowledge';

const base = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** True for a package manifest. */
export const isPackageManifest = (path: string): boolean => base(path) === 'package.json';

const isHtmlEntry = (path: string): boolean => base(path) === 'index.html';
const isWrangler = (path: string): boolean => /^wrangler\.(toml|json|jsonc)$/.test(base(path));
const isViteConfig = (path: string): boolean => /^vite\.config\.(ts|mts|cts|js|mjs|cjs)$/.test(base(path));

/** True for any file this module reads entry points from. */
export const isEntryManifest = (path: string): boolean =>
    isPackageManifest(path) || isHtmlEntry(path) || isWrangler(path) || isViteConfig(path);

/** A tool's config file: never a program's entry, whatever a manifest's `main` says. */
const CONFIG_FILE = /^[^/]+\.config\.[^/]+$|^\.?(eslint|prettier|stylelint|babel|commitlint|lint-staged|postcss|tailwind)(rc)?([.-][^/]*)?$|^\.[\w-]+rc(\.[^/]*)?$/i;
export const isConfigFile = (path: string): boolean => CONFIG_FILE.test(base(path));

/** Manifests read at most; a monorepo has dozens, never thousands that matter. */
const MAX_MANIFESTS = 200;
/** Script tags / inputs taken from one file at most. */
const MAX_TARGETS_PER_FILE = 32;

/** `target` resolved against `dir` (root-relative), or undefined when it is a URL, empty, or leaves the root. */
function resolveTarget(dir: string, target: string): string | undefined {
    const t = target.trim().replace(/[?#].*$/, '');
    if (!t || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(t)) return undefined;
    const parts = dir ? dir.split('/') : [];
    for (const seg of t.replace(/^\/+/, '').split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') { if (parts.length === 0) return undefined; parts.pop(); continue; }
        parts.push(seg);
    }
    return parts.length > 0 ? parts.join('/') : undefined;
}

function packageTargets(text: string): string[] {
    let json: Record<string, unknown>;
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { return []; }
    const out: string[] = [];
    const collect = (value: unknown): void => {
        if (typeof value === 'string') out.push(value);
        else if (value && typeof value === 'object') for (const v of Object.values(value as Record<string, unknown>)) collect(v);
    };
    for (const key of ['main', 'module', 'bin', 'exports']) collect(json[key]);
    return out;
}

/** The `src` of every `<script type="module">` of an html page. */
export function htmlModuleScripts(text: string): string[] {
    const out: string[] = [];
    for (const m of text.matchAll(/<script\b([^>]*)>/gi)) {
        const attrs = m[1] ?? '';
        if (!/\btype\s*=\s*["']?module["']?/i.test(attrs)) continue;
        const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
        const value = src?.[1] ?? src?.[2] ?? src?.[3];
        if (value) out.push(value);
        if (out.length >= MAX_TARGETS_PER_FILE) break;
    }
    return out;
}

/** A Worker's top-level `main`: TOML before the first table, JSON(C) the first `"main"` key. */
export function wranglerMain(path: string, text: string): string | undefined {
    if (path.endsWith('.toml')) {
        for (const line of text.split(/\r?\n/)) {
            if (/^\s*\[/.test(line)) return undefined;
            const m = /^\s*main\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line);
            if (m) return m[1] ?? m[2];
        }
        return undefined;
    }
    const uncommented = text.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    return /"main"\s*:\s*"([^"]*)"/.exec(uncommented)?.[1];
}

const LITERAL = String.raw`(?:"[^"\n]*"|'[^'\n]*'|\x60[^\x60\n$]*\x60)`;
const LITERAL_RE = new RegExp(LITERAL, 'g');
const INPUT_FORMS = [
    new RegExp(String.raw`^${LITERAL}`),
    new RegExp(String.raw`^\[\s*(?:${LITERAL}\s*,?\s*)*\]`),
    new RegExp(String.raw`^\{\s*(?:(?:[\w$-]+|${LITERAL})\s*:\s*${LITERAL}\s*,?\s*)*\}`),
];

/** `build.rollupOptions.input` of a Vite config, when it is written as literals; anything computed names nothing. */
export function viteInputs(text: string): string[] {
    const at = text.search(/\brollupOptions\s*:/);
    if (at < 0) return [];
    const window = text.slice(at, at + 4000);
    const input = /\binput\s*:\s*/.exec(window);
    if (!input) return [];
    const rest = window.slice(input.index + input[0].length);
    const form = INPUT_FORMS.map((re) => re.exec(rest)?.[0]).find((m) => m !== undefined);
    if (!form) return [];
    const literals = [...form.matchAll(LITERAL_RE)].map((m) => m[0].slice(1, -1));
    // An object's keys are its entry NAMES: keep only the values (each follows a colon).
    const values = form.startsWith('{')
        ? [...form.matchAll(new RegExp(String.raw`:\s*(${LITERAL})`, 'g'))].map((m) => m[1]!.slice(1, -1))
        : literals;
    return values.slice(0, MAX_TARGETS_PER_FILE);
}

/** The raw targets one manifest names, by its kind (unresolved). */
function targetsOf(path: string, text: string): string[] {
    if (isPackageManifest(path)) return packageTargets(text);
    if (isHtmlEntry(path) || path.endsWith('.html')) return htmlModuleScripts(text);
    if (isWrangler(path)) { const main = wranglerMain(path, text); return main ? [main] : []; }
    if (isViteConfig(path)) return viteInputs(text);
    return [];
}

/**
 * Entry paths named by the manifests (`path → text`): see the module doc for the kinds. A Vite input that is an html page
 * is returned as a path too — {@link readEntryPaths} reads it for its module scripts; it is not a code file, so the
 * signals drop it. Config-file targets are left out.
 */
export function manifestEntryPaths(manifests: ReadonlyMap<string, string>): Set<string> {
    const out = new Set<string>();
    for (const [path, text] of manifests) {
        for (const target of targetsOf(path, text)) {
            const resolved = resolveTarget(dirOf(path), target);
            if (resolved && !isConfigFile(resolved)) out.add(resolved);
        }
    }
    return out;
}

/** Entry points of the manifests among `ids` (root-relative), read through the review's source. */
export async function readEntryPaths(source: Pick<DirectorySource, 'read'>, ids: Iterable<string>): Promise<Set<string>> {
    const listed = new Set(ids);
    const manifests = new Map<string, string>();
    const readInto = async (id: string): Promise<void> => {
        if (manifests.has(id) || manifests.size >= MAX_MANIFESTS) return;
        try {
            const doc = await source.read(id);
            if (doc.content.kind === 'text') manifests.set(id, doc.content.text);
        } catch { /* An unreadable manifest names no entry. */ }
    };
    for (const id of [...listed].filter(isEntryManifest).sort()) await readInto(id);
    const first = manifestEntryPaths(manifests);
    // A Vite input that is an html page (`admin.html`) holds the entry: read it once, if the review listed it.
    const pages = [...first].filter((p) => p.endsWith('.html') && listed.has(p) && !manifests.has(p)).sort();
    if (pages.length === 0) return dropPages(first);
    for (const page of pages) await readInto(page);
    return dropPages(manifestEntryPaths(manifests));
}

/** An html page is a manifest, never an entry FILE: the code it loads is. */
const dropPages = (paths: Set<string>): Set<string> => new Set([...paths].filter((p) => !p.endsWith('.html')));
