// Evermind: which Evermind to look at — this machine's private one, or a model of the
// signed-in workspace — then its brain (the knowledge map and the learning charts). For a
// workspace model, the shared console follows (Teach, Test, Check, Maintain). For this
// machine: the private model the agents' experience trains, the facts every AI tool here
// shares (read from the store; forgetting goes through it), and forgetting everything.
import { dialog, h, invoke, showError } from "../bridge.js";
import { num, t } from "../i18n.js";
import { refreshAgents, subscribeAgents } from "../agentStore.js";
import { brainPanel } from "../brain/brainPanel.js";
import { refreshBrain, setTraining } from "../brain/brainStore.js";
import { sourcePicker } from "../brain/sourcePicker.js";
import { workspaceConsole } from "../cloud/workspaceConsole.js";
import { sourceState, subscribeSource } from "../cloud/evermindSource.js";

/**
 * Start from a workspace model: download one the person can already see as their private
 * model. Renders nothing when there is none to offer (signed out, or no workspace models).
 */
function starter(result) {
  const builds = sourceState().builds ?? [];
  if (!builds.length) return null;
  const select = h("select", { attrs: { "aria-label": t("evermind.starterPick") } }, ...builds.map((b) => h("option", { value: String(b.storageProjectId), text: b.name })));
  const fetchIt = async (ev) => {
    const btn = ev.currentTarget;
    const build = builds.find((b) => String(b.storageProjectId) === select.value);
    if (!build) return;
    btn.disabled = true;
    result.textContent = t("evermind.starterDownloading", { name: build.name });
    try {
      await invoke("evermind_fetch_model", { projectId: build.storageProjectId, name: build.name });
      result.textContent = t("evermind.starterDone", { name: build.name });
      await refreshAgents();
    } catch (e) {
      result.textContent = "";
      showError(e);
    } finally {
      btn.disabled = false;
    }
  };
  return h(
    "div",
    { class: "stack-tight" },
    h("span", { class: "muted small", text: t("evermind.starterBody") }),
    h("div", { class: "row wrap" }, select, h("button", { class: "ghost", text: t("evermind.starterUse"), on: { click: fetchIt } })),
  );
}

function learning(state) {
  const result = h("p", { class: "muted small", attrs: { "aria-live": "polite" } });
  const choose = async () => {
    const picked = await dialog.open({ multiple: false, directory: false, filters: [{ name: "Evermind", extensions: ["evermind"] }] });
    if (typeof picked !== "string" || !picked) return;
    await invoke("agents_set_model", { path: picked }).catch(showError);
    await refreshAgents();
  };
  const clear = async () => {
    await invoke("agents_set_model", { path: null }).catch(showError);
    await refreshAgents();
  };
  const train = async (btn) => {
    btn.disabled = true;
    result.textContent = t("evermind.training");
    setTraining(true);
    try {
      const r = await invoke("evermind_train", { dryRun: false });
      result.textContent =
        r.status === "trained"
          ? t("evermind.trained", { n: num(r.learned), version: r.version })
          : r.status === "nothing_new"
            ? t("evermind.nothingNew")
            : t("evermind.noWindow");
    } catch (e) {
      result.textContent = "";
      showError(e);
    } finally {
      btn.disabled = false;
      setTraining(false);
    }
  };
  const pending = h("span", { class: "muted small" });
  if (state.modelFile) {
    invoke("evermind_train", { dryRun: true })
      .then((r) => (pending.textContent = t("evermind.pending", { n: num(r.pending) })))
      .catch(() => {});
  }
  const trainBtn = h("button", { class: "primary", text: t("evermind.trainNow"), disabled: !state.modelFile });
  trainBtn.addEventListener("click", () => train(trainBtn));
  return h(
    "section",
    { class: "card stack" },
    h("h2", { text: t("evermind.learningTitle") }),
    h("p", { class: "muted", text: t("evermind.learningBody") }),
    h(
      "div",
      { class: "row wrap between" },
      h("div", { class: "min0" }, h("span", { class: "muted small", text: t("evermind.model") }), h("div", { class: "mono break", text: state.modelFile || t("evermind.noModel") })),
      h("div", { class: "row wrap" }, h("button", { class: "ghost", text: t("evermind.chooseModel"), on: { click: choose } }), state.modelFile && h("button", { class: "ghost", text: t("evermind.clearModel"), on: { click: clear } })),
    ),
    starter(result),
    h("div", { class: "row wrap" }, trainBtn, pending),
    result,
  );
}

function facts() {
  const filter = h("input", { type: "search", placeholder: t("evermind.filter"), attrs: { "aria-label": t("evermind.filter") } });
  const list = h("ul", { class: "rows facts" });
  const count = h("span", { class: "muted small" });
  let all = [];
  const paint = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = q ? all.filter((f) => `${f.key} ${f.content}`.toLowerCase().includes(q)) : all;
    count.textContent = t("evermind.factCount", { n: num(all.length) });
    list.replaceChildren(
      ...(shown.length
        ? shown.map((f) =>
            h(
              "li",
              { class: "row between wrap fact" },
              h("div", { class: "min0 grow" }, h("div", { class: "mono small break", text: f.key }), h("div", { class: "fact-body", text: f.content })),
              h("button", { class: "ghost danger small", text: t("evermind.forget"), on: { click: () => forget(f.key) } }),
            ),
          )
        : [h("li", { class: "muted", text: all.length ? t("evermind.noMatch") : t("evermind.noFacts") })]),
    );
  };
  const load = () =>
    invoke("facts_list")
      .then((r) => {
        all = Array.isArray(r.facts) ? r.facts : [];
        paint();
      })
      .catch(showError);
  const forget = async (key) => {
    const ok = await dialog.ask(t("evermind.forgetConfirm", { key }), { title: t("evermind.forget"), kind: "warning" });
    if (!ok) return;
    await invoke("fact_forget", { key }).catch(showError);
    load();
    refreshBrain();
  };
  filter.addEventListener("input", paint);
  load();
  return h("section", { class: "card stack" }, h("div", { class: "row between wrap" }, h("h2", { text: t("evermind.factsTitle") }), count), h("p", { class: "muted", text: t("evermind.factsBody") }), filter, list);
}

function forgetAll() {
  const run = async () => {
    const ok = await dialog.ask(t("evermind.forgetAllConfirm"), { title: t("evermind.forgetAll"), kind: "warning" });
    if (!ok) return;
    await invoke("forget_everything").catch(showError);
    await refreshAgents();
    refreshBrain();
  };
  return h(
    "section",
    { class: "card stack danger-zone" },
    h("h2", { text: t("evermind.forgetAll") }),
    h("p", { class: "muted", text: t("evermind.forgetAllBody") }),
    h("div", { class: "row" }, h("button", { class: "ghost danger", text: t("evermind.forgetAll"), on: { click: run } })),
  );
}

export function render(host) {
  const top = h("div");
  const picker = sourcePicker();
  const brain = brainPanel();
  const cloud = workspaceConsole();
  const machine = h("div", { class: "stack" }, top, facts(), forgetAll());
  const intro = h("p", { class: "muted" });
  host.append(h("header", { class: "page-head" }, h("div", {}, h("h1", { text: t("evermind.title") }), intro), picker.el), brain.el, cloud.el, machine);
  let model;
  let agentState = null;
  let buildCount = -1;
  const paintLearning = () => agentState && top.replaceChildren(learning(agentState));
  const stopSource = subscribeSource((s) => {
    const local = s.selected === "local";
    machine.hidden = !local;
    intro.textContent = t(local ? "evermind.intro" : "evermind.introWorkspace");
    // The starter offer depends on the workspace models, which arrive after sign-in.
    const count = (s.builds ?? []).length;
    if (count !== buildCount) {
      buildCount = count;
      paintLearning();
    }
  });
  const stopAgents = subscribeAgents((s) => {
    // The learning card depends only on the chosen model; the poll must not reset it.
    if (s.modelFile === model && top.firstChild) return;
    model = s.modelFile;
    agentState = s;
    paintLearning();
  });
  return () => {
    stopAgents();
    stopSource();
    picker.stop();
    cloud.stop();
    brain.stop();
  };
}
