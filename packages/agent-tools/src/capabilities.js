/**
 * Runtime capabilities — the contract between a surface (where an agent runs) and
 * the tools it can offer.
 *
 * A {@link ToolDefinition} declares which capabilities it `requires`; a surface
 * (cloud Worker, cloud Container, on-prem Node) supplies a {@link CapabilityProvider}
 * that advertises which capabilities it can actually back. The {@link ToolRegistry}
 * offers a tool to a surface ONLY when that surface advertises every capability the
 * tool needs — so a tool set is never hand-maintained per surface, and surfaces
 * differ only by *what they can physically do*, never by a curated allow-list.
 *
 * **Capability gating vs. authorization policy are ORTHOGONAL LAYERS (not competing
 * models).** A `Capability` answers "can this SURFACE physically perform this op" (no
 * shell in a Worker → no `shell` cap). It is NOT an authorization decision. On-prem
 * additionally runs an authorization PIPELINE (owner-only / subagent-depth / group /
 * profile allow-lists) that answers "is THIS caller allowed to use this tool here."
 * The convergence (PRD 12) keeps BOTH as layers: a tool gains `requires: Capability[]`
 * for physical backing, while the surface keeps applying its policy pipeline as a
 * decorator on top. They never merge — capability is about the machine, policy is
 * about the caller — so adopting the shared contract on-prem loses no authorization.
 *
 * This module is deliberately runtime-agnostic: no `node:*`, no Cloudflare `Env`,
 * no `pi-agent-core`. It is imported verbatim by both the Cloudflare Worker `api`
 * package and the Node `agent-runtime` package, so it must type-check and bundle
 * under both `moduleResolution: bundler` and `NodeNext`.
 */
export {};
//# sourceMappingURL=capabilities.js.map