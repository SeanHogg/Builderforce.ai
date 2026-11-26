---
summary: "Connect any MCP client to your Builderforce workspace over the hosted remote MCP server"
read_when:
  - Adding Builderforce to Claude, Cursor, Cline, Goose or another MCP client
  - Listing or consuming Builderforce as a remote MCP server
title: "Remote MCP server"
---

# Remote MCP server

Builderforce is a remote **MCP** server. Point any MCP client at it and that client
can run your workspace: create and move tickets, drive boards and swimlanes, read
and update portfolios, initiatives and OKRs, dispatch cloud coding agents, and
query executions.

- **Endpoint**: `https://api.builderforce.ai/mcp`
- **Transport**: Streamable HTTP (JSON-RPC 2.0), **stateless** — no session ids,
  no server→client stream
- **Auth**: `Authorization: Bearer bfk_…` (a tenant API key) for tool calls.
  Discovery (`initialize`, `ping`, `tools/list`) is **public** — no token needed.

## Get an API key

Settings → **API keys** → create a key. It looks like `bfk_…`.

The key's tenant is the scope of every tool call: a client authenticated with it
sees exactly the projects, boards and agents that tenant can see, and nothing else.
Treat it like a password — anyone holding it can act in your workspace.

## Connect a client

Most clients take the URL and a header. Claude Code, for example:

```bash
claude mcp add --transport http builderforce https://api.builderforce.ai/mcp \
  --header "Authorization: Bearer bfk_your_key"
```

Clients configured by file (Cursor, Windsurf, Cline, …) take the equivalent JSON:

```json
{
  "mcpServers": {
    "builderforce": {
      "type": "http",
      "url": "https://api.builderforce.ai/mcp",
      "headers": { "Authorization": "Bearer bfk_your_key" }
    }
  }
}
```

## What tools you get

The catalog is **per tenant**, so call `tools/list` for the live set. It is the
union of three sources:

| Source | What it is |
| --- | --- |
| Platform tools | First-party Builderforce actions — projects, tickets, boards, swimlanes, specs, approvals, portfolios, initiatives, OKRs, executions, cron, and more. |
| Connectors | Every connector your tenant has **connected**, executed through the connector runtime (SSRF-guarded and audited). |
| External MCP servers | Every MCP server your tenant has registered, relayed server-to-server with its stored secret. That secret is decrypted only on the server and never reaches a client. |

Tools that only read declare `annotations.readOnlyHint: true`. Anything else must
be treated as mutating — external servers cannot declare the flag, so an absent
hint means "assume it writes".

## Methods

`initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.

`initialize`, `ping` and `tools/list` answer **without a token**, so registries
and agents can see what the server does before sign-up. An anonymous
`tools/list` shows the public platform catalog only — never your connectors,
your registered MCP servers, or feature-gated tools. `tools/call` always
requires the key, and a presented-but-invalid key is a `401` challenge even on
discovery (it is never silently downgraded to the anonymous catalog).

The default profile handles MCP requests as `POST`. Its `GET` and `DELETE`
methods return `405`.

### Catalog notifications, resources, and prompts

Configure an MCP client with Streamable HTTP notification support to use
`https://api.builderforce.ai/mcp?profile=interactive` and the same Bearer header
on every request. Combine it with `&surface=readonly` or another tool surface when
you need a narrower catalog.

- Open the optional `GET` stream with `Accept: text/event-stream`. The server
  checks the authorized tool catalog every 30 seconds and sends
  `notifications/tools/list_changed` when the catalog changes. Fetch `tools/list`
  again when you receive it. The stream closes after four minutes or when the
  credential loses access. Reopen the stream and refresh the catalog if it closes.
- Use `resources/list` and `resources/read` to read the catalog guide at
  `builderforce://mcp/catalog`.
- Use `prompts/list` and `prompts/get` to load the `discover_tools` prompt.

## Verify it by hand

```bash
curl -s https://api.builderforce.ai/mcp \
  -H "content-type: application/json" \
  -H "Authorization: Bearer bfk_your_key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 400
```

Without a key the same call answers `200` with the public platform catalog —
the quickest way to confirm the endpoint is reachable. An unauthenticated
`tools/call` answers `401` with a `WWW-Authenticate: Bearer` challenge: calls
stay behind sign-in.

## Rate limits

The endpoint runs the same billable tools as the rest of the gateway and carries
the same per-tenant sliding-window limit. A throttled call answers `429`.

## Related

- [Gateway authentication](/docs/gateway/authentication)
- [OpenAI Chat Completions](/docs/gateway/openai-http-api)
