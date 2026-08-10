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
- **Auth**: `Authorization: Bearer bfk_…` (a tenant API key)

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

Because the server is stateless, `GET /mcp` and `DELETE /mcp` return `405`: there
is no stream to open and no session to end. Send everything as `POST`.

## Verify it by hand

```bash
curl -s https://api.builderforce.ai/mcp \
  -H "content-type: application/json" \
  -H "Authorization: Bearer bfk_your_key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 400
```

Without a key the same call answers `401` with a `WWW-Authenticate: Bearer`
challenge — which is also the quickest way to confirm the endpoint is reachable.

## Rate limits

The endpoint runs the same billable tools as the rest of the gateway and carries
the same per-tenant sliding-window limit. A throttled call answers `429`.

## Related

- [Gateway authentication](/docs/gateway/authentication)
- [OpenAI Chat Completions](/docs/gateway/openai-http-api)
