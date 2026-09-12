/**
 * I/O node handlers — every kind that reads or writes something outside the
 * payload: the web (`web-search`, `web-fetch`, `healthcheck`), a tenant's
 * connected accounts (`gmail`, `google-drive`, `connector`, `mcp`) and the
 * workflow variable store (`set-variable(s)`, `get-variable(s)`, `increment`).
 *
 * Outbound kinds consult the `OutboundPort` stub FIRST, before their own
 * preconditions, so a sandbox dry-run needs no tenant context at all.
 */
import { loadGoogleCredential } from '../../integrations/googleCredential';
import { sendGmail, searchGoogleDrive, readGoogleDriveFileText } from '../../integrations/googleOAuth';
import { credentialSecret } from '../../integrations/credentialCrypto';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { platformWebSearchBacking } from '../../runtime/webSearchCredential';
import { searchWeb } from '../../runtime/cloudWeb';
import { searchOwnedThenDiscover } from '../../webSearch/demandSearch';
import { fetchWebDocumentCached } from '../../web/webFetch';
import { assertSafeUrl, BlockedUrlError } from '../../../infrastructure/net/ssrfGuard';
import { fetchPublic } from '../../../infrastructure/net/fetchPublic';
import { renderValueTemplate } from '../../../domain/workflowExpr';
import { executeMcpNode, type McpNodeConfig } from '../mcpNode';
import { executeConnectorNode, type ConnectorNodeConfig } from '../connectorNode';
import { getWorkflowVariable, setWorkflowVariable, incrementWorkflowVariable } from '../workflowVariables';
import { expressionContext, renderTemplate } from './helpers';
import type { NodeHandlerTable } from './types';

export const IO_NODE_HANDLERS: NodeHandlerTable = {
  'web-search': async ({ env, node, inputText, usageCtx, outbound }) => {
    if (outbound?.webSearch) return { output: await outbound.webSearch(node.config, inputText) };
    const query = renderTemplate(
      typeof node.config.query === 'string' && node.config.query ? node.config.query : '{{input}}',
      inputText,
    ).trim();
    if (!query) throw new Error('Web Search needs a query');
    // With a tenant in scope: the tenant's OWNED crawled index first, a vendor only
    // to discover pages worth crawling — the SAME `searchOwnedThenDiscover` the cloud
    // agent's `web_search` tool uses, so a workflow's research also builds the index.
    // A tenant-LESS run has no index to own, so it falls back to a vendor-only call
    // against the platform backing — never null, so no "connect an integration" refusal.
    const result = usageCtx
      ? await searchOwnedThenDiscover({ db: usageCtx.db, env, tenantId: usageCtx.tenantId, request: { query } })
      : await searchWeb(env, platformWebSearchBacking(env), query);
    if (!result.ok) throw new Error(result.error ?? 'Web search failed');
    return {
      output: JSON.stringify({
        query, results: result.results ?? [], coverage: result.coverage, attribution: result.attribution,
      }),
    };
  },

  'web-fetch': async ({ env, node, inputText, outbound }) => {
    if (outbound?.webFetch) return { output: await outbound.webFetch(node.config, inputText) };
    // The SAME SSRF-guarded, redirect-revalidating, cached fetch the Brain's own
    // "read this URL" tool uses. No credential needed, so it runs with or without
    // a tenant context.
    const url = renderTemplate(typeof node.config.url === 'string' ? node.config.url : '', inputText).trim();
    if (!url) throw new Error('Web Fetch needs a URL');
    const doc = await fetchWebDocumentCached(env, url);
    return {
      output: JSON.stringify({
        url: doc.url, status: doc.status, contentType: doc.contentType,
        title: doc.title, text: doc.text, truncated: doc.truncated,
      }),
    };
  },

  healthcheck: async ({ node, inputText }) => {
    const url = renderTemplate(typeof node.config.url === 'string' ? node.config.url : '', inputText).trim();
    if (!url) throw new Error('Healthcheck needs a URL');
    const expectedStatus = typeof node.config.expectedStatus === 'number'
      ? node.config.expectedStatus
      : Number(node.config.expectedStatus) || 200;
    let status = 0;
    let up = false;
    let errorMsg: string | null = null;
    try {
      // Same SSRF guard `webFetch.ts` applies, then `fetchPublic`'s DNS-rebinding
      // check. `redirect: 'manual'` deliberately does NOT follow redirects (a 3xx is
      // itself a reportable status).
      const parsed = assertSafeUrl(url, { allowHttp: true });
      const res = await fetchPublic(parsed, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) });
      status = res.status;
      up = status === expectedStatus;
    } catch (e) {
      errorMsg = e instanceof BlockedUrlError ? e.message : e instanceof Error ? e.message : 'fetch failed';
    }
    return { output: JSON.stringify({ url, status, expectedStatus, up, error: errorMsg }) };
  },

  gmail: async ({ env, node, inputText, usageCtx, outbound }) => {
    if (outbound?.gmail) return { output: await outbound.gmail(node.config, inputText) };
    // Fields support {{input}} so an upstream node's output can drive the recipient,
    // subject or body. Needs the tenant context to load the (encrypted) creds.
    if (!usageCtx) throw new Error('The Gmail node needs a tenant context to load your connected account');
    const creds = await loadGoogleCredential(env, usageCtx.db, usageCtx.tenantId, 'gmail');
    if (!creds) throw new Error('Connect a Gmail integration under Settings ▸ Integrations to use the Gmail node');
    const cfg = node.config;
    const to = renderTemplate(typeof cfg.to === 'string' ? cfg.to : '', inputText).trim();
    const subject = renderTemplate(typeof cfg.subject === 'string' ? cfg.subject : '', inputText);
    const body = renderTemplate(typeof cfg.body === 'string' ? cfg.body : '{{input}}', inputText);
    const sent = await sendGmail(creds, { to, subject, body });
    return { output: JSON.stringify({ sent: true, id: sent.id, to }) };
  },

  'google-drive': async ({ env, node, inputText, usageCtx, outbound }) => {
    if (outbound?.googleDrive) return { output: await outbound.googleDrive(node.config, inputText) };
    // Same tenant-credential path as `gmail` (provider='google_drive'). NOT the
    // per-USER `DriveProvider` the canvas import picker uses (that needs an
    // interactive `userId`+`connectionId` this node has no session to supply).
    if (!usageCtx) throw new Error('The Google Drive node needs a tenant context to load your connected account');
    const driveCreds = await loadGoogleCredential(env, usageCtx.db, usageCtx.tenantId, 'google_drive');
    if (!driveCreds) throw new Error('Connect a Google Drive integration under Settings ▸ Integrations to use the Google Drive node');
    const driveCfg = node.config;
    const operation = typeof driveCfg.operation === 'string' ? driveCfg.operation : 'search';
    if (operation === 'read') {
      const fileId = renderTemplate(typeof driveCfg.fileId === 'string' ? driveCfg.fileId : '', inputText).trim();
      if (!fileId) throw new Error('Google Drive read needs a file id');
      const file = await readGoogleDriveFileText(driveCreds, fileId);
      return { output: JSON.stringify(file) };
    }
    const query = renderTemplate(typeof driveCfg.query === 'string' && driveCfg.query ? driveCfg.query : '{{input}}', inputText).trim();
    if (!query) throw new Error('Google Drive search needs a query');
    const hits = await searchGoogleDrive(driveCreds, query);
    return { output: JSON.stringify({ query, files: hits }) };
  },

  connector: async ({ env, node, inputText, usageCtx, outbound }) => {
    if (outbound?.connector) return { output: await outbound.connector(node.config, inputText) };
    // EVERY connector action (Twilio, SendGrid, Slack, Stripe, a tenant's own)
    // reaches a workflow through this one node, with the connector and action as
    // CONFIG — publishing a new connector makes it usable here with no change.
    if (!usageCtx) throw new Error('An integration node needs a tenant context to load your connection');
    const outcome = await executeConnectorNode(
      { db: usageCtx.db, env, tenantId: usageCtx.tenantId },
      node.config as ConnectorNodeConfig,
      inputText,
    );
    if (!outcome.ok) throw new Error(outcome.error);
    return { output: outcome.output };
  },

  mcp: async ({ env, node, inputText, usageCtx, outbound }) => {
    if (outbound?.mcp) return { output: await outbound.mcp(node.config, inputText) };
    // Every Data + Marketing palette integration lands here, issuing the SAME HTTP
    // call the connect form's "Test connection" makes (see ../mcpNode.ts).
    if (!usageCtx) throw new Error('An integration node needs a tenant context to load your connection');
    const outcome = await executeMcpNode(
      { db: usageCtx.db, tenantId: usageCtx.tenantId, encryptionSecret: credentialSecret(env) },
      node.config as McpNodeConfig,
      inputText,
    );
    if (!outcome.ok) throw new Error(outcome.error);
    return { output: outcome.output };
  },

  'set-variable': async ({ node, inputText, usageCtx }) => {
    if (!usageCtx) throw new Error('The Set Variable node needs a tenant context to store state');
    const key = typeof node.config.key === 'string' ? node.config.key.trim() : '';
    if (!key) throw new Error('Set Variable needs a key');
    // `renderValueTemplate`, not `renderTemplate`: a value field is a literal unless
    // it carries a span, and every span form is available — so a declared output
    // capture can name a PATH (`{{ order.id }}`), not only the whole payload.
    const template = typeof node.config.value === 'string' ? node.config.value : '{{input}}';
    const value = renderValueTemplate(template, inputText, await expressionContext(inputText, usageCtx, [template]));
    await setWorkflowVariable(usageCtx.db, usageCtx.tenantId, 'run', usageCtx.workflowId, key, value);
    return { output: value };
  },

  'get-variable': async ({ node, usageCtx }) => {
    if (!usageCtx) throw new Error('The Get Variable node needs a tenant context to read state');
    const key = typeof node.config.key === 'string' ? node.config.key.trim() : '';
    if (!key) throw new Error('Get Variable needs a key');
    const value = await getWorkflowVariable(usageCtx.db, usageCtx.tenantId, 'run', usageCtx.workflowId, key);
    return { output: value };
  },

  increment: async ({ node, usageCtx }) => {
    if (!usageCtx) throw new Error('The Increment node needs a tenant context to store state');
    const key = typeof node.config.key === 'string' ? node.config.key.trim() : '';
    if (!key) throw new Error('Increment needs a key');
    const step = typeof node.config.step === 'number' ? node.config.step : Number(node.config.step) || 1;
    // Definition-scoped (not run-scoped): the counter persists across runs of the
    // SAME workflow, matching Make's Increment. An ad-hoc run with no source
    // definition falls back to its own workflowId.
    const scopeId = usageCtx.workflowDefinitionId ?? usageCtx.workflowId;
    const value = await incrementWorkflowVariable(usageCtx.db, usageCtx.tenantId, scopeId, key, step);
    return { output: String(value) };
  },

  'get-variables': async ({ node, usageCtx }) => {
    if (!usageCtx) throw new Error('The Get Variables node needs a tenant context to read state');
    const keys = typeof node.config.keys === 'string'
      ? node.config.keys.split(',').map((k) => k.trim()).filter(Boolean)
      : [];
    const out: Record<string, string> = {};
    for (const key of keys) {
      out[key] = await getWorkflowVariable(usageCtx.db, usageCtx.tenantId, 'run', usageCtx.workflowId, key);
    }
    return { output: JSON.stringify(out) };
  },

  'set-variables': async ({ node, inputText, usageCtx }) => {
    if (!usageCtx) throw new Error('The Set Variables node needs a tenant context to store state');
    // Authored as a JSON string — {"key": "value or {{input}}"} per entry.
    let values: Record<string, unknown> = {};
    if (typeof node.config.values === 'string') {
      try {
        const parsedValues = JSON.parse(node.config.values) as unknown;
        if (parsedValues && typeof parsedValues === 'object' && !Array.isArray(parsedValues)) {
          values = parsedValues as Record<string, unknown>;
        }
      } catch (error) {
        reportCaughtError(error, { source: 'application/workflow/nodes/io.ts', operation: 'set-variables.parseValues', level: 'warning' });
      }
    }
    const written: Record<string, string> = {};
    // One context for the whole map — the payload is parsed once per node, not per key.
    const valuesCtx = await expressionContext(inputText, usageCtx, Object.values(values));
    for (const [key, raw] of Object.entries(values)) {
      const value = renderValueTemplate(String(raw ?? ''), inputText, valuesCtx);
      await setWorkflowVariable(usageCtx.db, usageCtx.tenantId, 'run', usageCtx.workflowId, key, value);
      written[key] = value;
    }
    return { output: JSON.stringify(written) };
  },
};
