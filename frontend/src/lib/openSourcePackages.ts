/**
 * THE OPEN-SOURCE REGISTRY — every repository Builderforce publishes under an
 * open licence, as DATA.
 *
 * One row per repository. `/open-source` (the index), `/open-source/[slug]` (the
 * detail page), the sitemap and the catalog test all read this array, so a new
 * package is one row here plus its copy under `openSource.packages.<key>` in the
 * five message catalogs — nothing else to edit.
 *
 * No user-facing English lives here. What a row carries is what is the same in
 * every language: URLs, package names, the brand name, the licence identifier,
 * the install line and the quick-start code. Every sentence a reader sees is in
 * the catalogs, keyed by `key`.
 *
 * Facts are taken from each repository's own README / package.json / Cargo.toml.
 * The two Rust repositories are not published to crates.io; they install from
 * the git source (`cargo install --git`) or build from a clone, and `distribution`
 * says so rather than pretending a registry page exists.
 */
import type { IconName } from '@/components/ui/Icon';

/** Where a package is installed from. `npm` has a registry page per package;
 *  `git` installs straight from the repository. */
export type OpenSourceDistribution = 'npm' | 'git';

export interface OpenSourcePackage {
  /** Catalog key under `openSource.packages.<key>` (camelCase, stable). */
  key: string;
  /** URL segment: `/open-source/<slug>`. The repository name, so the URL and
   *  the GitHub path read the same. */
  slug: string;
  /** Brand name — a proper noun, identical in every locale. */
  displayName: string;
  /** Public source repository. */
  repoUrl: string;
  /** SPDX identifier, from the repository's LICENSE / manifest. */
  license: 'MIT';
  /** Implementation language, as the ecosystem names it. */
  language: 'TypeScript' | 'Rust';
  distribution: OpenSourceDistribution;
  /** Published package / crate names, primary first. */
  packages: readonly string[];
  /** The one line that gets you started. */
  install: string;
  /** Shell or TypeScript, for the code block's label. */
  quickStartLanguage: 'ts' | 'sh';
  /** Literal code — no prose, so it needs no translation. */
  quickStart: string;
  /** A published `/blog/<slug>` about this package, when one exists. The detail
   *  page re-checks it against the blog index before linking. */
  relatedBlogSlug?: string;
  /** True when the catalog carries a `comparison` block for this row — a
   *  closed alternative it replaces. */
  hasComparison: boolean;
  icon: IconName;
}

const npmPackageUrl = (name: string): string => `https://www.npmjs.com/package/${name}`;

export const OPEN_SOURCE_PACKAGES: readonly OpenSourcePackage[] = [
  {
    key: 'webcontainers',
    slug: 'builderforce-webcontainers',
    displayName: 'BuilderForce WebContainers',
    repoUrl: 'https://github.com/SeanHogg/builderforce-webcontainers',
    license: 'MIT',
    language: 'TypeScript',
    distribution: 'npm',
    packages: ['@seanhogg/builderforce-webcontainers', '@seanhogg/builderforce-webcontainers-core'],
    install: 'npm install @seanhogg/builderforce-webcontainers',
    quickStartLanguage: 'ts',
    quickStart: `import { startPreviewRuntime } from '@seanhogg/builderforce-webcontainers';

const runtime = await startPreviewRuntime({ serviceWorkerUrl: '/__bfwc/sw.js', id: 'my-project' });
runtime.writeTree({
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
  'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': \`import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(<h1>Hello</h1>);\`,
});

if (runtime.profile().supported) iframe.src = runtime.url;
runtime.onError((e) => console.warn(e.message));`,
    relatedBlogSlug: 'builderforce-webcontainers-open-source',
    hasComparison: true,
    icon: 'code',
  },
  {
    key: 'memory',
    slug: 'builderforce-memory',
    displayName: 'BuilderForce Agent Memory',
    repoUrl: 'https://github.com/SeanHogg/builderforce-memory',
    license: 'MIT',
    language: 'TypeScript',
    distribution: 'npm',
    packages: [
      '@seanhogg/builderforce-memory-mcp',
      '@seanhogg/builderforce-memory',
      '@seanhogg/builderforce-memory-engine',
    ],
    install: 'npx -y -p @seanhogg/builderforce-memory-mcp builderforce-memory-install',
    quickStartLanguage: 'sh',
    quickStart: `# Claude Code
/plugin marketplace add SeanHogg/builderforce-memory
/plugin install builderforce-memory@builderforce

# Cursor, Windsurf, VS Code, Claude Desktop, Cline, Gemini CLI, Codex CLI
npx -y -p @seanhogg/builderforce-memory-mcp builderforce-memory-install --host=all`,
    relatedBlogSlug: 'inside-evermind-architecture',
    hasComparison: false,
    icon: 'brain',
  },
  {
    key: 'inference',
    slug: 'builderforce-inference',
    displayName: 'Synapse · bfi',
    repoUrl: 'https://github.com/SeanHogg/builderforce-inference',
    license: 'MIT',
    language: 'Rust',
    distribution: 'git',
    packages: ['bfi', 'bfi-server', 'bfi-runtime', 'bfi-gguf'],
    install: 'cargo install --git https://github.com/SeanHogg/builderforce-inference bfi',
    quickStartLanguage: 'sh',
    quickStart: `cargo install --git https://github.com/SeanHogg/builderforce-inference bfi

bfi fit Qwen/Qwen3-0.6B-GGUF:Q4_K_M
bfi pull Qwen/Qwen3-0.6B-GGUF:Q4_K_M
bfi ls
bfi serve --port 11434`,
    relatedBlogSlug: 'synapse-runs-models-itself',
    hasComparison: false,
    icon: 'monitor',
  },
  {
    key: 'spawn',
    slug: 'builderforce-spawn',
    displayName: 'Spawn',
    repoUrl: 'https://github.com/SeanHogg/builderforce-spawn',
    license: 'MIT',
    language: 'Rust',
    distribution: 'git',
    packages: ['bf-roblox'],
    install: 'git clone https://github.com/SeanHogg/builderforce-spawn',
    quickStartLanguage: 'sh',
    quickStart: `git clone https://github.com/SeanHogg/builderforce-spawn
cd builderforce-spawn
cargo build --workspace`,
    relatedBlogSlug: 'build-roblox-games-by-talking',
    hasComparison: false,
    icon: 'play',
  },
];

/** The row behind `/open-source/<slug>`, or `undefined` (the page 404s). */
export function openSourceBySlug(slug: string): OpenSourcePackage | undefined {
  return OPEN_SOURCE_PACKAGES.find((entry) => entry.slug === slug);
}

/** Public path of a package's detail page. */
export function openSourcePath(entry: Pick<OpenSourcePackage, 'slug'>): string {
  return `/open-source/${entry.slug}`;
}

/** Registry page for one published package name — npm only; a git-distributed
 *  crate has no registry page, so this returns `undefined` rather than a guess. */
export function packageRegistryUrl(entry: OpenSourcePackage, name: string): string | undefined {
  return entry.distribution === 'npm' ? npmPackageUrl(name) : undefined;
}
