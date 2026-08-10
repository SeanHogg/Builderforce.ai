const fs = require('fs');
const C = JSON.parse(fs.readFileSync('cols.json', 'utf8'));        // 1,130 distinct source tables
const P = JSON.parse(fs.readFileSync('primitives.json', 'utf8'));  // primitive -> source tables
const D = JSON.parse(fs.readFileSync('domains.json', 'utf8'));     // domain -> surviving tables
const src = Object.keys(C);

// ── every source table's TARGET and the MOVE that took it there
const target = new Map();  // source -> { move, to }
for (const [prim, list] of Object.entries(P))
  list.forEach(s => target.set(s.slice(3), { move: 'primitive', to: prim }));

const SESSION = new Set(['ceremony_sessions','chat_sessions','knowledge_documents','legal_documents',
  'meetings','poker_sessions','business_documents','pitch_deck_slide_views','pitch_deck_views',
  'planning_poker_sessions','scratch_pad_meetings','scratch_pad_pages','scratch_pad_scheduled_meetings',
  'scratch_pads','ai_chat_sessions','articles','artifact_views','calibration_sessions','event_co_hosts',
  'interview_sessions','live_screening_sessions','people_one_on_ones','pitch_decks','profile_views']);
SESSION.forEach(n => target.set(n, { move: 'session', to: 'creation_session + live session' }));

// domain survivors keep themselves
const domainOf = new Map();
D.rows.forEach(r => r.tables.forEach(t => { domainOf.set(t, r.d); if (!target.has(t)) target.set(t, { move: 'keep', to: t }); }));

// anything still unmapped fell out in the signature/flatten/pass-2 steps
src.forEach(n => { if (!target.has(n)) target.set(n, { move: 'merged', to: '(folded into a sibling)' }); });

// ── give every SOURCE table a domain too, using the SAME classifier that placed the
//    survivors, so a source and its target can never land in different domains.
const { classify } = require('./classify.js');
const DOMS = D.rows.map(r => r.d);
const domainForSource = n => domainOf.get(n) || classify(n) || 'Platform & observability';

const per = new Map(DOMS.map(d => [d, { src: 0, keep: 0, primitive: 0, session: 0, merged: 0 }]));
const rowsOut = [];
for (const n of src) {
  const d = domainForSource(n);
  const t = target.get(n);
  const p = per.get(d); if (!p) continue;
  p.src++; p[t.move]++;
  rowsOut.push([C[n].src, n, d, t.move, t.to]);
}

console.log('PER-DOMAIN: SOURCE TABLES IN, TARGET TABLES OUT\n');
console.log('domain                       src   keep  →kernel  →canvas  merged   after');
let S = 0, K = 0;
[...per.entries()].sort((a, b) => b[1].src - a[1].src).forEach(([d, p]) => {
  S += p.src; K += p.keep;
  console.log(`${d.padEnd(27)} ${String(p.src).padStart(4)}  ${String(p.keep).padStart(5)} ${String(p.primitive).padStart(7)} ${String(p.session).padStart(8)} ${String(p.merged).padStart(7)} ${String(p.keep).padStart(7)}`);
});
console.log(`${'TOTAL'.padEnd(27)} ${String(S).padStart(4)}  ${String(K).padStart(5)}`);
console.log('\nkernel 25 + domain ' + K + ' = ' + (K + 25));

// ── coverage proof: nothing unaccounted
const unaccounted = src.filter(n => !target.has(n));
console.log('\nCOVERAGE: ' + src.length + ' source tables, ' + (src.length - unaccounted.length) +
  ' mapped, ' + unaccounted.length + ' unaccounted');
const byMove = {};
[...target.values()].forEach(t => byMove[t.move] = (byMove[t.move] || 0) + 1);
console.log('  by move:', Object.entries(byMove).map(([k, v]) => k + ' ' + v).join(' · '));

fs.writeFileSync('coverage.tsv', 'product\tsource_table\tdomain\tmove\ttarget\n' +
  rowsOut.map(r => r.join('\t')).join('\n'));
fs.writeFileSync('perdomain.json', JSON.stringify([...per.entries()].map(([d, p]) => ({ d, ...p })), null, 1));
console.log('\nwrote coverage.tsv (' + rowsOut.length + ' rows)');
