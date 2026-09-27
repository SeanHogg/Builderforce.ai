// The pieces the workspace list and the workspace detail both show — one definition of
// what "scanning 40 of 120" or "embedded 62%" means.
import { h } from "./bridge.js";
import { num, relTime, t } from "./i18n.js";

export function embeddedPct(ws) {
  return ws.chunks ? Math.round((100 * ws.embedded) / ws.chunks) : 0;
}

export function progress(ws) {
  if (ws.phase.state === "scanning") return ws.phase.total ? Math.round((100 * ws.phase.done) / ws.phase.total) : 0;
  if (ws.phase.state === "embedding") return embeddedPct(ws);
  return 100;
}

export function phasePill(ws) {
  const { state } = ws.phase;
  const text =
    state === "scanning"
      ? t("phase.scanning", { done: num(ws.phase.done), total: num(ws.phase.total) })
      : state === "embedding"
        ? t("phase.embedding", { pct: embeddedPct(ws) })
        : t("phase.ready");
  return h("span", { class: `pill ${state === "ready" ? "ok" : "busy"}`, text });
}

export function meter(ws) {
  const pct = progress(ws);
  return h(
    "div",
    { class: `meter ${ws.phase.state === "ready" ? "done" : ""}`, attrs: { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) } },
    h("span", { style: `width:${pct}%` }),
  );
}

export function statTiles(ws) {
  const tile = (label, value, sub) =>
    h("div", { class: "tile" }, h("span", { class: "tile-label", text: label }), h("strong", { text: value }), sub && h("span", { class: "tile-sub", text: sub }));
  return h(
    "div",
    { class: "tiles" },
    tile(t("stat.files"), num(ws.files)),
    tile(t("stat.symbols"), num(ws.symbols)),
    tile(t("stat.chunks"), num(ws.chunks)),
    tile(t("stat.embedded"), `${embeddedPct(ws)}%`, ws.embeddingsEnabled ? num(ws.embedded) : t("stat.keywordOnly")),
  );
}

export function lastIndexed(ws) {
  return ws.lastIndexedAt ? t("workspace.lastIndexed", { when: relTime(ws.lastIndexedAt * 1000) }) : t("workspace.neverIndexed");
}
