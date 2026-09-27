// The brain, drawn: two hemispheres with Evermind at the fissure between them, each
// region a node that grows with what it holds, ringed by the things it learned (fresh
// ones pulse), wired to the core by an edge that flows while that region is learning.
// One component, two sizes — the sidebar's glanceable brain and the Evermind page's
// knowledge map — so they can never show different brains.
import { t } from "../i18n.js";
import { hemisphereTotal, isFresh, regionStates } from "./regions.js";

const NS = "http://www.w3.org/2000/svg";
const VB_W = 240;
const VB_H = 200;
const CORE = { x: 120, y: 102, r: 11 };
const GOLDEN = 2.399963;
const LEFT_HEMI = "M117,14 C80,5 31,22 22,68 C13,112 27,160 62,182 C84,195 108,192 117,186 Z";
const RIGHT_HEMI = "M123,14 C160,5 209,22 218,68 C227,112 213,160 178,182 C156,195 132,192 123,186 Z";
// Folds of the cortex — decoration only, drawn faintly so the regions read first.
const GYRI = [
  "M40,52 C56,40 76,48 96,38", "M30,86 C48,76 66,90 88,80", "M34,122 C52,112 62,130 86,124",
  "M50,158 C66,150 82,164 102,154", "M104,60 C98,74 110,86 104,98",
  "M144,38 C164,48 184,40 200,52", "M152,80 C174,90 192,76 210,86", "M154,124 C178,130 188,112 206,122",
  "M138,154 C158,164 174,150 190,158", "M136,60 C142,74 130,86 136,98",
];

const el = (tag, attrs = {}, ...children) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  for (const c of children) if (c) n.append(c);
  return n;
};
const title = (text) => {
  const n = el("title");
  n.textContent = text;
  return n;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 0..1: how full a region looks — logarithmic, so a hundred facts and three skills both read. */
const charge = (count) => (count > 0 ? clamp(0.35 + Math.log10(count + 1) / 2.5, 0, 1) : 0.12);

function nodeLayout(region, r, nodes, max) {
  const away = Math.atan2(region.y - CORE.y, region.x - CORE.x);
  return nodes.slice(0, max).map((n, i) => {
    const angle = away + (i % 2 === 0 ? 1 : -1) * ((((i + 1) * GOLDEN) / 2) % 2.2);
    const ring = r + 7 + (i % 3) * 5;
    return { n, x: clamp(region.x + Math.cos(angle) * ring, 6, VB_W - 6), y: clamp(region.y + Math.sin(angle) * ring, 6, VB_H - 6) };
  });
}

function regionGlyph(rs, s, mode, selected, dimmed, onSelect) {
  const { meta, count } = rs;
  const hue = `var(${meta.hue})`;
  const c = charge(count);
  const r = meta.size * 0.55 + c * meta.size * 0.45;
  const label = t(`brain.region.${meta.key}`);
  const full = mode === "full";
  const g = el("g", { class: `br-region${rs.active ? " br-active" : ""}${dimmed ? " br-dim" : ""}` });

  const max = full ? 12 : 6;
  for (const { n, x, y } of nodeLayout(meta, r, rs.nodes, max)) {
    g.append(
      el("line", { x1: meta.x, y1: meta.y, x2: x, y2: y, stroke: hue, "stroke-width": 0.5, "stroke-opacity": 0.35 }),
      el(
        "circle",
        { cx: x, cy: y, r: full ? 2.4 + (n.weight ?? 0) * 1.2 : 1.8, fill: hue, "fill-opacity": 0.75, class: isFresh(s, n) ? "br-fresh" : null },
        full ? title(n.title) : null,
      ),
    );
  }
  if (selected) g.append(el("circle", { cx: meta.x, cy: meta.y, r: r + 5, fill: "none", stroke: hue, "stroke-width": 1.2, "stroke-dasharray": "2 2" }));
  g.append(
    el("circle", { class: "br-halo", cx: meta.x, cy: meta.y, r: r + 3.5, fill: hue, "fill-opacity": 0.12 }),
    el("circle", { cx: meta.x, cy: meta.y, r, fill: hue, "fill-opacity": 0.18 + c * 0.3, stroke: hue, "stroke-width": selected ? 2.2 : 1.4 }),
  );
  if (full) {
    const text = el("text", { x: meta.x, y: meta.y + r + 8.5, "text-anchor": "middle", class: "br-label" });
    text.textContent = label;
    g.append(text);
    if (count > 0) {
      const badge = el("text", { x: meta.x, y: meta.y + 2.6, "text-anchor": "middle", class: "br-count" });
      badge.textContent = count > 999 ? `${Math.round(count / 100) / 10}k` : String(count);
      g.append(badge);
    }
    g.setAttribute("role", "button");
    g.setAttribute("tabindex", "0");
    g.setAttribute("aria-pressed", String(selected));
    g.setAttribute("aria-label", t("brain.regionAria", { region: label, n: count }));
    g.addEventListener("click", () => onSelect?.(meta.key));
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        onSelect?.(meta.key);
      }
    });
  }
  g.append(title(`${label} — ${t(`brain.role.${meta.key}`)}`));
  return g;
}

/**
 * A brain for `mode` ("mini" in the sidebar, "full" on the Evermind page). Returns the
 * element and `update(state, selected)`; it repaints only when what it shows changed,
 * so pulsing nodes are not restarted on every poll.
 */
export function createBrain(mode, onSelect) {
  const svg = el("svg", { viewBox: `0 0 ${VB_W} ${VB_H}`, class: `brain brain-${mode}`, role: "img", preserveAspectRatio: "xMidYMid meet" });
  let signature = "";

  function update(s, selected = null) {
    const states = regionStates(s);
    const sig = JSON.stringify([selected, states.map((r) => [r.count, r.active, r.fresh, r.nodes.map((n) => n.id)])]);
    if (sig === signature) return;
    signature = sig;

    const knows = hemisphereTotal(states, "left");
    const does = hemisphereTotal(states, "right");
    svg.setAttribute("aria-label", t("brain.aria", { knows, does }));
    const learning = states.some((r) => r.active);
    const kids = [
      el("path", { d: LEFT_HEMI, class: "br-hemi br-left" }),
      el("path", { d: RIGHT_HEMI, class: "br-hemi br-right" }),
      ...GYRI.map((d) => el("path", { d, class: "br-gyrus" })),
      el("line", { x1: 120, y1: 16, x2: 120, y2: 186, class: "br-fissure" }),
    ];
    // Core → region edges; flowing while that region learns.
    for (const rs of states) {
      kids.push(el("line", {
        x1: CORE.x, y1: CORE.y, x2: rs.meta.x, y2: rs.meta.y,
        stroke: `var(${rs.meta.hue})`, "stroke-width": 0.9 + charge(rs.count) * 1.1,
        "stroke-opacity": rs.count > 0 || rs.active ? 0.5 : 0.18, "stroke-linecap": "round",
        class: rs.active ? "br-edge br-live" : "br-edge",
      }));
    }
    for (const rs of states) {
      kids.push(regionGlyph(rs, s, mode, selected === rs.meta.key, selected != null && selected !== rs.meta.key, onSelect));
    }
    kids.push(
      el("circle", { cx: CORE.x, cy: CORE.y, r: CORE.r + 5, class: `br-core-halo${learning ? " br-live" : ""}` }),
      el("circle", { cx: CORE.x, cy: CORE.y, r: CORE.r, class: "br-core" }, title(t("brain.core"))),
    );
    if (mode === "full") {
      const core = el("text", { x: CORE.x, y: CORE.y + 2.4, "text-anchor": "middle", class: "br-core-label" });
      core.textContent = "Evermind";
      kids.push(core);
    }
    svg.replaceChildren(...kids);
  }

  return { el: svg, update };
}
