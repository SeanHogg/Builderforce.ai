// The brain's regions: which hemisphere each sits in, where it is drawn, its hue, and
// how many things it holds and which ones — the ONE taxonomy the sidebar brain, the
// knowledge map and its legend all read, so they never disagree.
//
// Left hemisphere — what Evermind KNOWS: the private model's weights (neocortex), the
// facts every AI tool shares (semantic memory), and what the tools are asking right now
// (thalamus, attention). Right hemisphere — what it DOES: the demonstrations it saw
// (hippocampus), the skills it compiled and ran (basal ganglia), the irreversible steps
// it asked about (amygdala), and the routines that start it by itself (hypothalamus).
// Names and hues match the web Evermind brain wherever the region is the same one.
//
// Every count and node comes from the store's own data (`brainStore`); nothing is made up.

const FRESH_MS = 10 * 60_000;

const events = (s, region) => (s.experience?.recent ?? []).filter((e) => e.region === region);
const eventNode = (e) => ({ id: `${e.kind}:${e.id}:${e.at}`, title: e.name, kind: e.kind, at: e.at, detail: e.detail });

export const REGIONS = [
  {
    key: "neocortex",
    hemi: "left",
    x: 74,
    y: 62,
    size: 21,
    hue: "--ev-neocortex",
    count: (s) => s.experience?.regions.neocortex ?? 0,
    nodes: (s) => events(s, "neocortex").map(eventNode),
    active: (s) => s.training,
  },
  {
    key: "semantic",
    hemi: "left",
    x: 52,
    y: 128,
    size: 18,
    hue: "--ev-semantic",
    count: (s) => s.facts.count,
    nodes: (s) => s.facts.top.map((f) => ({ id: `fact:${f.key}`, title: f.key, kind: "fact", weight: f.importance })),
    active: () => false,
  },
  {
    key: "thalamus",
    hemi: "left",
    x: 101,
    y: 104,
    size: 12,
    hue: "--ev-thalamus",
    count: (s) => s.activity.length,
    nodes: (s) => s.activity.map((a) => ({ id: `ask:${a.at}:${a.op}`, title: a.detail || a.op, kind: "ask", at: a.at })),
    active: (s) => s.activity.some((a) => s.now - a.at < 15_000),
  },
  {
    key: "basalGanglia",
    hemi: "right",
    x: 150,
    y: 72,
    size: 18,
    hue: "--ev-basal",
    count: (s) => s.experience?.regions.basalGanglia ?? 0,
    nodes: (s) => events(s, "basalGanglia").map(eventNode),
    active: (s) => !!s.run,
  },
  {
    key: "hippocampus",
    hemi: "right",
    x: 184,
    y: 120,
    size: 18,
    hue: "--ev-hippocampus",
    count: (s) => s.experience?.regions.hippocampus ?? 0,
    nodes: (s) => events(s, "hippocampus").map(eventNode),
    active: (s) => !!s.recording,
  },
  {
    key: "hypothalamus",
    hemi: "right",
    x: 137,
    y: 146,
    size: 12,
    hue: "--ev-hypothalamus",
    count: (s) => s.experience?.regions.hypothalamus ?? 0,
    nodes: () => [],
    active: (s) => s.run?.trigger === "routine",
  },
  {
    key: "amygdala",
    hemi: "right",
    x: 168,
    y: 160,
    size: 12,
    hue: "--ev-amygdala",
    count: (s) => s.experience?.regions.amygdala ?? 0,
    nodes: (s) => events(s, "amygdala").map(eventNode),
    active: (s) => s.run?.pendingApproval != null,
  },
];

export const regionByKey = Object.fromEntries(REGIONS.map((r) => [r.key, r]));

/** Where each region's knowledge is drawn from, with the live flags the map animates. */
export function regionStates(s) {
  return REGIONS.map((meta) => {
    const nodes = meta.nodes(s);
    return {
      meta,
      count: meta.count(s),
      nodes,
      fresh: nodes.some((n) => n.at && s.now - n.at < FRESH_MS),
      active: !!meta.active(s),
    };
  });
}

/** What a hemisphere holds: the sum of its regions. */
export function hemisphereTotal(states, hemi) {
  return states.filter((r) => r.meta.hemi === hemi).reduce((n, r) => n + r.count, 0);
}

export const isFresh = (s, n) => !!n.at && s.now - n.at < FRESH_MS;
