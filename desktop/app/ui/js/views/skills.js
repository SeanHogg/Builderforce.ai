// Skills: what Train Once made of reviewed demonstrations. Each can run now, run on a
// routine, or be deleted (with the secrets it saved in the vault).
import { basename, dialog, h, invoke, route, showError } from "../bridge.js";
import { num, relTime, t } from "../i18n.js";
import { subscribeAgents } from "../agentStore.js";
import { optInCard } from "./optIn.js";
import { runForm } from "./skillRun.js";
import { routineText, scheduleForm } from "./skillSchedule.js";

function skillCard(skill, open, toggle, reload) {
  const remove = async () => {
    const ok = await dialog.ask(t("skills.deleteConfirm", { name: skill.name }), { title: t("skills.delete"), kind: "warning" });
    if (!ok) return;
    await invoke("skill_delete", { id: skill.id }).catch(showError);
    reload();
  };
  const routine = routineText(skill.routine);
  const gates = skill.steps.filter((s) => s.requiresApproval).length;
  return h(
    "li",
    { class: "card stack" },
    h(
      "div",
      { class: "row between wrap" },
      h(
        "div",
        { class: "min0" },
        h("strong", { text: skill.name }),
        h("div", {
          class: "muted small",
          text: [basename(skill.program), t("teach.stepCount", { n: num(skill.steps.length) }), gates && t("skills.gates", { n: num(gates) }), relTime(skill.createdAt)].filter(Boolean).join(" · "),
        }),
        routine && h("span", { class: "pill ok", text: routine }),
      ),
      h(
        "div",
        { class: "row wrap" },
        h("button", { class: open === "run" ? "primary" : "ghost", text: t("skills.run"), on: { click: () => toggle(skill.id, "run") } }),
        h("button", { class: open === "schedule" ? "primary" : "ghost", text: t("skills.schedule"), on: { click: () => toggle(skill.id, "schedule") } }),
        h("button", { class: "ghost danger", text: t("skills.delete"), on: { click: remove } }),
      ),
    ),
    open === "run" && runForm(skill, () => (location.hash = route("runs"))),
    open === "schedule" && scheduleForm(skill, reload),
  );
}

export function render(host) {
  const body = h("div", { class: "stack" });
  host.append(h("header", { class: "page-head" }, h("div", {}, h("h1", { text: t("skills.title") }), h("p", { class: "muted", text: t("skills.intro") }))), body);
  let skills = null;
  let last = null;
  const open = { id: null, panel: null };

  const reload = () =>
    invoke("skills_list")
      .then((r) => {
        skills = r.skills;
        open.id = null;
        paint();
      })
      .catch(showError);
  const toggle = (id, panel) => {
    const same = open.id === id && open.panel === panel;
    open.id = same ? null : id;
    open.panel = same ? null : panel;
    paint();
  };

  function paint(s = last) {
    if (!s) return;
    last = s;
    const gate = optInCard(s);
    if (gate) return body.replaceChildren(gate);
    if (!skills) return body.replaceChildren(h("p", { class: "muted", text: t("common.loading") }));
    if (!skills.length) {
      return body.replaceChildren(
        h("div", { class: "card empty-state" }, h("p", { class: "muted", text: t("skills.empty") }), h("a", { class: "button primary", href: route("teach"), text: t("skills.teachFirst") })),
      );
    }
    body.replaceChildren(h("ul", { class: "stack" }, skills.map((sk) => skillCard(sk, open.id === sk.id ? open.panel : null, toggle, reload))));
  }

  reload();
  return subscribeAgents((s) => {
    // Repaint only on opt-in changes — a live poll must not wipe a half-typed form.
    if (!last || last.enabled !== s.enabled || last.supported !== s.supported) paint({ ...s });
    else last = { ...s };
  });
}
