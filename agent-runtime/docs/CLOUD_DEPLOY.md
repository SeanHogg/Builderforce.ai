# Deploy a Cloud BuilderForce Agent — runbook

A **BuilderForce Agent** can run **On-Premise** (on your own machine) or in the
**Cloud** (deployed as below). Either agent type can be assigned to a swimlane
and will auto-execute its tasks. This runbook deploys a Cloud agent: it codes
against your repos with no browser open — it dials out to the Builderforce relay,
picks up swimlane `agent_dispatch` tasks, clones the bound repo through the host
git-proxy, runs the embedded agent, pushes a branch, opens a PR, and reports the
result so the ticket advances autonomously.

The whole loop is implemented and unit-tested:
- Runtime handler: `src/infra/builderforce-coding-dispatch.ts` (+ adapters, + the `agent_dispatch` case in `builderforce-relay.ts`).
- API contracts (in `../api`): `GET /api/agent-hosts/:id/dispatch/:dispatchId`, the host git-proxy, `POST /api/agent-hosts/:id/dispatch/:dispatchId/pull-request`, `POST /api/agent-hosts/:id/dispatch-result`.

## Prerequisite (one-time, blocks the Docker build)

`@builderforce/memory` must be published to npm. The Dockerfile runs
`pnpm install --frozen-lockfile`, and the lockfile references that package; until
it is published the build 404s. (Tracked in the root README gap register.)
Publish it, regenerate the lockfile (`pnpm install` in `agent-runtime`), commit,
then proceed.

## 1. Register the agent (get id + key)

```bash
curl -sX POST https://api.builderforce.ai/api/agent-hosts \
  -H "Authorization: Bearer <TENANT_JWT>" \
  -H 'Content-Type: application/json' \
  -d '{"name":"cloud-agent-1","machineProfile":{"machineName":"fly-iad"}}'
# → { "agentHost": { "id": <N> }, "apiKey": "<key>" }   (apiKey shown once)
```

Keep `<N>` (the instanceId) and the API key.

## 2. Provision Fly + the volume

```bash
cd agent-runtime
fly apps create builderforce-agent          # or edit app name in fly.toml
fly volumes create agent_data --size 10 --region iad
fly secrets set BUILDERFORCE_API_KEY=<key>  # the key from step 1
```

## 3. Seed the instanceId the relay reads at boot

The relay resolves its `agentNodeId` from `<stateDir>/.builderforce/context.yaml`
(`BUILDERFORCE_AGENTS_STATE_DIR=/data`). Write it once on the volume:

```bash
fly deploy --no-public-ips          # first boot to create the machine + mount
fly ssh console -C "mkdir -p /data/.builderforce"
fly ssh console -C "sh -c 'cat > /data/.builderforce/context.yaml <<EOF
builderforce:
  instanceId: \"<N>\"
EOF'"
fly apps restart builderforce-agent
```

(If the task's project is fixed, also add `projectId: \"<P>\"` under `builderforce:`.)

## 4. Verify it's online

```bash
curl -s https://api.builderforce.ai/api/agent-hosts/fleet \
  -H "Authorization: Bearer <TENANT_JWT>"   # the agent should appear, online
fly logs   # expect: "[builderforce] relay started for agentNode <N>"
```

## 5. Drive a coding task end-to-end

1. In the portal, create/connect the project + bind the GitHub repo (must have a
   `credentialId`; mark one repo `isDefault`).
2. Assign this agent to a swimlane (Board config → lane → Assign agent → pick this
   agent as the target; leave target blank to use the tenant's default agent).
3. Create a task and start its swimlane ticket so an `agent_dispatch` is created
   and routed to this agent.
4. Watch `fly logs`:
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
- Any container with outbound HTTPS works (Railway/Render/a VM with
  `docker run`) — Fly is just the reference. Set the same env + write the same
  `context.yaml` + secret. An On-Premise agent is the same runtime started on
  your own machine instead of a cloud host.
```
