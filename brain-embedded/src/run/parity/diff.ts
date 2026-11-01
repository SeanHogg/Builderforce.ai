/**
 * Name every place two records differ, as `path: loop=<..> agent=<..>` lines. A parity failure should read as the
 * list of differences, not as a 4,000-line object diff: the list is what the burn-down works from.
 */

const clip = (v: unknown): string => {
  const s = typeof v === 'string' ? JSON.stringify(v) : (JSON.stringify(v) ?? 'undefined');
  return s.length > 200 ? `${s.slice(0, 200)}... (${s.length} chars)` : s;
};

/** Where two long strings first part, so a changed prompt is found without reading either. */
function stringDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const around = (s: string): string => JSON.stringify(s.slice(Math.max(0, i - 40), i + 80));
  return `differs at char ${i} of ${a.length}/${b.length}: a=${around(a)} b=${around(b)}`;
}

export function diffRecords(a: unknown, b: unknown, labels: [string, string] = ['loop', 'agent'], path = '$', out: string[] = []): string[] {
  if (out.length >= 80) return out;
  const [la, lb] = labels;
  if (typeof a === 'string' && typeof b === 'string') {
    if (a !== b) out.push(`${path}: ${a.length > 200 || b.length > 200 ? stringDiff(a, b) : `${la}=${clip(a)} ${lb}=${clip(b)}`}`);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: length ${la}=${a.length} ${lb}=${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) diffRecords(a[i], b[i], labels, `${path}[${i}]`, out);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const x = (a as Record<string, unknown>)[k];
      const y = (b as Record<string, unknown>)[k];
      if (!(k in a)) out.push(`${path}.${k}: only on ${lb}: ${clip(y)}`);
      else if (!(k in b)) out.push(`${path}.${k}: only on ${la}: ${clip(x)}`);
      else diffRecords(x, y, labels, `${path}.${k}`, out);
    }
    return out;
  }
  if (a !== b) out.push(`${path}: ${la}=${clip(a)} ${lb}=${clip(b)}`);
  return out;
}
