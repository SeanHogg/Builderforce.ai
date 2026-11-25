/**
 * The `/preview` harness build: `harness/index.html` + `main.tsx` → ONE self-contained
 * `index.html` (script and styles inlined, the compute worker a blob) in
 * `.universalcode/designs/visualizer/`, openable straight from disk.
 *
 * Run with the VS Code client's Vite (`npm run harness` / `harness:dev`): this package
 * installs nothing. Its peers (react, react-dom, three, the r3f packages) resolve from the
 * frontend's install through the SAME rule the package's tests use (`peersFromHost`), and
 * the source packages and the memory pin through the registry's aliases. No `vite` import,
 * so this file loads whichever Vite runs it.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourcePackageAliases } from '../../../scripts/sourcePackages.mjs';
import { peersFromHost } from '../vitest.config';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const OUT_DIR = path.resolve(HERE, '../../../../.universalcode/designs/visualizer');

/** The bundle items this plugin reads (structural: no Rollup types here). */
type BundleItem =
    | { type: 'chunk'; fileName: string; isEntry: boolean; code: string }
    | { type: 'asset'; fileName: string; source: string | Uint8Array };

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const text = (source: string | Uint8Array): string => (typeof source === 'string' ? source : new TextDecoder().decode(source));

/** Inlines the entry chunk and the CSS into index.html and drops them from the bundle: one file out. */
function inlineBundle() {
    return {
        name: 'kg-harness:inline-bundle',
        enforce: 'post' as const,
        generateBundle(_options: unknown, bundle: Record<string, BundleItem>) {
            const html = Object.values(bundle).find((b): b is Extract<BundleItem, { type: 'asset' }> => b.type === 'asset' && b.fileName.endsWith('.html'));
            if (!html) throw new Error('harness: the build emitted no index.html');
            let page = text(html.source);
            for (const [name, item] of Object.entries(bundle)) {
                const at = escapeRegExp(item.fileName);
                if (item.type === 'chunk' && item.isEntry) {
                    const code = item.code.replace(/<\/script/gi, '<\\/script');
                    page = page.replace(new RegExp(`<script[^>]*src="[^"]*${at}"[^>]*></script>`), () => `<script type="module">${code}</script>`);
                    delete bundle[name];
                } else if (item.type === 'asset' && item.fileName.endsWith('.css')) {
                    page = page.replace(new RegExp(`<link[^>]*href="[^"]*${at}"[^>]*>`), () => `<style>${text(item.source)}</style>`);
                    delete bundle[name];
                }
            }
            html.source = page;
        },
    };
}

export default {
    root: HERE,
    base: './',
    plugins: [peersFromHost, inlineBundle()],
    resolve: { alias: sourcePackageAliases(path.resolve(HERE, '../../..'), { installDir: FRONTEND }) },
    // The view's sources use syntax (destructuring in the worker bundle) the default browser targets reject.
    esbuild: { jsx: 'automatic', target: 'es2022' },
    worker: { format: 'es', plugins: () => [peersFromHost] },
    build: {
        target: 'es2022',
        outDir: OUT_DIR,
        emptyOutDir: true,
        rollupOptions: { output: { inlineDynamicImports: true } },
    },
    server: {
        host: '127.0.0.1',
        port: 5179,
        strictPort: true,
        // The view's sources and the frontend's install live outside `root`.
        fs: { allow: [REPO_ROOT] },
    },
};
