# Platform duplication audit

Part of the [unified platform review](unified-platform-gap-review.md). Areas are audited one at a time, and each one ends in a single target design plus granular gaps (`MCP-G###`, …) in [GAP-REGISTER.md](../../roadmap/GAP-REGISTER.md).

| # | Area | Status |
|---|---|---|
| 1 | MCP | **consolidation complete 2026-11-27** (§1) |
| 2 | Code index / search / context | **audited 2026-11-26** (below) |
| 3 | Local inference + model catalog + routing | **audited 2026-11-26** (below) |
| 4 | Memory (Evermind), skills, episodes, runs | **audited 2026-11-26** (below) |
| 5 | Chat composer / view | audited (§5) |
| 6 | Shell / terminal, file tools | audited (§6) |
| 7 | Auth / device sign-in / cloud client | audited (§7) |
| 8 | Security policy (code-shield vs Shield) | audited (§8) |

### Synapse moves from Tauri to a VS Code fork (user decision, 2026-11-27)

The Tauri Synapse app is removed. Synapse returns as a fork of VS Code (Code-OSS) (`UP-G015`):
- it runs the unchanged Builderforce extension (agent runtime and code visualizer);
- it packages the Spawn extension (`UP-G017`; the `builderforce-spawn` repo stays), with Spawn moving to a Roblox project type;
- it adds project types for three AI-model scenarios: Scratch, Existing model and Knowledge pack.

The OpenVSCode-in-Tauri shell is not being built. Until the fork ships, the editor is VS Code with the Builderforce extension.

**Kept in `builderforce-inference`:** the `bfi-*` engine (`bfi serve` announces itself in `~/.builderforce/bfi.json`; the extension also runs it in-process through `@seanhogg/bfi-node`), plus `bf-index`, `bf-context` and `bf-compress` (`bf-context serve` still writes `~/.builderforce/desktop.json`). `bf-index` stays behind the benchmark gate in §2.5. The release workflow now publishes only the `bfi` and `bf-context` binaries.

**Retired:** the vanilla-JS UI, Tauri shell, console, `bf-local`, and the private `bf-memory` client. The replacement Code-OSS build recipe lives in `app/`, and `bf-teach` contains the native Teach-once helper. `bf-cloud` and `bf-vault` moved to `builderforce-spawn`. Builderforce.ai removed the old model install flow, the `desktop.json` `models` reader, and the unused Synapse embedder slot. `/api/spawn/downloads` resolves Synapse installers during the rollout.

| Finding | Status after retirement |
|---|---|
| CHAT-G015 | Closed. The Synapse chat fork is deleted. |
| CHAT-G016 | Reduced to the Spawn copy of dictation. |
| CHAT-G010, CHAT-G018 | The Synapse part is gone. The API, Brain and VS Code share the attachment size limits. Chrome diagnostics and the remaining chat budgets stay open. |
| MEM-G105, MEM-G106 | The former Tauri experience integration and its direct `memory.json` reads were removed. The native Teach-once helper remains in `bf-teach`. |
| MEM-G114 | The former Tauri brain map was removed. Studio and the canvas still have their own renderers. |
| INF-G006 | Closed. `hub.rs` is deleted. |
| INF-G007, INF-G011 | The `bf-local` copies (its fit share and its `models_dir()`) are gone. The rest remains open. |
| INF-G015 | Closed. The `bfi` User-Agent comes from the crate version. |
| INF-G012 | Still open. The `synapse` runtime id now means `bfi serve`. It keeps its "Synapse" label and stays a wire id until the rename. |
| AUTH-G001, AUTH-G002, AUTH-G008, AUTH-G009, AUTH-G013 | Spawn keeps native auth and keyring adapters. Device-flow, origin and expiry fixtures now run in both languages. See §7.6 for session and configuration work. |
| CIX-G012 | The never-offered Synapse embedder slot is removed. The fingerprint policy remains open. |
| UP-G015 | Redefined: build Synapse as a VS Code fork. |

**Kept on purpose:** API compatibility for existing data (`DEVICE_CLIENTS` `synapse`/`spawn`, the private `synapse.step` approvals, `CLIENT_RESULT_ENGINES` `synapse`), the one-time import of Synapse connector settings in VS Code, and the dated Synapse blog posts.

---

## 1. MCP

### 1.1 Current stack, verified 2026-11-27

The original audit counted 11 server, client, catalog and host integrations. The shared package now owns the TypeScript MCP protocol helpers, Streamable HTTP transport, tool conversion, naming, output policy, platform REST relay and host config codecs. Each server has a distinct catalog.

| Surface | Current implementation |
|---|---|
| Platform MCP | The API's `mcpServerRoutes.ts` exposes the tenant gateway catalog via the shared SDK server. The default profile supports stateless discovery and calls. The authenticated interactive profile adds catalog-change notifications, a guide resource and a discovery prompt. |
| Workspace MCP | VS Code and agent-runtime use `packages/workspace-mcp` for the SDK server and catalog. The hosts supply workspace selection and HTTP authentication. Shared code provides text and indexed search, symbols, outlines, repo maps, references, git history and optional compression. |
| Memory MCP | `builderforce-memory/packages/memory-mcp` uses the shared SDK server with stdio and loopback HTTP, and exposes the same tool catalog to the in-process Agent SDK. It reports its package version. |
| Registered remote MCP | `mcpWireClient.ts` adapts the shared SDK-backed HTTP transport to the gateway's destination checks, session cache and legacy REST fallback. The marketplace discovery probe uses the same transport and pagination. |
| Editor MCP | The Builderforce VS Code extension carries Workspace MCP and connector setup for VS Code and the Synapse Code-OSS build (`UP-G015`). The Tauri Synapse app and its private Evermind stdio client were removed on 2026-11-27. Spawn has a VS Code extension and is moving to a Roblox project type (`UP-G017`). |
| Agent-runtime MCP | The docs command searches the published sitemap through the shared in-process MCP transport. The interactive ACP client forwards a specifically selected VS Code config to ACP peers that support its transports. The Gateway-backed bridge uses Gateway-managed tools. |
| WebContainer MCP | Browser preview execution and the environment agent host use the shared SDK with an in-process transport. Tool execution stays bound to the owning tab or the agent's environment port. Native inference receives tool definitions as model function schemas. |
| Platform REST relay | Web, VS Code, Chrome and agent-runtime use the shared TypeScript relay. The headless connector runner uses the shared connector action codec for its fixed discovery and dispatch tools. Rust, Android and iOS use native HTTP clients with the gateway's canonical model projection and legacy response compatibility. |

### 1.2 Duplicate responsibilities and compatibility

| Finding | Current behavior |
|---|---|
| Protocol framing, version negotiation and SSE parsing | MCP servers use the SDK. The shared outbound client uses SDK transport and message helpers. Marketplace discovery and tenant calls share that implementation. |
| Tool schema, names and read/write metadata | `packages/builderforce-mcp` owns the TypeScript tool and relay contracts, OpenAI and Anthropic conversion, the canonical name and connector action codecs, and the write-approval default. Web Brain, Canvas, Chrome, and VS Code pass canonical gateway names to the model for the entire remote catalog. Unambiguous legacy aliases still identify tools in dispatch, policy, and saved calls. Entries that share an alias keep distinct canonical IDs. Tenant consent controls tool availability. Host confirmations govern individual writes. |
| Platform write tools | The agent-runtime Workspace catalog advertises Workspace tools. Platform ticket creation, review recording and security finding tools come from the Platform catalog. |
| Code search and git history | `workspace__search` provides text search using the shared `search_code` implementation. `workspace__find` and the callable `codebase_*` aliases use the same Workspace index and embedder policy. The aliases retain their filters and response format. MCP and REST share Workspace tool resolution. Canonical and legacy git history share one Git reader and parser. Platform `knowledge.search` queries tenant knowledge. |
| Memory | Evermind hosted facts use `MemoryCapability`. Workspace Markdown uses `WorkspaceMemoryCapability`, including saved `memory_search` and `memory_get` calls. Memory MCP serves Evermind's memory and experience tools. |
| Connector registration and config | Tenant HTTP registrations live in the tenant store. Native stdio installations use host config. The VS Code chooser uses the shared connector catalog, and web and VS Code share the remote URL-shape check. The API validates public destinations. Memory's installer supplies the native launch config. |
| Workflow naming | The API and runtime use data-provider handlers. The unused API `mcpNode.ts` shim was removed. Saved workflow nodes with kind `mcp` still dispatch through the data-provider handler. |

The remaining compatibility surfaces include agent-runtime's legacy GET manifest and POST `/mcp/call`, the gateway's REST aliases, and native fallbacks for older gateway responses. A client that combines native editor and Platform catalogs would need verified server and account identity to deduplicate across those sources. Builderforce's former combined Synapse catalog was retired.

### 1.3 Gap status

MCP consolidation closed on 2026-11-27 with all 24 findings accounted for. The original inventory and migration plan are available in this document's Git history. [MCP gap register](../../roadmap/GAP-REGISTER.md#mcp-consolidation-platform-agents)

---

## 2. Code index / search / repo map / context

### 2.1 Inventory: 13 implementations

Roots: `B` = Builderforce.ai, `I` = builderforce-inference/crates, `M` = builderforce-memory/packages.

| # | Implementation | Path | Parse | Embed | Store | Lexical / rank | Repo map | Host |
|---|---|---|---|---|---|---|---|---|
| 1 | **bf-index** | `I/bf-index/src/*` | native tree-sitter, 11 languages; chunks ≤150 lines (header 25 + members; fallback 60/10) | fastembed bge-small-en-v1.5 384d (ONNX CPU, 33 MB) | SQLite per workspace (FTS5 + f32 BLOB, brute-force cosine) | identifier-aware BM25 + cosine, RRF k=60, +0.05 exact-symbol boost, cap 25 | file ref graph + personalized PageRank (0.85/30/1e-6), budget 1500–8000 tokens | Synapse (Rust) |
| 2 | bf-context | `I/bf-context/src/*` | — (wraps #1) | — | `~/.builderforce/desktop/indexes/<blake3>.db` | `semantic_search` (8/25), `check_references` (≤50) | `repo_map` | loopback HTTP + MCP |
| 3 | bf-compress | `I/bf-compress` | — | LLMLingua-2 ONNX 178 MB | — | `compress_context` | — | Synapse |
| 4 | `codebase_semantic_search` | `B/agent-runtime/src/builderforce/shared-tools/node-code-tools.ts:~361-595` | regex `extractSymbols` | **none** (BM25 only, despite the name) | `<root>/.builderForceAgents/search-index.json`, 5-min staleness | BM25 over the first 200 lines per file, 5000 files, 20 results | — | agent-runtime |
| 5 | `codebase_search` (= on-prem `search_code`) | same file `:~187-350`; wired at `agents/node-capability-provider.ts:296` | — | — | — | ripgrep per keyword + hand-weighted score, 20 results | — | agent-runtime |
| 6 | code-map / ast-parser | `B/agent-runtime/src/builderforce/{code-map,ast-parser}.ts` | TS compiler API (TS/JS only) | — | — | — | dependency graph | agent-runtime |
| 7 | Shared definition index | `B/packages/agent-tools/src/{symbols,node-tree-sitter,node-symbols,symbolRepoMap,symbolRelations,callScan}.ts` | web-tree-sitter WASM, 7 languages + regex fallback | — | `<ws>/.builderforce/symbols.json` (VS Code) · `<root>/.builderForceAgents/symbols.json` (on-prem) | `find_symbol`, `file_outline` | coarse (no ref graph) | VS Code, agent-runtime |
| 8 | **packages/repo-map** | `B/packages/repo-map/src/*` | regex facts (a deliberate TS mirror of #1's graph and map) | — | R2, keyed by repo+sha | keyword over definitions | PageRank (same constants as #1) | Cloudflare Worker |
| 9 | Cloud dense arm | `B/api/src/application/repos/repoSymbolVectors.ts`, `knowledge/knowledgeEmbedder.ts` | — | bge-m3 Workers AI, int8, signatures only | R2 per repo | RRF with #8 | — | Worker |
| 10 | **Deterministic knowledge index** | `M/memory/src/retrieval/knowledge-index/*` + `B/packages/agent-tools/src/knowledge/index/*` + `B/clients/vscode/src/knowledge/index/hostKnowledgeIndex.ts` + `B/api/.../knowledgeIndexPort.ts` | graph cards (path + symbol, no bodies) | chain: Synapse (never offered) → Evermind CPU → Ollama | int8 CSR `.idx` (editor) / `.bin` (R2) | exact → lexical → dense cascade | — | Worker, browser, Node |
| 11 | Memory RAG | `M/memory/src/retrieval/*`, `rag/*`, `vectorstore/*` | recursive char chunker 1000/200 | Evermind | HNSW / REST | BM25 + dense RRF + MMR | — | any; also backs API `knowledge.search` = SOP/doc search (`recallSops.ts`), not code |
| 12 | Knowledge-review graph | memory `knowledge/*`, agent-tools `knowledge/*` (codePack, codeLayers, codeEntryPoints, codeGraph…), VS Code `src/knowledge/*`, knowledge-browser, knowledge-client, knowledge-graph-view | regex + manifests + dependency-cruiser/jscpd/knip | — | packs | — | — | all |
| 13 | Other `search_code` backings | VS Code `src/workspace/workspaceSearch.ts` (exact/regex ripgrep, cap 100); cloud `repos/readRepoContents.ts searchRepoCode` (GitHub/GitLab API, 30); IDE `cloudAgent/ideWorkspaceCoding.ts searchIdeWorkspace` (R2 substring scan, 30) | — | — | — | — | — | — |

Checked and not duplicates:
- `packages/prefetch/lexical.ts` is an intent tokenizer.
- webcontainers has no index.
- Chrome calls the API.
- `@huggingface/transformers` is used for chat, not indexing.

### 2.2 Duplicate-responsibility matrix

| Responsibility | Copies |
|---|---|
| Symbol / definition parsing | **5**: bf-index `lang.rs` (11 languages), agent-tools `node-tree-sitter.ts` (7), agent-tools `symbols.ts` regex, agent-runtime `ast-parser.ts` (TS API), `symbolRelations.ts` (regex) |
| Chunking | 3 incompatible: bf-index (tree-sitter, 150/60 lines), memory `chunk.ts` (1000/200 chars), node-code-tools (first 200 lines, no chunks) |
| Embedders | **4 models**: bge-small 384d (Synapse), bge-m3 (cloud), Evermind SSM (editor, memory-mcp), Ollama (editor). No vectors are shared across stores |
| Vector stores | 4: SQLite BLOB, int8 CSR `.idx`/`.bin`, HNSW, R2 per-repo vectors |
| Lexical search | **6**: FTS5 + `terms.rs`, BM25 JSON (node-code-tools), memory `bm25.ts` + knowledge-index `lexical.ts`, repo-map `search.ts`, ripgrep ×2, GitHub API |
| Tokenizers | 5: `terms.rs`, repo-map `terms.ts` (mirror), knowledge-index `tokenize.ts`, node-code-tools `ssTokenise`, prefetch `lexical.ts` |
| Fusion / ranking | 4: `search.rs` RRF, memory `fusion.ts` RRF, cloudRepoMap RRF, node-code-tools hand weights |
| Repo map | 3: `repo_map.rs`, repo-map `render.ts` (mirror), `symbolRepoMap.ts` (no graph) |
| File walk + ignore rules | **7**: `walk.rs`, repo-map `filePolicy.ts`, agent-tools `skipDirs.ts`, memory `ignoreMatcher.ts`, VS Code `workspaceSearch.ts SKIP_DIRS`, node-code-tools `IGNORED_DIRS` (11 dirs), `ON_PREM_INDEX_SKIP_DIRS` |
| Change detection | 3: blake3 + notify watcher (bf-index), VS Code `indexWatcher` + mtime snapshot, agent-runtime 5-min staleness (no watcher) |
| `search_code` backing | **4 different semantics**: exact/regex (VS Code), keyword-ranked (on-prem), GitHub search (cloud), lower-cased substring (IDE workspace) |

### 2.3 Same repo, indexed several times on one machine

With VS Code, Synapse and agent-runtime all running, one repo produces:

- `~/.builderforce/desktop/indexes/<hash>.db` (Synapse: chunks + bge-small vectors);
- `<ws>/.builderforce/symbols.json`, `.builderforce/knowledge/<rootId>.idx` and the stat manifest (VS Code);
- `<ws>/.builderForceAgents/symbols.json` and `search-index.json` (agent-runtime). The directory name differs (`.builderForceAgents` vs `.builderforce`).

That is three walks, three parsers, two symbol snapshots and two embedders. None reuses another's output. The editor's embedder chain lists Synapse first, but Synapse never offers an embedder.

### 2.4 Survivor choice

| Capability | Best today | Why |
|---|---|---|
| Parsing / chunking | bf-index (native tree-sitter, 11 languages, body chunks) | Only one with real chunks. agent-tools WASM tree-sitter is 7 languages, but `tree-sitter-wasms` ships grammars for all 11. |
| Repo map | bf-index ≡ packages/repo-map (same algorithm) | repo-map already runs in Workers, Node and the browser; it only lacks tree-sitter facts. |
| Lexical + dense store | memory knowledge-index | Pure TS, runs everywhere, int8 + CSR, fingerprint-guarded. Lacks body chunks. |
| Embedder | Undecided: bge-small (Synapse) vs Evermind vs bge-m3 | One model per index fingerprint; see §2.5. |
| References check, watcher, hash-incremental | bf-index only | Must be ported. |
| Exact / regex search | VS Code `workspaceSearch.ts` (ripgrep + JS fallback) | Correct semantics; it lives in the client instead of a package. |

### 2.5 Target design: one code index, every host

Following decision 4 (interface first; Rust only where a benchmark proves a gain), there is one TypeScript engine assembled from parts that already exist, so it runs in the VS Code extension host / rebuilt Synapse IDE, agent-runtime, the Cloudflare Worker and the browser.

**End-state design: option D, approved 2026-11-27.** This supersedes the earlier sketch. It is built from three read-only inventories of the code as it is today. Option D removes the duplicates in the hosts first, using the homes the shared code already has. The runtime-neutral algorithms move into one package only at the end, once they are converged. Three alternatives were considered and rejected:
- **(A)** move everything into code-index first: the first step removed no duplicates, and the provider types created a cycle;
- **(B)** move the algorithms into builderforce-memory: a cross-repo release would be needed for every change;
- **(C)** never move packages: no reusable code package would result.

#### 2.5.1 Corrections to §2.1–§2.3 found by the inventories

- agent-runtime's BM25 engine, `ssTokenise`, `runCodebaseSearch` and `.builderForceAgents/search-index.json` are already deleted. `codebase_search` and `codebase_semantic_search` both route to code-index (`agent-runtime/src/builderforce/tools/workspace-search.ts`). One stale test still imports `runCodebaseSearch` (`agent-runtime/test/search-code-grep-fallback.e2e.test.ts:108`).
- Exact search is already shared. `clients/vscode/src/workspace/workspaceSearch.ts` is a 28-line re-export of `@builderforce/agent-tools/node-text-search`, which on-prem uses too.
- The cloud RRF (`cloudRepoMap.ts fuseDefinitionHits`) calls memory `reciprocalRankFusion`; it is not a copy.
- No 5-minute staleness window exists in agent-runtime. CIX-G013's third scheme is the 10-minute symbol-index backstop plus code-index's 60 s watch deadline.
- Remaining real duplicates:
  - two symbol snapshots (`.builderforce/symbols.json`, `.builderForceAgents/symbols.json`; one class, non-atomic write);
  - two BFKI indexes per root (`.builderforce/knowledge/<stem>.idx` cards, `.builderforce/index/<hash>.idx` chunks) under two root-id schemes;
  - two local semantic paths (`resolveLocalSemantic` and `on-prem-semantic.ts` never reach code-index);
  - about 10 ignore lists, about 15 path normalisers, two `statManifest` copies (agent-tools and memory);
  - six file-tool hosts with their own walkers, caps, containment and error wording (§2.5.4).
- **Layering constraint.** code-index imports `agent-tools` (`node-tree-sitter`, `node-git-ignore`, `node-path`, `acquireReplicaLock`, and the `RepoReadCapability` type), and repo-map imports `agent-tools/symbols`. The repo capability types live in agent-tools `capabilities.ts`, so a coding provider cannot live in a package below agent-tools.

#### 2.5.2 The rule

**Steps 1–4 (remove the duplicates).** Shared code stays in its current home, and every host converges on it:
- algorithms: agent-tools subpaths (`symbols`, `edit`, `glob`, `skipDirs`, `node-path`, `node-text-search`);
- graph and map: `packages/repo-map`;
- chunk index: `packages/code-index`.

The one coding provider is new in agent-tools, beside `CapabilityProvider`. Host side effects stay in the hosts as decorators: commits, leases, secret inspection, R2 history, symbol `markDirty` and run bookkeeping.

**Step 5 (the reusable package).** The runtime-neutral algorithms and the tree-sitter loader move into `packages/code` (`@seanhogg/builderforce-code`, the renamed code-index), which sits **below** agent-tools:

```
hosts (vscode, agent-runtime, api, frontend)
   ▼
workspace-mcp ──► agent-tools (capabilities, tools, coding provider, node-* host pieces, node-code-index)
                     ▼
                  code (/parse, /parse/node, /graph, /edit, /walk, /scan, /chunk)
                     ▼
                  @seanhogg/builderforce-memory (/knowledge, /retrieval)
```

`code` imports nothing from agent-tools, workspace-mcp or a host. The pieces that touch the host move the other way, into agent-tools `node-*`:
- containment (`node-path`);
- the Node walker;
- ripgrep search (`node-text-search`);
- `node-git-ignore`;
- code-index's current orchestrator (`index`, `storage`, `embedder`), which takes `RepoReadCapability`, a lock and `local-inference`.

Each concern in `code` is its own subpath, so it does not become a god package. Every subpath except `/parse/node` is Worker- and browser-safe and is listed in `worker-safety.test.ts`.

#### 2.5.3 Codemap, steps 1–4: where each duplicate dies

| Concern | Survivor (home) | Fold in | Delete |
|---|---|---|---|
| Ignore policy | agent-tools `skipDirs.ts` (§2.5.5) | repo-map `filePolicy` uses it; `.nuxt` | `IGNORED_DIRS` (node-code-tools), `ON_PREM_INDEX_SKIP_DIRS`, `LIST_IGNORED_DIRS` ×2, `node-text-search SKIP_DIRS`, `codebaseScan SKIP_DIRS`, `workingTree SKIPPED_DIRECTORIES`, the governance-audit, coding-dispatch and builderforcellm-rag lists; the `SYMBOL_INDEX_SKIP_DIRS` / `KNOWLEDGE_SKIP_DIRS` aliases |
| Tool caps | `tool-output-policy caps.ts`: `LIST_MAX_FILES` 5,000, `LIST_RETURN_MAX` 400, `READ_MAX_BYTES` 2 MiB, `SEARCH_MAX_MATCHES` 100 | the container receives them through `gen-container-shared.mjs` | the per-host constants |
| Path normaliser | agent-tools `toPosixPath(p)` (`glob.ts`, beside `normalizeScopeDir`) and `toPosixRel(root, abs)` (`node-path.ts`) | — | named copies with identical semantics (`relPosix`, code-index `relativePath`, sandbox `toPosix`, …); `normalizeRepoPath` keeps its own `..` resolution |
| Stat manifest | memory `knowledge/statManifest` | any behaviour only the agent-tools copy has | agent-tools `knowledge/statManifest.ts` |
| Exact search shim | agent-tools `node-text-search` | — | VS Code `workspace/workspaceSearch.ts` re-export; importers use the package directly |
| Coding provider | agent-tools `workspace.ts` (`WorkspaceFs`, `createRepoCapabilities`, error codes; neutral) + `node-workspace.ts` (`nodeWorkspaceFs`: the walker from `localCapabilities.walkFiles`, containment, ripgrep) | the VS Code bodies are the base (most complete); `unbounded`; EOL conformance on write | the list/read/search/write/edit/delete bodies in `localCapabilities.ts`, `node-capability-provider.ts`, `sandbox-capability-provider.ts`, `workspace-mcp/workspaceFiles.ts`, `ideWorkspaceCoding.ts`, `cloudProvider.ts` |
| Line scanner | agent-tools `text-scan.ts` (neutral; extracted from `node-text-search walkSearch`: smart case, regex or literal, binary skip, byte cap) | — | `searchIdeWorkspace` substring scan, `ide/searchWorkspace.ts` matcher, canvas `searchFileLines` |
| String edit | agent-tools `edit.ts` `applyStringEdit` | BOM tolerance from the native `edit` | the native-file-tools matcher (`:288-311`), frontend `applySearchReplace` |
| Container glob | agent-tools `glob.ts`, generated into the container | — | the hand mirrors in `workspaceAgent.mjs:327-420` |
| Repo map | repo-map `renderRepoMap` via `repoMapPort` | — | agent-tools `symbolRepoMap.ts` (`symbolIndexSemantic`) |
| TS dependency graph | repo-map `RepoGraph` | any `runCodeAnalysis` output it lacks (dependents, impact radius) | agent-runtime `ast-parser.ts`, `code-map.ts` |

Moved files keep their tests, which run unchanged; only their imports are retargeted. Importers move in the same pass, and nothing keeps a re-export shim.

The about 30 `knowledge/code*` analyzers (§2.1 row 12) are out of this program. They are a separate audit item and stay in agent-tools until it runs.

#### 2.5.4 One coding provider, one adapter per host

`WorkspaceFs` (agent-tools `workspace.ts`) is the only thing a host writes:

```ts
interface WorkspaceFs {
  list(dir: string, opts: { signal?: AbortSignal }): AsyncIterable<{ path: string; kind: 'file' | 'dir'; size?: number }>;
  read(path: string, opts: { maxBytes: number }): Promise<WorkspaceRead>;   // not_found | is_directory | ok(content, truncated)
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<'deleted' | 'missing'>;
  search?(query: string, scope: string, opts: { signal?: AbortSignal }): Promise<SearchMatch[]>;  // optional native searcher
}
```

| Host | Adapter (all that stays) | Decorators kept in the host |
|---|---|---|
| VS Code | `nodeWorkspaceFs(root, {ripgrep})` from agent-tools `node-workspace` | `symbols.markDirty` |
| On-prem agent | the same `nodeWorkspaceFs`, with `scope: 'workspace' \| 'unconfined'` | `symbols.markDirty` |
| Workspace MCP | the same `nodeWorkspaceFs`; `workspaceRepoRead` becomes the 1 MB read-cap option | — |
| Sandbox agent | `sandboxWorkspaceFs(bridge)` in agent-runtime | — |
| Cloud IDE (R2) | `r2WorkspaceFs(bucket, projectId)` in api over `workspaceStore` (paged list) | lease, written paths and hashes, history |
| Cloud repos (GitHub/GitLab/Bitbucket) | `gitRemoteFs(ctx)` in api over `readRepoContents`; `search` = provider code search | lease, credential gate, secret inspection, commit records, read memo |
| Cloud sandbox (`withSandbox`) | decorates the remote adapter, as today | mirror into the clone |
| Container (`workspaceAgent.mjs`) | stays an NDJSON op server; `gen-container-shared.mjs` generates agent-tools `glob.ts` and the ignore policy into it in place of the hand mirrors (`:327-420`) | — |
| Browser canvas | `memoryWorkspaceFs(files)` over the canvas file map | `validateFileContentForPath`, history |

Every host returns one result and error contract: `{ ok: false, error, code }` with `code ∈ not_found | is_directory | outside_root | too_large | no_match | ambiguous | unsupported | io`.
- Deleting a missing file is `{ ok: true, deleted: false }` everywhere; VS Code's `ok: false` is the outlier.
- There is one `SearchMatch {path, line?, text}`. Remote code search maps fragments to `text` with no `line`. This is a documented weaker contract, because provider search cannot match exact regex.
- Caps come from `tool-output-policy` (`LIST_MAX_FILES` 5,000, `LIST_RETURN_MAX` 400, `READ_MAX_BYTES` 2 MiB, `SEARCH_MAX_MATCHES` 100), which the container already receives through its generator.

agent-runtime's native `read` and `edit` (`native-file-tools.ts`) run on the shared provider; their parameter names (`oldText`/`newText`) stay at the tool layer only. `apply_patch` keeps its own hunk locator (`seekSequence`), because patch syntax is a different contract (SHELL-G007).

#### 2.5.5 One ignore policy

- **The list:** agent-tools `WORKSPACE_SKIP_DIRS`, which already contains repo-map's `SKIP_DIRS` plus `.hg`, `.svn` and `.vercel`, with `.nuxt` added.
- **Name rules:** the `skipDirs` rules (`.worktrees`, `*.local`, `_*_src`), plus `SKIP_FILES` and the `.min.js` and `.map` suffixes.
- **Not skipped:** `media`, because it can hold source.
- **Dot-directories:** indexing skips every dot-directory except `.github`. File tools (`list_files`) use the same list but also show a fixed set of config dot-directories (`.github`, `.vscode`, `.devcontainer`, `.husky`, `.changeset`, `.claude`, `.cursor`), so agents can edit workflows and settings.
- **`.gitignore` filtering:** `gitIgnoredMatcher` on Node, memory `ignoreMatcher` elsewhere.

#### 2.5.6 One index per root

- **One root id.** code-index names its files with agent-tools `rootFileStem(rootId)` (`knowledge/index/persistence.ts`), the same stem the knowledge-card index uses. It stops hashing the realpath on its own; the old file is read once as a fallback and never written again.
- **One location per kind, all under the same lock.**
  - `.builderforce/index/<stem>.idx`: code chunks.
  - `.builderforce/index/<stem>.symbols.json`: the symbol snapshot, now written atomically.
  - `.builderforce/knowledge/<stem>.idx`: knowledge cards, unchanged.
  - `.builderForceAgents/symbols.json` is read once as a fallback and never written again; the on-prem host writes the new location.
- **Cards and chunks stay separate files.** They are rebuilt by different triggers (review vs content change), they differ in size (chunks reach 160 MB), and they may carry different embedder fingerprints. `workspace__find` fuses the two with memory `reciprocalRankFusion`. No storage format changes.
- **One change feed.** A `WatchPort` replaces code-index's own `fs.watch` and the separate `markSymbolFileChanged` path.
  - VS Code fills it from `FileSystemWatcher`; Node fills it from `fs.watch`.
  - The symbol index and the code index both consume it.
- **One local semantic path.** `resolveLocalSemantic` (VS Code) and `on-prem-semantic.ts` call `/index` search. The Desktop (native) capability stays preferred while the benchmark gate below is open.

#### 2.5.7 Order (each batch ≤ 3 implementers on disjoint files)

1. **Policy (one implementer).** The ignore policy, the tool caps, the path normaliser, the stat manifest and the exact-search shim (§2.5.3, first five rows). Files the step-2 provider rewrite will replace get only their ignore-set line changed now.
2. **Providers (three in parallel, disjoint files).**
   - (a) agent-tools `workspace.ts` + `node-workspace.ts`; VS Code, on-prem and Workspace MCP adopt them.
   - (b) the api adapters (R2, git remote, sandbox decorator), `text-scan.ts` for R2 agent search and the IDE file panel, and the container generator.
   - (c) the sandbox adapter, native read/edit, canvas edit/search, the stale e2e test, `symbolRepoMap` → repo-map, and `ast-parser`/`code-map` → `RepoGraph`.
3. **Index (one implementer).** Everything in §2.5.6, plus `WatchPort` and the local semantic routing.
4. **Review and ship steps 1–3.** One review over the combined diff (Opus, because it is cross-package), one verify, then commit.
5. **The reusable package (one implementer).**
   - Move the neutral algorithms into `packages/code`: `symbols`, `callScan`, `callShape`, `ownerSpans`, `symbolImports`, `symbolRelations`, `callbackOwners`, `codeMask`, `testPaths`, `escapeRegex`, `edit`, `edit-match`, `editBalance`, `exportRemoval`, `importRewrite`, `glob`, `skipDirs`, `text-scan` and `chunk`; fold in all of repo-map; add `node-tree-sitter` + `retryingLoad` as `/parse/node`.
   - code-index's orchestrator moves to agent-tools `node-code-index`.
   - Rename the package to `@seanhogg/builderforce-code`, retarget every importer and tsconfig `paths`, and delete the `repo-map` package.
   - Then a review (Opus), a verify and a commit.

#### 2.5.8 Done-checks

- **Zero hits after step 4** for:
  - `IGNORED_DIRS`, `LIST_IGNORED_DIRS`, `ON_PREM_INDEX_SKIP_DIRS`, per-host `LIST_MAX_FILES` / `MAX_LIST_ENTRIES` / `MAX_READ_BYTES`;
  - `applySearchReplace`, `searchFileLines`, the native edit matcher;
  - `.builderForceAgents` writers;
  - agent-runtime `ast-parser`/`code-map`, agent-tools `symbolRepoMap`, agent-tools `knowledge/statManifest.ts`;
  - the VS Code `workspaceSearch.ts` shim;
  - hand glob mirrors in `workspaceAgent.mjs`.
- **Zero hits after step 5:** `@builderforce/repo-map`, `@seanhogg/builderforce-code-index`, and agent-tools copies of any file moved into `packages/code`.
- **Guards pass:** `check-source-package-graph.mjs` (no cycle, with `code` below agent-tools), and `worker-safety.test.ts` for every `code` subpath except `/parse/node`.
- **Tests unchanged:** every moved test runs with byte-identical inputs and expectations. `cross-provider-smoke.test.ts` runs against every adapter and becomes the conformance suite (SHELL-G017).
- **Box count, before → after:**

| Duplicate | Before | After |
|---|---:|---:|
| Symbol parsers | 5 | 2 (tree-sitter + regex fallback) |
| Chunkers | 3 | 2 (code, prose) |
| Lexical engines | 6 | 2 (knowledge-index, provider code search) |
| Tokenizers | 5 | 2 (`codeTokenize`, prefetch intent) |
| Repo maps | 3 | 2 (TS, plus Rust until the gate) |
| Ignore lists | 10 | 1 |
| File-tool hosts with their own bodies | 6 | 0 |
| Edit matchers | 3 | 1 (plus the `apply_patch` hunk locator, a different contract) |
| Symbol snapshots per root | 2 | 1 |
| Root-id schemes for local indexes | 2 | 1 |
| Local semantic paths | 2 | 1 |

- **Benchmarks:** `scripts/benchmark-code-index*.mjs` still run.

#### 2.5.9 Tool vocabulary on Workspace MCP (§1.1, unchanged)

| Tool | Semantics |
|---|---|
| `workspace__search` | exact or regex text search (ripgrep; JS fallback; `path` scope applied *before* the search) |
| `workspace__find` | semantic + lexical hybrid over chunks and cards (replaces `semantic_search`, `codebase_semantic_search` and `codebase_search`) |
| `workspace__symbol` / `__outline` | definition lookup |
| `workspace__map` | PageRank repo map (budgeted) |
| `workspace__references` | `check_references` |
| `workspace__compress` | LLMLingua (stays optional; it needs a native or ONNX backend) |

**Benchmark gate** (decision 4): before retiring bf-index, time the TS engine on hired.video and Builderforce.ai (cold index, warm query p50/p95, memory). If native is decisively faster, compile `bf-index` to WASM behind the same `parse`/`chunk` interface instead of keeping a Rust sidecar.

**Windows lexical baseline (2026-11-26).** A tracked snapshot of Builderforce.ai took 333 seconds from an empty TS cache to the first result. Its 30 warm queries measured 125 ms p50 and 370 ms p95, with 619 MiB process RSS. On hired.video, reopening and validating an existing TS snapshot took 83 seconds. Warm queries measured 116 ms p50 and 685 ms p95, with 361 MiB RSS. Both searches reported partial coverage. On cold unscoped Workspace MCP calls, the server reports indexing in progress after five seconds while the shared build continues. The native loopback service, with embeddings disabled, was still scanning both repos at the seven-minute cutoff. This run shared the machine with other builds. A controlled comparison with matched coverage, cold measurements for both engines, and dense retrieval quality remains the retirement gate.

**Matched-file Windows lexical sample (2026-11-26).** Both engines searched the same 400 tracked source files per repository in fresh scratch directories, with embeddings disabled. The TypeScript search reported complete coverage and the native service reported 400 indexed files per repo. Warm latency is from 30 queries per run. Other local work ran during this sample, and the processes contain different runtime overhead.

| Repository | Engine | Cold first result | Warm p50 / p95 | Process RSS |
|---|---|---:|---:|---:|
| hired.video | TypeScript | 89.5 s | 188 / 827 ms | 214 MiB |
| hired.video | Native loopback | 10.2 s | 39 / 64 ms | 18 MiB |
| Builderforce.ai | TypeScript | 79.6 s | 193 / 599 ms | 202 MiB |
| Builderforce.ai | Native loopback | 13.4 s | 44 / 172 ms | 18 MiB |

The native service was faster on both lexical samples. Keep it until a full-repository comparison with matched coverage and a dense retrieval quality check supports a replacement.

**Reproducible comparison.** `scripts/benchmark-code-index.mjs` pins tracked Git blobs, builds a common corpus, and checks the indexed file set of each engine before reporting latency. In matched 1,000-file lexical runs, hired.video (`27dbdf38dfb`) measured 31.1 s cold and 149/299 ms warm p50/p95 for TypeScript, and 27.2 s cold and 62/99 ms warm for native. Builderforce.ai (`56755a50276`) measured 25.2 s and 37/71 ms for TypeScript, and 52.0 s and 81/114 ms for native. Native RSS was 19–24 MiB compared with 238–271 MiB for the TypeScript process. Cold and warm latency varied by repository.

Full coverage cannot be matched at the current TypeScript limits. Of 5,385 eligible hired.video files, at most 4,548 fit the 24 MiB budget. Of 19,389 eligible Builderforce.ai files, at most 4,428 fit. Both ceilings precede the 20,000-chunk cap. The harness's `--full-comparison` mode runs the same TypeScript scanner, chunker, and ranker with a larger in-memory budget. This mode skips shared snapshot I/O and leaves the shipped limits unchanged. Its cold time therefore excludes writing and reopening the TypeScript snapshot. Both engines must index every materialized path for the comparison to pass.

An offline smoke used the same cached BGE-small ONNX model with native and TypeScript. The native engine embedded all 207 chunks from the 40-file matched corpus. Both engines ranked the judged file first for all three questions, as did TypeScript’s lexical-only search. The larger judged comparison below measures low-overlap retrieval separately.

**Full matched Windows lexical run (2026-11-27).** Both engines indexed the same 5,385 files at hired.video commit `27dbdf38dfb`, with zero missing or extra paths. TypeScript measured 503.1 s cold, 810/2,019 ms warm p50/p95 and 583 MiB RSS. Native measured 375.0 s, 369/850 ms and 19 MiB RSS. The run used the in-memory TypeScript benchmark budget and shared the host with other builds. Native leads on cold latency, warm latency and memory on this corpus.

**Full matched Ubuntu WSL lexical run (2026-11-27).** Both engines indexed the same 19,383 files at Builderforce.ai commit `56755a50276`, with zero missing or extra paths. Over 30 warm runs per engine, TypeScript measured 301.5 s cold and 384/508 ms warm p50/p95, with 2,156 MiB RSS and 64,280 chunks. Native measured 2,342.5 s cold and 647/1,321 ms warm p50/p95, with 25 MiB RSS and 164,646 chunks. TypeScript used the expanded in-memory budget. The corpus and indexes were on WSL's Linux filesystem. The Windows run on this repository reached the native stage's original 30-minute timeout.

The judged retrieval harness and the headless Workspace code search now load the same local BGE checkpoint through `loadBgeCodeEmbedder`. The headless runtime uses that adapter for `workspace__find` and saved semantic search when the checkpoint is installed. It falls back to a warm Ollama embedder or lexical search. A production-path smoke loaded the pinned checkpoint and returned a normalized 384-dimensional vector. The editor still uses the existing Ollama path.

The judged comparison evaluated 12 queries on each repository, with 64 matched files per repository and 15 low-overlap queries overall. Each hybrid run used the same cached BGE checkpoint. The table reports the number of judged files found in the top eight and mean reciprocal rank at eight.

| Repository | TypeScript lexical | TypeScript hybrid | Native lexical | Native hybrid |
|---|---:|---:|---:|---:|
| hired.video | 10 / 12, 0.505 | 10 / 12, 0.694 | 10 / 12, 0.479 | 11 / 12, 0.704 |
| Builderforce.ai | 8 / 12, 0.343 | 8 / 12, 0.451 | 6 / 12, 0.458 | 9 / 12, 0.468 |
| Low overlap across both | 9 / 15, 0.274 | 9 / 15, 0.461 | 9 / 15, 0.350 | 12 / 15, 0.504 |

The judged samples favor native hybrid on recall at eight, and native used less memory on both full-repository runs. Warm and cold latency favored different engines on the two corpora. Keep the native index until a replacement delivers comparable retrieval and resource use within its shipped limits.

### 2.6 Granular gaps

| ID | Gap | Fix | Where |
|---|---|---|---|
| CIX-G001 | **Bug:** on-prem `search_code` is keyword-ranked ripgrep (`runCodebaseSearch`), but its contract promises an exact substring or regex. The `path` scope is applied after the search. | Route it to exact/regex search, with the scope applied first | `agent-runtime/src/agents/node-capability-provider.ts:296`, `node-code-tools.ts:~187` |
| CIX-G002 | Workspace cutover complete | `workspace__find` and the saved `codebase_semantic_search` call use the shared index and warm embedder policy | `packages/workspace-mcp`, `workspace-search.ts` |
| CIX-G003 | Workspace exact search shared | VS Code and headless MCP share `workspace__search`. The broader host adapters are tracked here. | `packages/workspace-mcp`, `readRepoContents.ts`, `ideWorkspaceCoding.ts` |
| CIX-G004 | 5 symbol parsers (native tree-sitter 11 languages, WASM 7, regex, TS compiler API, regex relations) | One `parse` on WASM tree-sitter (11 languages) plus a regex fallback | `lang.rs`, `node-tree-sitter.ts`, `symbols.ts`, `ast-parser.ts`, `symbolRelations.ts` |
| CIX-G005 | 3 chunkers; only Synapse embeds code bodies; the editor index holds cards only | Port the `chunk.rs` rules; add chunk records to the knowledge index | `chunk.rs`, memory `knowledge-index/*` |
| CIX-G006 | repo-map is a hand-maintained TS mirror of `graph.rs`/`repo_map.rs`, fed by regex | Keep repo-map as the one implementation, fed by `parse`; delete `symbolRepoMap.ts` | `packages/repo-map`, `agent-tools/symbolRepoMap.ts` |
| CIX-G007 | 6 lexical engines and 5 tokenizers | knowledge-index lexical + `bm25.ts`; one `codeTokenize` | see §2.2 |
| CIX-G008 | 4 RRF/fusion copies | memory `fusion.ts` only | `search.rs`, cloudRepoMap, node-code-tools |
| CIX-G009 | 7 ignore lists that disagree (`target`, `vendor`, `media`, dot-dirs, `.vercel`, `.worktrees`…) | One policy (base: `filePolicy.ts`) | §2.2 row "File walk" |
| CIX-G010 | Path normalisation is done case by case (`normalizeScopeDir`, `relPosix`, `replace(/\\/g,'/')`) | One normaliser in `walk` | agent-tools, VS Code, agent-runtime |
| CIX-G011 | One repo is indexed 3× on one machine, in two dot-dirs (`.builderforce` vs `.builderForceAgents`) | One `.idx` per root; single writer; retire `.builderForceAgents` | §2.3 |
| CIX-G012 | 4 embedding models and no shared fingerprint policy; the editor chain lists a Synapse embedder that is never offered | One `EmbedderPort` chain with a declared default model per surface | `embedderChain.ts`, `embedderPort.ts`, `bf-index/embed.rs`, `knowledgeEmbedder.ts` |
| CIX-G013 | Change detection: watcher + blake3 (Synapse) vs mtime snapshot (VS Code) vs 5-min staleness (agent-runtime) | Content-hash incremental + host watcher port | `watcher.rs`, `indexWatcher.ts`, `node-code-tools.ts` |
| CIX-G014 | Workspace cutover complete | VS Code and headless MCP share `workspace__references` | `packages/workspace-mcp` |
| CIX-G015 | Result caps disagree (8/25/20/100/30), as do file caps (1 MB / 256 KB; 5k / 6k / 40k files) | One cap policy per tool, documented | §2.2 |
| CIX-G016 | Verification complete. Keep the native index | §2.5 records matched full-repository lexical benchmarks, judged dense retrieval and the production headless TypeScript embedder. Native leads on memory and low-overlap recall | — |
| CIX-G017 | API `knowledge.search` is SOP/doc search (`recallSops.ts`), but its name suggests code | Rename it to `docs.search`, or document it | `builtinMcpService.ts:1402` |
| CIX-G018 | **Re-audit 2026-11-27:** agent-runtime native `read`/`write`/`edit` are a seventh file-tool host. Only the edit matcher is shared; they keep their own fs ops, caps (2,000 lines / 50 KB), containment (`resolveToCwd`) and `File not found` text | Run them on `createRepoCapabilities`. Staging stays a decorator, and `oldText`/`newText` stay at the tool layer | `agent-runtime/src/agents/native-file-tools.ts` |
| CIX-G019 | The container's `listFiles` is a hand copy of `walkWorkspace`. Its containment (`lexicallyInside`, `resolveInside`, `insideClone`) and error wording are also its own | Generate `walkWorkspace` into the container. Containment stays stricter (`.git` block, `O_NOFOLLOW`, TOCTOU re-checks) until a security review | `api/container/workspaceAgent.mjs:264-396`, `gen-container-shared.mjs` |
| CIX-G020 | `builderforcellm-rag.ts` is a second code retrieval engine on the local-LLM path, with its own walker, tokenizer, scorer and `MAX_SCAN_FILES` | Route it through `workspaceSemantic` | `agent-runtime/src/agents/builderforcellm-rag.ts`, `builderforcellm-local-stream.ts:612` |
| CIX-G021 | 7 product ignore lists outside `skipDirs.ts` | Fold them into `WORKSPACE_SKIP_DIRS` / `isOutputDirName` | `commands/builderforce.ts:138`, `memory/manager-sync-ops.ts:67`, `repos/sources/RepoSource.ts:66`, `repos/importRepoContents.ts:31`, `frontend/.../generatedPaths.ts:12`, `downloadProject.ts:20`, `knowledge-graph-view/src/fileCategory.ts:44` |
| CIX-G022 | A 512 KB file cap is defined in 5 places. Per-host search file counts are unnamed | One `SNAPSHOT_FILE_MAX_BYTES` in `caps.ts`, plus named search caps | dispatch adapters, directory-sync, governance walker, GitHub/GitLab sources, `ide/searchWorkspace.ts` |
| CIX-G023 | Two copies of the literal, case-insensitive, column-reporting line matcher. Two near-identical local semantic resolvers ("Desktop, else `workspaceSemantic`") | One `findLiteralMatches` in `text-scan.ts`; one resolver in workspace-mcp | `api/.../ide/searchWorkspace.ts:40-60`, `frontend/.../workspaceFileStore.ts:83-96`, `vscode tools/localSemantic.ts`, `agent-runtime on-prem-semantic.ts` |
| CIX-G024 | About 190 hand path normalisers (`replace(/\\/g,'/')` and similar), against the ~15 counted in §2.5.1 | Bare ones go to `toPosixPath` / `toPosixRel`; one shared variant for trim / strip-`./`. Do this after step 5, which moves `glob.ts` | agent-runtime, clients/vscode, packages, api |
| CIX-G025 | About 20 hand path-containment checks beside `node-path` | Disk containment goes to `isPathInside` / `resolveInsideRootReal`; logical-key checks stay. Do this after step 5 | `clients/vscode` (knowledge, runDelta, git, composerCommands), `agent-runtime` (fs-safe, coding-tools.read, web/media), `workspace-mcp workspaceFiles.ts:11-22` |
| CIX-G026 | About 9 hand file walkers share the skip predicates but not the walk. There are three Node walkers: the provider `walkWorkspace`, knowledge `fsDirectorySource` and `node-symbols` | VS Code `codebaseScan`, `folderWorkingSet`, `workspaceMapScan` and agent-runtime `workspace-code-graph` / governance walker move onto `walkWorkspace`. Converging the knowledge walker is a separate L task | see the re-audit §2e |
| CIX-G027 | The `.builderForceAgents` vs `.builderforce` split stays open for everything except the index and symbol files (project context, rules, routing, telemetry, checkpoints) | One project dir, read-once fallback | `agent-runtime/src/builderforce/project-dir.ts:38` and its writers |
| CIX-G028 | `node-tree-sitter.ts` loads 7 grammars, but §2.5 assumes 11. The docs-site page still describes the deleted `ast-parser.ts` / `code-map.ts` | Wire the missing grammars or correct the count; fix the doc | `packages/agent-tools/src/node-tree-sitter.ts:125-138`, `docs-site/.../agents-architecture.md:27,34` |

---

## 3. Local inference, model catalog, routing, caches

Roots: `BI` = builderforce-inference, `BF` = Builderforce.ai, `WC` = builderforce-webcontainers, `MEM` = builderforce-memory.

### 3.1 Inventory

**Engines (run a model):**
- `BI/crates/bfi-*`: one Rust engine (`bfi-engine`) with three targets.
  - Targets: native `bfi-server`, wasm `bfi-web`, napi `bfi-node`.
  - GGUF reader (incl. Q1_0/PQ2_0/PTQ1_0), CPU SIMD + wgpu backends, qwen3 / qwen35-Bonsai.
  - Prefix KV (`engine/prefix.rs`), speculative decoding (`spec.rs`) and grammar-constrained tools.
  - Serves OpenAI, Anthropic and Ollama APIs on :11434.
- `BF/packages/bfi-node` (2026.10.12) and `bfi-web`: vendored prebuilt artifacts of the above (`SOURCE.json`), linked into VS Code.
  - **`bfi-web` is stale:** 2026.10.10 against crate 2026.10.12.
- Others:
  - `agent-runtime/llama-stream.ts` (node-llama-cpp);
  - `brain-embedded/pageEngines/{webllmEngine,browserEngine}.ts` (WebLLM, Gemini Nano);
  - WC `inference/` (ONNX Runtime Web, wllama, WebLLM adapters): **no consumer found**;
  - MEM `memory-engine` (SSM/Evermind: a different model family, not a duplicate).

**Hosts that drive an engine:**
- VS Code `src/hostBfi/*` (a worker_thread loading native `bfi-node`, else wasm; it auto-provisions Bonsai ≤600 MB);
- `brain-embedded/pageEngines/bfiEngine.ts` (browser);
- `bf-local/runtime.rs` (supervises `bfi serve` for Synapse).

**Catalogs: about 9, only 3 of them generated, from different sources:**
1. `model-catalog` (tiers, role ladders, BYO vocabulary);
2. `model-catalog/generated/priceSnapshot.ts` (OpenRouter, generated);
3. api `llm/vendors/*.ts` (the routing source of truth: tier, context, capabilities) + `liveModels.snapshot.json`;
4. api `modelCatalog.ts` (a live OpenRouter fetch for marketing);
5. frontend `lib/modelCatalog.ts` and `brain-embedded/gatewayModels.ts` (read the gateway);
6. agent-runtime `models-config.providers.ts` + 5 `*-models.ts` (**hand-coded context and price**);
7. `local-inference/catalog.ts` + `webllmCatalog.generated.ts` (generated) + `bfiLimits.generated.ts` (generated from Rust `kv_plan`);
8. `BI/bf-local/hub.rs` (hard-coded Ollama-tag hub: llama3.x, qwen2.5, gemma2);
9. api `providerModelCatalog.ts` (per-tenant fetch).

**Routers: about 10.**
- The shared core is `packages/model-router` (+ `learned-routing`, `difficulty-router`, `cost-levers`). api and agent-runtime each bind their own `CatalogView` to it, which is fine.
- Extra pickers:
  - api `proxySeed`/`poolRouting`/`modelPool*`/`proxyRoutePlan`, `pickCloudModel.ts`, `byoRoleOrder.ts`/`byoModelRouting.ts`;
  - `local-inference/plan.ts` + `brain-embedded/hostModelStream.ts` + `localSuccessRouter.ts`;
  - VS Code `models/modelRouting.ts`;
  - Chrome `inference/route.ts`;
  - agent-runtime `provider-cascade.ts`;
  - MEM `InferenceRouter.ts` (SSM vs transformer: a different problem).

**Fit / hardware budget:** 4 copies.
- Rust `bfi-runtime/fit.rs` + `bfi-models/kv_plan.rs`;
- TS `local-inference/fit.ts` (generated limits: good);
- `bf-local/hub.rs` (its own 0.6 share);
- WC `adaptive/`.

**KV / prefix cache:** 3 implementations.
- Rust `prefix.rs` (the real one);
- `bfi-core/resident` (GPU-resident);
- WC `kvcache/{paged,radix,lru,quant}.ts`, with **no engine feeding it**.

**Response caches:** 3.
- api `{responseCache,proxyResponseCache,semanticCache,semanticChatCache}.ts`;
- MEM `ResponseCache`/`SemanticCache`/`CachingBridge`;
- api `promptCaching.ts` (Anthropic `cache_control`, distinct).

**Ollama clients:** 6.
- `local-inference/{probe,embed}.ts`, agent-runtime `ollama-stream.ts`, api `vendors/{ollama,ollamaLocal}.ts`, Chrome `localRuntimes.ts`, `bfi/ollama.rs` (reads its store);
- also `bfi-server` *serves* the Ollama API.

**Weight stores on one machine: 8.**
1. `~/.builderforce/models` (Rust; the path is coded twice, in `bfi-runtime/store.rs` and `bf-local/runtime.rs`);
2. `~/.ollama/models`;
3. VS Code `globalStorage/local-models/<runtime>/`;
4. browser Cache Storage (HF URL);
5. WebLLM Cache Storage;
6. WC IndexedDB;
7. node-llama-cpp path;
8. Gemini Nano.

**The same Bonsai GGUF can sit in 3 of them on one PC.**

### 3.2 Inconsistencies

- **One engine, two runtime ids:** `synapse` and `bfi` both probe :11434 (Chrome dedupes them).
- **Bonsai ids differ:** `bonsai-1.7b-q1_0` (GGUF, runtime `bfi`) vs `Bonsai-1.7B-q4-ONNX` (runtime `webllm`).
- **The two local catalogs share no models:** the Rust hub uses Ollama tags; the TS catalog never lists them.
- **Price ids are OpenRouter ids** (incl. `~…-latest` aliases) and need `vendors/modelTwins.ts` to meet the vendor ids.
- **Context-window defaults disagree:** Ollama 128000 (agent-runtime), Bonsai 32768/65536, WebLLM 1024–4096.
- **The `bfi` CLI User-Agent** is hard-coded `bfi/2026.10.4`.
- **memory-engine `export/gguf.ts`** produces a GGUF that stock llama.cpp cannot run (unverified whether the docs say otherwise).

### 3.3 Target design

| Capability | Survivor | Retire / fold |
|---|---|---|
| Engine (native, wasm, napi, server) | `BI/crates/bfi-*`; distribution = the vendored `BF/packages/bfi-*` only | WC `inference/` (unused); node-llama-cpp `llama-stream.ts` once `bfi-node` covers the on-prem GGUF path |
| Local runtime registry, catalog, fit, local-first plan | `BF/packages/local-inference` | `bf-local/hub.rs` + its `fit.rs` (Synapse rebuild); one runtime id for the engine (`bfi`; `synapse` becomes a host label, not a runtime) |
| Hardware limits | Rust `kv_plan` → generated `bfiLimits` (already) | `hub.rs` 0.6 share, WC `adaptive/` |
| Cloud catalog (price, context, tier, roles) | `packages/model-catalog`, generated from ONE pipeline: priceSnapshot + vendor registry + context table | agent-runtime hand tables (`models-config.providers.ts`, `*-models.ts`); api `modelCatalog.ts` reads the same snapshot |
| Routing order | `packages/model-router` (+ learned, difficulty, cost-levers) | VS Code `modelRouting.ts`, Chrome `route.ts` and `provider-cascade.ts` become thin `CatalogView` bindings; api pickers (`pickCloudModel`, `byo*`, `poolRouting`) collapse into model-router policies |
| Prefix / KV cache | Rust `prefix.rs` (+ `resident`) | WC `kvcache/*` (no consumer) |
| Response cache | one library: MEM `ResponseCache`/`SemanticCache` behind api `cacheScope.ts` | api's own copies |
| Ollama client | `local-inference` (`probe`, `embed`, + a stream adapter) | agent-runtime `ollama-stream.ts`, Chrome `localRuntimes.ts` probe |
| Weight store | ONE machine store: `~/.builderforce/models` (`BFI_MODELS_DIR`), with sha256 and resumable download; VS Code `hostBfi/modelFiles.ts` points at it | VS Code `globalStorage/local-models`; the duplicated `models_dir()` in `bf-local`. Browser Cache Storage stays (a different host) |

### 3.4 Granular gaps

| ID | Gap | Fix | Where |
|---|---|---|---|
| INF-G001 | The vendored `bfi-web` is stale (2026.10.10 vs crate 2026.10.12); its `SOURCE.json` may lag the bytes | Re-run `scripts/vendor-bfi-web.mjs`; add a drift guard against the crate version | `BF/packages/bfi-web`, `BI/crates/bfi-web` |
| INF-G002 | WC `inference/` (ONNX/wllama/WebLLM) has no consumer | Validate, then retire (or wire it if a host needs ONNX) | `WC/packages/browser/src/inference/*`, `ml.ts` |
| INF-G003 | WC `kvcache/*` (paged/radix/lru/quant) has no engine feeding it | Retire; the Rust `prefix.rs` is the prefix cache | `WC/packages/browser/src/kvcache/*` |
| INF-G004 | WC `adaptive/` and `learning/` duplicate the fit and routing ideas, with no consumer found | Validate, then retire | `WC/packages/browser/src/{adaptive,learning}` |
| INF-G005 | About 9 model catalogs; agent-runtime hand-codes context windows and prices | One generated catalog pipeline in `model-catalog`; agent-runtime consumes it | `agent-runtime/src/agents/models-config.providers.ts`, `*-models.ts` |
| INF-G006 | Rust `hub.rs` local catalog (Ollama tags) is disjoint from the TS `local-inference` catalog | One local catalog (`local-inference`); Synapse rebuild drops `hub.rs` | `BI/crates/bf-local/src/hub.rs` |
| INF-G007 | 4 fit/hardware-budget implementations | Rust `kv_plan` → generated `bfiLimits` only | `hub.rs`, `fit.rs` ×2, WC `adaptive` |
| INF-G008 | About 10 model pickers; api pickers outside `model-router` | model-router policies; hosts keep only `CatalogView` bindings | api `pickCloudModel`, `byo*`, `poolRouting`, `proxySeed`; VS Code `modelRouting.ts`; Chrome `route.ts`; `provider-cascade.ts` |
| INF-G009 | 3 response-cache implementations | One library behind `cacheScope.ts` | api `*Cache.ts`, MEM `ResponseCache`/`SemanticCache` |
| INF-G010 | 6 Ollama clients | `local-inference` owns probe, embed and stream | `ollama-stream.ts`, Chrome `localRuntimes.ts`, api `vendors/ollama*.ts` |
| INF-G011 | 8 weight stores; the same Bonsai GGUF stored up to 3× per machine; `models_dir()` coded twice in Rust | One machine store `~/.builderforce/models` shared by VS Code and `bfi serve` | `hostBfi/modelFiles.ts`, `bf-local/runtime.rs`, `bfi-runtime/store.rs` |
| INF-G012 | `synapse` and `bfi` are two runtime ids for one engine on :11434 | One runtime id (`bfi`); host labels are separate | `local-inference/runtimes.ts`, Chrome `localRuntimes.ts` |
| INF-G013 | Bonsai id drift (`bonsai-1.7b-q1_0` vs `Bonsai-1.7B-q4-ONNX`); context-window defaults disagree (128000 / 32768 / 1024–4096) | Ids and context come from the one catalog | `local-inference/catalog.ts`, `ollama-stream.ts` |
| INF-G014 | node-llama-cpp is a second native GGUF engine in agent-runtime | Use `bfi-node` (same contract as VS Code) | `agent-runtime/src/agents/llama-stream.ts` |
| INF-G015 | `bfi` CLI User-Agent hard-coded `bfi/2026.10.4` | Derive it from the crate version | `BI/crates/bfi/src/hf.rs` |
| INF-G016 | memory-engine GGUF export is not llama.cpp-runnable; the docs may imply it is | Document the format, or rename the exporter | `MEM/packages/memory-engine/src/export/gguf.ts` |

---

## 4. Agent memory: Evermind, facts, skills, episodes, runs

Roots: `B` = Builderforce.ai, `M` = builderforce-memory, `I` = builderforce-inference, `W` = builderforce-webcontainers.

### 4.1 What is already shared, and what is not

**Already shared:**
- the fact engine (`M/memory` `MemoryStore`, `recallRanked`, `EvermindCognition.commitFact`);
- the memory MCP server (`M/memory-mcp`);
- the experience model: Episode, Skill, Run, Train-Once (`M/memory-engine/experience`);
- ONE console, `EvermindConsole` in `packages/brain-ui`, mounted by the frontend, VS Code `EvermindScreen` and the Synapse `app/console`;
- the `memory_*` tool contract (`agent-tools` `MemoryCapability`), with a cloud implementation (`buildMemoryCapability` over `memoryService`) and an on-prem one (`agent-runtime/run/nodeMemory.ts`).

Synapse's `bf-memory` is a thin MCP client: no second store.

**Not shared:**

| Capability | Copies |
|---|---|
| Fact stores | **9 shapes**:<br>- `memory.json` (local);<br>- cloud tables `project_facts` and `agent_memory` (scoped);<br>- `facts` (subject/predicate/object, a different model);<br>- Evermind Durable Object `mem:` ring;<br>- `.builderforce/memory/<date>.md` notes;<br>- Claude auto-memory `*.md`;<br>- agent-runtime sqlite-vec index (`src/memory/*`);<br>- W `memoryIntegration` IndexedDB;<br>- brain-embedded `onDeviceMemory` (a tab Q&A cache). |
| Recall / ranking | **6 formulas**:<br>- M hybrid RRF + importance + 90-day decay;<br>- api `memorySemanticRecall` (pgvector + lexical, its own formula);<br>- Evermind `/evermind/recall` (SSM cosine);<br>- agent-runtime `memory/hybrid` (wraps M math, own store);<br>- W `LexicalIndex` (its own BM25 + RRF);<br>- api `recallSops` (BM25). |
| Remember / dedupe | `commitFact` (replace by key); `memoryService.remember` (scope specificity); `writeProjectFact`; agent-runtime vector dedupe; Evermind `learn-text` reconcile. |
| Compaction | memory-mcp `compaction.ts` (reused by VS Code); M `working/consolidate` (codemap); `brainMemory` consolidation into `project_memories`; agent-runtime `memory-flush` (prompt-driven). |
| Tool names | Memory MCP and agent-tools define the fact operations. VS Code advertises `memory__recall` and `memory__remember` with stable editor dispatch IDs. Headless Markdown uses the Workspace provider with legacy call IDs preserved. |
| Episodes / skills / runs schema | TS `memory-engine/experience/types.ts` **hand-mirrored in Rust** `I/crates/bf-teach/model.rs`. Synapse `facts_list` reads `memory.json` directly, bypassing the server. |
| "Skill" | **3 unrelated meanings**:<br>(a) a Train-Once procedural skill (engine);<br>(b) a SKILL.md agent skill (`packages/agent-skills`, cloud `skills` / `tenant_skills` / `marketplace_skills` / `skill_files`, agent-runtime `skill-registry`);<br>(c) the Claude Code plugin skill (`plugins/builderforce-memory/skills`). |
| Run ledgers | memory-engine `Run` / `RunStepLog` (`experience.json`), written by Synapse `runs.rs`; cloud `runDelta` / `runOutcomes`, `commitRunMemory` facts `run-outcome:<scope>:<id>`; `brain_chat_steps`; agent-runtime `run-outcome-memory.ts`. |
| Chat learning | `chat_memories` (per session) + `project_memories` (per project) vs Evermind `learn-text` contributions vs the `brain_chat_*` tables. |
| "Learn" / train | local `trainOnce` and `experience_train` (CPU) vs cloud `evermindLearningPipeline`, `evermindDistillation`, `evermindDeltaLearn` (server SSM). Different data, same word. |
| Brain map UI | Synapse hand-written `ui/js/views/brain/*.js` vs frontend `EvermindBrainMap` vs `EvermindBrain3D` (canvas station). Synapse also has hand-written facts, skills, teach and runs views. |
| Embedding spaces | **5, not comparable**: pgvector 1536 (legacy) + 1024 bge-m3 (cloud); `EvermindLM` hidden state (local and the Durable Object); agent-runtime provider embeddings (OpenAI, Gemini, Voyage); W injected embedder. |
| Local ↔ cloud sync | **None for facts.**<br>- The Merkle knowledge sync covers graphs only.<br>- `/api/sync/v1` covers chat and tickets.<br>- The VS Code import teaches Evermind (`learn-text`), not `project_facts` (unverified).<br>- agent-runtime pushes `team:` and `run-outcome:` facts one way. |

### 4.2 Inconsistencies

- **Names:**
  - "Evermind" means the model, the whole brain, the facts and the console.
  - "Brain" means the chat assistant, the map visual and Synapse `cloud/brain.rs`.
  - "Memory" means facts, RAM (W `src/memory`), the `agent_memory` table, markdown notes and the workspace index (`memory_search`).
- **IDs:**
  - memory-mcp keys are free strings;
  - cloud keys are `varchar(255)` with uuid ids;
  - `chat_memories` uses serial ids;
  - experience ids are 16 hex characters.
  - Key prefixes are not registered anywhere: `team:`, `run-outcome:`, `codemap:`, `[absorbed→…]`.
- **Limits:**
  - local 10,000 entries vs cloud key length 255;
  - recall defaults 5 (VS Code max 20) vs Synapse injecting 6,000 characters;
  - the 90-day half-life applies locally only.
- **Locations:**
  - `~/.builderforce-memory/memory.json` (canonical) and `~/.claude/builderforce-memory/memory.json` (legacy; whichever is newer wins, which is a split-brain risk);
  - `<ws>/.builderforce/memory/<date>.md`;
  - `.builderforce/model.bin`.

### 4.3 Target design

| Capability | Survivor | Change |
|---|---|---|
| Fact model, rank and write | M `MemoryStore` + `recallRanked` + `commitFact` | Cloud `memoryService` keeps governance and scoping but calls M's ranker (one formula). `facts` (triples) is either folded into `agent_memory` or documented as the knowledge graph's own store. |
| Tool contract | `MemoryCapability` for Evermind facts and `WorkspaceMemoryCapability` for local Markdown | Editor fact tools and headless Markdown tools have canonical provider names. Saved calls continue to resolve through their original tool IDs. See `MCP-G022`. |
| Compaction | memory-mcp `compaction.ts` | `brainMemory` consolidation and `memory-flush` call it. |
| Experience (episodes, procedural skills, runs, Train-Once) | M `memory-engine/experience` | Rust `bf-teach` types are retired with the Synapse rebuild (the TS IDE hosts the teach flow). No direct reads of `memory.json`. |
| SKILL.md skills | `packages/agent-skills` + cloud `skills*` | Rename the procedural kind ("routine" or "recipe") so "skill" means one thing. |
| Run ledger | cloud `runOutcomes` / `runDelta` for runs; experience `Run` only for Train-Once replays | One `RunRef` id shared across both. |
| Consoles and maps | brain-ui `EvermindConsole` + one brain map (merge into the shared 3D stage, `AE-G059`) | Synapse hand-written views are retired. |
| Local ↔ cloud facts sync | new: facts over the existing local-first `/api/sync/v1` outbox (`packages/local-first`, `write-outbox`) | `memory.json` ↔ `project_facts`/`agent_memory` with scope and provenance; the import path stops being the only bridge. |
| Embeddings | one fingerprint per store, declared; the cloud failover vendor stated | (same policy as `CIX-G012`) |
| RAM manager naming | W `src/memory` → `src/residency` | It is not agent memory. W `memoryIntegration` reuses M `retrieval`/`ingest`. |

Cloud durable project beliefs are owned by `project_facts`. Tenant and ticket beliefs
are owned by the corresponding `agent_memory` scope. The separate `facts` relation stores
subject-predicate-object records for the Facts API. The Evermind coordinator's `mem:`
records track model contributions, and `project_facts` rows with source `qa-cache`
serve exact-question lookups. Governed recall reads active durable facts.
Workspace Markdown remains a workspace-owned input and its SQLite index is derived.
The MCP snapshot and archive live under the canonical per-machine memory directory.
Experience lives beside them and owns recorded episodes, procedures and replay logs.
Scoped replication into the cloud fact owners remains open.

**Terminology.** A fact is a durable belief. An episode is a recorded demonstration.
A procedure is the replayable result of Train Once. A schedule controls when it
runs. An agent skill is a SKILL.md capability. Evermind names the model and its
learning system, Brain names the chat assistant, and the brain map visualizes
Evermind activity. Residency manages browser RAM and model placement.

| Embedding store | Fingerprint and enforcement |
|---|---|
| Cloud durable facts | Provider and model stamp plus the pgvector column width. Free-embedding writes try Cloudflare bge-m3 and fall back to OpenRouter text-embedding-3-small. Recall searches each space with its own query vector. |
| Project Evermind learning history | Immutable model artifact reference and embedding recipe. Unstamped or stale vectors are refreshed within a bounded read budget. Larger stale windows use lexical recall until the existing reindex endpoint refreshes them. |
| Local MCP and in-memory facts | The MCP cache requires the embedder's fingerprint and vector width. In-memory recall invalidates derived caches when the runtime or its declared fingerprint changes and checks dimensions before scoring. |
| Runtime workspace notes | The SQLite store and cache use the provider and model fingerprint. The index rebuilds when its recorded provider key changes. |
| Browser knowledge | Each store instance binds its embedder fingerprint and width. Invalid vectors are excluded at restore, ingest or query. |

### 4.4 Granular gaps

| ID | Gap | Fix | Where |
|---|---|---|---|
| MEM-G101 | Cloud and local owners are documented above. Local and cloud durable facts still need a synchronization contract | Follow the scoped sync contract in MEM-G110 | §4.1 row "Fact stores" |
| MEM-G102 | Implemented in source. Cloud and local durable facts use the memory package's weighted fusion with importance and a 90-day half-life for cloud and MCP recall. pgvector and SSM supply dense evidence, and ILIKE and BM25 supply their respective lexical evidence | Ship the memory package changes | `memoryRecallRanking.ts`, M `MemoryStore` and `HybridRetriever` |
| MEM-G103 | Implemented. VS Code advertises `memory__recall` and `memory__remember` and uses the shared `MemoryCapability` tools | Retain the saved editor dispatch IDs | `clients/vscode/src/memory/cognition.ts` |
| MEM-G104 | agent-runtime keeps a second memory index (sqlite-vec + provider embedders) with tools `memory_search`/`memory_get` | Retire with the pi loop; the workspace-notes index moves to `code-index` (§2) | `agent-runtime/src/memory/*`, `agents/tools/memory-tool.ts` |
| MEM-G105 | The native helper now round-trips a fixture emitted by the TypeScript Train Once engine. The release workflow runs the contract test | Retire the mirrored types when the native helper is replaced | `I/crates/bf-teach/tests/experience_contract.rs` |
| MEM-G106 | Closed with the retirement of the Tauri client and its direct fact reads | Fact access goes through Memory MCP | `M/packages/memory-mcp` |
| MEM-G107 | Implemented in source. VS Code labels Train Once results as procedures and the shared Memory MCP server advertises procedure tool names | Keep saved tool IDs, scoped aliases and persisted fields compatible | `clients/vscode/src/experience`, M `experience/tools.ts` |
| MEM-G108 | 4 run ledgers with unrelated ids | One `RunRef` | `experience.json` runs, `runOutcomes`, `runDelta`, `brain_chat_steps` |
| MEM-G109 | 4 compaction paths | memory-mcp `compaction.ts` only | `brainMemory.ts`, `working/consolidate`, `memory-flush.ts` |
| MEM-G110 | The sync outbox mirrors local memory-fact records as client-reported history. The MCP snapshot and cloud durable fact owners have no scoped replication contract | Connect explicitly scoped facts through the sync outbox and governed cloud writes | `packages/local-first`, `write-outbox`, memory-mcp backend |
| MEM-G111 | Implemented in source. The installer, servers and generated hook import legacy data into the canonical location when the canonical snapshot is absent. Existing canonical and legacy snapshots are preserved | Ship Memory MCP and refresh older host entries that pin the legacy path | `memory-mcp` `resolveMemoryFile()` |
| MEM-G112 | Implemented. Cloud and on-prem share registered fact prefixes and run-outcome key construction. The codemap prefix comes from the memory package. The absorbed marker is fact content and remains owned by compaction | Preserve existing serialized keys and stubs | `packages/agent-tools/src/memoryFactKeys.ts`, M `compaction.ts` |
| MEM-G113 | Implemented in source. Every active memory embedding store declares its fingerprint and gates vector reuse. The Evermind model ring now stamps its active artifact and recipe | Roll out and refresh stale learned-memory vectors through the existing reindex endpoint | `memoryEmbeddingPolicy.ts`, `ProjectEvermindCoordinatorDO.ts`, M `SemanticRecall.ts`, W `memoryIntegration` |
| MEM-G114 | Two active brain-map renderers remain, `EvermindBrainMap` and `EvermindBrain3D` | Render both on the shared stage after the stage package extraction (AE-G059) | frontend Studio and canvas station |
| MEM-G115 | Implemented in source. Browser RAM management lives in `src/residency` and the memory terminology is documented above | Ship with the next webcontainers release | W `packages/browser/src/residency` |
| MEM-G116 | Implemented. Browser memory uses the memory package's chunking, BM25 scoring, RRF and decay. The browser adapter owns its incremental postings and IndexedDB persistence | Ship with the next webcontainers release | `W/packages/browser/src/memoryIntegration/*` |

## 5. Chat: composer, transcript, streaming, persistence

Paths: BF = `Builderforce.ai`, I = `builderforce-inference`. The audit is read-only; anything not opened is marked UNVERIFIED.

### 5.1 Headline

The React hosts (web, canvas, VS Code, Chrome) already share the chat. They mount:

- from `@seanhogg/builderforce-brain-ui`: `AiSurface`, `BrainTimeline`, `BrainComposer`, `ToolConfirmBar`, `PendingQuestionBanner`, `StarterTile`, `PromptOptionsMenu`, `QueuedTurnChips`, `useVoiceDictation`;
- from `@seanhogg/builderforce-brain-embedded`: `useBrainConversation`, `useChatTurns`, `streamChatCompletion`, `createHostModelStream`, `createBrainRestPersistence`, `gatherChatDiagnostics`, the `composerCommands` registry.

The real duplication is in four places:

1. **Synapse** has its own vanilla-JS chat: composer, transcript, approval, streaming through `brain.rs`, and a copy of dictation.
2. **The agent-runtime TUI and the Lit Control UI** each have their own message model, their own tool cards and a third slash-command registry.
3. **Web legacy components:**
   - `ChatMessageContent.tsx` is a second markdown renderer.
   - `ChatMessageBubble.tsx` and `ChatMessageActions.tsx` duplicate the brain-ui message rows and actions.
4. **Pieces each host owns:** labels, starters, model-picker adapters, the transcript serializer and diagnostics.

### 5.2 Surfaces

| Surface | Shared pieces used | Implemented itself | Transport | Persistence |
|---|---|---|---|---|
| Web Brain panel `BF/frontend/src/components/brain/*` | composer, timeline, `AiSurface`, pickers, confirm, pending question, `useBrainConversation` | `ChatMessageContent`, `ChatMessageBubble`, `ChatMessageActions`, `WorkOptionsPicker`, `BrainCapabilityPicker`, `lib/brain/chatModes.ts`, `messageExport.ts` | SSE `/llm/v1/chat/completions`; `/api/brain/chats/:id/stream` for shared chats | `brain_chat_*` via `createBrainRestPersistence`; steps buffered in IndexedDB |
| Web `ChatInput` consumers (agent execution, dashboard, agent host, guest, manager) | composer | transcript drawn with `ChatMessageBubble`/`Content`; manager diagnostics (`managerChatDiagnostics.ts`, `ManagerCopyDiagnostics.tsx`) | same | `brain_chat_*`; the guest has its own routes; agent-host chat has its own store (`chatRoutes.ts`) |
| Canvas chat `creation-canvas/CanvasChatSurface.tsx`, `BrainSurface`, `BrainDock` | `SurfaceHeader`, timeline, `Avatar`, composer menu | canvas turn runner (`runCanvasGroupTurn.ts`, `useCanvasBrainTurn.ts`), `canvasDiagnosticsContext.tsx` | same | same |
| VS Code webview `clients/vscode/webview/src/chat/*` | nearly all of brain-ui; `useBrainConversation`, `useToolConfirmationGate`, `gatherChatDiagnostics` | `chatLabels.ts` (240 lines), `composerLabels.ts`, `editorStarters.tsx`, `useComposerModels.ts`, `diagnostics/transcript.ts` and `transcriptSections.ts`, `runDelta/*`, `SubagentStrip` | agent loop in the extension host (`brainRunHost.ts`); events sent to the webview with postMessage; SSE proxied by `hostFetch.ts` | local-first records via `hostPersistence.ts`, synced to `brain_chat_*` |
| Chrome side panel `clients/chrome/src/sidepanel/*` | composer, timeline, `AiSurface`, banners, starters, confirm | `ConfirmCard` (wraps `ToolConfirmBar`), `ModelPickerSection`, `rovrStarters`, `toolLabels`, `i18n/t`/`rovrLookup`; **no Copy diagnostics** | `createHostModelStream` → gateway SSE | IndexedDB `RovrRecords` with an outbox to `brain_chat_*` |
| Synapse `I/app/ui/js/views/chat.js`, `chat/*`, `approval.js`, `stepText.js`, `src-tauri/src/cloud/brain.rs` | **none** | everything: composer, transcript, live reply, approvals, step text, dictation copy | Rust `reply_in_background` emits Tauri `brain-reply`; also polls messages every 2 s or 6 s | API only (`limit=24`); no local store |
| TUI `BF/agent-runtime/src/tui/*`, `BF/packages/tui/src/*` | none | `ChatEntry` model, about 35 slash commands (`commands.ts`), model and agent pickers | gateway WebSocket (`delta`, `final`, `aborted`, `error`) | gateway sessions |
| Control UI `BF/agent-runtime/ui/src/ui/*` (Lit) | none | `message-normalizer.ts`, `tool-cards.ts`, `grouped-render.ts`, `copy-as-markdown.ts` | gateway WebSocket | gateway sessions |
| API `BF/api/src/presentation/routes/brainRoutes.ts` (893 lines), `chatRoutes.ts`, `guestRoutes.ts`, `llm/chatCompletionsRoutes.ts` | — | `application/brain/*` (`BrainService`, `brainMessageStore`, `chatStepStore`, `chatDiagnosticsStore`) | SSE, plus a room relay (SSE or WebSocket UNVERIFIED) | `brain_chats`, `brain_chat_messages`, `brain_chat_steps`, `brain_chat_diagnostics`; agent-host messages are separate |

### 5.3 Duplicate-responsibility matrix

| Capability | Survivor | Other copies |
|---|---|---|
| Composer | `brain-ui/src/composer/BrainComposer.tsx` | TUI input; `brain-embedded/src/ui/PromptInput.tsx` is used by the web Meeting Room |
| Markdown | `brain-ui/src/Markdown.tsx` | `frontend/src/components/ChatMessageContent.tsx` (own react-markdown setup, mermaid, save-fence, apply, create-file); Control UI `grouped-render.ts` |
| Message rows and actions | `brain-ui/src/timeline/MessageRows.tsx` and `MessageActions.tsx` | web `ChatMessageBubble`, `ChatMessageActions`, `BrainMessageActions` |
| Tool cards and step text | `brain-ui` `ToolStep`, `StepRows`, `ToolGroupRow`, `toolStepView.ts` | Control UI `tool-cards.ts`; Synapse `stepText.js`; TUI renderer |
| Approval | `brain-ui/src/ToolConfirmBar.tsx` | Synapse `approval.js` and `liveReply.js`; TUI approvals (the web and Chrome wrappers are fine) |
| Model picker | `brain-ui` `promptOptions/ModelPane.tsx` and `composer/composerModel.ts` | Chrome `ModelPickerSection.tsx`; VS Code `useComposerModels.ts`; web `useComposerOptions.ts` and `dockModelMenu.ts`; TUI `/model` |
| Slash-command registry | `brain-embedded/src/composerCommands/*` | VS Code `src/composerCommands/*` (host entries, fine); TUI `commands.ts` and `auto-reply/commands-registry.ts` (third and fourth registries, with hand-written help) |
| Streaming and event parse | `brain-embedded` `streamChatCompletion.ts` and `hostModelStream.ts` | Synapse `brain.rs` `model_turn`; TUI `tui-stream-assembler.ts`; Control UI `controllers/chat.ts` |
| Conversation store | `brain-embedded` `brainRestPersistence`, `localFirstPersistence`, `useBrainChats`, `useBrainConversation` | Synapse `chatStore.js` and `brain.rs`; agent-host store (`chatRoutes.ts`); TUI and Control UI gateway sessions |
| Transcript and diagnostics | `brain-embedded` `gatherChatDiagnostics`, `chatDiagnosticsReport`, `brainTriage` | VS Code `diagnostics/transcript.ts` and `transcriptSections.ts`; web `managerChatDiagnostics.ts`, `diagnosticsCapture.ts`, `diagnosticsReport.ts`; `canvasDiagnosticsContext.tsx`; `brain-ui/src/evermind/diagnosticsReport.ts` |
| Starters and work modes | `brain-ui/src/surface/StarterTiles.tsx`; `ModePane.tsx` and `brain-embedded/src/chatMode.ts` | VS Code `editorStarters.tsx`; Chrome `rovrStarters.tsx`; web `useComposerStarters.tsx`, `WorkOptionsPicker.tsx`, `BrainCapabilityPicker.tsx`, `lib/brain/chatModes.ts`; Chrome `runOptions.ts` |
| Voice | `brain-ui/src/useVoiceDictation.ts` | Synapse `chat/dictation.js` (its header says it is a verbatim copy); Spawn `desktop/spawn/ui/js/dictation.js` (UNVERIFIED) |
| Limits | `packages/asset-limits` serves the API, Brain and VS Code. `brain-embedded` owns `toolResultBudget` and `HISTORY_TOKEN_BUDGET` | Remaining host budgets need review |
| Labels | `brain-ui` `labelCatalog.ts` and `timelineCatalog.ts` | six label paths: web next-intl plus hand maps (`PERSONA_PATH`, `RECIPIENT_PATH`); VS Code `chatLabels.ts` and `composerLabels.ts`; Chrome `i18n/t` plus a `QUEUED_KEY` map (`$1` vs `{model}`); Synapse `i18n.js`; TUI English literals; Control UI `ui/src/i18n` |

### 5.4 Data-model overlaps

- **Messages.** `BrainMessage` (`brain-embedded/src/types.ts`) is canonical; the API row adds `eventKey`. Steps are role `tool` with `metadata.kind = 'step'`, stored in `brain_chat_steps` and merged back by `chatStepStore.mergeSteps`. Other shapes:
  - Synapse uses untyped JSON plus `live` and `replyError`.
  - The TUI uses `ChatEntry`.
  - The Control UI normalizes `unknown` messages itself.
  - Agent-host chat has a separate messages table.
- **Conversations.** `brain_chats` with `chatMode`. Chrome `LocalChat`, VS Code local-first records and TUI sessions meet the cloud chat only through sync (`chatIdentity.boundServerId`). TUI sessions never do.
- **Stream events.** There is no shared vocabulary:
  - TUI: `delta`, `final`, `aborted`, `error`;
  - Synapse: `brain-reply`;
  - gateway SSE: `chat.completion.chunk`;
  - VS Code: `run.*` over the bridge;
  - API room stream: its own events.

### 5.5 Target design

- **brain-ui owns everything on screen**, including:
  - markdown, with hooks for mermaid, save-fence, apply and internal links;
  - message rows and actions, with web-only actions (export) injected as data;
  - starter and model-picker rendering; hosts supply only data adapters.
- **brain-embedded owns the conversation:**
  - the store, persistence and the turn controller;
  - stream parsing;
  - the transcript serializer, moved up from VS Code so web and Chrome get Copy transcript;
  - limits, one exported constants module that every host imports;
  - the composer-command registry, which the TUI also reads.
- **One run-event vocabulary.** Define `RunEvent` once (`run.start`, `run.delta`, `run.step`, `run.confirm`, `run.final`, `run.error`). Adapters translate gateway WebSocket, Tauri and SSE into it, so every host shows the same states and diagnostics.
- **One label catalog.** Use brain-ui `labelCatalog` keys; hosts provide a `t(key)` adapter only and delete their key-mapping tables.
- **Synapse.** The Code-OSS build uses the Builderforce extension's webview chat. The former Tauri chat and dictation sources were retired with the standalone shell.
- **TUI and Control UI.** These stay separate renderers (terminal and Lit), but they consume the shared registry, `RunEvent` and the message normalizer.

### 5.6 Migration order

1. Shared limits module, plus a test that each host imports it (cheap; it removes the drift).
2. Move the transcript serializer from VS Code into brain-embedded. Use it in web, canvas and Chrome, which adds Copy diagnostics to Chrome.
3. Extend brain-ui `Markdown` with the web hooks. Then delete `ChatMessageContent`, `ChatMessageBubble` and `ChatMessageActions` and move manager, guest and agent-execution to `BrainTimeline`.
4. Label catalog: switch Chrome, web and VS Code to `labelCatalog` adapters and delete the key-mapping tables.
5. Model-picker and starter adapters: keep only the data, rendered by brain-ui.
6. Define `RunEvent` and add adapters for the TUI and Control UI; have the TUI read the shared command registry.
7. Merge the agent-host chat store into `brain_chat_*`: expand/contract migration, `agent_host_id` as a column.
8. Synapse: removed by the IDE rebuild.

### 5.7 Gaps

| ID | Gap | Fix | Where |
|---|---|---|---|
| CHAT-G001 | Second markdown renderer on the web | Extend brain-ui `Markdown`, then delete the copy | `frontend/src/components/ChatMessageContent.tsx` |
| CHAT-G002 | Web message bubble and actions duplicate brain-ui rows | Fold into `MessageRows`/`MessageActions`; inject export | `ChatMessageBubble.tsx`, `ChatMessageActions.tsx`, `BrainMessageActions.tsx` |
| CHAT-G003 | Manager, guest and agent-execution panels draw their own transcript | Mount `BrainTimeline` | `ManagerChatPanel.tsx`, `GuestBrainPanel.tsx`, `AgentExecutionPanel.tsx` |
| CHAT-G004 | Transcript serializer lives only in VS Code | Move to brain-embedded | `webview/src/diagnostics/transcript.ts`, `transcriptSections.ts` |
| CHAT-G005 | Chrome has no Copy diagnostics | Use the shared serializer and report | `clients/chrome/src/sidepanel/*` |
| CHAT-G006 | Four diagnostics report builders | One `chatDiagnosticsReport`; canvas and manager supply sections | `managerChatDiagnostics.ts`, `diagnosticsCapture.ts`, `diagnosticsReport.ts`, `canvasDiagnosticsContext.tsx` |
| CHAT-G007 | Model-picker rendering in three hosts | Data adapters only → `ModelPane` | Chrome `ModelPickerSection.tsx`, VS Code `useComposerModels.ts`, web `useComposerOptions.ts`, `dockModelMenu.ts` |
| CHAT-G008 | Starter and work-mode tiles built per host | Starter data into `StarterTiles`; modes from `chatMode.ts` | `editorStarters.tsx`, `rovrStarters.tsx`, `useComposerStarters.tsx`, `WorkOptionsPicker.tsx`, `BrainCapabilityPicker.tsx`, `lib/brain/chatModes.ts`, Chrome `runOptions.ts` |
| CHAT-G009 | Six label paths and hand key maps | One `labelCatalog` plus a `t()` adapter per host | `chatLabels.ts`, `composerLabels.ts`, Chrome `QUEUED_KEY`, web `PERSONA_PATH`/`RECIPIENT_PATH` |
| CHAT-G010 | Attachment size limits consolidated | `packages/asset-limits` supplies the API and VS Code. Brain preserves its public constants for the web device blob store. Review the remaining chat budgets | `packages/asset-limits`, `brain-embedded/src` |
| CHAT-G011 | Third and fourth slash-command registries with hand-written help | TUI reads `composerCommands`; help is generated | `agent-runtime/src/tui/commands.ts`, `auto-reply/commands-registry.ts` |
| CHAT-G012 | No shared run-event vocabulary | `RunEvent` plus transport adapters | TUI assembler, Control UI controller, Synapse `brain.rs`, VS Code bridge |
| CHAT-G013 | Control UI has its own message normalizer, tool cards and copy-as-markdown | Consume the shared normalizer and serializer | `agent-runtime/ui/src/ui/chat/*` |
| CHAT-G014 | Agent-host chat uses a second message store | Fold into `brain_chat_*` (expand/contract) | `api/src/presentation/routes/chatRoutes.ts` and its tables |
| CHAT-G015 | Synapse chat is a full fork: composer, transcript, approval, streaming, polling | Removed by the Synapse IDE rebuild (the VSIX chat) | `I/app/ui/js/views/chat.js`, `chat/*`, `approval.js`, `stepText.js`, `src-tauri/src/cloud/brain.rs` |
| CHAT-G016 | Dictation copied into Synapse (and Spawn) | Deleted with CHAT-G015; until then, one plain-JS build of the core of `useVoiceDictation` | `I/app/ui/js/chat/dictation.js`, `desktop/spawn/ui/js/dictation.js` |
| CHAT-G017 | Verification complete. `PromptInput` has an active consumer | Keep the component for the web Meeting Room | `frontend/src/components/meetings/MeetingRoom.tsx` |
| CHAT-G018 | Chrome diagnostics and remaining chat limits need tests | API upload, VS Code upload/download and web blob store have focused attachment coverage | CHAT-G005, CHAT-G010 |

## 6. Shell, terminal and file tools

Paths are relative to `Builderforce.ai` unless marked I (`builderforce-inference`) or W (`builderforce-webcontainers`). The audit is read-only; items not opened are marked UNVERIFIED. Synapse and the Chrome extension have no shell or file tools. builderforce-memory has none either.

### 6.1 Headline

- **The tool definitions are already shared** in `packages/agent-tools` (`run_command`, `read_file`, `write_file`, `edit_file`, `delete_file`, `list_files`, plus `command_status`, `command_stop` and `output_filter`). Each host backs them with a `CapabilityProvider`.
- **What is duplicated is the code beneath them:**
  - path containment, about 11 copies;
  - process-tree kill, 4 copies;
  - shell job tables, 3 copies;
  - command runners, 5 copies;
  - file walkers, 3 copies;
  - output caps and timeouts hard-coded per host;
  - tool-name tables spread over more than 8 files.
- **agent-runtime's native loop** still exposes its own `read`, `exec`, `process` and `apply_patch`. Only `write`, `edit` and `delete` are converged (`converged-coding-tools.ts`).

### 6.2 Inventory: command execution

| Host | Path | Limits | Policy | Tests |
|---|---|---|---|---|
| Shared definition | `packages/agent-tools/src/core-tools.ts:587`, `shell-tools.ts` | `yieldMs` ≤ 10 min; `cwdArg` rejects absolute paths and `..`; `compressShellResult` | branch-switch guard, command-shape and segment checks; no allow/deny list | `shell-tools*.test.ts`, `branch-switch*.test.ts` |
| VS Code host | `clients/vscode/src/tools/localShell.ts`, `localShellJobs.ts`, `localShellOutputs.ts`, `processTree.ts` | 10 min; 4 MB buffer; 60,000 chars returned; 32 jobs; 4 MB kept per job | kills the whole tree; jobs end with the run; runs as the user, with no command policy | `localShell*.test.ts` |
| Cloud container | `api/container/sandboxCore.mjs`, `sandboxJobs.mjs`, `server.mjs` | 10 min; 60,000 chars; 32 jobs | dedicated shell user, trusted `PATH`, scrubbed env, isolation self-check, git mirror, egress trust | UNVERIFIED |
| agent-runtime native `exec`/`process` | `agent-runtime/src/agents/bash-tools.exec.ts` (1101 lines), `bash-tools.process.ts` (680), `bash-process-registry.ts`, `shell-utils.ts`, `src/process/kill-tree.ts` | 200,000 captured, 30,000 pending; timeout in **seconds**; jobs live 30 min to 3 h; PTY support | **the only allowlist and approval system** (`infra/exec-approvals*.ts`, `gateway/exec-approval-manager.ts`, `node-command-policy.ts`) | many |
| Browser (web Brain) | `frontend/src/lib/browserRuntime/workspaceShell.ts` → W `bfsh -c` | 5 min; output is the **tail**, 16,000 chars; saved-back files ≤ 1 MB | code scan and build gate; no jobs or background runs | `workspaceShell*.test.ts` |
| Other VS Code spawn sites | `verify/execRunner.ts`, `verify/targetedTests.ts`, `runDelta/analyzers/nodeAnalyzerExec.ts`, `knowledge/knowledgeShell.ts`, `child/childRunSpawner.ts`, plus about 30 more | each sets its own limits | — | various |
| Terminal UI | `frontend/src/components/Terminal.tsx` (xterm; the only terminal component) | — | — | — |

### 6.3 Inventory: file tools

- **Shared:**
  - `core-tools.ts` definitions;
  - `edit.ts` and `edit-match.ts` (`applyStringEdit`, ≤ 20 edits per call);
  - `fileRead.ts` and `fileWindow.ts` (≤ 8 paths, 64,000-character whole-read cap);
  - `glob.ts`;
  - `writeOverwriteGuard.ts` and `writeScope.ts`.
- **Providers:**
  - on-prem `agent-runtime/src/agents/node-capability-provider.ts`;
  - sandbox `sandbox-capability-provider.ts`, which has its own `resolveInsideRoot` (line 101) and its own walker;
  - VS Code `clients/vscode/src/tools/localCapabilities.ts`, with 2 MB reads and lists of 5,000 scanned and 400 returned;
  - container `api/container/workspaceAgent.mjs`, with `insideClone` and a hand-copied `dirMayContainGlobMatch`;
  - Worker/API `api/src/application/ide/workspaceStore.ts` and `worker/src/lib/workspacePath.ts`, both using `packages/workspace-path`;
  - browser `frontend/src/lib/browserRuntime/coding.ts` and `workingTree.ts` (UNVERIFIED);
  - MCP `packages/workspace-mcp/src/workspaceFiles.ts`, which re-checks with realpath.
- **Native agent-runtime tools:**
  - `native-file-tools.ts` (`read` ≤ 2,000 lines / 50 KB; its own BOM- and CRLF-tolerant edit matcher);
  - `apply-patch.ts` and `apply-patch-update.ts` (real patch syntax, `assertSandboxPath`).
- **Containment helpers**, all separate:
  - `sandbox-paths.ts:149`;
  - `sandbox/fs-paths.ts:227,235`;
  - `infra/path-safety.ts:8`;
  - `security/scan-paths.ts:3`;
  - `commands/cleanup-utils.ts:49`;
  - `agents/identity-avatar.ts:49`;
  - `extensions/bluebubbles/src/media-send.ts:73`;
  - VS Code `knowledge/sourcePort.ts:37` (realpath) and `knowledgeFixPaths.ts:29`;
  - container `insideClone`.

### 6.4 Duplicate-responsibility matrix

| Capability | Survivor | Other copies |
|---|---|---|
| Path containment | `packages/agent-tools/src/node-path.ts` (`resolveInsideRoot`, `resolveInsideRootOrThrow`, `resolveShellCwd`), plus a new realpath variant | the 11 helpers in §6.3 |
| R2/IDE key validation | `packages/workspace-path` | none found |
| Process-tree kill | `clients/vscode/src/process/killTree.ts` (taskkill from `%SystemRoot%`), moved to a shared node subpath, with agent-runtime's graceful-then-forced option | `vscode tools/processTree.ts`, `agent-runtime/src/process/kill-tree.ts`, `agents/shell-utils.ts:153`, `api/container/sandboxJobs.mjs:186` |
| Shell job table | `api/container/sandboxJobs.mjs` `createJobTable` | `vscode localShellJobs.ts` (`MAX_JOBS = 32` copied), `bash-process-registry.ts` |
| Command runner | `api/container/sandboxCore.mjs` `runShell` | `localShell.ts`, `bash-tools.exec-runtime.ts`, `workspaceShell.ts`, `verify/execRunner.ts` |
| Output caps and timeouts | `packages/tool-output-policy/src/caps.ts` (`SHELL_CAPTURE_CHARS`) | `localShell.ts:31-33`, `workspaceShell.ts:43,46`, `native-file-tools.ts`, `localCapabilities.ts`, `sandboxCore.mjs:34`, `bash-tools.exec.ts:226` |
| File walk and list | `agent-tools/src/glob.ts` plus one node walker | `node-capability-provider.ts:73`, `sandbox-capability-provider.ts:68`, `localCapabilities.ts:48`; `workspaceAgent.mjs:364` (hand-copied) |
| String edit | `agent-tools/src/edit.ts` `applyStringEdit` | `native-file-tools.ts` edit |
| Tool-name tables | `agent-tools/src/toolAliases.ts` | agent-runtime `tool-policy.ts`, `coding-tools.policy.ts`, `tool-mutation.ts`, `sandbox/constants.ts`, `tool-retry.ts`, `tool-display.json`; `brain-embedded/src/localWorkspaceTools.ts`; api `writeAheadAllowlist.ts`; `agent-tools` `tool-mutation.ts` and `tool-side-effect.ts` |
| Command policy and approvals | `agent-runtime/src/infra/exec-approvals*.ts`, ported to `agent-tools` | none (that is the gap) |

### 6.5 Inconsistencies

- **Tool names.** The shared tools are `run_command`, `read_file`, `write_file`, `edit_file` and `list_files`; native ones are `exec`, `process`, `read`, `write`, `edit` and `apply_patch`. The `apply_patch` → `edit_file` alias maps a patch-syntax call onto a unique-string replace, which has a different contract.
- **Timeouts.** VS Code and the container use 10 min, the browser 5 min. Native `exec` takes seconds where the container API takes milliseconds.
- **Output caps.** Returned output is 60,000 characters (VS Code and container), 16,000 (browser, tail only) or 200,000 (native). Whole-file reads are capped at 64,000 characters (shared), 2 MB (VS Code) or 2,000 lines / 50 KB (native). Whether each host keeps the head or the tail is UNVERIFIED.
- **Containment rules differ:**
  - `node-path.ts` splits on the separator; `sandbox-capability-provider.ts:101` uses `startsWith("..")`, which wrongly rejects a legitimate name like `..foo`.
  - Only 2 of the 11 helpers resolve symlinks.
  - Absolute paths inside the root are accepted by `node-path.ts` but rejected by `cwdArg`.
- **Error shapes.** Errors come as `{ok:false, error}`, a thrown `PathEscapesRootError`, or a native `AgentToolResult`, and the wording differs per host.
- **Kill.** Graceful-then-forced exists only in agent-runtime; VS Code and the container kill the process group straight away.

### 6.6 Target design and order

1. **Containment.** `node-path.ts` gains `resolveInsideRootReal` (realpath, borrowed from `sourcePort.ts`). Every read/write/edit provider uses it, and the local helpers are deleted. This also fixes the `..foo` bug.
2. **Tree kill.** One shared `node-process` subpath in `agent-tools`: taskkill from `%SystemRoot%`, an optional grace period. Fold the other 4 copies into it.
3. **Caps and timeouts.** `tool-output-policy` exports `SHELL_CAPTURE_CHARS`, `DEFAULT_COMMAND_TIMEOUT_MS` and the read caps; hosts import them. The container gets them through the existing hash-checked generator.
4. **One node file walker, plus generating `dirMayContainGlobMatch`** into the container with `scripts/gen-container-shared.mjs`.
5. **Tool names.** One table in `agent-tools` consumed by the agent-runtime policy files. Fix the `apply_patch` alias by giving `edit_file` patch syntax, or by removing the alias.
6. **Native compatibility.** The runtime keeps `read` for image attachments and existing byte-window responses. It keeps `exec` and `process` for PTY input, streaming progress, multi-action session control and remote approvals. The native tools reuse shared file ranges, command policy, process groups, job storage, polling and structured failures.
7. **Command policy.** Port `exec-approvals` into `agent-tools` as a deny-list plus a confirm port, applied by the VS Code and browser shells.
8. **Job table.** One job-table module shared by the container and VS Code.
9. **Conformance suite.** One test suite run against all four providers: containment, caps, error shape, kill.
10. **Terminal.** Any new terminal (Synapse IDE, VS Code) reuses `frontend/src/components/Terminal.tsx`; under the IDE rebuild, VS Code's own terminal is used.

### 6.7 Gaps

| ID | Gap | Where |
|---|---|---|
| SHELL-G001 | Closed. The sandbox provider uses shared containment and accepts workspace paths such as `..foo` | `agent-runtime/src/agents/sandbox-capability-provider.ts`, `packages/agent-tools/src/node-path.ts` |
| SHELL-G002 | Closed. Node providers use the shared realpath guard for symlink-aware containment | `packages/agent-tools/src/node-path.ts`, `localCapabilities.ts`, `node-capability-provider.ts` |
| SHELL-G003 | Closed. Node hosts and the generated container/Actions module share `node-process` tree cancellation. The sandbox retains its shell-user signal adapter | `packages/agent-tools/src/node-process.ts`, `api/container/sandboxJobs.mjs` |
| SHELL-G004 | Closed. The shared cancellation code resolves `taskkill.exe` from the Windows system directory | `packages/agent-tools/src/node-process.ts` |
| SHELL-G005 | Closed. The editor, browser, container and native read paths use named budgets from the shared output policy | `packages/tool-output-policy/src/caps.ts` |
| SHELL-G006 | Closed. Foreground shells share the ten-minute fallback in milliseconds, converted at the runtime's seconds-based tool boundary | `packages/tool-output-policy/src/caps.ts` |
| SHELL-G007 | Closed. `apply_patch` retains its patch-syntax contract and has no `edit_file` alias | `packages/agent-tools/src/toolAliases.ts`, `agent-runtime/src/agents/apply-patch.ts` |
| SHELL-G008 | Closed under the native compatibility decision in §6.6. Shared code handles file ranges, command policy, process groups, job storage, polling and structured failures | `converged-coding-tools.ts`, `native-file-tools.ts`, `bash-tools.exec.ts` |
| SHELL-G009 | Closed. The shared policy refuses direct system maintenance commands. VS Code and the browser use existing approval UI for direct destructive Git commands. The runtime uses the shared approval decision with its host-specific rules | `workspaceCommandPolicy.ts`, `nativeRunTool.ts`, `canvasBuildCommandAction.ts` |
| SHELL-G010 | Closed. VS Code, on-prem and the sandbox use the shared provider, walker and cap | `packages/agent-tools/src/workspace.ts`, `workspaceList.ts` |
| SHELL-G011 | Closed. The container consumes generated glob and pruning rules | `api/container/workspaceGlob.mjs`, `packages/agent-tools/src/glob.ts` |
| SHELL-G012 | Closed. Editor, container, browser and native process sessions share the job registry. Native PTY sessions retain their compatibility IDs and expiry policy | `packages/tool-output-policy/src/caps.ts`, `bash-process-registry.ts` |
| SHELL-G013 | Closed. Native edit uses the shared string matcher | `native-file-tools.ts`, `packages/agent-tools/src/edit.ts` |
| SHELL-G014 | Closed. Native groups, sandbox defaults, alias resolution, retry policy, workspace selection and failover reads use the shared workspace tool names | `packages/agent-tools/src/toolAliases.ts` |
| SHELL-G015 | Closed. Shared shell failures and native compatibility errors use `{ok:false, error, code}` for validation, denial, timeout, exit, cancellation and missing jobs | `packages/agent-tools/src/shell-job-types.ts`, `bash-tools.exec.ts`, `bash-tools.process.ts` |
| SHELL-G016 | Canvas registers start, poll and stop over the shared command tools. Canvas tests verify tree cancellation for running and exited shell jobs. The WebContainers 2026.11.30 candidate builds and passes its process-host and process-shield tests, including detached descendant cancellation. Publish the candidate and verify that Canvas consumes the published version | `canvasBuildCommandAction.ts`, `workspaceShell.test.ts`, W `packages/browser/src/node/processHost.ts` |
| SHELL-G017 | Closed. The shared command suite covers working-directory validation, output caps, exit errors and background stop across VS Code, browser, native runtime and the container. Shared file fixtures cover containment and file operations | `packages/agent-tools/src/shellConformance.test-util.ts`, `agent-runtime/src/agents/cross-provider-smoke.test.ts` |
| SHELL-G018 | Closed. The terminal and output panes share `Terminal`. The frontend architecture guard rejects additional direct xterm imports | `frontend/src/components/Terminal.tsx`, `frontend/scripts/check-frontend-architecture.mjs` |

## 7. Auth, device sign-in and the cloud API client

Paths: BF = `Builderforce.ai`, I = `builderforce-inference`, M = `builderforce-memory`, W = `builderforce-webcontainers`. The audit is read-only; items not opened are marked UNVERIFIED. Security-sensitive observations are kept in the gitignored local security findings file (`AUTH-G015` to `AUTH-G019`) and only referenced here.

### 7.1 Headline

- **The server side is single:**
  - `authRoutes.ts` (1224 lines), `oauthRoutes.ts`, `passkeyRoutes.ts`, `vscodeRoutes.ts` and `sessionIntrospectRoutes.ts`;
  - JWTs verified through `packages/hs256-jwt` in both the API and the Worker;
  - revocation through `packages/session-introspection`.
- **The device flow is shared in TypeScript** (`packages/device-auth`, RFC 8628).
- **The client side is not shared.** Three copies of "editor key → base JWT → workspace JWT" exist:
  - VS Code `bfApi/session.ts`;
  - Chrome `auth/session.ts`;
  - Synapse/Spawn `bf-cloud/session.rs`.
- **The authenticated-fetch and 401 behaviour differs per host,** and the error-flattening helper is copied four times.
- **agent-runtime hand-builds `Authorization: Bearer` in about 56 files,** and reads `BUILDERFORCE_URL` with an inline fallback in about 18.

### 7.2 Clients

| Host | Sign-in | Credential storage | Session and refresh | Authed fetch and 401 | Tests |
|---|---|---|---|---|---|
| Web `frontend/src/lib/{auth.ts, auth/*, apiClient.ts, builderforceApi.ts}` | password, MFA, OAuth, SSO, magic link, passkey | web JWT and tenant JWT (see `AUTH-G015`) | no refresh; tenant JWT through `/api/auth/tenant-token` | `apiRequest`: 401 clears the session and redirects to `/login`; 402 becomes a plan-limit error | `apiClient*.test`, `auth.test`, `AuthContext*.test` |
| VS Code `clients/vscode/src/{auth/auth.ts, bfApi/session.ts, bfApi/transport.ts}` | `packages/device-auth`, with a paste-key fallback | `bfk_*` key in SecretStorage | shared key exchange and neutral workspace-token route, with compatibility fallback; 60 s margin, single-flight, epoch guard, park/drop workspace | `authed`: 401 forces a re-mint and retries once; 60 s timeout; `asTenant` pin | `session.mint`, `session.park`, `transport`, `gatewayAuth`, `editorKeyGuard` |
| Chrome `clients/chrome/src/{auth/session.ts, api/apiClient.ts}` | device flow (`SettingsView`) | encrypted credential in extension storage with an IndexedDB-backed key | shared key exchange and workspace switch; 60 s margin; a 400/401 on exchange clears the session | forced refresh and one 401 retry for replayable requests; `ApiError{status}`; `Idempotency-Key` | `session.test.ts`, `apiClient.test.ts`, `config.test` |
| Spawn `builderforce-spawn/crates/bf-cloud/{device.rs, session.rs, account.rs, error.rs}` | Rust device flow | OS keyring (`bf-vault`) | same exchange and 3600 s fallback; prefers the neutral workspace-token route | `Session::api` retries once on 401 under a Mutex | `bf-cloud` unit tests |
| agent-runtime `agent-runtime/src/commands/builderforce-connect.ts`, `infra/builderforce-relay.ts`, `run-context-client.ts` | workspace enrollment token → `POST /api/agent-hosts` → API key | OS credential store with a warned local file fallback | static key | shared base URL resolver and bearer transport | `builderforce-http.test.ts`, `env-file.test.ts` |
| SDK `BF/sdk/src/infrastructure/httpClient.ts` | — | caller-supplied key | static | rich `BuilderforceApiError`, 180 s timeout, no 401 refresh | yes |
| Memory `M/memory/src/wire/chatClient.ts`, `cache/FetchSemanticCacheBackend.ts` | — | static key | static | no 401 logic | — |
| brain-embedded `createBrainRestPersistence` | — | host-injected `getToken` | host re-mints | the host's request layer | yes |

### 7.3 Duplicate-responsibility matrix

| Capability | Survivor | Other copies |
|---|---|---|
| Device flow | `packages/device-auth` | `I/bf-cloud/src/device.rs` (Rust; kept native, but pinned by a shared fixture) |
| Editor-key session (exchange, margin, single-flight, workspace switch, rejected-key event) | VS Code `bfApi/session.ts`, **extracted** host-neutral into `packages/editor-session` (injected storage, fetch, clock) | Chrome `auth/session.ts`; `I/bf-cloud/session.rs` (Rust; fixture) |
| Authed fetch with a forced re-mint and one retry on 401 | `packages/device-auth/src/tenantSession.ts`, used by VS Code and Chrome | Rust `Session::api`; the agent-runtime sites |
| Error flattening (`{error}` vs `{error:{message,code}}`) | `frontend/src/lib/apiClient.ts` `flattenErrorBody`, moved to a shared package | Chrome `flattenErrorMessage` (its comment admits it is a copy); SDK parser; Rust `CloudError::from_ureq`, which misses the nested form |
| Base URL and web-origin derivation | none; add one resolver | VS Code `appUrl()` and `webUrl`; Rust `web_base_of`; frontend `apiOrigin.ts`; Chrome `PLATFORM_ORIGINS` |
| Key revoke on sign-out | `device-auth` `revokeKey` | Rust `sign_out` (inline) |
| JWT verify | `packages/hs256-jwt` | none |

### 7.4 Inconsistencies

- **Default base URL.** VS Code, Chrome and Synapse use `https://builderforce.ai/gateway`; web, agent-runtime, the SDK and the memory docs use `https://api.builderforce.ai`.
- **Platform configuration by host**

  | Host or service | Setting | Purpose and compatibility |
  | --- | --- | --- |
  | Runtime and native Spawn | `BUILDERFORCE_URL` | Platform API base. The runtime defaults to the direct API and Spawn defaults to the editor proxy. Spawn accepts the deprecated `SYNAPSE_BUILDERFORCE_URL` when the canonical value is absent and emits a warning. |
  | VS Code | `builderforce.baseUrl`, `builderforce.webUrl` | API gateway and optional browser origin override. The default browser origin is derived from the gateway. |
  | Chrome | Editor gateway in `clients/chrome/src/config.ts` | Extension gateway and app origins come from `platformOrigins.ts`. Manifest permissions are checked against them. |
  | Web | `NEXT_PUBLIC_AUTH_API_URL`, `NEXT_PUBLIC_WORKER_URL` | API base and optional project/IDE worker base. |
  | Runtime connection | `BUILDERFORCE_API_KEY`, `BUILDERFORCE_TOKEN`, `BUILDERFORCE_WEB_TOKEN` | Agent-host credential, initial workspace enrollment token and web-session token for onboarding, respectively. |
  | Runtime service overrides | `BUILDERFORCE_WEB_URL`, `BUILDERFORCE_GATEWAY_URL`, `BUILDERFORCE_AGENTS_LINK_URL` | Browser links, optional model gateway, and optional workforce registry endpoint, respectively. |
  | Runtime local gateway | `BUILDERFORCE_AGENTS_GATEWAY_TOKEN` | Authentication for the local agent gateway. |
  | Memory | `BUILDERFORCE_MEMORY_TOKEN` | Credential for the memory service. |
- **Refresh.** Chrome and VS Code share the forced refresh and single retry. VS Code also deduplicates concurrent token exchanges. The web signs out on 401.
- **Rejected key.** VS Code fires an event, Chrome clears the session, and Rust returns `KeyRejected` and signs out.
- **Workspace switch.** The web uses `/api/auth/tenant-token`. VS Code, Chrome and Spawn prefer `/api/auth/workspace-token` and accept the older editor route during the rollout.
- **Expiry fallback.** The API, Chrome, VS Code and Spawn use 3600 s.
- **Rust device poll** swallows non-status errors and has no distinct `cancelled` reason.

### 7.5 Target design and order

1. **Fix the doc paths and the expiry constant** (cheap). The server always sends `expiresIn`, and clients share one fallback.
2. **Extract `packages/editor-session`** from VS Code `bfApi/session.ts` and `transport.ts`, with no `vscode` imports. VS Code consumes it unchanged (its tests are the parity oracle). Chrome adopts it, which brings the 401 retry and the workspace switch.
3. **Shared error flattening and base-URL resolver.** One helper used by web, Chrome, VS Code and the SDK, plus one table documenting every configuration name; deprecate the aliases.
4. **One `builderforceClient` for agent-runtime.** Replace the hand-built Bearer sites and the `BUILDERFORCE_URL` fallbacks.
5. **Rust parity.** `bf-cloud` keeps native code, but a shared JSON fixture (device statuses, exchange responses, error bodies) runs in both the TypeScript and Rust tests. Under the Synapse IDE rebuild, the VS Code extension's session replaces it.
6. **Workspace-switch route.** Alias `/api/vscode/tenants/:id/token` under a host-neutral name (`/api/auth/workspace-token`), with expand/contract.
7. **Security items** `AUTH-G015` to `AUTH-G019`: see the local security findings file. `AUTH-G015` needs a product decision.

### 7.6 Gaps

| ID | Gap | Where |
|---|---|---|
| AUTH-G001 | Closed. TypeScript and Spawn test the same device-code, approval and poll-status fixtures | `packages/device-auth/fixtures/gateway-contract.json`, Spawn `bf-cloud` |
| AUTH-G002 | Closed. VS Code and Chrome share token caching, exchange coalescing, workspace-token resolution and stale-session retry. Spawn uses the same workspace-token fixtures and keeps refreshes bound to the selected workspace | `packages/device-auth/src/tenantSession.ts`, Spawn `bf-cloud` |
| AUTH-G003 | Closed. Chrome uses the shared 401 forced refresh and one retry for replayable requests. Tests cover the idempotency key and workspace scope | `clients/chrome/src/api/apiClient.test.ts` |
| AUTH-G004 | Closed in source. Chrome Settings switches workspaces through the shared mint route. Workspace scope travels with REST tokens, gateway requests, chat records and queued writes | `clients/chrome/src/auth/session.ts`, `host/panelServices.ts` |
| AUTH-G005 | Closed. Runtime clients use shared Builderforce URL resolution, bearer headers and transport. The wizard uses the shared API error decoder | `agent-runtime/src/infra/builderforce-http.ts` |
| AUTH-G006 | Closed. One origin contract defines the direct API and the editor proxy for restricted networks. Web, runtime, SDK, VS Code, Chrome and Spawn consume it | `packages/device-auth/src/platformOrigins.ts` |
| AUTH-G007 | Closed. §7.4 lists the canonical settings, service-specific overrides and deprecated Spawn URL alias. Spawn warns when it uses the alias | `packages/device-auth/src/platformOrigins.ts`, Spawn `bf-cloud/src/lib.rs` |
| AUTH-G008 | Closed. Web, Chrome and SDK share the error decoder. Spawn handles both flat and nested envelopes in its native decoder | `packages/api-errors`, Spawn `bf-cloud` |
| AUTH-G009 | Closed. The API and TypeScript clients use the shared 3600 s fallback. Spawn's constant is generated from that same source | `packages/device-auth/src/tenantSession.ts`, `packages/device-auth/scripts/sync-spawn-contract.mjs` |
| AUTH-G010 | Closed. The `device-auth` header names the current Chrome and VS Code entry points | `packages/device-auth/src/index.ts` |
| AUTH-G011 | Closed. Web sessions renew in the background and retry after one renewal on 401 | `frontend/src/lib/auth/tokenRenewal.ts`, `DONE.md` |
| AUTH-G012 | Closed. Focused tests cover Chrome session and retry behavior, Rust device-flow parity and runtime bearer transport | Chrome `auth/session.test.ts`, Spawn `bf-cloud`, runtime `builderforce-http.test.ts` |
| AUTH-G013 | Closed. The web, SDK, runtime and VS Code share platform base URL normalization. VS Code sign-in and deep links share web-origin derivation. Spawn verifies the same origin cases | `packages/device-auth/src/platformOrigins.ts`, Spawn `bf-cloud/src/lib.rs` |
| AUTH-G014 | Audit complete. Chrome Settings uses shared device sign-in and stores the result through the session adapter. Webcontainers AI forwarding injects host credentials through `HostRelay`. Knowledge Client and Provider Connect accept host transport ports. Provider Connect's direct account probe uses the provider's credential | `SettingsView.tsx`, Webcontainers `aiGateway.ts` and `hostRelay.ts`, `packages/knowledge-client`, `packages/provider-connect` |
| AUTH-G015 | Mitigated and closed under the web-session design decision | `DONE.md` |
| AUTH-G016 | Closed. Chrome wraps stored editor credentials with a non-extractable key and migrates legacy storage | `clients/chrome/src/auth/credentialVault.ts` |
| AUTH-G017 | Closed. Runtime sign-in stores the API key and web token in the system credential store when available. The private file fallback warns, and headless enrollment accepts the workspace token on stdin | `agent-runtime/src/infra/builderforce-credential-store.ts`, `agent-runtime/src/cli/program/register.connect.ts` |
| AUTH-G018 | Closed. VS Code connection diagnostics omit editor-key fragments | `DONE.md` |
| AUTH-G019 | Closed in source. Device approval checks workspace membership, claims credentials atomically and applies grant-specific rate limits. Focused API checks cover OAuth, CORS and revocation. The reference memory HTTP host can rotate its bearer token without restarting | `DeviceAuthService.ts`, Operator security findings, M `packages/memory-mcp/src/bin/http.ts` |
| AUTH-G020 | VS Code and Spawn source prefer `/api/auth/workspace-token` and fall back on older gateways. The 2026.11.221 VS Code Marketplace package inspected on November 27, 2026 still calls `POST /api/vscode/tenants/:id/token`. Roll out the updated clients and verify production counts for that route before retiring it | `api/src/presentation/routes/workspaceTokenRoutes.ts`, `vscodeRoutes.ts`, `clients/vscode/src/bfApi/session.ts` |

## 8. Security policy engines

Paths: BF = `Builderforce.ai`, W = `builderforce-webcontainers`, I = `builderforce-inference`, M = `builderforce-memory`. The audit is read-only; items not opened are marked UNVERIFIED. Exploitable observations are in the gitignored local security findings file (`SECP-G011`, `SECP-G013` to `SECP-G015`, and the memory part of `SECP-G004`) and are only referenced here.

### 8.1 Headline

Three good shared cores already exist:

- **`packages/code-shield`**, the scanner:
  - secret, SAST, behaviour and obfuscation rules, plus a signature set and manifest/typosquat heuristics;
  - profiles `pr-diff`, `skill-install`, `runtime` and `visualizer`;
  - a 0–100 risk score mapped to an action;
  - runs in the browser, Node and the API Worker.
- **`packages/secret-redaction`**, the redactor: about 25 `SECRET_SHAPES`, used by about 10 consumers.
- **`packages/sarif`**, the finding format: `NormalizedFinding`, `normalizeSeverity`, SARIF emit and parse.

There is one incident writer: `findingIncidentKinds.ts` writes `security_incidents`, deduped on `source_ref`, and records a governance audit entry.

The duplication sits around these cores:

- secret regexes outside `secret-redaction`;
- about 8 severity scales;
- a reason-code list mirrored by hand between W and the API;
- run-delta security rules that re-implement code-shield SAST;
- 3 sets of prompt-injection patterns;
- 6 unrelated egress mechanisms;
- 2 hosts with no policy at all (I, and M's fact storage).

### 8.2 Engines

| Engine | Path | Runs in | Output | Goes to |
|---|---|---|---|---|
| code-shield | `BF/packages/code-shield` | browser worker, Node, API Worker | `ScanFinding` (CRITICAL..LOW, category, weight, ATT&CK id); `ScanReport.complete` | PR gate `api/src/domain/security/diffScanRules.ts`; agent-runtime `security/skill-scanner.ts`; frontend `browserRuntime/codeScanner.ts`; knowledge badges `agent-tools/src/knowledge/{codeFileBadges.ts, rules/securityRisk.ts}` |
| secret-redaction | `BF/packages/secret-redaction` | everywhere | redacted text and JSON; `findSecretShapes` | api `redactSecrets.ts`, `contentTrust.ts`, `packageReview.ts`; agent-runtime `logging/redact.ts`; `interaction-contract`; `builderforce-mcp/policy.ts`; VS Code `childCoverage.ts`; run-delta `secretAdded`; `agent-env` |
| Runtime Shield | `W/packages/browser/src/security/{shieldRules, securityEvent, shieldTelemetry, ingressLimit}.ts`, `W/packages/core/src/system/{securityContext, codeScanner}.ts` | browser tab | `SecurityEvent` with 26 `ShieldReasonCode`s → severity and action | `POST /api/security/shield-incidents` (`runtimeShieldRoutes.ts`, `runtimeShieldEvent.ts`, `runtimeShieldIncidents.ts`) → `security_incidents` |
| API pipeline | `prSecurityGate.ts`, `securityMergeGate.ts`, `prSecurityScan.ts`, `prSecurityReview.ts`, `prSecurityOverride.ts`, `osvScaScan.ts`, `advisoryFeed.ts`, `githubAlerts.ts`, `WebSecurityScanner.ts`, `SecurityAuditService.ts`, `vulnerabilityFindings.ts`, `criticalFindingIncidents.ts`, `governanceAuditor.ts`, `policyPackService.ts` | API | `vulnerability_findings`, `security_incidents` | Security UI and incidents |
| agent-runtime policy | `security/{audit*, dangerous-tools, external-content, instruction-firewall, skill-scanner}.ts`, `gateway/node-command-policy.ts`, `infra/{exec-approvals*, host-egress}.ts`, `agents/tools/governance-audit/matchers.ts` | local gateway and agent | `SecurityAuditFinding` (info/warn/critical); approvals; deny-lists | local UI and logs |
| run-delta rules | `BF/packages/run-delta/src/rules/*` (`secretAdded`, `rmRf`, `tlsVerifyDisabled`, `weakCrypto`, `corsPermissive`, `cspPermissive`, `cookieInsecure`, `installScriptAdded`, `workflowPermissive`) | VS Code and API | run-delta findings (error/warn) | run-delta records |
| Egress and CSP | api `workerEgressPolicy.ts` (signed, per app), `workerEgressGrant.ts`, `workerEgressDeclarations.ts`, `runtime/sandbox/egressAllowlist.ts`, `api/container/egressTrust.mjs`, `workerCsp.ts`, `cspReports.ts`; W `previewEgress.ts`, `previewCsp.ts`; agent-runtime `infra/host-egress.ts`; frontend `middleware.ts` CSP (UNVERIFIED) | various | — | — |
| Other | VS Code `models/modelFallbackDetail.ts` (its own redactor); M `cognition/sanitize.ts` (recall injection only); I `crates/bf-vault`, `src-tauri/src/agents/secrets.rs`, `bf-teach` password redaction | — | — | — |

### 8.3 Duplicate-responsibility matrix

| Capability | Survivor | Other copies |
|---|---|---|
| Secret detection | `secret-redaction` `SECRET_SHAPES` | `code-shield/src/rules/secretRules.ts` (6 rules, own regexes); agent-runtime `governance-audit/matchers.ts` `SECRET_PATTERNS`; W `securityEvent.ts` `SECRET_ASSIGNMENT`/`SECRET_KEY`; VS Code `modelFallbackDetail.ts` |
| Redaction | `secret-redaction` (`redactDeep`, `redactThenCap`) | W `scrubCredentials` and `redactEvidence` (W is published separately: keep, with a parity test); VS Code `redactFallbackText`; agent-runtime `config/redact-snapshot.ts` and `logging/redact-identifier.ts` (UNVERIFIED overlap) |
| Dangerous commands | none; build one ruleset | run-delta `rmRf`; `dangerous-tools.ts`; `node-command-policy.ts`; `exec-approvals-analysis.ts`; `agent-tools/src/policyGateCallKey.ts` (UNVERIFIED); W `agent.tool_not_allowed` |
| Code-vulnerability rules | `code-shield` SAST and behaviour | run-delta `tlsVerifyDisabled`, `weakCrypto`, `corsPermissive`, `cspPermissive`, `cookieInsecure` (parallel regexes, different severity) |
| Severity | `sarif` `FindingSeverity` (CRITICAL..LOW) with one mapper | Shield and incidents lower-case; `SecurityAuditService` 5-level (adds `info`); agent-runtime info/warn/critical; run-delta and knowledge error/warn; `packageReview` pass/warn/fail; `auditDeepPass` `FINDING_SEVERITIES`; two action scales (allow..block, allow..quarantine) |
| Finding and incident shape | `sarif` `NormalizedFinding`, `security_incidents` | `SecurityAuditFinding`, `SkillScanFinding`, W `SecurityEvent`, `CodeScanVerdict`, run-delta findings, `packageReview` verdicts |
| Reason codes | W `ShieldReasonCode` / `SHIELD_RULES` | api `runtimeShieldEvent.ts` `SHIELD_REASON_CODES` and `SHIELD_REASON_POLICY` (hand mirror); code-shield rule ids in mixed styles |
| Egress | signed per-app policy (`workerEgressPolicy`) plus `previewCsp` | `sandbox/egressAllowlist.ts`; `host-egress.ts`; W `previewEgress.ts`; frontend and Control UI CSP |
| Policy config | none | signed egress JSON; `gateway.nodes.allowCommands`/`denyCommands`; `exec-approvals.json`; `governance_policy_packs`; `logging.redactPatterns`; W `SHIELD_RULES` |
| Prompt-injection patterns | none; build one package | `external-content.ts`; `instruction-firewall.ts`; M `cognition/sanitize.ts` |
| Dependency vulnerabilities | OSV (`osvScaScan.ts`) → `vulnerability_findings` | code-shield manifest heuristics (keep: a different signal); run-delta `installScriptAdded`; `advisoryFeed`; `githubAlerts` |

### 8.4 Target design and order

1. **One secret detector.** code-shield `secretRules` becomes a view derived from `SECRET_SHAPES`. Delete `governance-audit/matchers.ts` `SECRET_PATTERNS`. Move VS Code `modelFallbackDetail.ts` onto the shared redactor. Add a parity test between W `scrubCredentials` and `secret-redaction`.
2. **One severity mapper** in `sarif`, covering every scale in §8.3; consumers map at their edge.
3. **Shield reason codes from one source.** Generate the API's `SHIELD_REASON_CODES`, and the default for `SHIELD_REASON_POLICY`, from W `SHIELD_RULES`. The API keeps its own trusted severity, but a test fails on drift.
4. **Server-side value redaction on Shield evidence.**
5. **run-delta security rules call code-shield** (one rule set; run-delta keeps its error/warn mapping through the mapper).
6. **One dangerous-command ruleset** in `agent-tools`, used by exec approvals, run-delta `rmRf` and the command gate. This joins `SHELL-G009`.
7. **One prompt-injection package**, consumed by agent-runtime and memory recall.
8. **Egress registry.** One documented list and format; sandbox enforcement on by default.
9. **Memory.** Redact before facts are stored. **I.** Decide the inference host's policy; under the IDE rebuild it inherits the VS Code extension's.
10. **Rule-ID naming.** Namespace every code-shield id and remove the duplicate `obfuscated-code`.

### 8.5 Gaps

| ID | Gap | Where |
|---|---|---|
| SECP-G001 | Secret regexes outside `secret-redaction` | `code-shield/src/rules/secretRules.ts`, `agent-runtime/src/agents/tools/governance-audit/matchers.ts`, W `securityEvent.ts`, VS Code `modelFallbackDetail.ts` |
| SECP-G002 | About 8 severity scales; no shared mapper | `sarif`, `SecurityAuditService.ts`, `auditDeepPass.ts`, `skill-scanner.ts`, `agent-runtime/src/security/audit.ts`, `packageReview.ts`, run-delta, Shield |
| SECP-G003 | Shield reason codes mirrored by hand | `api/src/application/security/runtimeShieldEvent.ts`, W `shieldRules.ts` |
| SECP-G004 | Memory has no secret redaction before storage (details in the local security findings file) | M `packages/memory/src/storage/*` (UNVERIFIED) |
| SECP-G005 | No single dangerous-command ruleset | `exec-approvals-analysis.ts`, run-delta `rmRf.ts`, `agent-tools/src/policyGateCallKey.ts`, `dangerous-tools.ts`, `node-command-policy.ts` |
| SECP-G006 | run-delta security rules re-implement code-shield SAST | `run-delta/src/rules/{tlsVerifyDisabled, weakCrypto, corsPermissive, cspPermissive, cookieInsecure}.ts` |
| SECP-G007 | Three prompt-injection pattern sets | `agent-runtime/src/security/{external-content, instruction-firewall}.ts`, M `cognition/sanitize.ts` |
| SECP-G008 | W scrubber parity test; VS Code fallback redactor | W `securityEvent.ts`, VS Code `models/modelFallbackDetail.ts` |
| SECP-G009 | Egress has no single registry; six mechanisms | §8.2 egress row |
| SECP-G010 | The inference host (I) has no scanner or egress policy | `I/crates/*` |
| SECP-G011 | Shield evidence values are not redacted server-side (details in the local security findings file) | `runtimeShieldEvent.ts` |
| SECP-G012 | code-shield rule ids are inconsistent; `obfuscated-code` is duplicated | `packages/code-shield/src/rules/*` |
| SECP-G013–G015 | Security-sensitive defaults and coverage gaps; details in the local security findings file | — |
