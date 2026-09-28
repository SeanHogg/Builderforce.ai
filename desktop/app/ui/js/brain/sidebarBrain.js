// The brain in the sidebar: always in view, so learning is something you watch happen —
// a region glows while it learns, new knowledge pulses in. Named for the Evermind it shows
// (this machine's, or the workspace model chosen on the Evermind page) and captioned per
// hemisphere with what it holds; a click opens the full map on the Evermind page.
import { h, route } from "../bridge.js";
import { num, t } from "../i18n.js";
import { createBrain } from "./brainSvg.js";
import { hemisphereTotal, regionStates } from "./regions.js";
import { subscribeBrain } from "./brainStore.js";

export function mountSidebarBrain(host) {
  const brain = createBrain("mini");
  const knows = h("span", { class: "side-brain-num" });
  const does = h("span", { class: "side-brain-num" });
  const status = h("span", { class: "side-brain-status", attrs: { "aria-live": "polite" } });
  const source = h("span", { class: "side-brain-source" });
  const link = h(
    "a",
    { class: "side-brain", href: route("evermind"), title: t("brain.open") },
    source,
    brain.el,
    h(
      "div",
      { class: "side-brain-caps" },
      h("span", { class: "side-brain-cap" }, h("span", { class: "muted", text: t("brain.knows") }), knows),
      h("span", { class: "side-brain-cap" }, h("span", { class: "muted", text: t("brain.does") }), does),
    ),
    status,
  );
  host.prepend(link);

  subscribeBrain((s) => {
    brain.update(s);
    source.textContent = s.view.kind === "cloud" ? (s.source.build?.name ?? "") : t("brain.thisMachine");
    const states = regionStates(s);
    knows.textContent = num(hemisphereTotal(states, "left"));
    does.textContent = num(hemisphereTotal(states, "right"));
    const live = states.filter((r) => r.active);
    status.textContent = live.length ? t("brain.learningIn", { region: t(`brain.region.${live[0].meta.key}`) }) : "";
    status.hidden = live.length === 0;
  });
}
