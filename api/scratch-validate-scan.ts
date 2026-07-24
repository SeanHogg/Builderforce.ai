/* Real end-to-end validation of the web scanner — no mocks, real HTTP. */
import { scanWebTarget } from './src/application/security/WebSecurityScanner';

const targets = process.argv.slice(2);
if (targets.length === 0) targets.push('http://neverssl.com', 'https://example.com', 'https://github.com');

for (const t of targets) {
  try {
    const r = await scanWebTarget(t);
    console.log(`\n=== ${t}  →  ${r.finalUrl}`);
    console.log(`SCORE: ${r.score}/100   findings: ${r.findings.length}   server: ${r.server ?? '(hidden)'}`);
    for (const f of r.findings) {
      console.log(`  [${f.severity.toUpperCase().padEnd(8)}] ${f.checkId.padEnd(26)} ${f.title}`);
    }
  } catch (e) {
    console.log(`\n=== ${t}  →  ERROR: ${(e as Error).message}`);
  }
}
