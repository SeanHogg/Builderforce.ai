---
summary: "The Builderforce.ai vendor API: install webhooks, the install-scoped token exchange, acting on a customer's behalf, and reporting metered usage"
read_when:
  - Building the integration server behind a published extension
  - Handling installation.created and provisioning for a new customer
  - Exchanging a publisher key for an install-scoped token
  - Reporting metered usage for billing
title: "The vendor API"
---

# The vendor API

Base URL: `https://api.builderforce.ai/api/v1`

Your integration server has two different things to say to us, and they use two
different credentials.

| Credential | Says | Lifetime | Reaches |
|---|---|---|---|
| **Publisher key** (`bfk_…`) | "I am Acme Payroll" | Long-lived | Your own installs. No customer data. |
| **Install token** | "I am Acme Payroll, acting for the workspace that installed me" | 5 minutes | Exactly the scopes that install's admin approved |

A long-lived key that could act for every customer is a key whose compromise is
every customer's problem. That is the whole reason the exchange exists.

Mint a publisher key where every other workspace key is managed
(`/api/tenants/{tenantId}/api-keys`), with the `read:installs` scope. Use
`write:packages` for a CI key that ships versions — it deliberately cannot act for
customers.

## 1. You are told about an install

Register a webhook subscription in your own workspace and subscribe to:

* `extension.installation.created` — a workspace that has never installed this before
* `extension.installation.updated` — a returning customer, or a plan change
* `extension.installation.removed` — a cancellation

Provision on `created`; do not re-provision on `updated`.

```json
{
  "type": "extension.installation.created",
  "id": "<occurrence>",
  "data": {
    "installId": "e2f1…",
    "packageId": "…",
    "packageSlug": "acme-payroll",
    "versionId": "…",
    "semver": "1.2.0",
    "grantedScopes": ["tools:call", "read:projects"],
    "planCode": "pro",
    "subscriptionState": "active"
  }
}
```

**`installId` is the only identity that crosses.** You learn that an install
happened, on what plan, at what version — not who the customer is. Their workspace
id, name and members are deliberately absent, because no scope in the vocabulary
says "tell the publisher who I am", so no admin has agreed to it. A customer who
wants you to know will tell you.

### Verifying a delivery

Every delivery is HMAC-SHA256 signed with your subscription's secret and is
replay-protected:

1. Read `X-BF-Webhook-Id`, `X-BF-Webhook-Timestamp`, `X-BF-Signature`.
2. Reject if `|now − timestamp| > 300s`.
3. Recompute `sha256=HMAC(secret, "{id}.{timestamp}.{rawBody}")` and compare in
   constant time.
4. Reject if you have already processed that id.

Failed deliveries are retried with capped exponential backoff (5m → 10m → 20m →
40m → 80m, six attempts).

If you miss deliveries, reconcile with `GET /extensions/installs`.

## 2. Exchange for an install token

```http
POST /api/v1/extensions/token
Authorization: Bearer bfk_…
Content-Type: application/json

{ "installId": "e2f1…", "scopes": ["read:projects"] }
```

```json
{
  "access_token": "eyJ…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "read:projects",
  "install": { "id": "e2f1…", "package": "acme-payroll", "version": "1.2.0", "plan": "pro" }
}
```

`scopes` narrows and can never widen: asking for something the admin did not
approve returns a token without it rather than an error, so a partially-granted
install stays partially usable.

**There is no second consent screen.** The install *is* the grant — an admin
already read the scope list and pressed Install, and asking them to approve the
same scopes again on your site is exactly the extra step that kills marketplace
conversion.

Tokens live five minutes and are not tunable. Mint one per burst of work; do not
cache them across periods of idleness.

### Revocation is immediate

Every call re-reads the install, so a live token stops working the instant the
customer uninstalls, the instant an admin narrows the grant, and the instant a
subscription is cancelled. There is no cache to wait out.

## 3. Find out what you may do

```http
GET /api/v1/extensions/me
Authorization: Bearer <install token>
```

Call this first. Without it, an integration granted less than it expected
discovers the fact as an unexplained `403` on a business call.

## 4. Reporting usage

```http
POST /api/v1/extensions/usage
Authorization: Bearer <install token>
Content-Type: application/json

{ "usageId": "run_8814", "units": 12, "note": "payroll run", "occurredAt": "2026-08-25T09:31:00Z" }
```

```json
{
  "recorded": true,
  "units": 12,
  "period": {
    "units": 1412, "unitLabel": "document", "includedUnits": 1000,
    "projectedCents": 824, "currency": "USD", "since": "2026-08-01T09:30:00Z"
  }
}
```

* **`usageId` is the idempotency key.** A retry returns `recorded: false` and a
  200 — our word that the occurrence is counted exactly once. Never re-report
  under a new id.
* `units` must be a positive whole number, at most 1,000,000 per report. The cap
  exists because the number becomes a real charge on a real invoice, and a bug
  that reports 10¹² calls should be refused at the door rather than discovered on
  a credit note.
* `occurredAt` is clamped into the open period. You choose *when* within it; you
  do not choose which invoice.
* `period` is what the customer sees too, computed by the same function that will
  price the close — so what you show them and what we bill cannot disagree.

No scope is required beyond holding the token: reporting usage is you telling us
what to bill for your own product, not an act on the customer's data.

## 5. Reconciling

```http
GET /api/v1/extensions/installs?package=acme-payroll&limit=100
Authorization: Bearer bfk_…
```

Returns install ids, packages, versions, plans, subscription states and install
dates — the handles you need to serve, and nothing that identifies a customer.

## The contract, machine-readable

`GET /api/v1/extensions/contract` returns the token exchange path, the usage path
and the current webhook event list. Read it rather than hard-coding our
vocabulary.
