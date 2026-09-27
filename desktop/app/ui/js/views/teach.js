// Teach: pick a program, do the task once while Synapse records that program, stop.
// The recording goes straight to review — nothing becomes a skill until the person says so.
import { basename, dialog, h, invoke, route, showError } from "../bridge.js";
import { num, relTime, t } from "../i18n.js";
import { refreshAgents, subscribeAgents } from "../agentStore.js";
import { stepLine } from "../stepText.js";
import { optInCard } from "./optIn.js";

// Kept across view switches so a half-filled form survives a look elsewhere.
const draft = { program: "", args: "", name: "" };

function splitArgs(s) {
  return (s.match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ""));
}

async function browse(input) {
  const picked = await dialog.open({ multiple: false, directory: false, filters: [{ name: t("teach.programs"), extensions: ["exe", "bat", "cmd", "lnk"] }] });
  if (typeof picked === "string" && picked) {
    input.value = draft.program = picked;
  }
}

function setupForm() {
  const program = h("input", { value: draft.program, placeholder: "C:\\Program Files\\…\\app.exe", attrs: { "aria-label": t("teach.program") }, on: { input: (e) => (draft.program = e.target.value) } });
  const args = h("input", { value: draft.args, placeholder: t("teach.argsPlaceholder"), attrs: { "aria-label": t("teach.args") }, on: { input: (e) => (draft.args = e.target.value) } });
  const name = h("input", { value: draft.name, placeholder: t("teach.namePlaceholder"), attrs: { "aria-label": t("teach.name") }, on: { input: (e) => (draft.name = e.target.value) } });
  const start = async (ev) => {
    ev.preventDefault();
    if (!draft.program.trim()) return program.focus();
    try {
      await invoke("teach_start", { program: draft.program.trim(), args: splitArgs(draft.args), name: draft.name });
      await refreshAgents();
    } catch (e) {
      showError(e);
    }
  };
  return h(
    "form",
    { class: "card stack", on: { submit: start } },
    h("h2", { text: t("teach.newTitle") }),
    h("label", { class: "field" }, h("span", { text: t("teach.program") }), h("div", { class: "row" }, program, h("button", { type: "button", class: "ghost", text: t("teach.browse"), on: { click: () => browse(program) } }))),
    h("div", { class: "grid-2" }, h("label", { class: "field" }, h("span", { text: t("teach.name") }), name), h("label", { class: "field" }, h("span", { text: t("teach.args") }), args)),
    h("p", { class: "muted small", text: t("teach.privacy") }),
    h("div", { class: "row" }, h("button", { class: "primary", type: "submit", text: t("teach.start") })),
  );
}

function recordingPanel(rec) {
  const stop = async () => {
    try {
      const episode = await invoke("teach_stop");
      await refreshAgents();
      location.hash = episode ? route("review", { episode: episode.id }) : route("teach");
    } catch (e) {
      showError(e);
    }
  };
  const discard = async () => {
    await invoke("teach_cancel");
    await refreshAgents();
  };
  return h(
    "section",
    { class: "card recording" },
    h(
      "div",
      { class: "row between wrap" },
      h("div", { class: "row min0" }, h("span", { class: "dot rec" }), h("strong", { text: t("teach.recording", { name: rec.name }) })),
      h("div", { class: "row" }, h("button", { class: "primary", text: t("teach.stop"), on: { click: stop } }), h("button", { class: "ghost danger", text: t("teach.discard"), on: { click: discard } })),
    ),
    h("p", { class: "muted small", text: t("teach.onlyThis", { program: basename(rec.program) }) }),
    rec.error && h("p", { class: "error-inline", text: rec.error }),
    rec.steps.length
      ? h("ol", { class: "live-steps" }, rec.steps.map((s) => h("li", {}, stepLine(s.action))))
      : h("p", { class: "muted", text: t("teach.waiting") }),
  );
}

function episodesList(episodes) {
  if (!episodes.length) return null;
  return h(
    "section",
    { class: "card" },
    h("h2", { text: t("teach.demonstrations") }),
    h(
      "ul",
      { class: "rows" },
      episodes.map((ep) =>
        h(
          "li",
          { class: "row between wrap" },
          h("div", { class: "min0" }, h("strong", { text: ep.name }), h("div", { class: "muted small", text: `${basename(ep.program)} · ${t("teach.stepCount", { n: num(ep.steps) })} · ${relTime(ep.startedAt)}` })),
          h("a", { class: "button ghost small", href: route("review", { episode: ep.id }), text: t("teach.review") }),
        ),
      ),
    ),
  );
}

export function render(host) {
  const body = h("div", { class: "stack" });
  host.append(h("header", { class: "page-head" }, h("div", {}, h("h1", { text: t("teach.title") }), h("p", { class: "muted", text: t("teach.intro") }))), body);
  let episodes = [];
  invoke("episodes_list").then((r) => { episodes = r.episodes; paint(); }).catch(showError);
  let last = null;
  function paint(s = last) {
    if (!s) return;
    last = s;
    const gate = optInCard(s);
    body.replaceChildren(...(gate ? [gate] : s.recording ? [recordingPanel(s.recording)] : [setupForm(), episodesList(episodes)].filter(Boolean)));
  }
  return subscribeAgents(paint);
}
