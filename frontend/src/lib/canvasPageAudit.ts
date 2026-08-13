/**
 * Accessibility and performance audit of a fetched page, as a Canvas diagnostic.
 *
 * ── WHY THIS IS STATIC, AND WHAT THAT COSTS ──────────────────────────────────────
 * The board can already FETCH a page (`builtin_web_fetch`), and the CI suite already
 * runs axe against the product (`qa-e2e/tests/accessibility-wcag22.spec.ts`). What was
 * missing was a verdict anyone could see next to the thing being built — so this runs
 * over the returned HTML, in the visitor's own browser, with no tenant, no key and no
 * new endpoint. A guest evaluating the product gets a real WCAG verdict on their own
 * site.
 *
 * The cost is stated rather than hidden: a static audit cannot measure contrast,
 * focus order, computed roles, or anything that only exists after script runs. Every
 * rule below is one that is DECIDABLE from source, and the summary says so — an audit
 * that implied it had checked contrast would be worse than no audit.
 *
 * Findings carry a `rule` key and a `detail` map, never a sentence, so the same
 * finding renders in five languages. Same convention as `canvasDataQuality`.
 */

export type AuditCategory = 'accessibility' | 'performance';
/** Ordered weakest → strongest; the index is the weight in the score. */
export const AUDIT_SEVERITIES = ['minor', 'moderate', 'serious', 'critical'] as const;
export type AuditSeverity = typeof AUDIT_SEVERITIES[number];

export interface AuditFinding {
  rule: string;
  category: AuditCategory;
  severity: AuditSeverity;
  /** How many elements tripped this rule. 0 means the rule PASSED. */
  count: number;
  /** WCAG 2.2 success criterion, for the accessibility rules that map to one. */
  wcag?: string;
  /** One offending snippet, trimmed — enough to find it in the source. */
  sample?: string;
  detail?: Record<string, string | number>;
}

export interface PageAudit {
  target: string;
  findings: AuditFinding[];
  /** 0–100, weighted by severity. */
  score: number;
  passed: boolean;
  counts: { checked: number; failed: number; accessibility: number; performance: number };
}

const SEVERITY_WEIGHT: Record<AuditSeverity, number> = { minor: 1, moderate: 3, serious: 7, critical: 12 };

/** Strip comments, `<script>` and `<style>` bodies before counting elements — a
 *  commented-out `<img>` is not a missing alt attribute. */
function strip(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}

function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((match) => match[0]!);
}

function hasAttribute(tag: string, attribute: string): boolean {
  return new RegExp(`\\s${attribute}\\s*=`, 'i').test(tag) || new RegExp(`\\s${attribute}(\\s|>|/)`, 'i').test(tag);
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? (match[2] ?? match[3] ?? match[4] ?? '').trim() : null;
}

/** Element text with markup removed — what a screen reader would announce, near enough. */
function innerText(html: string, openTag: string, name: string): string {
  const start = html.indexOf(openTag);
  if (start === -1) return '';
  const rest = html.slice(start + openTag.length);
  const end = rest.search(new RegExp(`</${name}>`, 'i'));
  return (end === -1 ? rest : rest.slice(0, end)).replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').trim();
}

function finding(
  rule: string,
  category: AuditCategory,
  severity: AuditSeverity,
  count: number,
  extras: Partial<Pick<AuditFinding, 'wcag' | 'sample' | 'detail'>> = {},
): AuditFinding {
  return { rule, category, severity, count, ...extras };
}

/**
 * Audit a page's HTML.
 *
 * `target` is carried through for display only — nothing is fetched here, which is
 * what keeps this pure, guest-safe and unit-testable.
 */
export function auditPageHtml(html: string, target: string): PageAudit {
  const source = strip(html);
  const findings: AuditFinding[] = [];

  // ── Accessibility ────────────────────────────────────────────────────────
  const htmlTag = tags(source, 'html')[0] ?? '';
  const lang = attribute(htmlTag, 'lang');
  findings.push(finding('htmlLang', 'accessibility', 'serious', lang ? 0 : 1, { wcag: '3.1.1' }));

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1]?.trim() ?? '';
  findings.push(finding('documentTitle', 'accessibility', 'serious', title ? 0 : 1, { wcag: '2.4.2' }));

  const images = tags(source, 'img');
  const missingAlt = images.filter((tag) => !hasAttribute(tag, 'alt') && attribute(tag, 'role') !== 'presentation');
  findings.push(finding('imageAlt', 'accessibility', 'serious', missingAlt.length, {
    wcag: '1.1.1',
    detail: { images: images.length },
    ...(missingAlt[0] ? { sample: missingAlt[0].slice(0, 160) } : {}),
  }));

  const links = tags(source, 'a').filter((tag) => hasAttribute(tag, 'href'));
  const namelessLinks = links.filter((tag) => {
    if (attribute(tag, 'aria-label') || attribute(tag, 'title')) return false;
    const text = innerText(source, tag, 'a');
    if (text) return false;
    // A link whose only child is an image is named by that image's alt text.
    const start = source.indexOf(tag);
    const inner = source.slice(start, start + 600);
    const img = tags(inner, 'img')[0];
    return !(img && attribute(img, 'alt'));
  });
  findings.push(finding('linkText', 'accessibility', 'serious', namelessLinks.length, {
    wcag: '2.4.4',
    detail: { links: links.length },
    ...(namelessLinks[0] ? { sample: namelessLinks[0].slice(0, 160) } : {}),
  }));

  const controls = [...tags(source, 'input'), ...tags(source, 'select'), ...tags(source, 'textarea')]
    .filter((tag) => !['hidden', 'submit', 'button', 'reset', 'image'].includes((attribute(tag, 'type') ?? '').toLowerCase()));
  const labelFor = new Set([...source.matchAll(/<label\b[^>]*\sfor\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => (m[2] ?? m[3] ?? '')));
  const unlabelled = controls.filter((tag) => {
    if (attribute(tag, 'aria-label') || attribute(tag, 'aria-labelledby') || attribute(tag, 'title')) return false;
    const id = attribute(tag, 'id');
    return !(id && labelFor.has(id));
  });
  findings.push(finding('formLabel', 'accessibility', 'critical', unlabelled.length, {
    wcag: '3.3.2',
    detail: { controls: controls.length },
    ...(unlabelled[0] ? { sample: unlabelled[0].slice(0, 160) } : {}),
  }));

  const buttons = tags(source, 'button');
  const namelessButtons = buttons.filter((tag) => !attribute(tag, 'aria-label') && !attribute(tag, 'title') && !innerText(source, tag, 'button'));
  findings.push(finding('buttonName', 'accessibility', 'critical', namelessButtons.length, { wcag: '4.1.2' }));

  const headings = [...source.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  const skips = headings.filter((level, index) => index > 0 && level - headings[index - 1]! > 1).length;
  findings.push(finding('headingOrder', 'accessibility', 'moderate', skips, { wcag: '1.3.1', detail: { headings: headings.length } }));
  const h1Count = headings.filter((level) => level === 1).length;
  findings.push(finding('singleH1', 'accessibility', 'moderate', h1Count === 1 ? 0 : 1, { wcag: '1.3.1', detail: { found: h1Count } }));

  const viewportMeta = tags(source, 'meta').find((tag) => (attribute(tag, 'name') ?? '').toLowerCase() === 'viewport');
  const viewportContent = viewportMeta ? (attribute(viewportMeta, 'content') ?? '') : '';
  const zoomBlocked = /user-scalable\s*=\s*no/i.test(viewportContent) || /maximum-scale\s*=\s*1(\.0)?\b/i.test(viewportContent);
  findings.push(finding('zoomDisabled', 'accessibility', 'serious', zoomBlocked ? 1 : 0, { wcag: '1.4.4' }));

  const frames = [...tags(source, 'iframe'), ...tags(source, 'frame')];
  const namelessFrames = frames.filter((tag) => !attribute(tag, 'title') && !attribute(tag, 'aria-label'));
  findings.push(finding('iframeTitle', 'accessibility', 'serious', namelessFrames.length, { wcag: '4.1.2', detail: { frames: frames.length } }));

  const positiveTabindex = [...source.matchAll(/\stabindex\s*=\s*["']?(\d+)/gi)].filter((match) => Number(match[1]) > 0).length;
  findings.push(finding('positiveTabindex', 'accessibility', 'moderate', positiveTabindex, { wcag: '2.4.3' }));

  const landmarks = /<(main|nav|header|footer)\b/i.test(source) || /role\s*=\s*["'](main|navigation|banner|contentinfo)["']/i.test(source);
  findings.push(finding('landmarks', 'accessibility', 'moderate', landmarks ? 0 : 1, { wcag: '1.3.1' }));

  // ── Performance / mobile readiness ───────────────────────────────────────
  const bytes = html.length;
  findings.push(finding('htmlWeight', 'performance', 'moderate', bytes > 150_000 ? 1 : 0, {
    detail: { kb: Math.round(bytes / 1024) },
  }));

  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
  const blocking = [...head.matchAll(/<script\b[^>]*>/gi)]
    .map((match) => match[0]!)
    .filter((tag) => hasAttribute(tag, 'src') && !hasAttribute(tag, 'defer') && !hasAttribute(tag, 'async') && (attribute(tag, 'type') ?? '') !== 'module');
  findings.push(finding('blockingScripts', 'performance', 'serious', blocking.length, {
    ...(blocking[0] ? { sample: blocking[0].slice(0, 160) } : {}),
  }));

  const sizeless = images.filter((tag) => !(hasAttribute(tag, 'width') && hasAttribute(tag, 'height')) && !attribute(tag, 'style')?.includes('aspect-ratio'));
  findings.push(finding('imageDimensions', 'performance', 'moderate', sizeless.length, { detail: { images: images.length } }));

  // The first images are plausibly above the fold; everything after should defer.
  const eager = images.slice(3).filter((tag) => (attribute(tag, 'loading') ?? '') !== 'lazy');
  findings.push(finding('lazyLoading', 'performance', 'minor', eager.length, { detail: { images: images.length } }));

  const inlineStyleBytes = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].reduce((total, match) => total + (match[1]?.length ?? 0), 0);
  findings.push(finding('inlineStyleWeight', 'performance', 'minor', inlineStyleBytes > 40_000 ? 1 : 0, { detail: { kb: Math.round(inlineStyleBytes / 1024) } }));

  findings.push(finding('viewportMeta', 'performance', 'serious', viewportMeta ? 0 : 1));

  const failed = findings.filter((item) => item.count > 0);
  const penalty = failed.reduce((total, item) => total + SEVERITY_WEIGHT[item.severity] * Math.min(item.count, 5), 0);
  const score = Math.max(0, 100 - penalty);
  return {
    target,
    findings,
    score,
    // "Passing" is no serious or critical failure: a page with three lazy-loading
    // hints has not failed an accessibility gate, and saying so devalues the gate.
    passed: !failed.some((item) => item.severity === 'serious' || item.severity === 'critical'),
    counts: {
      checked: findings.length,
      failed: failed.length,
      accessibility: failed.filter((item) => item.category === 'accessibility').length,
      performance: failed.filter((item) => item.category === 'performance').length,
    },
  };
}

/** Read an audit back off a `diagnostics` object, tolerating a hand-edited payload. */
export function readAuditFindings(value: unknown): AuditFinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.rule !== 'string') return [];
    const severity = AUDIT_SEVERITIES.includes(item.severity as AuditSeverity) ? item.severity as AuditSeverity : 'moderate';
    return [{
      rule: item.rule,
      category: item.category === 'performance' ? 'performance' as const : 'accessibility' as const,
      severity,
      count: Number(item.count) || 0,
      ...(typeof item.wcag === 'string' ? { wcag: item.wcag } : {}),
      ...(typeof item.sample === 'string' ? { sample: item.sample } : {}),
      ...(item.detail && typeof item.detail === 'object' ? { detail: item.detail as Record<string, string | number> } : {}),
    }];
  });
}
