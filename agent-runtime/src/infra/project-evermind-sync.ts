/**
 * project-evermind-sync — the on-prem/IDE half of concurrent project learning
 * ([[evermind-learning-architecture]]).
 *
 * An agent runs a LOCAL replica of the project's Evermind and, after a run,
 * contributes what it learned back to the single writer (the coordinator DO on
 * the gateway) as a WEIGHT DELTA:
 *   1. pull the current head (version + mode) from the gateway,
 *   2. download that version's `.evermind` base + tokenizer (the replica),
 *   3. adapt the base on the run's text with the engine trainer (a few steps),
 *   4. diff adapted-vs-base (row-sparse, kilobytes) and POST it to `/learn`.
 *
 * The coordinator FedAvg-merges concurrent deltas and republishes the next
 * version; this replica picks it up on its next run (pull-on-boundary). All of it
 * is best-effort and OFF unless fully configured (gateway url + key + host id +
 * project id) — a mis/under-configured runtime is a silent no-op, never a crash.
 */
import {
  EvermindModelPackage,
  EvermindLMTrainer,
  BPETokenizer,
  diffCheckpoints,
  deserializeRowDelta,
} from "@seanhogg/builderforce-memory-engine";
import { logDebug } from "../logger.js";

export interface ProjectEvermindSyncConfig {
  gatewayUrl: string;
  apiKey: string;
  agentHostId: number;
  projectId: number;
  /** Max characters of run text fed to a single adaptation pass. Default 4000. */
  maxChars?: number;
  /** Token window length for the training sequences. Default 64. */
  windowTokens?: number;
}

export interface ContributeResult {
  ok: boolean;
  /** Why nothing was pushed (skipped), when applicable. */
  reason?: string;
  /** The new head version, when the coordinator accepted + merged. */
  version?: number;
}

/** Resolve sync config from env; null unless every required value is present. */
export function projectEvermindSyncFromEnv(env: NodeJS.ProcessEnv = process.env): ProjectEvermindSyncConfig | null {
  const gatewayUrl = env["BUILDERFORCE_GATEWAY_URL"]?.trim();
  const apiKey = env["BUILDERFORCE_API_KEY"]?.trim();
  const agentHostId = Number(env["BUILDERFORCE_AGENT_HOST_ID"]);
  const projectId = Number(env["BUILDERFORCE_PROJECT_ID"]);
  if (!gatewayUrl || !apiKey || !Number.isInteger(agentHostId) || agentHostId <= 0 || !Number.isInteger(projectId) || projectId <= 0) {
    return null;
  }
  return { gatewayUrl: gatewayUrl.replace(/\/+$/, ""), apiKey, agentHostId, projectId };
}

function authHeaders(cfg: ProjectEvermindSyncConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.apiKey}`, "X-AgentHost-Id": String(cfg.agentHostId) };
}

function base(cfg: ProjectEvermindSyncConfig): string {
  return `${cfg.gatewayUrl}/api/agent/projects/${cfg.projectId}/evermind`;
}

interface Head {
  version: number;
  mode: "connected" | "offline-frozen";
  seeded: boolean;
}

/** Fetch the project's current head (version + mode). */
export async function fetchProjectEvermindHead(cfg: ProjectEvermindSyncConfig): Promise<Head | null> {
  try {
    const res = await fetch(`${base(cfg)}/head`, { headers: authHeaders(cfg) });
    if (!res.ok) return null;
    const j = (await res.json()) as Head;
    return { version: Number(j.version) || 0, mode: j.mode === "offline-frozen" ? "offline-frozen" : "connected", seeded: !!j.seeded };
  } catch (err) {
    logDebug(`[project-evermind] head fetch failed: ${String(err)}`);
    return null;
  }
}

/** Chunk a token id list into fixed-length training windows (min length 2). */
function windows(ids: number[], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 1 < ids.length; i += size) {
    const seq = ids.slice(i, i + size);
    if (seq.length >= 2) out.push(seq);
  }
  return out;
}

/**
 * Adapt the project's base model on `text` and push the resulting weight delta.
 * Skips (never throws) when: not seeded, frozen, the base isn't an EvermindLM,
 * the text is too short to train on, or the adaptation produced no weight change.
 */
export async function contributeProjectEvermindFromText(
  cfg: ProjectEvermindSyncConfig,
  text: string,
): Promise<ContributeResult> {
  const trimmed = (text ?? "").trim();
  if (trimmed.length < 20) return { ok: false, reason: "text too short" };

  const head = await fetchProjectEvermindHead(cfg);
  if (!head) return { ok: false, reason: "head unavailable" };
  if (!head.seeded || head.version <= 0) return { ok: false, reason: "not seeded" };
  if (head.mode === "offline-frozen") return { ok: false, reason: "offline-frozen" };

  try {
    const [modelRes, tokRes] = await Promise.all([
      fetch(`${base(cfg)}/model?version=${head.version}`, { headers: authHeaders(cfg) }),
      fetch(`${base(cfg)}/tokenizer?version=${head.version}`, { headers: authHeaders(cfg) }),
    ]);
    if (!modelRes.ok || !tokRes.ok) return { ok: false, reason: "replica download failed" };

    const pkg = EvermindModelPackage.fromBlob(await modelRes.arrayBuffer());
    if (pkg.manifest.modelType !== "evermind-lm") return { ok: false, reason: "base is not an evermind-lm" };
    const baseCheckpoint = pkg.checkpoint;
    const lm = pkg.loadLM();

    const tokDesc = (await tokRes.json()) as { vocab: Record<string, number>; merges: string[] };
    const tok = new BPETokenizer();
    tok.loadFromObjects(tokDesc.vocab, tokDesc.merges);

    const ids = tok.encode(trimmed.slice(0, cfg.maxChars ?? 4000));
    const seqs = windows(ids, cfg.windowTokens ?? 64);
    if (seqs.length === 0) return { ok: false, reason: "no trainable sequences" };

    // One-epoch online adaptation on the run text — the local learning step whose
    // delta we contribute. Bounded (few short windows) so it stays cheap per run.
    new EvermindLMTrainer(lm, { epochs: 1 }).fit(seqs);

    const adapted = lm.exportWeights();
    const diff = diffCheckpoints(baseCheckpoint, adapted);
    if (deserializeRowDelta(diff).rows.length === 0) return { ok: false, reason: "no weight change" };

    const diffB64 = Buffer.from(new Uint8Array(diff)).toString("base64");
    const res = await fetch(`${base(cfg)}/learn`, {
      method: "POST",
      headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ diff: diffB64, baseVersion: head.version, weight: ids.length }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, reason: typeof body["error"] === "string" ? (body["error"] as string) : `learn ${res.status}` };
    return { ok: true, version: head.version };
  } catch (err) {
    logDebug(`[project-evermind] contribution failed: ${String(err)}`);
    return { ok: false, reason: String(err) };
  }
}
