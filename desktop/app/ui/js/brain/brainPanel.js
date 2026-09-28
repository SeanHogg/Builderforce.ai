// The top of the Evermind page — the brain at full size, as the web Evermind shows it:
// stat tiles (model, learned, queued, training loss), the knowledge map with its legend
// (click a region to filter), what it learned most recently, and the two learning charts.
// Self-contained: it reads the shared brain picture — this machine's Evermind or a
// workspace model, one view shape either way — and owns its selection. A workspace model's
// tiles are the console's own (it sits right below), so they are not repeated here.
import { h } from "../bridge.js";
import { num, relTime, t } from "../i18n.js";
import { createBrain } from "./brainSvg.js";
import { activityChart, activityLegend, lossChart } from "./charts.js";
import { REGIONS, regionStates } from "./regions.js";
import { subscribeBrain } from "./brainStore.js";

const tile = (label) => {
  const value = h("div", { class: "tile-value" });
  return { el: h("div", { class: "tile" }, h("div", { class: "tile-label", text: label }), value), value };
};

function legend(onSelect) {
  const rows = {};
  const tier = (hemi) =>
    h(
      "div",
      { class: "legend-tier" },
      h("div", { class: "legend-head", text: t(hemi === "left" ? "brain.knows" : "brain.does") }),
      ...REGIONS.filter((r) => r.hemi === hemi).map((r) => {
        const cap = h("span", { class: "legend-cap" });
        const btn = h(
          "button",
          { class: "legend-item", type: "button", on: { click: () => onSelect(r.key) } },
          h("span", { class: "swatch", attrs: { style: `background: var(${r.hue})` } }),
          h("span", { class: "legend-name", text: t(`brain.region.${r.key}`) }),
          cap,
        );
        rows[r.key] = { btn, cap };
        return btn;
      }),
    );
  return { el: h("div", { class: "legend" }, tier("left"), tier("right")), rows };
}

const EVENT_TEXT = {
  demonstration: (e) => t("brain.event.demonstration", { name: e.name }),
  skill: (e) => t("brain.event.skill", { name: e.name }),
  run: (e) => t(`brain.event.run.${e.detail}`, { name: e.name }),
  approval: (e) => t(`brain.event.approval.${e.detail}`, { name: e.name }),
  adaptation: (e) => t("brain.event.adaptation", { version: e.name, loss: e.detail }),
  contribution: (e) => (e.detail ? t("brain.event.contributionDistilled", { name: e.name, model: e.detail }) : t("brain.event.contribution", { name: e.name })),
  fact: (e) => t("brain.event.fact", { name: e.title }),
  ask: (e) => t("brain.event.ask", { name: e.title }),
};

/** What the recent list shows: experience events, or — for a region filter — that region's own items. */
function recentItems(s, selected) {
  if (!selected) return s.view?.recent ?? [];
  const rs = regionStates(s).find((r) => r.meta.key === selected);
  return (rs?.nodes ?? []).map((n) => ({ kind: n.kind, name: n.title, title: n.title, detail: n.detail, at: n.at, region: selected }));
}

export function brainPanel() {
  let selected = null;
  let last = null;
  const select = (key) => {
    selected = selected === key ? null : key;
    if (last) paint(last);
  };

  const model = tile(t("brain.statModel"));
  const learned = tile(t("brain.statLearned"));
  const queued = tile(t("brain.statQueued"));
  const loss = tile(t("brain.statLoss"));
  const brain = createBrain("full", select);
  const lg = legend(select);
  const mapState = h("span", { class: "pill" });
  const recentHead = h("span", { class: "muted small" });
  const recent = h("ul", { class: "recent" });
  const lossHost = h("div", { class: "chart-host" });
  const daysHost = h("div", { class: "chart-host" });
  const note = h("p", { class: "muted small", hidden: true });
  const lossBody = h("p", { class: "muted small" });

  const tiles = h("div", { class: "tiles" }, model.el, learned.el, queued.el, loss.el);
  const el = h(
    "div",
    { class: "stack brain-panel" },
    tiles,
    note,
    h(
      "div",
      { class: "brain-grid" },
      h("section", { class: "card stack" }, h("div", { class: "row between wrap" }, h("h2", { text: t("brain.mapTitle") }), mapState), h("div", { class: "brain-stage" }, brain.el), lg.el),
      h("section", { class: "card stack" }, h("div", { class: "row between wrap" }, h("h2", { text: t("brain.recentTitle") }), recentHead), recent),
    ),
    h(
      "div",
      { class: "brain-grid" },
      h("section", { class: "card stack" }, h("h2", { text: t("brain.lossTitle") }), lossBody, lossHost),
      h("section", { class: "card stack" }, h("h2", { text: t("brain.daysTitle") }), daysHost, activityLegend()),
    ),
  );

  function paint(s) {
    last = s;
    const v = s.view;
    const local = v.kind === "local";
    const adaptations = v.adaptations;
    const lastLoss = adaptations.length ? adaptations[adaptations.length - 1].loss : null;
    tiles.hidden = !local;
    model.value.textContent = v.name ?? t("brain.noModel");
    learned.value.textContent = v.learned != null ? num(v.learned) : "—";
    queued.value.textContent = v.pending != null ? num(v.pending) : "—";
    loss.value.textContent = lastLoss != null ? lastLoss.toFixed(3) : "—";
    const unavailable = local && s.experienceError;
    note.hidden = !unavailable;
    note.textContent = unavailable ? t("brain.experienceUnavailable") : "";

    const states = regionStates(s);
    const live = states.some((r) => r.active);
    mapState.textContent = live ? t("brain.stateLearning") : states.some((r) => r.count > 0) ? t("brain.stateResting") : t("brain.stateEmpty");
    mapState.className = `pill ${live ? "ok" : ""}`;
    brain.update(s, selected);
    for (const rs of states) {
      const row = lg.rows[rs.meta.key];
      row.cap.textContent = num(rs.count);
      row.btn.title = t(`${v.rolePrefix}.${rs.meta.key}`);
      row.btn.setAttribute("aria-pressed", String(selected === rs.meta.key));
      row.btn.classList.toggle("on", selected === rs.meta.key);
    }

    const items = recentItems(s, selected);
    recentHead.textContent = selected ? t(`brain.region.${selected}`) : items.length ? (local ? "" : t("brain.recentCloudTag")) : t("brain.recentEmptyTag");
    recent.replaceChildren(
      ...(items.length
        ? items.slice(0, 40).map((e) =>
            h(
              "li",
              { class: "recent-item" },
              h("span", { class: "swatch", attrs: { style: `background: var(${REGIONS.find((r) => r.key === e.region)?.hue ?? "--muted"})` } }),
              h("span", { class: "grow min0 break", text: (EVENT_TEXT[e.kind] ?? ((v) => v.name))(e) }),
              e.at ? h("span", { class: "muted small nowrap", text: relTime(e.at) }) : null,
            ),
          )
        : [h("li", { class: "empty-recent muted", text: t(local ? "brain.recentEmpty" : "brain.recentEmptyCloud") })]),
    );

    lossBody.textContent = t(local ? "brain.lossBody" : "brain.lossBodyCloud");
    lossHost.replaceChildren(lossChart(adaptations) ?? h("p", { class: "muted", text: t(local ? "brain.lossEmpty" : "brain.lossEmptyCloud") }));
    daysHost.replaceChildren(activityChart(v.days));
  }

  const stop = subscribeBrain(paint);
  return { el, stop };
}
