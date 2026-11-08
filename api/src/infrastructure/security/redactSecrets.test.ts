import { describe, it, expect } from 'vitest';
import { DEFAULT_SECRET_PATTERNS, findSecretShapes, redactText } from '@builderforce/secret-redaction';
import { isSecretKey, maskTail, redactAuditRow, redactDeep, redactJsonText, redactSecrets, redactThenCap } from './redactSecrets';

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
    const bearer = 'eyJhbGciOiJIUzI1NiJ9' + 'abcdefghij1234567890';
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

describe('regression: M4 text redaction over JSON text', () => {
  it('regression: an escaped-quoted ENV value in JSON text is redacted and the JSON stays valid', () => {
    const text = JSON.stringify({ cmd: 'API_TOKEN="xyz123secret" run' });
    const out = redactJsonText(text);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toContain('xyz123secret');
    expect(JSON.parse(out).cmd).toContain('run');
  });

  it('regression: a multi-word escaped-quoted value (DB_PASSWORD=\\"a b c\\") is fully removed', () => {
    const out = redactJsonText(JSON.stringify({ cmd: 'DB_PASSWORD="a b c" deploy' }));
    expect(out).not.toContain('a b c');
    expect(JSON.parse(out).cmd).toContain('deploy');
  });

  it('regression: plain-text redaction of JSON text no longer captures a lone backslash (secret gone, JSON still parses)', () => {
    for (const [blob, secret] of [['{"cmd":"API_TOKEN=\\"xyz123secret\\" run"}', 'xyz123secret'], ['{"cmd":"DB_PASSWORD=\\"a b c\\" run"}', 'a b c']] as const) {
      const out = redactSecrets(blob);
      expect(out).not.toContain(secret);
      expect(() => JSON.parse(out)).not.toThrow();
    }
  });

  it('regression: redactThenCap and redactDeep treat a JSON string (a `result` / `payload` column) structurally', () => {
    const json = JSON.stringify({ ok: 'fine', cmd: 'API_TOKEN="xyz123secret" run' });
    expect(redactThenCap(json, 10_000)).not.toContain('xyz123secret');
    expect(() => JSON.parse(redactThenCap(json, 10_000))).not.toThrow();
    const deep = redactDeep({ execution: { payload: json } });
    expect(deep.execution.payload).not.toContain('xyz123secret');
    expect(() => JSON.parse(deep.execution.payload)).not.toThrow();
  });
});

describe('regression: M6 missed spellings', () => {
  it('regression: snake_case JSON keys inside text (access_token, refresh_token, client_secret) are redacted', () => {
    const blob = '{"access_token":"ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxx","refresh_token":"1//0gabcdefghijklmnop","client_secret":"GOCSPX-abcdefghijklmnopqrstuvwxyz1"}';
    const out = redactSecrets(blob);
    for (const secret of ['ya29.a0AfH6SMB', '1//0gabcdefghijklmnop', 'GOCSPX-abcdefghijklmnop']) expect(out).not.toContain(secret);
  });

  it.each(['refresh_token=abcdefgh12345678', 'id_token=abcdefgh12345678', 'auth_token=abcdefgh12345678', 'export github_token=abcdefgh12345678', 'SECRET_KEY_BASE=abcdefgh12345678', 'API_KEY_2=abcdefgh12345678'])(
    'regression: %s is redacted', (text) => {
      expect(redactSecrets(text)).not.toContain('abcdefgh12345678');
    });

  it.each([
    ['bfk', 'bfk_' + '0123456789abcdef0123456789abcdef'],
    ['bfa', 'bfa_' + '0123456789abcdef0123456789abcdef'],
    ['bfr', 'bfr_' + '0123456789abcdef0123456789abcdef'],
    ['clk', 'clk_' + '0123456789abcdef0123456789abcdef'],
    ['Google access token', 'ya29.' + 'a0AfH6SMBabcdefghijklmnop'],
    ['Google client secret', 'GOCSPX-' + 'abcdefghijklmnopqrstuvwxyz12'],
  ])('regression: our own / Google credential %s is redacted', (_label, key) => {
    expect(redactSecrets(`using ${key} now`)).not.toContain(key);
  });
});

describe('regression: M7 over-reach', () => {
  it('regression: source code that merely mentions token/password is left alone', () => {
    const code = 'const token = getToken(); interface U { password: string; }';
    expect(redactSecrets(code)).toBe(code);
    expect(redactSecrets('const token = process.env.X;')).toBe('const token = process.env.X;');
  });

  it('regression: "Authorization: denied for user" is prose, not a credential', () => {
    expect(redactSecrets('Authorization: denied for user')).toBe('Authorization: denied for user');
  });

  it('regression: sk- needs a key-shaped run, so "sk-learn-components" is untouched while real OpenAI keys are masked', () => {
    expect(redactSecrets('pip install sk-learn-components')).toBe('pip install sk-learn-components');
    const proj = 'sk-' + 'proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefgh';
    const legacy = 'sk-' + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghijkl';
    expect(redactSecrets(`k ${proj}`)).not.toContain(proj);
    expect(redactSecrets(`k ${legacy}`)).not.toContain(legacy);
  });

  it('regression: keys that reference a secret (Id / Count / Name / Consent / page tokens) are not masked', () => {
    const value = { credentialId: 'c-1', apiKeyId: 12, secretCount: 3, nextPageToken: 'abc', pageToken: 'def', cookieConsent: true, secretName: 'prod-db' };
    expect(redactDeep(value)).toEqual(value);
    expect(redactSecrets('nextPageToken: abcdefghijklmnop')).toBe('nextPageToken: abcdefghijklmnop');
  });

  it('regression: a JSON-schema `properties` map keeps its password/apiKey/token field definitions (an eval case replays them)', () => {
    const schema = { type: 'object', properties: { password: { type: 'string' }, apiKey: { type: 'string' }, token: { type: 'string' }, name: { type: 'string' } } };
    expect(redactDeep(schema)).toEqual(schema);
    // …while a data object that happens to be called `properties` is still masked.
    expect((redactDeep({ properties: { password: 'hunter2hunter2' } }) as { properties: { password: string } }).properties.password).toBe('[REDACTED]');
  });
});

describe('regression: M8 one redactor, one shape list', () => {
  it('regression: findSecretShapes exposes the shared prefix list for detection-only callers', () => {
    expect(findSecretShapes('x AKIA' + 'ABCDEFGHIJKLMNOP y').map((s) => s.id)).toContain('aws-access-key');
    expect(findSecretShapes('nothing here')).toEqual([]);
    expect(findSecretShapes('bfk_' + '0123456789abcdef0123456789abcdef').some((s) => s.label === 'BuilderForce API key')).toBe(true);
  });

  it('regression: redactText can tag a span with the caller\'s label (the diff scanner\'s [REDACTED:id])', () => {
    const out = redactText('const k = "AKIA' + 'ABCDEFGHIJKLMNOP";', DEFAULT_SECRET_PATTERNS, 'strict', (id) => `[REDACTED:secret.${id}]`);
    expect(out).toContain('[REDACTED:secret.aws-access-key]');
    expect(out).not.toContain('AKIA' + 'ABCDEFGHIJKLMNOP');
  });

  it('regression: an unterminated PEM block (a capped output) is redacted to its end', () => {
    expect(redactSecrets('x -----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBgkq\nabcd')).not.toContain('MIIEvQIBADANBgkq');
  });

  it('regression: maskTail shows only the last four characters', () => {
    expect(maskTail('abcdefghijkl')).toBe('****ijkl');
    expect(maskTail('abcd')).toBe('****');
  });
});

describe('regression: structural walk', () => {
  it('regression: a DAG of shared nodes is walked once per depth, not once per path', () => {
    let node: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 40; i++) node = { a: node, b: node };
    const started = Date.now();
    redactDeep(node, { maxDepth: 100 });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('regression: AggregateError.errors (non-enumerable) are included and redacted', () => {
    const out = redactDeep(new AggregateError([new Error('x ghp_' + tail)], 'agg')) as unknown as { errors: unknown[] };
    expect(Array.isArray(out.errors)).toBe(true);
    expect(out.errors).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain(tail);
  });

  it('regression: a node that emitted [CIRCULAR] is not memoised for another path', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', a };
    a.b = b;
    // `b` is reached first inside `a` (where `a` is an ancestor: circular), then directly as a sibling (where it is not).
    const out = redactDeep({ first: a, second: b }) as { first: { b: { a: unknown } }; second: { a: { b: unknown } } };
    expect(out.first.b.a).toBe('[CIRCULAR]');
    expect(out.second.a.b).toBe('[CIRCULAR]');
    expect((out.second.a as Record<string, unknown>).name).toBe('a');
  });
});

describe('regression: B1 ReDoS — every pattern is linear on adversarial input', () => {
  redactSecrets('warm up token_a = x'); // first call compiles the regexes; time only the steady state
  it.each([
    ['40 underscore segments after token', 'token' + '_a'.repeat(40) + ' '],
    ['26 underscore segments after token', 'token' + '_a'.repeat(26) + ' '],
    ['KEY_ x 30000', 'KEY_'.repeat(30000)],
    ['password_x x 5000', 'password_x'.repeat(5000)],
    ['-a x 5000 then token', '-a'.repeat(5000) + ' token'],
    ['Authorization: x 20000', 'Authorization:'.repeat(20000)],
    ['password: x 20000', 'password:'.repeat(20000)],
    ['unterminated JSON key', '"' + 'password_x'.repeat(5000)],
  ])('regression: %s redacts in under 200ms', (_label, input) => {
    const started = performance.now();
    redactSecrets(input);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('regression: M2 short / unusual unquoted values', () => {
  it.each([
    ['password=hunter2', 'hunter2'],
    ['secret_token=abcdefgh;', 'abcdefgh'],
    ['password=a;b;c1234567', 'c1234567'],
    ['secret = "abc"', '"abc"'],
  ])('regression: %s is masked', (text, secret) => {
    expect(redactSecrets(text)).not.toContain(secret);
  });

  it('regression: prose and code stay unmasked', () => {
    for (const text of ['const token = getToken();', 'const token = process.env.X;', 'interface U { password: string; }', 'password: string']) {
      expect(redactSecrets(text)).toBe(text);
    }
  });
});

describe('regression: M3 uppercase env-assignment over-masking', () => {
  it.each(['PRIMARY_KEY: users_id', 'SORT_KEY=timestamp', 'MONKEY: banana', 'HOTKEY=abcdefgh', 'PARTITION_KEY=abcdefgh', 'CACHE_KEY=abcdefgh'])(
    'regression: %s is not masked', (text) => {
      expect(redactSecrets(text)).toBe(text);
    });

  it.each(['API_KEY=abcdefgh12', 'SECRET_KEY_BASE=abcdefgh12', 'GITHUB_TOKEN=abcdefgh12', 'AWS_SECRET_ACCESS_KEY=abcdefgh12'])(
    'regression: %s is masked', (text) => {
      expect(redactSecrets(text)).toBe(`${text.split('=')[0]}=***`);
    });
});

describe('regression: M4 redactJsonText round trip', () => {
  it('regression: a big integer is preserved while a secret in the same JSON is still masked', () => {
    const out = redactJsonText('{"id":12345678901234567890,"password":"hunter2hunter2"}');
    expect(out).toContain('12345678901234567890');
    expect(out).not.toContain('hunter2hunter2');
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('regression: an out-of-range exponent is not turned into null', () => {
    const out = redactJsonText('{"n":1e400,"api_key":"abcdefgh12345678"}');
    expect(out).toContain('1e400');
    expect(out).not.toContain('abcdefgh12345678');
  });
});

describe('regression: m5 bounded nested-JSON work', () => {
  it('regression: caller options reach a JSON-text string leaf', () => {
    const out = redactDeep({ payload: JSON.stringify({ list: [1, 2, 3, 4] }) }, { maxEntries: 2 }) as { payload: string };
    expect(JSON.parse(out.payload)).toEqual({ list: [1, 2] });
  });

  it('regression: JSON nested in JSON strings stops being re-parsed after 3 levels but is still redacted as text', () => {
    let text = JSON.stringify({ token: 'x', cmd: 'DB_PASSWORD=hunter2hunter2 run' });
    for (let i = 0; i < 8; i++) text = JSON.stringify({ inner: text });
    const out = JSON.stringify(redactDeep({ text }));
    expect(out).not.toContain('hunter2hunter2');
  });
});

describe('regression: m6 / m7 key rules', () => {
  it.each(['webhookSecretUrl', 'signedTokenUrl', 'tokenUri'])('regression: %s is a secret key', (key) => {
    expect(isSecretKey(key)).toBe(true);
    expect((redactDeep({ [key]: 'https://x.test/abc' }) as Record<string, unknown>)[key]).toBe('[REDACTED]');
  });

  it.each(['passwordPolicy', 'cookiesEnabled', 'authorizationStatus', 'secretary', 'credentialsProvided', 'secret_provider', 'tokenMode'])(
    'regression: %s keeps its data', (key) => {
      expect(isSecretKey(key)).toBe(false);
      expect(redactDeep({ [key]: 'visible' })).toEqual({ [key]: 'visible' });
    });
});
