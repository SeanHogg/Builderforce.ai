import { describe, it, expect } from 'vitest';
import { redactAuditRow, redactDeep, redactSecrets, redactThenCap } from './redactSecrets';

const tail = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4';

describe('redactSecrets', () => {
  it.each(['ghp', 'gho', 'ghu', 'ghs', 'ghr'])('redacts a %s_ GitHub token in prose', (prefix) => {
    const token = `${prefix}_${tail}`;
    const out = redactSecrets(`cloned with ${token} ok`);
    expect(out).not.toContain(token);
    expect(out).toContain(`${prefix}_`);
  });

  it('redacts GitHub tokens and AWS key ids in a real-looking env dump', () => {
    const aws = 'AKIA' + 'IOSFODNN7EXAMPLE';
    const asia = 'ASIA' + 'IOSFODNN7EXAMPLE';
    const dump = [
      'HOME=/home/agent',
      'SHELL=/bin/bash',
      `GITHUB_TOKEN=gho_${tail}`,
      `AWS_ACCESS_KEY_ID=${aws}`,
      `AWS_SESSION_KEY_ID=${asia}`,
      `note: key ${aws} and temp ${asia} leaked`,
    ].join('\n');
    const out = redactSecrets(dump);
    expect(out).not.toContain(`gho_${tail}`);
    expect(out).not.toContain(aws);
    expect(out).not.toContain(asia);
    expect(out).toContain('HOME=/home/agent');
    expect(out).toContain('SHELL=/bin/bash');
  });

  it('still redacts the existing patterns', () => {
    const bearer = 'eyJhbGciOiJIUzI1NiJ9abcdefghij1234567890';
    expect(redactSecrets(`Authorization: Bearer ${bearer}`)).not.toContain(bearer);
    expect(redactSecrets('{"apiKey":"supersecretvalue123456"}')).not.toContain('supersecretvalue123456');
    expect(redactSecrets('run --token abcdefghijklmnop1234')).not.toContain('abcdefghijklmnop1234');
    expect(redactSecrets('OPENAI_API_KEY=sk-abcdefghij1234567890')).not.toContain('sk-abcdefghij1234567890');
    expect(redactSecrets('npm_abcdefghij1234567890')).not.toContain('npm_abcdefghij1234567890');
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBgkq\nabcd\n-----END RSA PRIVATE KEY-----';
    expect(redactSecrets(pem)).not.toContain('MIIEvQIBADANBgkq');
  });

  it('handles quoted and flag-style forms', () => {
    expect(redactSecrets('tool --token "quotedsecret99"')).not.toContain('quotedsecret99');
    expect(redactSecrets('tool --token=equalsecret99')).not.toContain('equalsecret99');
    expect(redactSecrets('export DB_PASSWORD="pa ss wo rd"')).not.toMatch(/pa ss wo rd/);
    expect(redactSecrets("export DB_PASSWORD='single quoted pw'")).not.toContain('single quoted pw');
    expect(redactSecrets('password=hunter2hunter2')).not.toContain('hunter2hunter2');
  });

  it.each([
    ['a bare JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'],
    ['a Stripe live key', 'sk_live_' + 'abcdefghij1234567890'],
    ['a Stripe restricted key', 'rk_test_' + 'abcdefghij1234567890'],
    ['a Stripe webhook secret', 'whsec_' + 'abcdefghij1234567890'],
    ['a GitLab token', 'glpat-' + 'abcdefghij1234567890'],
    ['a Hugging Face token', 'hf_' + 'abcdefghijABCDEFGHIJ1234567890'],
    ['a SendGrid key', 'SG.' + 'abcdefghijklmnop1234.ABCDEFGHIJKLMNOP5678'],
    ['a Slack rotating token', 'xoxe.' + 'xoxp-1-abcdefghij1234567890'],
  ])('redacts %s', (_label, token) => {
    const out = redactSecrets(`value ${token} end`);
    expect(out).not.toContain(token);
  });

  it('redacts a password embedded in a URL but keeps the host', () => {
    const out = redactSecrets('git clone https://deploy:s3cretPassw0rd@git.example.com/o/r.git');
    expect(out).not.toContain('s3cretPassw0rd');
    expect(out).toContain('git.example.com/o/r.git');
  });

  it('leaves non-secrets intact', () => {
    for (const text of [
      'The quick brown fox jumps over the lazy dog',
      'commit 3f2a9c1 fixed the build',
      'sha deadbeef and 0123abcd',
      'PATH=/usr/local/bin:/usr/bin',
      'github is not ghp or AKIA alone',
      'AKIAshort',
      'ghx_abcdefghijklmnopqrstuvwxyz',
      'primaryKey: id',
      'monkey: banana',
      'const sortKey = 5; // keyboard',
      'see https://example.com/path and user@example.com',
      'hf_ and sk_live short',
      '',
    ]) {
      expect(redactSecrets(text)).toBe(text);
    }
  });
});

describe('redactThenCap', () => {
  it('redacts before cutting, so a token straddling the cap is not left as a fragment', () => {
    const token = 'ghp_' + tail + 'zzzzzzzz';
    const text = `${'x'.repeat(20)} ${token}`;
    const out = redactThenCap(text, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out).not.toContain('ghp_' + tail.slice(0, 10) + tail.slice(10));
    expect(out).not.toContain(tail);
  });
});

describe('redactDeep', () => {
  it('redacts string leaves, keeps non-strings, and masks secret-named keys', () => {
    const ghp = 'ghp_' + tail;
    const out = redactDeep({ n: 1, ok: true, nested: { password: 'plainvalue', list: [`tok ${ghp}`, 2] }, none: null });
    expect(out.n).toBe(1);
    expect(out.ok).toBe(true);
    expect(out.none).toBeNull();
    expect(out.nested.password).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain(ghp);
    expect(out.nested.list[1]).toBe(2);
  });

  it('redacts an Error and its cause, and survives a cycle', () => {
    const ghp = 'ghp_' + tail;
    const err = new Error(`failed with ${ghp}`, { cause: new Error(`inner ${ghp}`) });
    const a: Record<string, unknown> = { err };
    a.self = a;
    const out = JSON.stringify(redactDeep(a));
    expect(out).not.toContain(ghp);
    expect(out).toContain('[CIRCULAR]');
  });
});

describe('redactAuditRow', () => {
  it('keeps args valid JSON and removes quoted, escaped and nested secrets', () => {
    const args = JSON.stringify({
      command: 'tool --token "quotedsecret99" && export DB_PASSWORD="pa ss wo rd"',
      escaped: 'say "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123"',
      env: { password: 'nestedpassword1', ok: 'fine' },
    });
    const row = redactAuditRow({ args, result: 'plain', toolName: 'x' });
    const parsed = JSON.parse(row.args as string);
    const text = JSON.stringify(parsed);
    for (const secret of ['quotedsecret99', 'pa ss wo rd', 'abcdefghijklmnopqrstuvwxyz0123', 'nestedpassword1']) {
      expect(text).not.toContain(secret);
    }
    expect(parsed.env.ok).toBe('fine');
    expect(row.result).toBe('plain');
    expect(row.toolName).toBe('x');
  });

  it('leaves a clean JSON args blob byte-identical, and redacts a JSON result structurally', () => {
    const clean = '{"a": 1,  "b": "two"}';
    expect(redactAuditRow({ args: clean }).args).toBe(clean);
    const row = redactAuditRow({ result: JSON.stringify({ token: 'abcdefghijklmnopqrstuvwxyz' }) });
    expect(JSON.parse(row.result as string)).toEqual({ token: '[REDACTED]' });
  });

  it('redacts non-JSON text and passes null through', () => {
    const row = redactAuditRow({ args: null, result: 'GITHUB_TOKEN=ghp_' + tail });
    expect(row.args).toBeNull();
    expect(row.result).not.toContain(tail);
  });
});

describe('Authorization headers, URLs and key names', () => {
  it.each([
    ['Basic', 'Authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ1Ng=='],
    ['token', 'Authorization: token ghx0123456789abcdef0123456789abcdef'],
    ['Bearer', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123'],
  ])('redacts an Authorization %s credential', (_scheme, header) => {
    const credential = header.split(' ').at(-1)!;
    const out = redactSecrets(header);
    expect(out).not.toContain(credential);
    expect(out.startsWith('Authorization:')).toBe(true);
  });

  it('redacts a URL password with an EMPTY username (redis://:pw@host)', () => {
    const out = redactSecrets('REDIS=redis://:hunter2hunter2@cache.internal:6379/0 and amqp://:otherpw99@mq');
    expect(out).not.toContain('hunter2hunter2');
    expect(out).not.toContain('otherpw99');
    expect(out).toContain('cache.internal:6379/0');
  });

  it('redacts aws_secret_access_key in every casing', () => {
    expect(redactSecrets('aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).not.toContain('wJalrXUtnFEMI');
    expect(redactSecrets('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).not.toContain('wJalrXUtnFEMI');
  });

  it('masks assignments and URL passwords completely, but keeps prefix+suffix for a known provider token', () => {
    expect(redactSecrets('DB_PASSWORD=abcdefghijklmnopqrstuvwxyz')).toBe('DB_PASSWORD=***');
    expect(redactSecrets('postgres://u:abcdefghijklmnopqrstuvwxyz@db/x')).toBe('postgres://u:***@db/x');
    expect(redactSecrets('token ghp_' + tail)).toContain('ghp_');
  });

  it('never lets a "$&" in a secret act as a replacement pattern', () => {
    const out = redactSecrets('DB_PASSWORD="a$&b$1c"');
    expect(out).toBe('DB_PASSWORD="***"');
  });
});

describe('does not redact look-alikes', () => {
  it('leaves git SHAs, UUIDs, base64 blobs and numbers alone', () => {
    for (const text of [
      'commit 3f2a9c1d5e7b8a0c4d6e8f0a1b2c3d4e5f607182',
      '123e4567-e89b-12d3-a456-426614174000',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'build 20261108 took 123456 ms at 12:34:56',
      'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    ]) {
      expect(redactSecrets(text)).toBe(text);
    }
  });
});

describe('redactDeep keys and structure', () => {
  it.each(['SecretAccessKey', 'SessionToken', 'db_secret', 'github_token', 'DB_PASSWORD', 'userPassword', 'api_key', 'apiKey', 'private_key', 'credentials', 'Authorization'])(
    'masks the value under %s, whatever its type', (key) => {
      const out = redactDeep({ [key]: { nested: 'x', n: 5 }, other: 'visible' }) as Record<string, unknown>;
      expect(out[key]).toBe('[REDACTED]');
      expect(out.other).toBe('visible');
      const numeric = redactDeep({ [key]: 12345 }) as Record<string, unknown>;
      expect(numeric[key]).toBe('[REDACTED]');
    });

  it('does not mask counters and ordinary keys', () => {
    const value = { maxTokens: 10, inputTokens: 5, sessionKey: 'exec:5', sortKey: 'a', keyboard: 'k' };
    expect(redactDeep(value)).toEqual(value);
  });

  it('reports only a true cycle, not a node shared by two siblings', () => {
    const shared = { note: 'same object' };
    const out = redactDeep({ a: shared, b: shared, list: [shared, shared] }) as { a: unknown; b: unknown; list: unknown[] };
    expect(out.a).toEqual({ note: 'same object' });
    expect(out.b).toEqual({ note: 'same object' });
    expect(out.list).toEqual([{ note: 'same object' }, { note: 'same object' }]);
  });

  it('keeps an Error\'s own properties (redacted) and turns Maps and Sets into entries', () => {
    const err = Object.assign(new Error('boom'), { code: 'E_FAIL', status: 502, apiKey: 'sk-abcdefghij1234567890' });
    const out = redactDeep({ err, map: new Map([['password', 'hunter2hunter2'], ['host', 'db']]), set: new Set(['ghp_' + tail]) }) as Record<string, any>;
    expect(out.err.code).toBe('E_FAIL');
    expect(out.err.status).toBe(502);
    expect(out.err.apiKey).toBe('[REDACTED]');
    expect(out.map).toEqual([['password', '[REDACTED]'], ['host', 'db']]);
    expect(JSON.stringify(out.set)).not.toContain(tail);
  });

  it('honours size limits after redacting', () => {
    const out = redactDeep({ text: 'x'.repeat(50), list: [1, 2, 3, 4] }, { maxString: 10, maxEntries: 2 }) as { text: string; list: number[] };
    expect(out.text).toBe('xxxxxxxxxx…[truncated]');
    expect(out.list).toEqual([1, 2]);
  });
});
