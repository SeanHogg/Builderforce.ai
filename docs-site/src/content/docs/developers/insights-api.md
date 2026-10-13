---
summary: "The Insights read API: export a site's overview, kept recordings and funnel results with a replay:read workspace key"
read_when:
  - Pulling Insights (session replay) numbers into your own warehouse or dashboard
  - Minting a key that can read Insights and nothing else
  - Understanding which Insights numbers are exact and which are estimates
title: "The Insights read API"
---

# The Insights read API

Base URL: `https://api.builderforce.ai/api/replay`

Three reads of a site's Insights data accept a workspace API key carrying the
`replay:read` scope, so a server of yours can export them without a member session:

| Read | Answers |
|---|---|
| `GET /overview?site={siteId}&days={1-90}` | Sessions, pages per session, active time, frustration shares, the daily trend and the top pages, referrers, countries, devices, browsers and operating systems |
| `GET /recordings?site={siteId}&days={1-90}&cursor={cursor}&limit={1-50}` | Kept recordings, newest first, 50 per page; follow `nextCursor` |
| `GET /funnels/{funnelId}/evaluate?site={siteId}&days={1-90}` | Visits per step, conversion from the previous step, median time between steps and the recordings that dropped at each step |

Nothing else under `/api/replay` accepts the key: segments, smart events, funnel
definitions, summaries and every write still need a signed-in member. A key never
acts as a person.

## Mint the key

Workspace keys are managed at `/api/tenants/{tenantId}/api-keys`. Mint one with only
the scope it needs:

```json
POST /api/tenants/{tenantId}/api-keys
{ "name": "Warehouse export", "scopes": ["replay:read"] }
```

The raw `bfk_…` key is returned once. Send it as a bearer token:

```bash
curl -H "Authorization: Bearer bfk_…" \
  "https://api.builderforce.ai/api/replay/overview?site=SITE_ID&days=30"
```

A key minted without `allowedOrigins` is server-only: a server-to-server call sends
no `Origin` and is accepted, a browser request is refused. With an allowed-origins
list, only those browser origins are accepted. The site's public `bfr_…`
snippet key carries only `replay:ingest` and is refused here.

`site` must be a site of the key's own workspace — another workspace's site, or an
unknown id, is the same `403`. The workspace must hold Insights (`403` otherwise).

## Filtering

All three reads take the same filter as the Insights screen, as query parameters
`f.<field>.<op>=<value>` (an `in` list is comma-separated, each item URI-encoded):

```
/overview?site=SITE_ID&days=30&f.device.eq=phone&f.frustration.in=rage,dead
```

Fields: `device`, `browser`, `os`, `country`, `referrer`, `entryPath`, `exitPath`,
`visitedPath`, `clickedSelector`, `frustration`, `durationMs`, `activeMs`,
`pageCount`, `release`, `smartEvent`, `tag` (`key=value`), `converted`, `variant`
and `issue` (an issue fingerprint). At most 12 clauses; an invalid clause is a `400`.

## Exact and estimated numbers

Insights counts every session but keeps full recordings only for the visits that
matter. So:

* An **unfiltered** overview is read from counts over every session and is exact
  (`"estimated": false`).
* A **filtered** overview, every funnel and the recording list are read from kept
  recordings, each weighted by how many sessions it stands for. Treat them as
  estimates: the overview says `"estimated": true`, a funnel always does, and a
  number a kept recording cannot know (new visitors, scroll depth) is `null`.
* A funnel reads at most the newest 20,000 matching recordings; `"truncated": true`
  says the ceiling was reached.

Answers are cached for up to five minutes and refresh as new visits arrive.
