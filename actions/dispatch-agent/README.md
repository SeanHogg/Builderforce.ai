# Builderforce — dispatch a cloud agent

File a Builderforce ticket from CI and hand it to a cloud coding agent.

```yaml
- uses: SeanHogg/Builderforce.ai/actions/dispatch-agent@main
  with:
    api-key: ${{ secrets.BUILDERFORCE_API_KEY }}
    project-id: 42
    title: "Fix the failing ${{ github.workflow }} build"
    body: |
      ${{ github.workflow }} failed on ${{ github.sha }}.
      Run: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
    priority: high
```

Create the API key in Builderforce under **Settings → API keys** and store it as a
repository secret. The key's tenant is the scope of everything the action can do.

## Inputs

| Input | Required | Default | Notes |
| --- | --- | --- | --- |
| `api-key` | yes | — | `bfk_…` tenant key. Never inline it. |
| `project-id` | unless `task-id` | — | Project the ticket belongs to. |
| `title` | unless `task-id` | — | Idempotent on project + title, so a re-run reuses the ticket. |
| `body` | no | — | The brief the agent works from. |
| `priority` | no | `medium` | `low` \| `medium` \| `high` \| `urgent`. |
| `task-id` | no | — | Dispatch an existing ticket instead of creating one. |
| `endpoint` | no | `https://api.builderforce.ai/mcp` | Override for self-hosted. |
| `wait` | no | `false` | Block until the run reaches a terminal state. |
| `timeout-minutes` | no | `30` | Applies when `wait` is true. |
| `fail-on-error` | no | `true` | Fail the job when a waited run ends unsuccessfully. |

## Outputs

`task-id`, `task-url`, `execution-id`, `status`, `deduped`.

```yaml
- id: dispatch
  uses: SeanHogg/Builderforce.ai/actions/dispatch-agent@main
  with:
    api-key: ${{ secrets.BUILDERFORCE_API_KEY }}
    project-id: 42
    title: "Nightly dependency sweep"
    wait: true
- run: echo "Ticket ${{ steps.dispatch.outputs.task-url }} → ${{ steps.dispatch.outputs.status }}"
```

## How it works

The action speaks to Builderforce's [remote MCP server](https://builderforce.ai/docs/gateway/mcp)
(`POST /mcp`, JSON-RPC 2.0) — the supported machine surface for a tenant key — so
CI needs one credential and one URL. It calls three tools: create the ticket,
submit an execution, and (when waiting) poll that execution.

Ticket creation is idempotent on project + normalised title. If Builderforce
declines to auto-start the ticket, the action says so as a `::notice::` rather
than implying work began.

## Waiting

Polling backs off from 5s to 30s so a long run does not spend its rate-limit
budget on status checks. If the timeout is reached the run is *not* cancelled —
the job either fails or warns, per `fail-on-error`, and the execution continues
in Builderforce.
