import { describe, expect, it } from 'vitest';
import { createMemoryVerdictCache, scanSubjects, scanText } from './engine.js';
import { SCAN_PROFILES } from './profiles.js';
import { BEHAVIOR_RULES } from './rules/behaviorRules.js';
import { OBFUSCATION_RULES } from './rules/obfuscationRules.js';
import { SAST_RULES } from './rules/sastRules.js';
import { SECRET_RULES } from './rules/secretRules.js';
import { SIGNATURE_RULES } from './signatures.js';
import { toSarif } from './sarif.js';

const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!', '$H+H*'].join('');
const hexIdentifiers = (n: number): string => Array.from({ length: n }, (_, i) => `_0x${i.toString(16).padStart(4, '0')}`).join(' ');

/** [rule id, text that fires it, near-miss that must stay quiet] */
const CASES: readonly (readonly [string, string, string])[] = [
  ['secret.private-key', '-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN PUBLIC KEY-----'],
  ['secret.aws-access-key', `key = "AKIA${'A'.repeat(16)}"`, 'key = "AKIA123"'],
  ['secret.github-token', `ghp_${'a'.repeat(36)}`, 'ghp_short'],
  ['secret.slack-token', 'xoxb-1234567890ab', 'xoxb-1'],
  ['secret.provider-api-key', `sk_live_${'a'.repeat(24)}`, 'sk_live_abc'],
  ['secret.hardcoded-credential', 'password = "abcdefghijkl1"', 'password = "short"'],
  ['sast.eval', 'eval(x)', 'retrieval(x)'],
  ['sast.shell-injection', 'exec(`ls ${dir}`)', 'exec("ls")'],
  ['sast.sql-concat', 'query(`SELECT * FROM t WHERE a=${x}`)', 'query("SELECT 1")'],
  ['sast.tls-verification-disabled', 'rejectUnauthorized: false', 'rejectUnauthorized: true'],
  ['sast.unsafe-html', 'el.innerHTML = x', 'el.textContent = x'],
  ['sast.weak-hash', "createHash('md5')", "createHash('sha256')"],
  ['dangerous-exec', "const cp = require('child_process'); cp.exec('ls')", "cp.exec('ls')"],
  ['dynamic-code-execution', 'new Function("return 1")', 'x.evaluate(1)'],
  ['crypto-mining', 'pool = "stratum+tcp://pool.example:3333"', 'stratum pool'],
  ['suspicious-network', 'new WebSocket("ws://h.example:9999/x")', 'new WebSocket("wss://h.example:443/x")'],
  ['potential-exfiltration', 'fs.readFileSync(p); fetch(u)', 'fs.readFileSync(p)'],
  ['env-harvesting', 'const k = process.env.K; fetch(u)', 'const k = process.env.K'],
  ['behavior.reverse-shell', "bash -c 'exec 5<>/dev/tcp/10.0.0.1/80'", 'echo hello'],
  ['behavior.credential-file', "readFile('~/.aws/credentials')", "readFile('~/.config/app')"],
  ['behavior.persistence', "fs.appendFileSync(home + '/.bashrc', x)", 'fs.appendFileSync(logPath, x)'],
  ['behavior.keylogger', "addEventListener('keydown', (e) => fetch('/k', { body: e.key }))", "addEventListener('keydown', (e) => handle(e))"],
  ['behavior.exfil-endpoint', "fetch('https://discord.com/api/webhooks/1/x')", "fetch('https://example.com/api')"],
  ['obfuscated-code', `"${'\\x41'.repeat(6)}"`, `"${'\\x41'.repeat(2)}"`],
  ['obfuscated-code', `atob("${'A'.repeat(200)}")`, 'atob("AAAA")'],
  ['obfuscation.eval-decode', 'eval(atob(s))', 'eval(s)'],
  ['obfuscation.charcode-chain', `String.fromCharCode(${Array(12).fill(65).join(',')})`, 'String.fromCharCode(65,66,67)'],
  ['obfuscation.hex-identifiers', hexIdentifiers(20), hexIdentifiers(3)],
  ['signature.eicar', EICAR, 'X5O!P%@AP'],
];

const fires = (id: string, text: string): boolean =>
  scanText({ path: 'src/app.ts', content: text }, 'visualizer').some((f) => f.ruleId === id);

describe('rules', () => {
  it.each(CASES)('%s fires on a sample and stays quiet on a near-miss', (id, sample, nearMiss) => {
    expect(fires(id, sample)).toBe(true);
    expect(fires(id, nearMiss)).toBe(false);
  });

  it('has a case for every rule id', () => {
    const covered = new Set(CASES.map(([id]) => id));
    for (const rule of [...SECRET_RULES, ...SAST_RULES, ...BEHAVIOR_RULES, ...OBFUSCATION_RULES, ...SIGNATURE_RULES]) {
      expect(covered.has(rule.id), rule.id).toBe(true);
    }
  });

  it('never copies the matched secret into a finding', () => {
    const secret = `ghp_${'q'.repeat(36)}`;
    const json = JSON.stringify(scanText({ path: 'a.ts', content: `const t = "${secret}"` }, 'runtime'));
    expect(json).toContain('secret.github-token');
    expect(json).not.toContain(secret);
  });

  it('reports a secret on every line of a minified one-liner but skips SAST there', () => {
    const findings = scanText({ path: 'dist/app.min.js', content: `eval(1);var t="ghp_${'z'.repeat(36)}"` }, 'visualizer');
    expect(findings.map((f) => f.ruleId)).toContain('secret.github-token');
    expect(findings.map((f) => f.ruleId)).not.toContain('sast.eval');
  });

  it('skips SAST rules in test paths and downgrades generic credentials there', () => {
    expect(scanText({ path: 'src/a.test.ts', content: 'eval(x)' }, 'pr-diff')).toEqual([]);
    const [f] = scanText({ path: 'tests/a.ts', content: 'password = "abcdefghijkl1"' }, 'pr-diff');
    expect(f?.severity).toBe('MEDIUM');
  });

  it('limits a call to the requested categories', () => {
    const findings = scanText({ path: 'a.ts', content: 'eval(x); const k = "AKIAAAAAAAAAAAAAAAAA"' }, 'pr-diff', ['secret']);
    expect(findings.every((f) => f.category === 'secret')).toBe(true);
  });

  it('runs every rule against an adversarial 2000-character line in under 50 ms', () => {
    const inputs = ['a'.repeat(2000), '\\x'.repeat(1000), '_0x'.repeat(660), "'".repeat(2000), '(,'.repeat(1000)];
    for (const profile of Object.values(SCAN_PROFILES)) {
      for (const rule of profile.ruleSets.flat()) {
        for (const input of inputs) {
          const start = performance.now();
          rule.pattern.exec(input);
          expect(performance.now() - start, `${rule.id} on ${input.slice(0, 6)}`).toBeLessThan(50);
        }
      }
    }
  });
});

describe('scanSubjects', () => {
  it('blocks the EICAR string and the EICAR file hash', async () => {
    const report = await scanSubjects([{ path: 'a.txt', content: EICAR }, { path: 'b.bin', content: new TextEncoder().encode(EICAR) }], { profile: 'runtime' });
    expect(report.action).toBe('block');
    expect(report.files.every((f) => f.action === 'block')).toBe(true);
    expect(report.files[1]!.findings[0]!.ruleId).toBe('signature.known-bad-hash');
  });

  it('reports a too-large file as incomplete, never clean', async () => {
    const report = await scanSubjects([{ path: 'a.js', content: 'a'.repeat(20) }], { profile: 'runtime', maxFileBytes: 10 });
    expect(report.complete).toBe(false);
    expect(report.files[0]).toMatchObject({ complete: false, incompleteReason: 'too-large', action: 'review' });
  });

  it('reports an unsupported binary as incomplete but an image as scanned', async () => {
    const report = await scanSubjects([
      { path: 'x.bin', content: new Uint8Array([0, 1, 2]) },
      { path: 'logo.png', content: new Uint8Array([0, 1, 2]) },
    ], { profile: 'runtime' });
    expect(report.files[0]).toMatchObject({ complete: false, incompleteReason: 'binary-unsupported' });
    expect(report.files[1]).toMatchObject({ complete: true, action: 'allow' });
  });

  it('marks files incomplete once the deadline has passed or the signal aborted', async () => {
    const late = await scanSubjects([{ path: 'a.js', content: '1' }], { profile: 'runtime', deadlineMs: -1 });
    expect(late.files[0]).toMatchObject({ complete: false, incompleteReason: 'deadline' });
    const controller = new AbortController();
    controller.abort();
    const aborted = await scanSubjects([{ path: 'a.js', content: '1' }], { profile: 'runtime', signal: controller.signal });
    expect(aborted.complete).toBe(false);
  });

  it('caches a verdict by content hash, only for the same path', async () => {
    const cache = createMemoryVerdictCache(2);
    const subject = { path: 'a.js', content: 'const x = 1;' };
    const first = await scanSubjects([subject], { profile: 'runtime', cache });
    const second = await scanSubjects([subject], { profile: 'runtime', cache });
    expect(second.files[0]).toBe(first.files[0]);
    const moved = await scanSubjects([{ ...subject, path: 'b.js' }], { profile: 'runtime', cache });
    expect(moved.files[0]).not.toBe(first.files[0]);
  });

  it('emits a SARIF log with a result per finding and the incomplete files listed', async () => {
    const report = await scanSubjects([{ path: 'a.js', content: 'eval(x); fetch(u); process.env.K' }, { path: 'x.bin', content: new Uint8Array([0]) }], { profile: 'runtime' });
    const run = toSarif(report).runs[0]!;
    expect(run.results.map((r) => r.ruleId)).toContain('env-harvesting');
    expect((run.properties?.incompleteFiles as unknown[]).length).toBe(1);
  });
});
