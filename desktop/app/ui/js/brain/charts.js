// The two learning charts: how each adaptation's loss went, and what happened each day.
// Plain SVG, themed through the region hues, labelled in the page's language; each mark
// carries a tooltip with its numbers, so no value is colour-only.
import { num, t } from "../i18n.js";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, tip) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (tip) {
    const title = document.createElementNS(NS, "title");
    title.textContent = tip;
    n.append(title);
  }
  return n;
};

/** Loss per adaptation, oldest first — falling is learning. Null when there is none yet. */
export function lossChart(adaptations) {
  const points = adaptations.filter((a) => Number.isFinite(a.loss));
  if (points.length === 0) return null;
  const W = 300;
  const H = 90;
  const pad = 8;
  const max = Math.max(...points.map((p) => p.loss));
  const min = Math.min(...points.map((p) => p.loss));
  const span = max - min || 1;
  const x = (i) => (points.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (points.length - 1));
  const y = (v) => pad + ((max - v) / span) * (H - pad * 2);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart chart-loss", role: "img", "aria-label": t("brain.lossAria", { n: points.length }) });
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.loss).toFixed(1)}`).join(" ");
  svg.append(
    el("polyline", { points: `${pad},${H - pad} ${line} ${W - pad},${H - pad}`, class: "chart-area" }),
    el("polyline", { points: line, class: "chart-line" }),
  );
  points.forEach((p, i) => {
    svg.append(el("circle", { cx: x(i), cy: y(p.loss), r: i === points.length - 1 ? 3.4 : 2.2, class: "chart-dot" }, t("brain.lossTip", { version: p.version, loss: p.loss.toFixed(3), n: num(p.learned.length) })));
  });
  return svg;
}

const SERIES = [
  { key: "demonstrations", cls: "s-demo" },
  { key: "skills", cls: "s-skill" },
  { key: "runs", cls: "s-run" },
  { key: "learned", cls: "s-learned" },
];

/** One stacked bar per day: demonstrations, skills, runs and procedures learned. */
export function activityChart(days) {
  const W = 300;
  const H = 90;
  const gap = 2;
  const bw = Math.max(2, (W - gap * (days.length - 1)) / days.length);
  const total = (d) => SERIES.reduce((n, s) => n + d[s.key], 0);
  const max = Math.max(1, ...days.map(total));
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart chart-days", role: "img", "aria-label": t("brain.daysAria", { n: days.length }) });
  svg.append(el("line", { x1: 0, y1: H - 0.5, x2: W, y2: H - 0.5, class: "chart-axis" }));
  days.forEach((d, i) => {
    let top = H;
    const x = i * (bw + gap);
    const tip = t("brain.dayTip", { day: d.day, demos: d.demonstrations, skills: d.skills, runs: d.runs, learned: d.learned });
    for (const s of SERIES) {
      const v = d[s.key];
      if (!v) continue;
      const hgt = (v / max) * (H - 4);
      top -= hgt;
      svg.append(el("rect", { x, y: top, width: bw, height: hgt, rx: 1, class: `chart-bar ${s.cls}` }, tip));
    }
    if (total(d) === 0) svg.append(el("rect", { x, y: H - 2, width: bw, height: 2, class: "chart-bar s-none" }, tip));
  });
  return svg;
}

/** The legend for {@link activityChart}. */
export function activityLegend() {
  const wrap = document.createElement("div");
  wrap.className = "chart-legend";
  for (const s of SERIES) {
    const item = document.createElement("span");
    const sw = document.createElement("span");
    sw.className = `swatch ${s.cls}`;
    item.append(sw, document.createTextNode(t(`brain.series.${s.key}`)));
    wrap.append(item);
  }
  return wrap;
}
