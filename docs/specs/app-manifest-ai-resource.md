# App manifest `ai` resource — end state

Status: revision 3 — the nine required edits of the first architecture-and-auth review (chat #288, Mike QA, 2026-11-21) and the three edits of the second review (2026-11-22, same reviewer) are applied below. Acceptance of this revision is recorded in the Review gate. Gaps A–D are logged in `ROADMAP.md` (Run). This file is the contract. Do not implement a different shape.

Evidence: chat #168661 (server #287), project 103 Yardfire. The launcher rejected `services.agent` (missing `command`; role `agent` is not `frontend`/`backend`).

## Decision

Manifest v1 gains one resource type, `ai`: `{ "type": "ai", "models"?: string[] }`. An agent inside the app is an ordinary service, `role: "backend"`, with `"uses": ["<ai id>"]`. Roles stay `frontend` | `backend`. Do not add a role `agent`.

A service that uses an `ai` resource receives `AI_BASE_URL`, an OpenAI-compatible base (ending `/v1`) with no key in the browser process. The host adds the signed-in session and forwards to `POST /v1/chat/completions` on the API gateway host (`api/src/presentation/routes/llm/chatCompletionsRoutes.ts`, mounted by `llmRoutes`). There is no dedicated `https://builderforce.ai/gateway` model proxy — that origin is the API's primary host and the campaign-tracking origin; the chat-completions route on it is the forward target. Process egress stays `PREVIEW_DEFAULT_EGRESS`.

`connection` → browser `yes('vault')` is an acknowledged false capability today. This pass does NOT inject vault secrets into process env (review edit 2). Delivery, when it lands (ticket #6999), is a localhost relay that attaches the secret host-side — the same shape as `ai`. Until that relay exists, the row stays as an acknowledged false `yes('vault')`; do not retire it and do not claim this pass makes it true.

## Contract

### 1. Manifest type

```ts
export interface AiResource {
  type: 'ai';
  /** Allowlist. Absent: the platform router picks. A request whose model is outside the list is rejected at the host relay, not forwarded. */
  models?: string[];
}
```

Add it to `ResourceSpec`. `ResourceType` stays derived from `ResourceSpec['type']`.

Validation (`validate.ts`), no new issue code:

- `models` absent is valid.
- `models` present must be a list of strings (`invalid-value` otherwise — `stringArray` already emits that code).
- A service `uses` entry that names an `ai` resource is an ordinary `uses` reference. A `frontend` that uses it already gets `frontend-uses-credentials` (`validate.ts:160`, for every resource type). Keep that warning. Do not inject `AI_BASE_URL` into a frontend.

Regression fixture (must validate with zero errors), standing in for the Yardfire manifest:

```json
{
  "version": 1,
  "name": "yardfire",
  "resources": { "assistant": { "type": "ai", "models": ["builderforce"] } },
  "services": {
    "api": {
      "runtime": "node",
      "command": "node server.js",
      "role": "backend",
      "port": 8787,
      "uses": ["assistant"]
    }
  },
  "environments": { "local": { "target": "browser", "tier": "non-production" } }
}
```

`role: "agent"` remains `invalid-value`. A service with no `command` remains `missing-field`.

### 2. Capability matrix — one row per target, no false `yes`

A capability may only flip to `yes` in the SAME change that lands its delivery. Never in an earlier commit.

| Target | `ai` | Why |
|---|---|---|
| `browser` | `yes('host-relay')` — ships with the relay in the same change | Page-side gateway on the port registry; in-process `HostRelay`. No token in the process. |
| `cloudflare` | `no('app-token')` this pass | No app-scoped token acceptor exists on `POST /v1/chat/completions` today (the review searched; none found). The tenant meter DOES exist and is named: `logUsage` (`api/src/application/llm/gatewayUsageLog.ts`, called from `chatCompletionsRoutes.ts` streaming and non-streaming paths) meters into the tenant ledger. The row flips to `yes` only when an app-scoped token acceptor is added to that route AND the delivery (§7) lands in the same change. |
| `aws`, `azure`, `gcp` | `no(…)` | Not built this pass. A `yes` without delivery would repeat the `connection` lie. |

`connection` stays `yes('vault')` on every target as an ACKNOWLEDGED false capability on `browser` until the localhost secret relay of ticket #6999 exists. Do not retire the row; do not "fix" it by putting secrets in the worker.

### 3. Spec mapping

`toApplicationSpec` today (`toApplicationSpec.ts:128-131`) turns a supported non-postgres resource into a decline ("provisioned by its deployment…") unless the type is `connection`. `ai` is host-delivered, not a process. Generalise that exception to a `HOST_DELIVERED` set: `connection`, `ai`. Do not add another `if`.

`uses` is not copied onto `ServiceSpec` today, and `serviceEnv` cannot see it. Add one optional field, not a new service type:

```ts
/** Host-delivered resources this service uses. Not `dependsOn` — nothing to wait for. Browser-runtime seam only. */
resourceUses?: readonly { id: string; type: 'ai' | 'connection'; models?: readonly string[] }[];
```

`applicationService` fills it from `uses` for those two types only. Databases stay on `dependsOn` as they are.

`resourceUses` is the BROWSER `ServiceSpec` seam only. Cloudflare deploy does not consume `ApplicationSpec`; the artifact Cloudflare shares is the manifest itself (`uses` + resource `type`). Do not describe `resourceUses` as a seam Cloudflare reads.

A browser environment with the fixture above must return a spec (not a decline) whose `api` service has `resourceUses: [{ id: 'assistant', type: 'ai', models: ['builderforce'] }]`.

### 4. What the process is allowed to see

`serviceEnv` grows ONE optional callback next to `databaseCredentials`. Core never mints a token and never embeds a gateway URL of its own.

```ts
aiEndpoint?(resourceId: string, client: ServiceSpec): { baseUrl: string } | undefined;
```

Rules, same credential policy as databases (`CREDENTIAL_POLICY`):

- Frontend: returns nothing, even if `resourceUses` names the resource.
- Backend, exactly one `ai` use: `AI_BASE_URL=<baseUrl>` (no trailing slash; the app appends `/chat/completions`).
- Backend, several `ai` uses: `<ID>_AI_BASE_URL` for each, and `AI_BASE_URL` only when there is exactly one.
- Never set `OPENAI_API_KEY`, `AI_API_KEY`, or `Authorization` material.

There is NO `connectionEnv` callback. Vault material is never injected into process env, the worker script, the manifest, or the workspace tree — a secret in the worker is stealable AND still unusable (process egress cannot reach the vendor and must not be widened). Database logins are page-minted, random, localhost-only (`databaseCredentials.ts`); a vault secret is not that pattern and must not be copied into it.

`connection` delivery (ticket #6999, separate slice): the process gets a localhost base URL and the host attaches the vault secret on the way out — the same relay shape as `ai`. The env key names and header shape come from the vault's real Connected Account code at implementation time; do not invent a `CONNECTION_<ID>_*` field list. A service that does not `uses` the connection gets nothing. Until that relay exists, `connection` remains the acknowledged false capability of §2.

The browser runtime is the only caller that fills the callback.

### 5. Browser gateway — host-held session, no postMessage auth hop, no egress widening

Pattern to copy: `databaseCredentials` + `pgGateway` + the port registry (`connectionRelay.ts`). Difference: HTTP, not the Postgres wire protocol — and the host call is a direct function call in the page that holds the session (web), or the launcher's existing token-gated loopback API (VSIX, §6). Never a message hop. `connectionRelay.post()` is the page↔process-worker byte channel; it is not the extension host and it is not an auth boundary. A `postMessage` listener the preview iframe can reach is how a stolen preview origin spends the tenant meter.

```
process  --localhost dial-->  port registry  -->  page gateway  --function call-->  HostRelay.forwardAi
HostRelay (web: IDE page, in-process · VSIX: launcher page → token-gated /__bf hop → extension host)
         --signed-in session-->  POST /v1/chat/completions on the API host  -->  model
```

Hard rules:

- Do not add the API host (or any model host) to `PREVIEW_DEFAULT_EGRESS` (`['https://esm.sh']`, `previewHeaders.ts:70`), worker `connect-src`, or preview-document `connect-src`. The preview document must not be the component that fetches the gateway.
- The page gateway calls `HostRelay.forwardAi` as a function — in-process on web; on VSIX the adapter's one hop is the launcher's token-gated `/__bf` API (§6). Accept a forward ONLY from that gateway. Do not register the gateway port as ingress and do not publish it on a preview origin.
- Port policy admits only a backend whose `resourceUses` names that resource — the same rule as `mayConnectToDatabase`.
- Strip the request `Authorization` header. Strip response `Set-Cookie`, `Authorization`, and `WWW-Authenticate` before any byte returns to the process.
- The session is attached by the host that holds it: the web app's IDE page (in-process), or the VSIX extension host reached over the launcher's existing token-gated loopback `/__bf` API (§6). It forwards to `POST /v1/chat/completions` on the API gateway host. It streams SSE. It does not buffer the completion.
- The host rejects a `model` outside that resource's `models` allowlist before the forward. The allowlist comes from the launch spec/manifest the HOST read — never from process-supplied bytes. Absent allowlist: the gateway's existing cascade router decides. Do not add a second router.
- Metering is the route's existing tenant meter: `logUsage` (`gatewayUsageLog.ts`) into the tenant ledger, already wired on both the streaming and non-streaming paths of `chatCompletionsRoutes.ts`. Do not add a side counter.
- No token is ever sent back to the process, logged, or put in a tool result.

### 6. One wiring seam for the two browser launchers — thread the relay, do not add a second entry

Both browser launchers ALREADY enter `startApplicationRuntime`: web at `frontend/src/lib/runTarget/browserRunTarget.ts:100` (IDE page), and the VSIX product through the local launcher's page — `/launch` calls `createLocalLauncher` (`clients/vscode/src/composerCommands/host.ts` → `packages/browser/src/launcher/server/launcher.ts`), a loopback HTTPS server whose page (the `localhost` page origin) boots the runtime via `launcher/page/bootApplication.ts:73` (`BootDeps.startApplicationRuntime`). There are no references under `clients/vscode` source because the call lives in the launcher page, not the extension host. The work is threading a `HostRelay` through `createLocalLauncher` options → launch info (`launcher/protocol.ts`) → the page's `BootDeps` / `ApplicationRuntimeOptions` — not adding a call under `clients/vscode`. Do not fork a second port or env injector in the client.

`HostRelay` is an in-process function the launcher passes in — browser-only, not a Cloudflare seam:

```ts
interface HostRelay {
  /** OpenAI-compatible forward to POST /v1/chat/completions on the API host. Host adds the session. Never returns a token. */
  forwardAi(req: { resourceId: string; models?: readonly string[]; body: Uint8Array; stream: boolean }): AsyncIterable<Uint8Array>;
  /** Vault material for one Connected Account. Host-side only; used by the connection relay (#6999), never returned to the process. */
  connectionSecrets(connectionId: string): Promise<Record<string, string>>;
}
```

- The web adapter runs in the IDE page (where `browserRunTarget.ts` already enters `startApplicationRuntime`), not the preview document. Its `forwardAi` is a direct in-process call.
- The VSIX adapter lives in the LAUNCHER PAGE (the `localhost` page origin the launcher serves), not the extension host and not the webview: the page gateway cannot call a separate Node process in-process. Its `forwardAi` crosses ONE token-gated loopback hop on the launcher's existing page-origin-only `/__bf` API (Host allowlist + per-launch fragment token, `launcher/server/launcher.ts`) to the extension host, which attaches the session. This is not a postMessage listener; preview origins (`<key>.localhost`) are classified off the page origin and are never served `/__bf`.
- `startApplicationRuntime` (the existing database-credential hook is the pattern) asks the relay, registers the page gateway, and passes `aiEndpoint` into `serviceEnv`. The clients supply a `HostRelay`; they do not each open a port or inject env.

### 7. Cloudflare — `no('app-token')` until the acceptor exists

Not the port registry. The deploy path reads the MANIFEST (`uses` + resource `type`), not `resourceUses`.

The future delivery, gated on prerequisites that do not exist today:

- `AI_BASE_URL` = the API gateway host's `/v1` base.
- A server-minted app-scoped token in a Worker secret or binding, never in the repo, never a user session token.
- The Worker (not the browser process) may hold that token; "no token in the worker" applies to the browser process worker.
- App code never reads the token. The starter calls `AI_BASE_URL` with no `Authorization`. A platform wrapper (not the shop route) attaches the binding.

Prerequisites, both named in code before the capability flips: (1) an app-scoped token acceptor on `POST /v1/chat/completions` (`chatCompletionsRoutes.ts` / `gatewayAccess.ts`) — none exists today; (2) the existing tenant meter (`logUsage`, `gatewayUsageLog.ts`) metering that token's calls — this exists. Adding the acceptor is a later slice; until it and the delivery land in one change, `cloudflare` stays `no('app-token')`. Do not mark `yes` early.

### 8. Agent tools — own catalog, not `builtinMcpService.ts`

New file next to `appBlueprintToolCatalog.ts`: `appManifestToolCatalog.ts`. Spread once, the way `APP_BLUEPRINT_TOOLS` is spread (~line 4194 of `builtinMcpService.ts`). Implementations do not grow into `builtinMcpService.ts`.

Both tools import from `@seanhogg/builderforce-webcontainers-core/manifest` — the pure-core export (verified in `packages/core/package.json` `exports`: `.`, `./check`, `./app`, `./manifest`; none pulls `packages/browser`). It exports `validateManifest`, `APP_MANIFEST_SCHEMA_V1`, `RESOURCE_CAPABILITIES`, `resourceCapability`, `toApplicationSpec`, `describeManifestIssue`. No second validator. No API dependency on the browser package.

- `app_manifest.schema` — args `{ target?: ManifestTargetId }`. Returns `APP_MANIFEST_SCHEMA_V1`, a short field guide (version, services require `runtime`+`command`, roles, `uses`, the `ai` shape), and `RESOURCE_CAPABILITIES` for that target (default `browser`).
- `app_manifest.validate` — args `{ projectId?: number; content?: string; path?: string; environment?: string }`. One of `content` or `path`. When `path` is given, `projectId` is REQUIRED and checked with `ownedProjectId` (the same tenant boundary as `app_blueprint.detect`/`get`, `appBlueprintToolCatalog.ts:63`) before any repo read. Content-only validation needs no repo read and no `projectId`. Returns the typed issues from `validateManifest` plus, when `environment` is set, capability declines from `toApplicationSpec` for that environment. The launcher's accept/reject must be this result, not a parallel check.

The finder is `findTools` in `brain-embedded/src/toolRouter.ts` (keyword scoring over tool name + description; there is no `tools_find` symbol under `api/src` and no alias table today). Add a small alias expansion NEXT TO `findTools` mapping exactly these phrases to both tools: `app manifest`, `builderforce.json`, `ai resource`. Do NOT alias bare `service`, `schema`, or `launch` — those words belong to other tools.

`OVERRIDE_HINT` and the launch/composer prompt name the tools via `advertisedName('app_manifest.schema')` and `advertisedName('app_manifest.validate')` (`toolNaming.ts`; `api/scripts/check-prompt-tool-names.mjs` fails a prompt that uses a catalog id). The example in `OVERRIDE_HINT` stays a valid v1 manifest; a test still parses it.

### 9. Write gate and commit gate — shared validator, per-host hooks

The shared function is `validateManifest` (plus `describeManifestIssue`) in core. Each host calls it; there is no single gate function both hosts can import beyond the validator itself. The write gate and the commit gate are different policies:

- Write gate (advisory): VSIX `write_file` / `edit_file` of `MANIFEST_PATH` (`.builderforce/builderforce.json`, from `app-detect` — do not hard-code a second path) runs the validator and appends the issues to the tool result. The write still lands so the agent can fix it.
- Commit gate (blocking): refuse when that file is in the commit and the manifest has errors, naming each error (`describeManifestIssue`). Warnings do not block. Hook EVERY host that writes the manifest into a commit: VSIX `git_commit` AND the API/sandbox commit path (`commitFileToRepo`, sandbox git). A raw `git commit` inside the sandbox that never calls those paths is out of scope — stated, not silently missed.

### 10. Docs — extend the existing publisher, no second generator

The generator ALREADY exists: `Builderforce.ai/frontend/scripts/publish-manifest-schema.mjs` writes `APP_MANIFEST_SCHEMA_V1` to `public/schema/app.v1.json` at prebuild/dev, reading the path from `APP_MANIFEST_SCHEMA_URL` (`https://builderforce.ai/schema/app.v1.json`). `public/schema/` is gitignored — there is no committed copy to diff. Extend that publisher; do not add a second generator and do not paste JSON into two files. A drift test asserts the publisher's output equals `APP_MANIFEST_SCHEMA_V1` (it cannot diff a committed `frontend/public/schema/app.v1.json`).

One docs-site page, title exactly `App manifest (builderforce.json v1)`, generated from the same schema (a script, not a hand copy). Include the recipe "Add an AI agent service": an `ai` resource, a `backend` service with `uses`, `AI_BASE_URL`, no key in the process.

Retitle the agent-runtime config pages that currently win a search for `builderforce.json`, so they cannot be read as the app manifest. `knowledge_search` for `builderforce.json` / `app manifest` must return the new page. If the index is built, not live, rebuild it in the same pass.

### 11. Starter — the ide-templates kit, not `frontend/src`

Kit id `react-vite-node-express` lives in `Builderforce.ai/packages/ide-templates` (`kits/compose.test.ts`). Optional piece on that kit only; do not add a second starter. The `frontend/src` i18n rule does not apply — follow the kit's own string and theme convention. When chosen:

- manifest: `resources.assistant` type `ai`; the api service `role: "backend"` with `uses`; no new role
- `api` route `POST /api/agent` calls `AI_BASE_URL` (`/chat/completions`) with tool calls over the shop's catalog and orders
- a chat widget in the kit's web app

`app_manifest.validate` is clean for the starter-with-agent.

### 12. Intent — one fixed choice, not a model call

Pure function, no LLM:

```ts
clarifyAgentIntent(utterance: string, hasAppManifest: boolean):
  | null
  | { question: 'Add an AI agent — which one?'; options: ['a teammate on the board', 'an AI feature inside the app'] }
```

Returns the choice only when the utterance contains the word `agent` and the project has an app manifest. The run preamble asks the human channel that exact list before any hire tool and before any manifest write. Hiring stays the teammate path. The manifest path is the feature path. No third option, no paraphrase.

### 13. Yardfire (visible cleanup)

- Replace the invalid `services.agent` commit (and any half-written concierge from run #3) with a valid `ai` resource plus a `backend` service that `uses` it, or revert that commit if the user would rather not keep the attempt. Do not leave the rejected manifest as the tree tip.
- Do not delete the hired "Yardfire Developer" agent (`2635a3c5-…`) or its project staffing unless the user says so. Ask first.
- Attach chat #287 to project 103. (Done, 2026-11-21.)

## Codemap

| Concern | File | Change |
|---|---|---|
| Types | `builderforce-webcontainers/packages/core/src/manifest/types.ts` | `AiResource` |
| Schema | `packages/core/src/manifest/schema.ts` | one `resource('ai', …)` arm |
| Validate | `packages/core/src/manifest/validate.ts` | `models` string list; roles unchanged |
| Capabilities | `packages/core/src/manifest/capabilities.ts` | `ai` row: browser yes with delivery, cloudflare/aws/azure/gcp no; `connection` unchanged |
| Issues | `packages/core/src/manifest/issues.ts` | no new code expected |
| Spec | `packages/core/src/manifest/toApplicationSpec.ts` | `HOST_DELIVERED`; copy `resourceUses` |
| Env | `packages/core/src/app/serviceEnv.ts` | `AI_BASE_URL` via `aiEndpoint` callback; frontend gets nothing; no `connectionEnv` |
| Spec type | `packages/core/src/app/spec.ts` | `resourceUses` (browser seam only) |
| Gateway | `packages/browser/src/` next to `database/` | HTTP gateway on the port registry; in-process `HostRelay` call; header stripping; no egress change |
| Runtime hook | `packages/browser/src/app/startApplicationRuntime.ts` | `HostRelay` argument; both launchers enter here |
| Web adapter | `Builderforce.ai/frontend/src/lib/runTarget/browserRunTarget.ts` | supply `HostRelay` (IDE page) |
| VSIX adapter | `clients/vscode/src/composerCommands/host.ts` + `packages/browser/src/launcher/server/launcher.ts`, `launcher/page/{bootApplication,runtimeDeps}.ts`, `launcher/protocol.ts` | thread `HostRelay` through launcher options → launch info → page `BootDeps`; page adapter forwards over token-gated `/__bf` to the extension host |
| Forward target | `api/src/presentation/routes/llm/chatCompletionsRoutes.ts` | existing route; meter is `logUsage` (`gatewayUsageLog.ts`); app-token acceptor is a LATER slice |
| Tools | `Builderforce.ai/api/src/application/llm/appManifestToolCatalog.ts` | new; one spread in `builtinMcpService.ts`; imports `-core/manifest` |
| Finder | `Builderforce.ai/brain-embedded/src/toolRouter.ts` | alias expansion next to `findTools`: three phrases |
| Hint | `blueprintOverrideHint.ts` plus the launch/composer prompt | `advertisedName` for both tools |
| Gates | VSIX write path + `git_commit` + `commitFileToRepo`/sandbox git | each calls core `validateManifest`; commit refuses errors |
| Docs | `frontend/scripts/publish-manifest-schema.mjs` (extend) + docs-site page + agent-runtime retitles | generated; drift test vs `APP_MANIFEST_SCHEMA_V1` |
| Starter | `Builderforce.ai/packages/ide-templates` kit `react-vite-node-express` | optional piece |
| Intent | run preamble (candidate: `brain-embedded/src/runStore/runPreamble.ts`) | fixed choice |
| Connection relay | ticket #6999, same relay shape | localhost base URL; host attaches vault secret; no env injection |
| Gaps | `ROADMAP.md` → `DONE.md` | after the live run, not before |

## Sequence

1. Agent calls `app_manifest.schema` (finder phrase `app manifest` / `builderforce.json` / `ai resource` resolves).
2. Agent writes `.builderforce/builderforce.json` with an `ai` resource and a `backend` service. The write gate appends issues. The commit gate refuses if any are errors.
3. `/launch` on the browser target runs `toApplicationSpec`. `ai` is not declined. `startApplicationRuntime` registers the page gateway and sets `AI_BASE_URL` on the backend only.
4. `POST /api/agent` in the process calls `AI_BASE_URL/chat/completions` with no key.
5. Port registry delivers the bytes to the page gateway (port policy: only a backend whose `resourceUses` names the resource). The gateway strips request `Authorization` and calls `HostRelay.forwardAi` (web: in-process; VSIX: the launcher page's adapter over the token-gated `/__bf` hop).
6. The host adds the signed-in session (web: in-process; VSIX: extension host over the token-gated `/__bf` hop), enforces `models` from the launch spec it read, forwards to `POST /v1/chat/completions` on the API gateway host, strips response `Set-Cookie`/`Authorization`/`WWW-Authenticate`, streams the reply back.
7. The shop widget renders the reply. The tenant ledger moves via the route's existing `logUsage` meter. The process environment contains no token.

Cloudflare is `no('app-token')` this pass. When the acceptor and delivery land: deploy injects `AI_BASE_URL` plus an app-scoped secret from the manifest; the platform wrapper attaches it; the same route meters it.

## Done-checks

- `validateManifest` is clean for the Yardfire fixture and for the starter-with-agent. `role: "agent"` still fails.
- `toApplicationSpec` does not decline `ai` on `browser`. It declines `ai` on `cloudflare`, `aws`, `azure`, `gcp` with the capability reason.
- A backend that `uses` `ai` gets `AI_BASE_URL` and no key. A frontend that `uses` it gets neither. A service that does not `uses` it gets neither.
- Worker CSP and `PREVIEW_DEFAULT_EGRESS` are unchanged (assert the constant; the gateway module does not import `previewHeaders` to extend it).
- Port policy: a service whose `resourceUses` does not name the resource cannot dial the gateway port; the port is not ingress and not published on a preview origin.
- A test double `HostRelay` proves: process-supplied `Authorization` is not forwarded; the host's session is; response `Set-Cookie`, `Authorization`, `WWW-Authenticate` never reach the process.
- `connection`: no vault material in process env, the worker script, the manifest, or the tree (this pass). Delivery is ticket #6999's done-check, on the relay shape of §4.
- `app_manifest.validate` issues equal `validateManifest` + `toApplicationSpec` for the same input. A test locks that.
- Write gate appends issues; VSIX `git_commit` and the API/sandbox commit path refuse errors and name them.
- `findTools` (with the alias expansion) for each of `app manifest`, `builderforce.json`, `ai resource` returns both tools; bare `service` / `schema` / `launch` do not resolve to them.
- Publisher drift test: `publish-manifest-schema.mjs` output equals `APP_MANIFEST_SCHEMA_V1`. Docs page exists, is generated, and `knowledge_search` returns it ahead of the retitled agent-runtime config pages.
- VSIX `/launch` supplies a `HostRelay` into the launcher page's `startApplicationRuntime` options (a test or trace proves the gateway + `aiEndpoint` are registered, not a claim). The `/__bf` forward hop refuses a missing/wrong launch token and is never served on a preview origin.
- `app_manifest.validate` with `path` and no `projectId` — or another tenant's project — is refused before any repo read.
- Targeted tests only: webcontainers manifest tests, the new tool tests, the write-gate test.
- Live, not a unit test: `/launch` of the starter-with-agent starts api + web in the browser target, and `POST /api/agent` returns a model reply through the host relay.
- Release: webcontainers version bumped and the tag pushed (the user asked for this push), consumers bumped, every lockfile refreshed, VSIX packaged with a new version and installed.
- `release_notes` row `category=new`, and an Idea-to-Real blog post, in the same pass.
- Gap entries A–D moved from `ROADMAP.md` to `DONE.md` only after the live run. Not before.

## Out of scope

- A new service role.
- Widening process or preview-document egress.
- Putting any token or vault secret in the browser process.
- A `postMessage` auth hop reachable from the preview document.
- Cloudflare `ai` delivery and the app-scoped token acceptor (later slice; capability stays `no`).
- `connection` secret delivery (ticket #6999; this pass keeps the acknowledged false row).
- Deleting the hired Yardfire Developer agent without an explicit yes.
- AWS / Azure / GCP delivery of `ai` (declined, with a reason, until a later pass).
- A model call to decide teammate vs feature.
- A raw sandbox `git commit` that bypasses the hooked commit paths.

## Review gate

Revision 2 (2026-11-22) applied all nine required edits of the 2026-11-21 architecture-and-auth review: (1) host-held session, no postMessage auth hop, port policy + header stripping; (2) no vault secrets in process env, `connection` acknowledged false until the relay; (3) forward target `POST /v1/chat/completions` on the API host, cloudflare `no` until acceptor + delivery, meter named (`logUsage`); (4) `resourceUses` browser-only; (5) finder is `findTools` in `toolRouter.ts`, three alias phrases, no bare `service`/`schema`/`launch`; (6) shared validator with per-host gate hooks incl. the API/sandbox commit path; (7) extend the existing schema publisher, drift test against the schema constant; (8) starter is the `ide-templates` kit; (9) API imports `@seanhogg/builderforce-webcontainers-core/manifest` (verified pure export).

The second review (2026-11-22, Mike QA, record at `.builderforce/cache/subagents/chat288-review-r2.md`) verified all nine against the code, held the false-capability rule and the smallest-seam judgment, and required three further edits, applied in revision 3: (1) the VSIX `HostRelay` adapter lives in the launcher PAGE and crosses the launcher's existing token-gated, page-origin-only `/__bf` loopback hop to the extension host — the page cannot call a separate Node process in-process; the `models` allowlist comes from the host-read launch spec, never process bytes; (2) both launchers already enter `startApplicationRuntime` (`browserRunTarget.ts:100`, `bootApplication.ts:73`) — the work is threading `HostRelay` through `createLocalLauncher` → launch info → page `BootDeps`, and the codemap/done-checks name those files; (3) `app_manifest.validate` requires `projectId` (checked via `ownedProjectId`) whenever `path` is given. The reviewer judged everything else acceptable as the implementation contract for #6996–#6999.

Acceptance of revision 3 is recorded below by the confirming review. No implementation before it; required changes come back to this file before code.

**ACCEPT — revision 3, confirming review 2026-11-22 (Mike QA, chat #288).** All three required edits verified across the whole file: (1) the VSIX `HostRelay` adapter is consistently placed in the launcher page with exactly one token-gated, page-origin-only `/__bf` hop to the extension host (§5 prose/diagram/rules, §6, Sequence 5–6, Review gate); no leftover in-process-extension-host claim; the `models` allowlist is pinned to the host-read launch spec in §5 and Sequence 6. (2) §6, Codemap (VSIX adapter + Runtime hook rows) and Done-checks state both launchers already enter `startApplicationRuntime` and name `launcher/server/launcher.ts`, `launcher/page/{bootApplication,runtimeDeps}.ts`, `launcher/protocol.ts`, `clients/vscode/src/composerCommands/host.ts`; the done-check requires a trace-proven `HostRelay` in the launcher page's options plus the `/__bf` token-refusal check. (3) §8 args `{ projectId?, content?, path?, environment? }` with `projectId` required for `path`, checked via `ownedProjectId` before any repo read, and the matching refusal done-check. No contradictions, no new defect. Ticket #6995 closes on this acceptance; implementation tickets #6996–#6999 are unblocked.