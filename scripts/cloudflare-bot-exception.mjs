#!/usr/bin/env node
/**
 * Zone-level bot-mitigation check for the API hostnames.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `api.builderforce.ai/mcp` answers 401 to a laptop and a 403 managed challenge
 * to a GitHub Actions runner. Nothing is wrong with the Worker: Cloudflare bot
 * mitigation scores requests from datacenter ASNs as automated and challenges
 * them at the EDGE, before the request reaches any of our code.
 *
 * That is not a CI inconvenience. Every audience this API has arrives from a
 * datacenter IP:
 *
 *   - remote MCP clients (Anthropic connectors, hosted agents, AWS);
 *   - the VS Code extension's server-side calls;
 *   - every integration that calls `builderforce.ai/gateway/*`.
 *
 * A browser visiting the marketing site passes. Literally every programmatic
 * caller — the entire point of an API — can be challenged. The MCP registry
 * publish step refuses to advertise the endpoint while this is true, which is
 * the correct call: a listing pointing at a URL that answers challenge HTML is
 * worse than no listing.
 *
 * ── THE CAUSES ARE NOT INTERCHANGEABLE ───────────────────────────────────────
 * FOUR different settings emit the same `cf-mitigated:` header and the same
 * 403, and they have DIFFERENT remedies — which is why this reads the zone
 * rather than guessing:
 *
 *   Bot Fight Mode (free plan)
 *     Runs OUTSIDE the Ruleset Engine and takes NO exceptions. Cloudflare's own
 *     docs: "You cannot bypass or skip Bot Fight Mode using WAF custom rules or
 *     Page Rules" — Skip, Bypass and Allow "have no effect". The only remedy is
 *     to turn it OFF. Advice to "add a WAF skip rule" is simply wrong here and
 *     costs an afternoon to disprove.
 *
 *   Super Bot Fight Mode (Pro and above)
 *     Skippable, but NOT by a plain "skip remaining custom rules" rule — the
 *     skip must name the `http_request_sbfm` phase explicitly.
 *
 *   Security Level
 *     Challenges by IP REPUTATION. Datacenter ranges carry threat scores, so
 *     'high' challenges exactly the callers this API is for. Skippable as the
 *     `securityLevel` product.
 *
 *   Browser Integrity Check
 *     Challenges requests whose headers don't look like a browser — which is
 *     every correct API client. Skippable as the `bic` product.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT SKIP ─────────────────────────────────────
 * WAF Managed Rules (`http_request_firewall_managed`) and rate limiting stay
 * ON. The problem is interactive challenges served to legitimate machines, not
 * request inspection: an API hostname should still be protected from injection
 * and abuse. Turning those off is a security decision for a human, not a side
 * effect of unblocking a registry listing.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 *   node scripts/cloudflare-bot-exception.mjs            # read-only; exits 1 if mitigated
 *   node scripts/cloudflare-bot-exception.mjs --apply    # applies the right remedy
 *
 * Needs CLOUDFLARE_API_TOKEN with, on the builderforce.ai zone:
 *   Zone → Zone Settings → Edit   (to read/clear Bot Fight Mode)
 *   Zone → WAF → Edit             (to write the Super Bot Fight Mode skip rule)
 * A Workers-deploy token does NOT carry these; this is a separate, narrower
 * token, and the read-only mode needs only the Read halves of both.
 */
const API = 'https://api.cloudflare.com/client/v4';

const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
const zoneName = process.env.CLOUDFLARE_ZONE_NAME || 'builderforce.ai';
const apply = process.argv.includes('--apply');

/** The hostnames whose callers are machines by definition. */
const PROTECTED = [
  { label: 'api.builderforce.ai', expression: '(http.host eq "api.builderforce.ai")' },
  {
    label: 'builderforce.ai/gateway/*',
    expression: '(http.host eq "builderforce.ai" and starts_with(http.request.uri.path, "/gateway/"))',
  },
];

const SKIP_RULE_DESCRIPTION = 'builderforce: skip bot mitigation for API + MCP + gateway clients';
const SKIP_RULE_EXPRESSION = PROTECTED.map((p) => p.expression).join(' or ');

/** Super Bot Fight Mode is a phase; the reputation/browser checks are products. */
const SKIP_PHASES = ['http_request_sbfm'];
const SKIP_PRODUCTS = ['securityLevel', 'bic', 'uaBlock'];

if (!token) {
  console.error(
    '❌  CLOUDFLARE_API_TOKEN is not set.\n' +
      '   This reads zone security settings, which the Workers deploy token cannot do.\n' +
      '   Create a token scoped to the builderforce.ai zone with Zone Settings + WAF.\n',
  );
  process.exit(2);
}

async function cf(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const detail = (payload.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ');
    throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status} ${detail || '(no detail)'}`);
  }
  return payload.result;
}

const zones = await cf(`/zones?name=${encodeURIComponent(zoneName)}`);
const zone = zones?.[0];
if (!zone) {
  console.error(`❌  No zone named ${zoneName} is visible to this token.`);
  process.exit(2);
}
console.log(`Zone ${zone.name} (${zone.id}) — plan: ${zone.plan?.name ?? 'unknown'}`);

// Some of these are plan-gated; a token that cannot read one should still get a
// verdict on the rest rather than crashing with nothing to show.
async function optional(path, fallback) {
  try {
    return await cf(path);
  } catch (error) {
    console.log(`    (could not read ${path}: ${error.message})`);
    return fallback;
  }
}

const bots = await optional(`/zones/${zone.id}/bot_management`, {});
const securityLevel = (await optional(`/zones/${zone.id}/settings/security_level`, {}))?.value;
const browserCheck = (await optional(`/zones/${zone.id}/settings/browser_check`, {}))?.value;

const fightMode = bots?.fight_mode === true;
// Super Bot Fight Mode grades traffic in three buckets; only the automated ones
// challenge an API client. 'allow' means it is already out of the way.
const sbfm = {
  definitelyAutomated: bots?.sbfm_definitely_automated,
  likelyAutomated: bots?.sbfm_likely_automated,
};
const sbfmMitigating = ['definitelyAutomated', 'likelyAutomated'].filter(
  (key) => sbfm[key] && sbfm[key] !== 'allow',
);
// 'medium' is the default and challenges only genuinely bad reputation; 'high'
// and 'under_attack' reach far enough to catch ordinary datacenter egress.
const reputationChallenging = ['high', 'under_attack'].includes(securityLevel);
const bicOn = browserCheck === 'on';

console.log(
  `Settings — bot fight mode: ${fightMode ? 'ON' : 'off'}` +
    `, SBFM: ${sbfmMitigating.length ? sbfmMitigating.map((k) => `${k}=${sbfm[k]}`).join(', ') : 'not mitigating'}` +
    `, security level: ${securityLevel ?? 'unknown'}` +
    `, browser integrity check: ${browserCheck ?? 'unknown'}`,
);

const skippable = sbfmMitigating.length > 0 || reputationChallenging || bicOn;

if (!fightMode && !skippable) {
  console.log('\n✅  Nothing in the zone is challenging these hostnames:');
  for (const p of PROTECTED) console.log(`      · ${p.label}`);
  console.log(
    '\n    If a datacenter caller is STILL challenged, the cause is outside these' +
      '\n    settings — check WAF managed rules and any Page Rule or firewall rule' +
      "\n    with a challenge action, which this script deliberately does not edit.\n",
  );
  process.exit(0);
}

if (fightMode) {
  console.log('\n⚠️  Bot Fight Mode is ON.');
  console.log('    It runs before WAF custom rules and accepts NO exceptions — a skip rule');
  console.log('    cannot carve out an API hostname. Turning it off is the only remedy on');
  console.log('    this plan.');

  if (!apply) {
    console.log('\n    Re-run with --apply to turn it off, or in the dashboard:');
    console.log('      Security → Bots → Bot Fight Mode → off\n');
    process.exit(1);
  }

  await cf(`/zones/${zone.id}/bot_management`, {
    method: 'PUT',
    body: JSON.stringify({ fight_mode: false }),
  });
  console.log('    → Bot Fight Mode turned OFF.');
}

if (skippable) {
  console.log('\n⚠️  Challenging these hostnames, and skippable by WAF custom rule:');
  for (const key of sbfmMitigating) console.log(`      · Super Bot Fight Mode ${key} = ${sbfm[key]}`);
  if (reputationChallenging) console.log(`      · Security Level = ${securityLevel} (challenges by IP reputation)`);
  if (bicOn) console.log('      · Browser Integrity Check = on (challenges non-browser headers)');
  console.log('    Skippable — but only by a rule naming the phase/products explicitly.');
  console.log('    A generic "skip remaining custom rules" rule does not touch any of them.');

  if (!apply) {
    console.log('\n    Re-run with --apply to write the skip rule:');
    console.log(`      expression: ${SKIP_RULE_EXPRESSION}`);
    console.log(`      action:     skip → phases: ${JSON.stringify(SKIP_PHASES)}`);
    console.log(`                       → products: ${JSON.stringify(SKIP_PRODUCTS)}\n`);
    process.exit(1);
  }

  const rulesets = await cf(`/zones/${zone.id}/rulesets`);
  let custom = rulesets.find(
    (r) => r.phase === 'http_request_firewall_custom' && r.kind === 'zone',
  );
  if (!custom) {
    custom = await cf(`/zones/${zone.id}/rulesets`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Zone custom firewall rules',
        kind: 'zone',
        phase: 'http_request_firewall_custom',
        rules: [],
      }),
    });
  }

  const full = await cf(`/zones/${zone.id}/rulesets/${custom.id}`);
  const existing = (full.rules ?? []).find((r) => r.description === SKIP_RULE_DESCRIPTION);
  const rule = {
    action: 'skip',
    action_parameters: { phases: ['http_request_sbfm'] },
    expression: SKIP_RULE_EXPRESSION,
    description: SKIP_RULE_DESCRIPTION,
    enabled: true,
  };

  // Idempotent by description: re-running updates the one rule rather than
  // stacking a new copy on every invocation.
  if (existing) {
    await cf(`/zones/${zone.id}/rulesets/${custom.id}/rules/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify(rule),
    });
    console.log('    → Skip rule updated in place.');
  } else {
    await cf(`/zones/${zone.id}/rulesets/${custom.id}/rules`, {
      method: 'POST',
      body: JSON.stringify(rule),
    });
    console.log('    → Skip rule created.');
  }
}

console.log(
  '\n✅  Applied. Verify from a datacenter IP — a laptop is the one client that' +
    '\n    passes anyway, so a local curl proves nothing here. Re-running the' +
    '\n    release workflow is the honest test.\n',
);
