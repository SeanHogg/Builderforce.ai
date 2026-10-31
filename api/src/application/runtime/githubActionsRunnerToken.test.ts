/**
 * The Actions runner outlives its OIDC token: /op enforces `exp` (+60s), a long run takes
 * longer than a token lives, and a runner that kept the first one would 401 on every op and
 * strand the run's background jobs. These run the REAL rendered script against a stubbed
 * `fetch` and `process`, and check that it re-mints before expiry and once on a 401, and
 * that it ends the process when the run is over.
 */
import { describe, expect, it } from 'vitest';
import { renderAgentRunnerScript } from './githubActionsRunner';
import { BUILDERFORCE_AGENT_OIDC_AUDIENCE } from './githubActionsWorkflow';

const jwt = (expSeconds: number, tag: string) =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp: expSeconds, tag })).toString('base64url')}.sig`;

interface Call { url: string; auth: string | undefined; op?: string }

/** Run the rendered runner to completion: it loads its spec, is told to stop, and exits. */
async function runRunner(opts: {
  token: string;
  minted?: string;
  /** Statuses `/op` answers in order (default all 200); the last repeats. */
  opStatuses?: number[];
  withMint?: boolean;
}): Promise<{ calls: Call[]; exitCode: number | undefined; errors: string[] }> {
  const script = renderAgentRunnerScript();
  const body = script.replace(/^import .*$/gm, '');
  const importLines = [...script.matchAll(/^import \{([^}]*)\} from '([^']+)';?$/gm)];
  const names: string[] = [];
  const values: unknown[] = [];
  for (const m of importLines) {
    const mod = (await import(/* @vite-ignore */ m[2]!)) as Record<string, unknown>;
    for (const n of m[1]!.split(',').map((s) => s.trim()).filter(Boolean)) {
      // `import { resolve as resolvePath }` binds the local name on the right.
      const [exported, local] = n.split(/\s+as\s+/);
      names.push(local ?? exported!);
      values.push(mod[exported!]);
    }
  }

  const calls: Call[] = [];
  const errors: string[] = [];
  let exitCode: number | undefined;
  let opIndex = 0;
  const statuses = opts.opStatuses ?? [200];
  const fetchStub = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    const auth = init?.headers?.Authorization;
    if (url.startsWith('https://token.example/mint')) {
      calls.push({ url, auth });
      return Response.json({ value: opts.minted ?? jwt(Math.floor(Date.now() / 1000) + 3600, 'fresh') });
    }
    const opName = JSON.parse(init?.body ?? '{}').op as string;
    calls.push({ url, auth, op: opName });
    const status = statuses[Math.min(opIndex++, statuses.length - 1)]!;
    if (status !== 200) return new Response('no', { status });
    if (opName === 'spec') return Response.json({ repo: { headBranch: 'bf/1' } });
    if (opName === 'sandbox_next') return Response.json({ close: true });
    return Response.json({ ok: true });
  };
  const processStub = {
    env: {
      BUILDERFORCE_API: 'https://api.example',
      BUILDERFORCE_TOKEN: opts.token,
      BUILDERFORCE_EXECUTION_ID: '7',
      ...(opts.withMint === false ? {} : { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example/mint?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req-token' }),
    },
    cwd: () => '/work',
    exit: (code?: number) => { exitCode = code; },
  };
  const consoleStub = { error: (...a: unknown[]) => { errors.push(a.map(String).join(' ')); }, log: () => {} };
  const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<void>;
  const run = new AsyncFunction('process', 'fetch', 'console', ...names, body);
  await run(processStub, fetchStub, consoleStub, ...values);
  return { calls, exitCode, errors };
}

describe('the Actions runner and its OIDC token', () => {
  it('requests the agent audience when it re-mints, with the Actions request token', async () => {
    const expired = jwt(Math.floor(Date.now() / 1000) - 600, 'old');
    const { calls } = await runRunner({ token: expired });
    const mint = calls.find((c) => c.url.startsWith('https://token.example/mint'));
    expect(mint?.url).toContain(`audience=${encodeURIComponent(BUILDERFORCE_AGENT_OIDC_AUDIENCE)}`);
    expect(mint?.auth).toBe('bearer req-token');
  });

  it('re-mints BEFORE a token that is about to lapse is sent, and sends the fresh one', async () => {
    const minted = jwt(Math.floor(Date.now() / 1000) + 3600, 'fresh');
    const soon = jwt(Math.floor(Date.now() / 1000) + 30, 'old');
    const { calls } = await runRunner({ token: soon, minted });
    const ops = calls.filter((c) => c.op);
    expect(ops.length).toBeGreaterThan(0);
    for (const c of ops) expect(c.auth).toBe(`Bearer ${minted}`);
  });

  it('keeps a token with plenty of life and mints nothing', async () => {
    const fine = jwt(Math.floor(Date.now() / 1000) + 3000, 'fine');
    const { calls } = await runRunner({ token: fine });
    expect(calls.some((c) => c.url.startsWith('https://token.example/mint'))).toBe(false);
    for (const c of calls.filter((x) => x.op)) expect(c.auth).toBe(`Bearer ${fine}`);
  });

  it('on a 401 re-mints once and retries the same op with the new token', async () => {
    const minted = jwt(Math.floor(Date.now() / 1000) + 3600, 'fresh');
    const fine = jwt(Math.floor(Date.now() / 1000) + 3000, 'fine');
    const { calls } = await runRunner({ token: fine, minted, opStatuses: [401, 200] });
    const first = calls.findIndex((c) => c.op === 'spec');
    expect(calls[first]!.auth).toBe(`Bearer ${fine}`);
    expect(calls[first + 1]!.url).toContain('token.example/mint');
    expect(calls[first + 2]).toMatchObject({ op: 'spec', auth: `Bearer ${minted}` });
  });

  it('a 401 with no way to mint fails the op as before', async () => {
    const fine = jwt(Math.floor(Date.now() / 1000) + 3000, 'fine');
    const { calls, exitCode } = await runRunner({ token: fine, opStatuses: [401], withMint: false });
    expect(calls.filter((c) => c.op === 'spec')).toHaveLength(1);
    expect(exitCode).toBe(1);
  });

  it('ends the process when the run is over, so a daemon that escaped cannot keep it alive', async () => {
    const fine = jwt(Math.floor(Date.now() / 1000) + 3000, 'fine');
    const { exitCode } = await runRunner({ token: fine });
    expect(exitCode).toBe(0);
  });
});
