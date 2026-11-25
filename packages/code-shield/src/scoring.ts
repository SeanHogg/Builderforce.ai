import type { ScanAction, ScanFinding, ThreatCategory } from './types.js';

/**
 * Categories that are more alarming together than apart (reading credentials is normal; reading them
 * AND sending data out is not). UNCALIBRATED: chosen by judgement, to be tuned against real benign and
 * malicious samples.
 */
export const CATEGORY_CORRELATIONS: readonly { readonly categories: readonly [ThreatCategory, ThreatCategory]; readonly bonus: number }[] = [
  { categories: ['credential-access', 'exfiltration'], bonus: 25 },
  { categories: ['obfuscation', 'remote-shell'], bonus: 15 },
  { categories: ['supply-chain', 'exfiltration'], bonus: 20 },
  { categories: ['obfuscation', 'exfiltration'], bonus: 10 },
  { categories: ['keylogging', 'exfiltration'], bonus: 15 },
];

/** Highest threshold first. UNCALIBRATED: an engineering starting point, not an industry-standard scale. */
export const ACTION_THRESHOLDS = [[80, 'block'], [60, 'quarantine'], [40, 'review'], [20, 'log'], [0, 'allow']] as const;

/** Ascending severity, for taking the worst action across files. */
export const ACTION_ORDER: readonly ScanAction[] = ['allow', 'log', 'review', 'quarantine', 'block'];

export const worstAction = (a: ScanAction, b: ScanAction): ScanAction => (ACTION_ORDER.indexOf(a) >= ACTION_ORDER.indexOf(b) ? a : b);

/** Sum of each distinct rule's weight plus the correlation bonuses, clamped to 0..100. */
export function riskScore(findings: readonly ScanFinding[]): number {
  const weights = new Map<string, number>();
  const categories = new Set<ThreatCategory>();
  for (const f of findings) {
    const key = `${f.ruleId ?? ''}::${f.title}`;
    weights.set(key, Math.max(weights.get(key) ?? 0, f.weight));
    categories.add(f.category);
  }
  let score = 0;
  for (const w of weights.values()) score += w;
  for (const { categories: [a, b], bonus } of CATEGORY_CORRELATIONS) {
    if (categories.has(a) && categories.has(b)) score += bonus;
  }
  return Math.round(Math.min(100, Math.max(0, score)));
}

/** A confirmed malware signature blocks regardless of score. */
export function actionFor(score: number, findings: readonly ScanFinding[]): ScanAction {
  if (findings.some((f) => f.category === 'malware-signature')) return 'block';
  return ACTION_THRESHOLDS.find(([min]) => score >= min)![1];
}
