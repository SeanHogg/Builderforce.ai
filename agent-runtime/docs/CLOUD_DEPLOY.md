# Deploy a self-hosted (On-Prem) BuilderForce Agent — runbook

A **BuilderForce Agent** runs in one of two places:

- **Cloud (V2)** — needs **no separate deploy**. A cloud agent executes inside the
  Builderforce **api Worker** on Cloudflare: the `durable` surface runs on the
  `CloudRunnerDO` Durable Object (one LLM step per alarm tick) and the `container`
  surface targets a Cloudflare Container. Both ship with `api` (`npm run deploy`
  there); you just create the agent in the portal and pick its `runtime_surface`.
- **On-Prem (self-hosted)** — the `agent-runtime` process below, running on *your*
  machine (or any container host with outbound HTTPS). This runbook covers that.

A self-hosted agent codes against your repos with no browser open: it dials out to
the Builderforce relay, picks up swimlane `agent_dispatch` tasks, clones the bound
repo through the host git-proxy, runs the embedded agent, pushes a branch, opens a
PR, and reports the result so the ticket advances autonomously.

The loop is implemented and unit-tested:
- Runtime handler: `src/infra/builderforce-coding-dispatch.ts` (+ adapters, + the `agent_dispatch` case in `builderforce-relay.ts`).
- API contracts (in `../api`): `GET /api/agent-hosts/:id/dispatch/:dispatchId`, the host git-proxy, `POST /api/agent-hosts/:id/dispatch/:dispatchId/pull-request`, `POST /api/agent-hosts/:id/dispatch-result`.

> The stack is **Cloudflare-only** (Workers + Durable Objects + R2 + KV). There is
> no Fly.io / managed-cloud deploy of `agent-runtime` — a self-hosted agent is just
> this runtime started wherever *you* choose to run it.

## 1. Register the agent (get id + key)

```bash
curl -sX POST https://api.builderforce.ai/api/agent-hosts \
  -H "Authorization: Bearer <TENANT_JWT>" \
  -H 'Content-Type: application/json' \
  -d '{"name":"agent-1","machineProfile":{"machineName":"my-host"}}'
# → { "agentHost": { "id": <N> }, "apiKey": "<key>" }   (apiKey shown once)
```

Keep `<N>` (the instanceId) and the API key.

## 2. Run the runtime (any host with outbound HTTPS)

Run `agent-runtime` as a long-lived process — directly on a machine (`pnpm start`)
or as a container (`docker run`) on whatever infra you control (your laptop, a VM,
Railway/Render, etc.). It needs:

- `BUILDERFORCE_API_KEY=<key>` — the key from step 1.
- `BUILDERFORCE_AGENTS_STATE_DIR=<dir>` — a **persistent** directory (the relay
  reads/writes its identity + memory here; back it with a volume on a container host).

```bash
# Container form (mount a volume at the state dir so identity survives restarts):
docker run -d --restart=unless-stopped \
  -e BUILDERFORCE_API_KEY=<key> \
  -e BUILDERFORCE_AGENTS_STATE_DIR=/data \
  -v agent_data:/data \
  <your-agent-runtime-image>
```

## 3. Seed the instanceId the relay reads at boot

The relay resolves its `agentNodeId` from
`<stateDir>/.builderforce/context.yaml`. Write it once on the persistent dir
(a host path, or via `docker exec` / your platform's shell):

```bash
mkdir -p <stateDir>/.builderforce
cat > <stateDir>/.builderforce/context.yaml <<EOF
builderforce:
  instanceId: "<N>"
EOF
# restart the runtime so it picks up the identity
```

(If the task's project is fixed, also add `projectId: "<P>"` under `builderforce:`.)

## 4. Verify it's online

```bash
curl -s https://api.builderforce.ai/api/agent-hosts/fleet \
  -H "Authorization: Bearer <TENANT_JWT>"   # the agent should appear, online
# runtime logs should show: "[builderforce] relay started for agentNode <N>"
```

## 5. Drive a coding task end-to-end

1. In the portal, create/connect the project + bind the GitHub repo (must have a
   `credentialId`; mark one repo `isDefault`).
2. Assign this agent to a swimlane (Board config → lane → Assign agent → pick this
   agent as the target; leave target blank to use the tenant's default agent).
3. Create a task and start its swimlane ticket so an `agent_dispatch` is created
   and routed to this agent.
4. Watch the runtime logs:
   - `received agent_dispatch dispatch=<id>`
   - git clone via `/api/agent-hosts/<N>/git-proxy/<repoId>`
   - agent edits → push → PR open
5. The PR URL lands on `tasks.githubPrUrl` (kanban card) and the ticket advances.

## Notes

- The provider git token is **never** sent to the agent: git authenticates to the
  host git-proxy with the agent's own API key (HTTP extra-header); the proxy
  injects the real token server-side.
- PR creation is GitHub-only today; other providers push the branch and report
  "open a PR manually" (tracked in the gap register).
- A **Cloud** agent is *not* deployed this way — it runs in the api Worker (see the
  intro). Use this runbook only for self-hosted / On-Prem agents.
```
