import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import type { ReactElement } from 'react';
import type { Components } from 'react-markdown';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { urlAttributes } from 'html-url-attributes';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS, type PluggableList } from './markdownPipeline';

/**
 * The hook-free Markdown → React renderer: the synchronous path of `react-markdown`'s
 * `<Markdown>` (same unified chain, same raw-HTML-as-text rule, same URL hardening,
 * same `toJsxRuntime` options), with nothing that touches React state.
 *
 * ── WHY NOT `<ReactMarkdown>` ────────────────────────────────────────────────
 * `react-markdown@10` imports `useState`/`useEffect` at module top level (for its
 * `MarkdownHooks` export), so importing it at all from a React Server Component —
 * the published tenant site at `/w/[owner]` renders server-side for SEO — fails the
 * production build ("'useState' is not exported from 'react'"). This module runs the
 * SAME pipeline lists from `markdownPipeline.ts`, so a document renders identically
 * on the server and in the browser. `Components` stays react-markdown's type
 * (type-only import, erased at build time).
 */

export type MarkdownComponents = Components;

export interface RenderMarkdownOptions {
  /** remark plugins; defaults to the platform pipeline. */
  remarkPlugins?: PluggableList;
  /** rehype plugins; defaults to the platform pipeline. */
  rehypePlugins?: PluggableList;
  /** Element overrides, exactly as `<ReactMarkdown components>` takes them. */
  components?: MarkdownComponents;
}

const SAFE_PROTOCOL = /^(https?|ircs?|mailto|xmpp)$/i;

/**
 * `react-markdown`'s `defaultUrlTransform`: relative URLs and safe protocols pass,
 * anything else (`javascript:`, `data:`, `vbscript:` …) becomes the empty string.
 * Tenant-authored Markdown is untrusted, so this is load-bearing.
 */
export function safeMarkdownUrl(value: string): string {
  const colon = value.indexOf(':');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  const slash = value.indexOf('/');
  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    SAFE_PROTOCOL.test(value.slice(0, colon))
  ) {
    return value;
  }
  return '';
}

interface HastLike {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastLike[];
}

/** Raw HTML renders as its source text; URL-bearing attributes go through {@link safeMarkdownUrl}. */
function harden(tree: HastLike): void {
  visit(tree as never, (node: HastLike, index: number | undefined, parent: HastLike | undefined) => {
    if (node.type === 'raw' && parent?.children && typeof index === 'number') {
      parent.children[index] = { type: 'text', value: node.value };
      return index;
    }
    if (node.type === 'element' && node.properties) {
      for (const key of Object.keys(urlAttributes)) {
        if (!Object.hasOwn(node.properties, key)) continue;
        const test = urlAttributes[key];
        if (test === null || (node.tagName && test.includes(node.tagName))) {
          node.properties[key] = safeMarkdownUrl(String(node.properties[key] || ''));
        }
      }
    }
    return undefined;
  });
}

/** Markdown source → React elements, synchronously and without hooks (server- and client-safe). */
export function renderMarkdown(content: string, options: RenderMarkdownOptions = {}): ReactElement {
  const processor = unified()
    .use(remarkParse)
    .use(options.remarkPlugins ?? MARKDOWN_REMARK_PLUGINS)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(options.rehypePlugins ?? MARKDOWN_REHYPE_PLUGINS);
  const tree = processor.runSync(processor.parse(content)) as unknown as HastLike;
  harden(tree);
  return toJsxRuntime(tree as never, {
    Fragment,
    components: options.components as never,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
  }) as ReactElement;
}
