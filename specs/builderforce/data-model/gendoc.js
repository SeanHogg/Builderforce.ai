const fs = require('fs');
const D = JSON.parse(fs.readFileSync('domains.json', 'utf8'));
const per = JSON.parse(fs.readFileSync('perdomain.json', 'utf8'));
const C = JSON.parse(fs.readFileSync('cols.json', 'utf8'));
const cov = fs.readFileSync('coverage.tsv', 'utf8').trim().split('\n').slice(1).map(l => l.split('\t'));

const ROOT = {
  'Growth & marketing': 'campaign', 'Delivery & work': 'work_item', 'Agents & runtime': 'agent',
  'Finance': 'ledger_entry', 'Hiring': 'job_posting', 'Revenue & CRM': 'deal',
  'Identity & tenancy': 'party', 'People & HR': 'employment', 'Commerce': 'listing',
  'Investor & portfolio': 'company', 'Platform & observability': 'signal',
  'Governance & security': 'control', 'Support & knowledge': 'ticket',
  'Canvas & ideas': 'creation_session', 'Integrations': 'connection',
};
const perBy = Object.fromEntries(per.map(p => [p.d, p]));
const BOILER = new Set(['id','created_at','updated_at','deleted_at','created_by','updated_by',
  'tenant_id','account_id','segment_id','company_id','archived_at','is_active','is_archived']);
const cols = n => (C[n] ? C[n].cols : []).filter(c => !BOILER.has(c));

// per-domain flatten candidates that REMAIN (the residual moves, measured earlier)
function remaining(tables) {
  const r = { lookup: [], derived: [], thin: [], facet: [], kind: [] };
  const byTail = new Map();
  for (const n of tables) {
    const p = cols(n);
    if (/_(types?|kinds?|categories|statuses|tiers?|levels?|stages?|reasons?|sources?|dimensions?|norms?)$/.test(n) && p.length <= 6) { r.lookup.push(n); continue; }
    if (/(cost|costs|value|velocity|capacity|rate|rates|roi|ltv|cac|burn|attainment|projection|projections|payback|churn|quarterly|daily|performance)$/.test(n)) { r.derived.push(n); continue; }
    if (p.length <= 3) { r.thin.push(n); continue; }
    if (/_(billing|crm|marketing|product|support|profile|profiles|details|meta|settings|config|configs|preferences|state|summary|info|branding|policy|policies)$/.test(n)) { r.facet.push(n); continue; }
    const t = n.split('_').pop();
    if (!byTail.has(t)) byTail.set(t, []); byTail.get(t).push(n);
  }
  for (const [t, g] of byTail) {
    if (g.length < 2) continue;
    const sets = g.map(n => new Set(cols(n)));
    const shared = [...sets[0]].filter(c => sets.every(s => s.has(c)));
    if (shared.length >= 3) r.kind.push({ t, g, shared });
  }
  return r;
}

let md = '';
D.rows.forEach(row => {
  const p = perBy[row.d] || { src: row.n, primitive: 0, session: 0, merged: 0 };
  const rem = remaining(row.tables);
  md += `\n### ${row.d} — owned by ${row.owner === 'the platform' ? '**the platform**' : `the **${row.owner}**`}\n\n`;
  md += `Root entity \`${ROOT[row.d]}\`. **${p.src} source tables in → ${row.n} out** `;
  md += `(${p.primitive} absorbed by the kernel, ${p.session} by the canvas, ${p.merged} merged into a sibling). `;
  md += `Contributed by Builderforce ${row.by.BF} · hired.video ${row.by.HV} · BurnRateOS ${row.by.BR}.\n\n`;
  const bits = [];
  if (rem.facet.length) bits.push(`**Facet → columns on \`${ROOT[row.d]}\`** (${rem.facet.length}): \`${rem.facet.join('`, `')}\``);
  rem.kind.forEach(k => bits.push(`**Kind-split → one \`${k.t}\` with a kind**: \`${k.g.join('` = `')}\` — shared: ${k.shared.slice(0,6).join(', ')}`));
  if (rem.derived.length) bits.push(`**Derived → \`metric_fact\`** (${rem.derived.length}): \`${rem.derived.join('`, `')}\``);
  if (rem.thin.length) bits.push(`**Thin → a column, array or JSONB key** (${rem.thin.length}): \`${rem.thin.join('`, `')}\``);
  if (rem.lookup.length) bits.push(`**Lookup → an enum + CHECK** (${rem.lookup.length}): \`${rem.lookup.join('`, `')}\``);
  if (bits.length) {
    md += 'Flattening still to apply:\n\n' + bits.map(b => '- ' + b).join('\n') + '\n';
  } else {
    md += '_No flattening left: every table here is a distinct noun with its own columns._\n';
  }
});
fs.writeFileSync('domains.md', md);
console.log('wrote domains.md,', md.split('\n').length, 'lines');

// the coverage map, as a committed TSV
fs.writeFileSync('source-to-target.tsv', fs.readFileSync('coverage.tsv', 'utf8'));
console.log('coverage rows:', cov.length);
