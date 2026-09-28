// What the brain shows, in ONE shape whichever Evermind it is — this machine's private
// one, or a workspace model on builderforce.ai — so the drawing, the legend, the tiles
// and the charts never branch on where the numbers came from.
//
//   { kind, rolePrefix, name, learned, pending, adaptations, days, recent,
//     regions: { [key]: { count, nodes, active, charge? } } }
//
// Semantic memory (the facts every AI tool here shares) and the thalamus (what those
// tools ask the code index) are this machine's whichever model is shown. A workspace
// model's own regions come from the web Knowledge Map's derivation (`cloudBrain`, from
// the console bundle), so the desktop lights what the web lights.

const events = (x, region) => (x?.recent ?? []).filter((e) => e.region === region);
const eventNode = (e) => ({ id: `${e.kind}:${e.id}:${e.at}`, title: e.name, kind: e.kind, at: e.at, detail: e.detail });

function machineRegions(s) {
  return {
    semantic: {
      count: s.facts.count,
      nodes: s.facts.top.map((f) => ({ id: `fact:${f.key}`, title: f.key, kind: "fact", weight: f.importance })),
      active: false,
    },
    thalamus: {
      count: s.activity.length,
      nodes: s.activity.map((a) => ({ id: `ask:${a.at}:${a.op}`, title: a.detail || a.op, kind: "ask", at: a.at })),
      active: s.activity.some((a) => s.now - a.at < 15_000),
    },
  };
}

/** This machine's Evermind: the store's experience overview, the agents' live state. */
export function localView(s) {
  const x = s.experience;
  const reg = (key, active) => ({ count: x?.regions?.[key] ?? 0, nodes: events(x, key).map(eventNode), active: !!active });
  return {
    kind: "local",
    rolePrefix: "brain.role",
    name: x?.modelVersion ?? null,
    learned: x ? x.learned : null,
    pending: x ? x.pending : null,
    adaptations: (x?.adaptations ?? []).map((a) => ({ version: a.version, loss: a.loss, count: a.learned?.length ?? 0 })),
    days: x?.days ?? [],
    recent: x?.recent ?? [],
    regions: {
      ...machineRegions(s),
      neocortex: reg("neocortex", s.training),
      basalGanglia: reg("basalGanglia", s.run),
      hippocampus: reg("hippocampus", s.recording),
      hypothalamus: { ...reg("hypothalamus", s.run?.trigger === "routine"), nodes: [] },
      amygdala: reg("amygdala", s.run?.pendingApproval != null),
    },
  };
}

const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, "0");
const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Contributions learned per local day, over the last `n` days (oldest first). */
function learnedDays(recent, now, n = 30) {
  const counts = new Map();
  for (const e of recent) counts.set(dayOf(e.at), (counts.get(dayOf(e.at)) ?? 0) + 1);
  return Array.from({ length: n }, (_, i) => {
    const day = dayOf(now - (n - 1 - i) * DAY_MS);
    return { day, demonstrations: 0, skills: 0, runs: 0, learned: counts.get(day) ?? 0 };
  });
}

/** What one learned contribution reads as: its task, else what it learned. */
const snippet = (e) => (e.prompt || e.text || "").split("\n")[0].trim().slice(0, 140);

/** A workspace model: its contributions payload, drawn with the web's region derivation. */
export function cloudView(s, build, data, cloudBrain) {
  const b = cloudBrain(data);
  const node = (e) => ({ id: `c:${e.id}`, title: snippet(e) || `v${e.version}`, kind: "contribution", at: e.at, detail: e.distilled ? e.teacherModel : null });
  const limbic = (key) => ({ count: 0, nodes: [], active: !!b.signals[key]?.active, charge: b.signals[key]?.charge });
  const recent = data?.recent ?? [];
  return {
    kind: "cloud",
    rolePrefix: "brain.roleCloud",
    name: build ? (data?.seeded ? `${build.name} · v${data.version}` : build.name) : null,
    learned: data ? data.contributions : null,
    pending: data ? data.pending : null,
    // Newest first on the wire; a merge of pure weight deltas measured no loss (0).
    adaptations: [...(data?.training ?? [])].reverse().filter((p) => p.loss > 0).map((p) => ({ version: `v${p.version}`, loss: p.loss, count: p.merged })),
    days: learnedDays(recent, s.now),
    recent: recent.map((e) => ({ kind: "contribution", id: e.id, name: snippet(e) || `v${e.version}`, detail: e.distilled ? e.teacherModel : null, at: e.at, region: e.fitted !== false ? "neocortex" : "hippocampus" })),
    regions: {
      ...machineRegions(s),
      neocortex: { count: data?.contributions ?? 0, nodes: b.neocortex.map(node), active: !!b.signals.neocortex?.active },
      hippocampus: { count: b.hippocampus.length, nodes: b.hippocampus.map(node), active: !!b.signals.hippocampus?.active },
      basalGanglia: limbic("basalGanglia"),
      hypothalamus: limbic("hypothalamus"),
      amygdala: limbic("amygdala"),
    },
  };
}
