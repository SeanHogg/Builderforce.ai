/**
 * The `declarative` hosting adapter — handlers run HERE, on the platform.
 *
 * Materialising is almost a no-op by design: a handler saved into `handlers/` in
 * the canvas is already live at the project's ingress URL, because the ingress
 * route reads the canvas on every request. There is no build, no deploy and no
 * propagation delay, which is the entire reason this strategy exists — a customer
 * who has never opened a terminal can paste a brief and give Twilio a URL that
 * answers.
 *
 * What it DOES produce is the one thing a live URL does not give you: a written
 * record, in the project itself, of which URL serves which handler and what still
 * has to be set. `handlers/README.md` is generated rather than hand-written so it
 * can never drift from the specs actually deployed.
 */

import { missingSecretSteps, type BackendHostingStrategy, type MaterializeContext, type MaterializeResult, type SetupStep } from '../hostingStrategy';

/** Providers whose console the user has to paste the URL into, by verify kind. */
const PROVIDER_CONSOLE: Record<string, { label: string; url: string }> = {
  twilio: { label: 'Twilio Console', url: 'https://console.twilio.com/us1/develop/phone-numbers/manage/incoming' },
};

function webhookSteps(ctx: MaterializeContext): SetupStep[] {
  const steps: SetupStep[] = [];
  const byProvider = new Map<string, string[]>();
  for (const h of ctx.handlers) {
    if (h.verify === 'none') continue;
    const list = byProvider.get(h.verify) ?? [];
    list.push(`${h.method} ${ctx.ingressUrl}${h.route === '/' ? '' : h.route}`);
    byProvider.set(h.verify, list);
  }
  for (const [provider, urls] of byProvider) {
    const console = PROVIDER_CONSOLE[provider];
    steps.push({
      key: `webhook:${provider}`,
      label: `Point ${provider} at this project's webhook URL${urls.length > 1 ? 's' : ''}`,
      detail: urls.join('\n'),
      ...(console ? { url: console.url } : {}),
      blocking: false,
    });
  }
  return steps;
}

/**
 * The generated map of live endpoints. Written into the canvas so the URLs live
 * next to the handlers rather than only in the UI — a customer copying a webhook
 * URL into a provider console should not have to have our dashboard open.
 */
function renderReadme(ctx: MaterializeContext): string {
  const rows = ctx.handlers.length
    ? ctx.handlers
        .map((h) => {
          const url = `${ctx.ingressUrl}${h.route === '/' ? '' : h.route}`;
          const verify = h.verify === 'none' ? '⚠️ unverified' : h.verify;
          return `| \`${h.name}\` | \`${h.method}\` | ${url} | ${verify} | ${h.description ?? ''} |`;
        })
        .join('\n')
    : '| _none yet_ | | | | |';

  return `# Live endpoints — ${ctx.projectName}

These URLs are **already serving**. Every handler in this directory is executed by
Builderforce at the address below the moment you save it — there is no build or
deploy step on this hosting strategy.

| Handler | Method | URL | Verification | Purpose |
| --- | --- | --- | --- | --- |
${rows}

## How a handler works

A handler is JSON, not JavaScript. It declares:

- \`route\` / \`method\` — the path under this project's ingress it answers on.
- \`verify\` — how the caller is proved. \`twilio\` checks \`X-Twilio-Signature\`
  against the project's \`TWILIO_AUTH_TOKEN\` secret; \`shared-secret\` checks an
  HMAC-SHA256 of the body. **An unverified public webhook lets anyone forge
  traffic on your account**, so this field has no default — you choose it.
- \`steps\` — ordered work. \`llm\` asks a model, \`connector\` calls a connected
  system (Twilio, SendGrid, …), \`set\` binds a computed value. Each step binds its
  result to \`{{steps.<id>}}\` for the steps after it.
- \`respond\` — the reply. \`twiml\` returns the XML Twilio expects, \`json\`/\`text\`
  return their obvious thing.

Templates (\`{{...}}\`) can read \`body\`, \`query\`, \`headers\`, \`steps\` and
\`project\`. They deliberately **cannot** read secrets — otherwise a one-line edit
to a handler would exfiltrate your credentials to anyone who can call the public
URL. Secrets are used by the runtime (verification) and by connector credentials.

## Outgrowing this

If you need real code — loops, your own libraries, arbitrary requests — switch the
project's backend strategy to **GitHub Worker**. These same handlers are compiled
into a genuine Cloudflare Worker in your repo, deployed to your own account, with
no vocabulary limits. Nothing here is thrown away.
`;
}

export const declarativeStrategy: BackendHostingStrategy = {
  key: 'declarative',
  label: 'Builderforce-hosted (zero setup)',
  summary:
    'Handlers are data in the canvas, executed by Builderforce at a public ingress URL. Live the moment you save — no cloud account, no CLI, no deploy.',
  zeroSetup: true,

  materialize(ctx: MaterializeContext): MaterializeResult {
    return {
      files: { 'handlers/README.md': renderReadme(ctx) },
      setupSteps: [...missingSecretSteps(ctx), ...webhookSteps(ctx)],
      webhookBaseUrl: ctx.ingressUrl,
    };
  },
};
