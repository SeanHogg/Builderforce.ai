// The top of the Evermind page — the brain at full size, as the web Evermind shows it:
// stat tiles (model, learned, queued, training loss), the knowledge map with its legend
// (click a region to filter), what it learned most recently, and the two learning charts.
// Self-contained: it reads the shared brain picture and owns its selection.
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
          { class: "legend-item", type: "button", title: t(`brain.role.${r.key}`), on: { click: () => onSelect(r.key) } },
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
  fact: (e) => t("brain.event.fact", { name: e.title }),
  ask: (e) => t("brain.event.ask", { name: e.title }),
};

/** What the recent list shows: experience events, or — for a region filter — that region's own items. */
function recentItems(s, selected) {
  if (!selected) return (s.experience?.recent ?? []).map((e) => ({ ...e, region: e.region }));
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

  const el = h(
    "div",
    { class: "stack brain-panel" },
    h("div", { class: "tiles" }, model.el, learned.el, queued.el, loss.el),
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
      h("section", { class: "card stack" }, h("h2", { text: t("brain.lossTitle") }), h("p", { class: "muted small", text: t("brain.lossBody") }), lossHost),
      h("section", { class: "card stack" }, h("h2", { text: t("brain.daysTitle") }), daysHost, activityLegend()),
    ),
  );

  function paint(s) {
    last = s;
    const x = s.experience;
    const adaptations = x?.adaptations ?? [];
    const lastLoss = adaptations.length ? adaptations[adaptations.length - 1].loss : null;
    model.value.textContent = x?.modelVersion ?? t("brain.noModel");
    learned.value.textContent = x ? num(x.learned) : "—";
    queued.value.textContent = x ? num(x.pending) : "—";
    loss.value.textContent = lastLoss != null ? lastLoss.toFixed(3) : "—";
    note.hidden = !s.experienceError;
    note.textContent = s.experienceError ? t("brain.experienceUnavailable") : "";

    const states = regionStates(s);
    const live = states.some((r) => r.active);
    mapState.textContent = live ? t("brain.stateLearning") : states.some((r) => r.count > 0) ? t("brain.stateResting") : t("brain.stateEmpty");
    mapState.className = `pill ${live ? "ok" : ""}`;
    brain.update(s, selected);
    for (const rs of states) {
      const row = lg.rows[rs.meta.key];
      row.cap.textContent = num(rs.count);
      row.btn.setAttribute("aria-pressed", String(selected === rs.meta.key));
      row.btn.classList.toggle("on", selected === rs.meta.key);
    }

    const items = recentItems(s, selected);
    recentHead.textContent = selected ? t(`brain.region.${selected}`) : items.length ? "" : t("brain.recentEmptyTag");
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
        : [h("li", { class: "empty-recent muted", text: t("brain.recentEmpty") })]),
    );

    lossHost.replaceChildren(lossChart(adaptations) ?? h("p", { class: "muted", text: t("brain.lossEmpty") }));
    daysHost.replaceChildren(activityChart(x?.days ?? []));
  }

  const stop = subscribeBrain(paint);
  return { el, stop };
}
