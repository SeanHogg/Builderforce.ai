# Kimi Code hosted integration approval request

Status: ready for owner review and submission  
Product: Builderforce.ai  
Public site: https://builderforce.ai  
Source: https://github.com/SeanHogg/Builderforce.ai

## Submission route

Submit this request through the official Kimi API sales form:

https://platform.kimi.ai/contact-sales

Also send it through the Kimi Code support channel linked from:

https://www.kimi.com/code/docs/en/kimi-code/faq.html

Do not submit API keys, bearer tokens, full request bodies, customer prompts, or
unredacted logs. If Kimi requests a reproduction, provide a newly generated test
key through the secure channel they nominate.

## Subject

Builderforce.ai request for approved hosted Kimi Code integration and delegated user authorization

## Request

Hello Kimi Code team,

Builderforce.ai is a human-in-the-loop agentic development platform. Users run
coding agents from our web application and VS Code integration on scalable
Cloudflare infrastructure. We would like an officially approved way for an
individual Kimi Code subscriber to authorize Builderforce and have that user's
agent calls consume only that user's Kimi Code entitlement.

Our current integration uses the documented OpenAI-compatible Kimi Code endpoint:

`POST https://api.kimi.com/coding/v1/chat/completions`

We identify the client truthfully as `Builderforce.ai`; we do not impersonate
Kimi Code CLI, Claude Code, Codex, or another approved client. Requests from our
hosted gateway currently receive an edge-generated HTTP 403 before the supplied
user key appears to be validated.

We understand that Moonshot Open Platform is the supported pay-as-you-go product
for general hosted inference, and Builderforce already supports it as a separate
provider. This request is specifically about an approved, user-delegated Kimi
Code integration—not converting, pooling, reselling, or sharing subscription
credentials.

Could you advise which supported integration path applies?

1. Registration or allowlisting of Builderforce's real client identity and
   production egress;
2. OAuth 2.0, device authorization, or another delegated authorization flow for
   third-party hosted coding clients;
3. A partner SDK or partner-specific endpoint for Kimi Code subscriptions; or
4. A commercial agreement that permits this hosted, per-user use case.

We are willing to implement Kimi's required client identifier, redirect URIs,
token lifecycle, rate-limit handling, abuse controls, and user-facing disclosures.
We will not spoof a first-party client identifier or route traffic through an
unidentified proxy.

### Product and traffic profile

- Legal entity: **TODO — legal company/entity name**
- Primary contact: **TODO — name and business email**
- Product URL: https://builderforce.ai
- Integration surface: hosted web application plus VS Code extension
- Execution infrastructure: Cloudflare Workers and isolated cloud agent runtimes
- Users authenticate to Builderforce and connect their own provider account
- Expected active Kimi users/month: **TODO**
- Expected requests/month: **TODO**
- Expected input/output tokens/month: **TODO**
- Primary user regions: **TODO**
- Production egress addresses/ranges: **TODO — provide if stable; otherwise state that Cloudflare egress is dynamic**
- Requested launch date: **TODO**

### Credential and tenant controls

- Provider credentials are scoped to the connecting Builderforce tenant.
- Credentials are encrypted at rest with AES-256-GCM and are not displayed again.
- A user's Kimi credential is used only for that tenant's explicitly selected
  Kimi models.
- Kimi Code and Moonshot Open Platform are separate providers, endpoints, and
  credential slots in the product.
- Credentials can be replaced or deleted by the user.
- Requests and provider failures receive trace identifiers for support and audit.
- Builderforce applies tenant authentication, tenant isolation, rate limits, and
  human approval controls around agent activity.
- We can pass an approved tenant/user pseudonymous identifier if Kimi requires
  one, but will not send direct personal data without an agreed purpose and format.

### Current request identity

```http
POST /coding/v1/chat/completions HTTP/1.1
Host: api.kimi.com
Authorization: Bearer [user-owned Kimi Code key]
Content-Type: application/json
User-Agent: Builderforce.ai
```

We can change the `User-Agent` to a versioned identifier and add an agreed
application/client ID header after Kimi supplies the required format. We prefer a
delegated token with explicit audience and scopes over collection of long-lived
subscription API keys if such a flow is available.

### Approval questions

Please confirm:

1. Whether hosted third-party coding agents may consume an individual user's
   Kimi Code subscription after explicit user authorization;
2. The required registration, review, and commercial terms;
3. The authentication grant, scopes, token lifetimes, refresh/revocation behavior,
   and redirect URI requirements;
4. The required client identity headers and whether production egress must be
   registered;
5. Whether concurrent cloud-agent or sub-agent calls are permitted and which
   account-level concurrency limits apply;
6. Whether Builderforce may display Kimi model names and marks in its provider
   picker, and any branding requirements;
7. Required retention, logging, incident-reporting, and abuse-response controls;
8. A sandbox or test entitlement and a technical contact for certification.

Thank you. We can provide an architecture diagram, redacted request/response
trace, data-flow inventory, security controls, and production traffic forecast
for review.

## Internal implementation evidence

The existing implementation already preserves the product boundary needed for
review:

- `api/src/application/llm/vendors/openaiCompatibleVendors.ts` registers
  `kimi-code` and `moonshot` as different vendors, on different hosts, and sends
  the truthful `User-Agent: Builderforce.ai` identity for Kimi Code. The
  `moonshot` vendor targets the Open Platform (`api.moonshot.ai`, with
  `api.moonshot.cn` resolved automatically for China-platform keys) and never
  the Kimi Code coding endpoint.
- `api/src/application/llm/tenantProviderKeyService.ts` maps the two credential
  types to distinct encrypted tenant key fields.
- `api/src/application/llm/vendors/types.ts` captures a redacted
  `UpstreamDiagnostic` for every failed upstream call — endpoint, HTTP status,
  an allowlist of correlation headers (`cf-ray`, `x-request-id`, `server`,
  `date`, …), and an `edgeBlocked` flag set when the response body is an HTML
  page rather than the API's JSON error envelope. No credential, prompt, or
  request body is retained.
- `api/src/presentation/routes/llmRoutes.ts` branches on that `edgeBlocked`
  flag, so an edge-generated hosted 403 is reported as an edge rejection and is
  never misreported as successful key validation or as a bad key.
- `frontend/src/components/ProviderKeysSettings.tsx` exposes separate Kimi Code
  and Moonshot Open Platform connections, and offers the redacted trace for
  download on any failed connection test (see below).

### How to produce the redacted 403 trace for this submission

1. Connect the Kimi Code subscription key under **Settings ▸ Integrations ▸ Kimi**.
2. Click **Test connection**. This sends one small real request, billed to the
   account under test.
3. When it fails, click **Copy diagnostic trace** on the result line. The
   clipboard receives a block of the form below — already redacted, and safe to
   paste into a Kimi support ticket as-is.

```text
Builderforce.ai upstream diagnostic (redacted)
observed-at:   2026-08-02T10:00:00.000Z
trace-id:      llm-<uuid>
endpoint:      POST https://api.kimi.com/coding/v1/chat/completions
model:         kimi-for-coding
http-status:   403
edge-blocked:  yes (response body was an HTML page, not the API error envelope)
response-headers:
  cf-ray: <edge node id>
  server: <server>
  date: <date>
No credential, prompt, or request body is included.
```

`edge-blocked: yes` is the evidence for the claim in this request: the response
never reached the Kimi API's JSON error envelope, so the supplied user key was
not the thing that was rejected.

## Certification plan after Kimi responds

1. Record Kimi's written authorization and integration requirements.
2. Add the assigned client ID/authentication grant without changing or spoofing
   another client's identity.
3. Keep Kimi Code and Open Platform credentials separate in storage and routing.
4. Add tests for authorization, refresh, revocation, user disconnect, tenant
   isolation, concurrency limits, 401/402/403/429 handling, and redacted logging.
5. Run certification using a dedicated test tenant and non-production repository.
6. Enable production access behind a feature flag until Kimi signs off.

## Submission checklist

- [ ] Replace every `TODO` above.
- [x] Attach a redacted 403 trace with timestamp, response headers, request ID (if
      present), endpoint, model, and Builderforce trace ID. **Obtainable in-product** —
      see "How to produce the redacted 403 trace" above. Paste the copied block here
      before submitting.
- [ ] Confirm the privacy policy and terms URLs to give Kimi.
- [ ] Confirm whether Cloudflare provides stable egress for this deployment; do
      not claim fixed IPs unless verified.
- [ ] Submit through Kimi Code support and the Moonshot sales form.
- [ ] Save the case/ticket number here: **TODO**
- [ ] Do not deploy any client-identity change until Kimi documents or approves it.
