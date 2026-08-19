import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('./create-probe.html', 'utf8');
const dom = new JSDOM(html);
const out = dom.serialize();

const tags = (s) => (s.match(/<\/?[a-zA-Z][a-zA-Z0-9-]*/g) || []).map((t) => t.toLowerCase());
const a = tags(html), b = tags(out);
let i = 0;
while (i < a.length && i < b.length && a[i] === b[i]) i++;
if (i === a.length && a.length === b.length) {
  console.log('IDENTICAL tag sequence — the parser moved nothing (', a.length, 'tags )');
} else {
  console.log('DIVERGES at tag index', i, 'of', a.length);
  console.log('server :', a.slice(Math.max(0, i - 12), i + 12).join(' '));
  console.log('parsed :', b.slice(Math.max(0, i - 12), i + 12).join(' '));
  const idx = html.split(/<\/?[a-zA-Z][a-zA-Z0-9-]*/).slice(0, i + 1).join('').length;
  console.log('context:', html.slice(Math.max(0, idx - 300), idx + 300));
}
