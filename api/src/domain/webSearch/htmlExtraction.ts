import { normalizeWebUrl } from './urlPolicy';

export interface ExtractedWebDocument {
  canonicalUrl: string; title: string | null; text: string; headings: string[]; language: string | null;
  publicationTimestamp: Date | null; author: string | null; outboundLinks: string[]; metadata: Record<string, unknown>;
}

function decode(value: string): string {
  return value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#(?:39|x27);|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
function plain(value: string): string { return decode(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function attr(tag: string, name: string): string | null {
  return new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1] ?? null;
}
function meta(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if ((attr(tag, 'name') ?? attr(tag, 'property'))?.toLowerCase() === key.toLowerCase()) return attr(tag, 'content');
  }
  return null;
}
function dateOrNull(raw: string | null): Date | null {
  if (!raw) return null; const value = new Date(raw); return Number.isNaN(value.getTime()) ? null : value;
}

export function extractHtmlDocument(html: string, fetchedUrl: string): ExtractedWebDocument {
  const canonicalTag = (html.match(/<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/i) ?? [])[0];
  let canonicalUrl = normalizeWebUrl(attr(canonicalTag ?? '', 'href') ?? fetchedUrl, fetchedUrl);
  if (new URL(canonicalUrl).origin !== new URL(fetchedUrl).origin) canonicalUrl = normalizeWebUrl(fetchedUrl);
  const title = plain(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? meta(html, 'og:title') ?? '') || null;
  const headings = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((m) => plain(m[1] ?? '')).filter(Boolean).slice(0, 100);
  const root = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html)?.[2] ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  const cleaned = root.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|canvas|template|nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  const text = decode(cleaned).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const outbound = new Set<string>();
  for (const tag of html.match(/<a\b[^>]*href\s*=\s*["'][^"']+["'][^>]*>/gi) ?? []) {
    const href = attr(tag, 'href'); if (!href) continue;
    try { outbound.add(normalizeWebUrl(href, fetchedUrl)); } catch { /* non-http link */ }
    if (outbound.size >= 500) break;
  }
  const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0] ?? '';
  const language = attr(htmlTag, 'lang')?.split('-')[0]?.toLowerCase() ?? meta(html, 'content-language');
  const author = meta(html, 'author') ?? meta(html, 'article:author');
  const published = dateOrNull(meta(html, 'article:published_time') ?? meta(html, 'date') ?? meta(html, 'datePublished'));
  const metadata: Record<string, unknown> = { description: meta(html, 'description') ?? meta(html, 'og:description'), sourceType: meta(html, 'og:type') ?? 'web_page' };
  return { canonicalUrl, title, text, headings, language: language ?? null, publicationTimestamp: published, author, outboundLinks: [...outbound], metadata };
}

