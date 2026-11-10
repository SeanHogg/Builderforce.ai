/**
 * rules/support/layers.ts — which runtime a JS/TS file runs in, by path and text (C7 flexibility,
 * C6.1 bundle weight): browser code (`'use client'`, webview and browser folders, `*.client.*`) and
 * Worker code (`workers/`, `*.worker.*`, a `cloudflare:` import, an `export default { fetch }` module).
 * Everything else is unknown: the layer rules say nothing about it.
 */

import { isJsPath, type TextView } from './files.js';
import { importsOf } from './imports.js';

export type Layer = 'browser' | 'worker';

const BROWSER_PATH = /(^|\/)(?:webviews?|browser)\/|\.client\.[cm]?[jt]sx?$/;
const WORKER_PATH = /(^|\/)workers?\/|\.worker\.[cm]?[jt]sx?$/;
const USE_CLIENT = /^\s*(['"])use client\1/;
const WORKER_MODULE = /export\s+default\s*\{[\s\S]{0,400}?\b(?:async\s+)?fetch\s*\(/;

export function layerOf(view: TextView): Layer | undefined {
    if (!isJsPath(view.path)) return undefined;
    return view.memo('layer', () => {
        if (USE_CLIENT.test(view.code) || BROWSER_PATH.test(view.path)) return 'browser';
        if (WORKER_PATH.test(view.path) || WORKER_MODULE.test(view.bare) || importsOf(view).some((i) => i.specifier.startsWith('cloudflare:'))) return 'worker';
        return undefined;
    });
}
