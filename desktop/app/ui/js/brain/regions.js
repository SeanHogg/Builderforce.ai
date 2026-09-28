// The brain's regions: which hemisphere each sits in, where it is drawn and its hue —
// the ONE layout the sidebar brain, the knowledge map and its legend all read, so they
// never disagree. What each region HOLDS comes from the brain view (`brainView.js`),
// whichever Evermind is shown.
//
// Left hemisphere — what Evermind KNOWS: the model's weights (neocortex), the facts every
// AI tool shares (semantic memory), and what the tools are asking right now (thalamus,
// attention). Right hemisphere — what it DOES: the episodes it saw (hippocampus), the
// skills it compiled and ran (basal ganglia), what it stopped to ask about (amygdala),
// and what starts it by itself (hypothalamus). Names and hues match the web Evermind
// brain wherever the region is the same one.

const FRESH_MS = 10 * 60_000;

export const REGIONS = [
  { key: "neocortex", hemi: "left", x: 74, y: 62, size: 21, hue: "--ev-neocortex" },
  { key: "semantic", hemi: "left", x: 52, y: 128, size: 18, hue: "--ev-semantic" },
  { key: "thalamus", hemi: "left", x: 101, y: 104, size: 12, hue: "--ev-thalamus" },
  { key: "basalGanglia", hemi: "right", x: 150, y: 72, size: 18, hue: "--ev-basal" },
  { key: "hippocampus", hemi: "right", x: 184, y: 120, size: 18, hue: "--ev-hippocampus" },
  { key: "hypothalamus", hemi: "right", x: 137, y: 146, size: 12, hue: "--ev-hypothalamus" },
  { key: "amygdala", hemi: "right", x: 168, y: 160, size: 12, hue: "--ev-amygdala" },
];

export const regionByKey = Object.fromEntries(REGIONS.map((r) => [r.key, r]));

const EMPTY = { count: 0, nodes: [], active: false };

/** Each region with what it holds in the shown Evermind, and the live flags the map animates. */
export function regionStates(s) {
  return REGIONS.map((meta) => {
    const r = s.view?.regions?.[meta.key] ?? EMPTY;
    return {
      meta,
      count: r.count,
      nodes: r.nodes,
      charge: r.charge,
      fresh: r.nodes.some((n) => n.at && s.now - n.at < FRESH_MS),
      active: !!r.active,
    };
  });
}

/** What a hemisphere holds: the sum of its regions. */
export function hemisphereTotal(states, hemi) {
  return states.filter((r) => r.meta.hemi === hemi).reduce((n, r) => n + r.count, 0);
}

export const isFresh = (s, n) => !!n.at && s.now - n.at < FRESH_MS;
