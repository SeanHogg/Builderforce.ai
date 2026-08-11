const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref_src)$/i;

export interface CrawlUrlPolicy {
  allowedDomains?: readonly string[];
  blockedDomains?: readonly string[];
}

function domainMatches(host: string, rule: string): boolean {
  const normalized = rule.trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, '');
  return normalized !== '' && (host === normalized || host.endsWith(`.${normalized}`));
}

/** Stable crawl/index identity. Fragments and known tracking parameters are not resources. */
export function normalizeWebUrl(raw: string, base?: string): string {
  const url = base ? new URL(raw, base) : new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs can be crawled.');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.test(key))
    .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  url.search = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, '');
  return url.toString();
}

export function isUrlAllowed(raw: string, policy: CrawlUrlPolicy): boolean {
  let host: string;
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return false; }
  if ((policy.blockedDomains ?? []).some((rule) => domainMatches(host, rule))) return false;
  const allow = policy.allowedDomains ?? [];
  return allow.length === 0 || allow.some((rule) => domainMatches(host, rule));
}

