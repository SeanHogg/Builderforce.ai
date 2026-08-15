/**
 * GitHub-Worker adapter tests.
 *
 * The promise this adapter makes is that switching strategies is a MIGRATION,
 * not a rewrite: the generated Worker must implement the same handlers with the
 * same semantics, carry no Builderforce credential into the customer's repo, and
 * name its secrets the way the vendor does.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_CONNECTORS } from '../../connectors/defaults';
import type { MaterializeContext } from '../hostingStrategy';
import { parseHandlerSpec, type HandlerSpec } from '../handlerSpec';
import { twilioOmnichannelBlueprint } from '../../challenge/blueprints/twilioOmnichannel';
import {
  githubWorkerStrategy,
  WORKER_DEPLOY_WORKFLOW_PATH,
  WORKER_DIR,
} from './githubWorker';
import {
  connectorEnvVar,
  requiredBackendSecrets,
  screamingSnake,
} from './handlerEngineSource';
import { declarativeStrategy } from './declarative';

function blueprintHandlers(): HandlerSpec[] {
  return Object.entries(twilioOmnichannelBlueprint.handlers).flatMap(([name, raw]) => {
    const parsed = parseHandlerSpec(raw, name);
    return parsed.ok ? [parsed.spec] : [];
  });
}

function context(over: Partial<MaterializeContext> = {}): MaterializeContext {
  return {
    projectId: 7,
    tenantId: 1,
    projectName: 'Acme Comms',
    ingressUrl: 'https://api.test/hooks/tok',
    handlers: blueprintHandlers(),
    connectors: [BUILTIN_CONNECTORS.get('twilio')!, BUILTIN_CONNECTORS.get('sendgrid')!],
    secretNames: [],
    requiredSecretNames: ['TWILIO_AUTH_TOKEN'],
    apiOrigin: 'https://api.test',
    ...over,
  };
}

describe('secret naming', () => {
  it('converts camelCase to the vendor’s own env style', () => {
    expect(screamingSnake('accountSid')).toBe('ACCOUNT_SID');
    expect(connectorEnvVar('twilio', 'accountSid')).toBe('TWILIO_ACCOUNT_SID');
    expect(connectorEnvVar('twilio-lookup', 'password')).toBe('TWILIO_LOOKUP_PASSWORD');
  });
});

describe('requiredBackendSecrets', () => {
  const secrets = requiredBackendSecrets(context());

  it('includes one per connector auth field', () => {
    expect(secrets).toEqual(expect.arrayContaining(['TWILIO_ACCOUNT_SID', 'TWILIO_USERNAME', 'TWILIO_PASSWORD', 'SENDGRID_TOKEN']));
  });

  it('includes the verification token for signature-checking handlers', () => {
    expect(secrets).toContain('TWILIO_AUTH_TOKEN');
  });

  it('includes the gateway key only when a handler calls a model', () => {
    expect(secrets).toContain('BUILDERFORCE_API_KEY');
    const noLlm = requiredBackendSecrets(context({
      handlers: [{ name: 'x', route: '/x', method: 'POST', verify: 'none', steps: [], respond: { kind: 'empty' } }],
      connectors: [],
    }));
    expect(noLlm).not.toContain('BUILDERFORCE_API_KEY');
  });
});

describe('materialize', () => {
  const result = githubWorkerStrategy.materialize(context());

  it('generates a wrangler config, a package.json, the engine, the entrypoint and the deploy workflow', () => {
    expect(Object.keys(result.files).sort()).toEqual([
      WORKER_DEPLOY_WORKFLOW_PATH,
      `${WORKER_DIR}package.json`,
      `${WORKER_DIR}src/engine.js`,
      `${WORKER_DIR}src/index.js`,
      `${WORKER_DIR}wrangler.toml`,
    ].sort());
  });

  it('writes valid JSON into package.json', () => {
    expect(() => JSON.parse(result.files[`${WORKER_DIR}package.json`]!)).not.toThrow();
  });

  it('keeps the entrypoint to the one thing that is Cloudflare-specific', () => {
    // Everything else is the shared engine. An entrypoint that grew a second
    // responsibility is an entrypoint that would have to be re-tested per cloud.
    const entry = result.files[`${WORKER_DIR}src/index.js`]!;
    expect(entry).toContain("import { handleRequest } from './engine.js'");
    expect(entry).toContain('export default');
    // Null means "no handler claims this path" — the entrypoint owns the 404.
    expect(entry).toContain("new Response('Not found', { status: 404 })");
  });

  it('points wrangler at the generated entrypoint', () => {
    expect(result.files[`${WORKER_DIR}wrangler.toml`]).toContain('main = "src/index.js"');
  });

  it('derives a DNS-safe Worker name from the project', () => {
    expect(result.files[`${WORKER_DIR}wrangler.toml`]).toContain('name = "acme-comms-backend"');
  });

  it('blocks on the Cloudflare token — it deploys to the customer’s own account', () => {
    const blocking = result.setupSteps.filter((s) => s.blocking).map((s) => s.key);
    expect(blocking).toContain('cf-token');
    expect(blocking).toContain('push');
  });

  it('reports no webhook base until the first deploy prints one', () => {
    expect(result.webhookBaseUrl).toBeNull();
  });

  it('lists a missing required secret as a blocking step', () => {
    const withGap = githubWorkerStrategy.materialize(context({ secretNames: [], requiredSecretNames: ['TWILIO_AUTH_TOKEN'] }));
    expect(withGap.setupSteps.some((s) => s.key === 'secret:TWILIO_AUTH_TOKEN' && s.blocking)).toBe(true);

    const satisfied = githubWorkerStrategy.materialize(context({ secretNames: ['TWILIO_AUTH_TOKEN'], requiredSecretNames: ['TWILIO_AUTH_TOKEN'] }));
    expect(satisfied.setupSteps.some((s) => s.key === 'secret:TWILIO_AUTH_TOKEN')).toBe(false);
  });
});

describe('the declarative adapter', () => {
  const result = declarativeStrategy.materialize(context());

  it('is live immediately — its webhook base is the ingress itself', () => {
    expect(declarativeStrategy.zeroSetup).toBe(true);
    expect(result.webhookBaseUrl).toBe('https://api.test/hooks/tok');
  });

  it('writes an endpoint map that cannot drift from the deployed handlers', () => {
    const readme = result.files['handlers/README.md']!;
    for (const handler of blueprintHandlers()) {
      expect(readme).toContain(`https://api.test/hooks/tok${handler.route}`);
    }
  });

  it('flags an unverified handler in the generated map', () => {
    const withOpen = declarativeStrategy.materialize(context({
      handlers: [{ name: 'open', route: '/open', method: 'POST', verify: 'none', steps: [], respond: { kind: 'empty' } }],
    }));
    expect(withOpen.files['handlers/README.md']).toContain('unverified');
  });

  it('tells the operator which URLs to paste into the provider console', () => {
    const step = result.setupSteps.find((s) => s.key === 'webhook:twilio');
    expect(step).toBeTruthy();
    expect(step!.detail).toContain('https://api.test/hooks/tok/sms');
    expect(step!.url).toContain('twilio.com');
  });
});
