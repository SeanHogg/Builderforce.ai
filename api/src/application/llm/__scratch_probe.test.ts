import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { scoreEnglishWordiness, detectLatinLanguage } from './wordLexicon';

const P = 'Summarize the current status of the project.';
// Deliberately the RISKIEST legitimate class: short, proper-noun-heavy, jargon-dense.
const LEGIT: Array<[string, string]> = [
  ['Kubernetes autoscaling was tuned, Grafana dashboards rebuilt, and Datadog alerts rewired to PagerDuty.', P],
  ['Sentry flagged a regression in the Stripe webhook handler, so Kafka replay was paused overnight.', P],
  ['We migrated Postgres to Aurora, swapped Redis for Valkey, and benchmarked Clickhouse ingestion.', P],
  ['Terraform modules were refactored, Vault secrets rotated, and Istio sidecars upgraded cluster-wide.', P],
  ['The Evermind coordinator quarantined v813 because the merged neocortex head regressed.', P],
  ['Onboarding funnel telemetry now lands in Snowflake, and dbt models power the retention cohorts.', P],
  ['Shipped multi-tenant RBAC, deprecated the legacy SAML bridge, and hardened the OAuth callback.', P],
  ['Refactored the tokenizer, retrained embeddings, and cut p99 latency on the inference path.', P],
  ['Braintree checkout replaced Adyen, and the Twilio verification flow was localized for Brazil.', P],
  ['Anthropic and OpenAI vendors were added behind the proxy, with per-tenant quota accounting.', P],
];
const GIB: Array<[string, string]> = [
  ['ss author dollation section code exostolated so the PRD date and the ticketionsode authatP moffat section', 'Summarize the current status of the project.'],
  ['s sopactuth sar the sed then doas Requirements so the PRD so the BA requirements socken repo and theuthor the', 'What has the team been working on recently?'],
  ['s codecPRD bAnd APReus and the coded tocket dole ticket so the Requirements repo code toolete so', 'List the main things left to do.'],
];

function measure(text: string, prompt: string) {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const raw = text.split(/\s+/u);
  const cores = raw.map((r) => r.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, '').toLowerCase().replace(/['’-]/gu, ''));
  const s = scoreEnglishWordiness(cores.filter(Boolean), raw.filter((_, i) => !!cores[i]), prompt);
  return { lang: detectLatinLanguage(words, text).language, eligible: s.eligible, unknown: s.unknown, share: +(s.eligible ? s.unknown / s.eligible : 0).toFixed(3), text: text.slice(0, 45) };
}

describe('scratch', () => {
  it('measures', () => {
    const rows = [...LEGIT.map(([t, p]) => ({ k: 'LEGIT', ...measure(t, p) })), ...GIB.map(([t, p]) => ({ k: 'GIB', ...measure(t, p) }))];
    rows.sort((a, b) => b.share - a.share);
    writeFileSync('scratch-probe.json', JSON.stringify(rows, null, 1));
    expect(rows.length).toBe(13);
  });
});
