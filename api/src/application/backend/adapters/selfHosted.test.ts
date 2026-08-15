/**
 * The four self-hosted targets, and the ONE engine underneath them.
 *
 * The promise every self-hosted strategy makes is that moving a working system
 * into your own account is a MIGRATION, not a rewrite: same handlers, same
 * semantics, same failure posture, no Builderforce credential in your repo. Four
 * hand-written copies of that lowering would break the promise quietly — the
 * kind of drift only a customer's dropped call reveals — so the assertions here
 * are deliberately about SAMENESS across clouds as much as about each cloud.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_CONNECTORS } from '../../connectors/defaults';
import type { MaterializeContext } from '../hostingStrategy';
import { parseHandlerSpec, type HandlerSpec } from '../handlerSpec';
import { twilioOmnichannelBlueprint } from '../../challenge/blueprints/twilioOmnichannel';
import { BACKEND_HEALTH_MARKER, BACKEND_HEALTH_PATH, renderHandlerEngineSource } from './handlerEngineSource';
import { githubWorkerStrategy, WORKER_DIR } from './githubWorker';
import { awsLambdaStrategy, AWS_DIR, AWS_DEPLOY_WORKFLOW_PATH } from './awsLambda';
import { gcpCloudRunStrategy, GCP_DIR, GCP_DEPLOY_WORKFLOW_PATH } from './gcpCloudRun';
import { azureFunctionsStrategy, AZURE_DIR, AZURE_DEPLOY_WORKFLOW_PATH } from './azureFunctions';

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

describe('the shared handler engine', () => {
  const source = renderHandlerEngineSource(context());

  it('exports the one function every runtime adapter calls', () => {
    expect(source).toContain('export async function handleRequest(request, env)');
    expect(source).toContain('export const HANDLERS');
    expect(source).toContain('export const EXPECTED_SECRETS');
  });

  it('embeds every handler so the backend is self-contained', () => {
    for (const handler of blueprintHandlers()) {
      expect(source).toContain(`"route": "${handler.route}"`);
    }
  });

  it('embeds the connector manifests and reads every credential from the environment', () => {
    // The manifest travels — it is pure data (base URL, auth SHAPE, actions).
    expect(source).toContain('https://api.twilio.com');
    // The VALUES do not: each auth field maps to an env NAME the generated
    // callConnector resolves at request time.
    expect(source).toContain('"password": "TWILIO_PASSWORD"');
    expect(source).toContain('const value = env[envName];');
  });

  it('carries nothing of Builderforce into the customer’s repo', () => {
    for (const leak of ['credentialsEnc', 'credentials_enc', 'connector_connections', 'hooks/tok']) {
      expect(source, leak).not.toContain(leak);
    }
  });

  it('points the generated model call at the configured API origin', () => {
    expect(source).toContain("'https://api.test/v1/chat/completions'");
  });

  it('reproduces the failure posture — a thrown step must not abort the request', () => {
    expect(source).toContain("steps[step.id] = '';");
    expect(source).toContain('console.error');
  });

  it('verifies every provider signature scheme', () => {
    expect(source).toContain('x-twilio-signature');
    expect(source).toContain('stripe-signature');
    expect(source).toContain('x-shopify-hmac-sha256');
    expect(source).toContain('return new Response(failure, { status: 403, headers: cors })');
  });

  it('honours the same cors allow-list as the platform-hosted ingress', () => {
    // Every strategy runs the SAME specs. If `cors` meant something different in
    // a generated backend, switching strategy would silently open or close a
    // frontend.
    expect(source).toContain('access-control-request-method');
    expect(source).toContain("if (list.includes('*')) return '*';");
    // Answered before verification and before a single step runs.
    expect(source.indexOf('if (preflightMethod) {')).toBeLessThan(source.indexOf("handler.verify === 'twilio'"));
  });

  it('serves a readiness route that names its secrets without revealing them', () => {
    expect(source).toContain(`export const HEALTH_PATH = "${BACKEND_HEALTH_PATH}"`);
    expect(source).toContain('Boolean(env[n])');
    // Names and booleans only — never a value, never a prefix.
    expect(source).not.toContain('env[n].slice');
  });

  it('emits the marker the deployed-backend monitor matches on', () => {
    // The contract between `watchDeployedBackend` and this generator. A status
    // code alone proves nothing on either side — a deleted Lambda can answer 200
    // from an edge, and a Cloud Run revision that failed to start answers 503
    // through a healthy load balancer — so the monitor matches on a substring
    // only the engine emits. A second copy of that string would keep matching
    // until the health payload changed shape, and then report every healthy
    // deployment as down.
    expect(source).toContain('ok: true,');
    expect(JSON.stringify({ ok: true, backend: 'Acme Comms' })).toContain(BACKEND_HEALTH_MARKER);
  });

  it('reads a data step back over the API instead of silently dropping it', () => {
    // The bug this closes: a handler that reads a collection worked on the
    // platform and returned nothing at all once it was moved to another cloud.
    expect(source).toContain("step.kind === 'data'");
    expect(source).toContain('/api/backend-runtime/projects/7/collections/');
  });

  it('returns null rather than a 404 so an entrypoint can fall through to the site', () => {
    expect(source).toContain('if (!handler) return null;');
  });
});

describe('every self-hosted adapter', () => {
  const adapters = [
    { name: 'cloudflare', result: githubWorkerStrategy.materialize(context()), engine: `${WORKER_DIR}src/engine.js` },
    { name: 'aws', result: awsLambdaStrategy.materialize(context()), engine: `${AWS_DIR}src/engine.js` },
    { name: 'gcp', result: gcpCloudRunStrategy.materialize(context()), engine: `${GCP_DIR}src/engine.js` },
    { name: 'azure', result: azureFunctionsStrategy.materialize(context()), engine: `${AZURE_DIR}engine.js` },
  ];

  it.each(adapters)('$name embeds the identical engine', ({ result, engine }) => {
    // Byte-identical, not merely similar. The moment one cloud carries its own
    // copy, "same semantics everywhere" becomes an aspiration.
    expect(result.files[engine]).toBe(renderHandlerEngineSource(context()));
  });

  it.each(adapters)('$name reports no webhook base until the first deploy prints one', ({ result }) => {
    expect(result.webhookBaseUrl).toBeNull();
  });

  it.each(adapters)('$name blocks on a credential and on the push', ({ result }) => {
    const blocking = result.setupSteps.filter((s) => s.blocking).map((s) => s.key);
    expect(blocking).toContain('push');
    expect(blocking.some((k) => k === 'cf-token' || k === 'cloud-credentials')).toBe(true);
  });

  it.each(adapters)('$name lists a missing required secret as a blocking step', ({ name }) => {
    const strategy = { cloudflare: githubWorkerStrategy, aws: awsLambdaStrategy, gcp: gcpCloudRunStrategy, azure: azureFunctionsStrategy }[name]!;
    const withGap = strategy.materialize(context({ secretNames: [], requiredSecretNames: ['TWILIO_AUTH_TOKEN'] }));
    expect(withGap.setupSteps.some((s) => s.key === 'secret:TWILIO_AUTH_TOKEN' && s.blocking)).toBe(true);

    const satisfied = strategy.materialize(context({ secretNames: ['TWILIO_AUTH_TOKEN'], requiredSecretNames: ['TWILIO_AUTH_TOKEN'] }));
    expect(satisfied.setupSteps.some((s) => s.key === 'secret:TWILIO_AUTH_TOKEN')).toBe(false);
  });
});

describe('aws-lambda', () => {
  const result = awsLambdaStrategy.materialize(context());

  it('generates a SAM template, an entrypoint, the site collector and a workflow', () => {
    expect(Object.keys(result.files).sort()).toEqual([
      AWS_DEPLOY_WORKFLOW_PATH,
      `${AWS_DIR}collect-site.mjs`,
      `${AWS_DIR}package.json`,
      `${AWS_DIR}src/engine.js`,
      `${AWS_DIR}src/lambda.mjs`,
      `${AWS_DIR}src/static.mjs`,
      `${AWS_DIR}template.yaml`,
    ].sort());
  });

  it('exposes a Function URL with no transport auth, because providers cannot sign SigV4', () => {
    const template = result.files[`${AWS_DIR}template.yaml`]!;
    expect(template).toContain('FunctionUrlConfig');
    expect(template).toContain('AuthType: NONE');
    expect(template).toContain('!GetAtt BackendFunctionUrl.FunctionUrl');
  });

  it('passes every backend secret as a NoEcho parameter, not a literal', () => {
    const template = result.files[`${AWS_DIR}template.yaml`]!;
    expect(template).toContain('TwilioAuthToken:');
    expect(template).toContain('NoEcho: true');
    expect(template).toContain('TWILIO_AUTH_TOKEN: !Ref TwilioAuthToken');
  });

  it('rebuilds the request URL from the forwarded host, which is what Twilio signed', () => {
    const entry = result.files[`${AWS_DIR}src/lambda.mjs`]!;
    expect(entry).toContain("headers.get('x-forwarded-host')");
    expect(entry).toContain('event.rawQueryString');
    // Handlers first, static second: a page must never shadow an endpoint.
    expect(entry.indexOf('handleRequest')).toBeLessThan(entry.indexOf('serveStatic'));
  });

  it('reads the OIDC role from env, because the secrets context is unavailable in `if`', () => {
    const workflow = result.files[AWS_DEPLOY_WORKFLOW_PATH]!;
    expect(workflow).toContain("if: env.AWS_ROLE_ARN != ''");
    expect(workflow).toContain("if: env.AWS_ROLE_ARN == ''");
  });

  it('collects the site before deploying, so one address serves both halves', () => {
    expect(result.files[AWS_DEPLOY_WORKFLOW_PATH]).toContain('node aws/collect-site.mjs');
  });
});

describe('gcp-cloudrun', () => {
  const result = gcpCloudRunStrategy.materialize(context());

  it('generates a Dockerfile, a server, the site collector and a workflow', () => {
    expect(Object.keys(result.files).sort()).toEqual([
      GCP_DEPLOY_WORKFLOW_PATH,
      `${GCP_DIR}Dockerfile`,
      `${GCP_DIR}collect-site.mjs`,
      `${GCP_DIR}package.json`,
      `${GCP_DIR}src/engine.js`,
      `${GCP_DIR}src/server.mjs`,
      `${GCP_DIR}src/static.mjs`,
    ].sort());
  });

  it('rebuilds the public URL from forwarded headers — Cloud Run hands over plain HTTP', () => {
    const server = result.files[`${GCP_DIR}src/server.mjs`]!;
    expect(server).toContain("headers.get('x-forwarded-proto')");
    expect(server).toContain("headers.get('x-forwarded-host')");
  });

  it('federates rather than storing a service-account key', () => {
    const workflow = result.files[GCP_DEPLOY_WORKFLOW_PATH]!;
    expect(workflow).toContain('workload_identity_provider');
    expect(workflow).not.toContain('credentials_json');
  });

  it('uses a delimiter that survives a comma inside a secret', () => {
    // `--set-env-vars A=1,B=2` splits on commas, and a signing secret may contain
    // one. The `^##^` form is the documented escape.
    expect(result.files[GCP_DEPLOY_WORKFLOW_PATH]).toContain('^##^');
  });

  it('has no install step, because the bundle has no dependencies', () => {
    // `npm ci` on a build machine is the single most common way a generated
    // deploy fails; a zero-dependency image cannot fail that way.
    expect(result.files[`${GCP_DIR}Dockerfile`]).not.toMatch(/^RUN /m);
  });
});

describe('azure-functions', () => {
  const result = azureFunctionsStrategy.materialize(context());

  it('generates host.json, a function entrypoint, the site collector and a workflow', () => {
    expect(Object.keys(result.files).sort()).toEqual([
      AZURE_DEPLOY_WORKFLOW_PATH,
      `${AZURE_DIR}collect-site.mjs`,
      `${AZURE_DIR}engine.js`,
      `${AZURE_DIR}host.json`,
      `${AZURE_DIR}package.json`,
      `${AZURE_DIR}src/functions/backend.mjs`,
      `${AZURE_DIR}static.mjs`,
    ].sort());
  });

  it('empties the /api route prefix so the deployed routes are the spec’s routes', () => {
    // Left at the default, a handler claiming /sms would answer on /api/sms, and
    // the URL the customer pasted into Twilio would 404.
    const host = JSON.parse(result.files[`${AZURE_DIR}host.json`]!);
    expect(host.extensions.http.routePrefix).toBe('');
  });

  it('claims every path with one anonymous function', () => {
    const entry = result.files[`${AZURE_DIR}src/functions/backend.mjs`]!;
    expect(entry).toContain("route: '{*path}'");
    expect(entry).toContain("authLevel: 'anonymous'");
    expect(entry).toContain("'OPTIONS'");
  });

  it('declares the one dependency the v4 model actually needs', () => {
    const pkg = JSON.parse(result.files[`${AZURE_DIR}package.json`]!);
    expect(pkg.dependencies['@azure/functions']).toBeTruthy();
    expect(pkg.main).toBe('src/functions/backend.mjs');
  });
});
