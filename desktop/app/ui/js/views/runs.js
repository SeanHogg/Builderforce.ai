// Runs: what the agents did, newest first — the live run with its Stop button, and the
// audit trail of every step of every run (what was done, how, and what the person decided).
import { h, invoke, route, showError } from "../bridge.js";
import { num, relTime, t } from "../i18n.js";
import { refreshAgents, subscribeAgents } from "../agentStore.js";
import { stepLine } from "../stepText.js";
import { accountState } from "../cloud/accountStore.js";

const STATUS_PILL = { running: "busy", succeeded: "ok", failed: "bad", stopped: "idle", denied: "idle" };
const OUTCOME_PILL = { ok: "ok", fallback: "busy", failed: "bad", approved: "ok", denied: "idle" };

const statusPill = (status) => h("span", { class: `pill ${STATUS_PILL[status] ?? "idle"}`, text: t(`runs.status.${status}`) });

function liveRun(run) {
  if (!run) return null;
  const stop = async () => {
    await invoke("run_stop").catch(showError);
    await refreshAgents();
  };
  return h(
    "section",
    { class: "card recording" },
    h(
      "div",
      { class: "row between wrap" },
      h("div", { class: "row min0" }, h("span", { class: "dot busy" }), h("strong", { text: t("runs.running", { name: run.skillName }) })),
      h("button", { class: "ghost danger", text: t("runs.stop"), on: { click: stop } }),
    ),
    run.current != null && h("p", { class: "muted small", text: t("runs.atStep", { n: num(run.current + 1) }) }),
  );
}

/** Answer approvals from the phone: opt-in, and only meaningful while signed in. */
function phoneCard(state) {
  const box = h("input", { type: "checkbox", checked: !!state.phoneApprovals, disabled: !accountState().signedIn });
  box.addEventListener("change", async () => {
    await invoke("agents_set_phone_approvals", { on: box.checked }).catch(showError);
    await refreshAgents();
  });
  return h(
    "section",
    { class: "card stack" },
    h("label", { class: "check" }, box, h("strong", { text: t("runs.phoneTitle") })),
    h("p", { class: "muted small", text: accountState().signedIn ? t("runs.phoneBody") : t("runs.phoneSignIn") }),
  );
}

function runRow(run) {
  return h(
    "li",
    {},
    h(
      "a",
      { class: "row between wrap run-row", href: route("runs", { run: run.id }) },
      h("div", { class: "min0" }, h("strong", { text: run.skillName }), h("div", { class: "muted small", text: `${t(`runs.trigger.${run.trigger}`)} · ${relTime(run.startedAt)}` })),
      statusPill(run.status),
    ),
  );
}

function detail(host, id) {
  host.append(h("a", { class: "back", href: route("runs"), text: `← ${t("nav.runs")}` }));
  invoke("run_get", { id })
    .then(({ run, skill }) => {
      const steps = skill?.steps ?? [];
      host.append(
        h("header", { class: "page-head" }, h("div", {}, h("h1", { text: run.skillName }), h("p", { class: "muted", text: `${t(`runs.trigger.${run.trigger}`)} · ${relTime(run.startedAt)}` })), statusPill(run.status)),
        run.error && h("p", { class: "error-inline", text: run.error }),
        !skill && h("p", { class: "muted small", text: t("runs.skillGone") }),
        h(
          "ol",
          { class: "card rows audit" },
          run.steps.map((log) =>
            h(
              "li",
              { class: "row between wrap" },
              steps[log.idx] ? stepLine(steps[log.idx].action) : h("span", { class: "muted", text: t("runs.stepN", { n: num(log.idx + 1) }) }),
              h("div", { class: "row" }, h("span", { class: `pill ${OUTCOME_PILL[log.outcome] ?? "idle"}`, text: t(`runs.outcome.${log.outcome}`) }), log.detail && h("span", { class: "muted small", text: log.detail })),
            ),
          ),
        ),
      );
    })
    .catch(showError);
  return null;
}

export function render(host, params) {
  if (params.get("run")) return detail(host, params.get("run"));
  const live = h("div");
  const phone = h("div");
  const list = h("ul", { class: "card rows" });
  const empty = h("div", { class: "card empty-state", hidden: true }, h("p", { class: "muted", text: t("runs.empty") }));
  host.append(h("header", { class: "page-head" }, h("div", {}, h("h1", { text: t("runs.title") }), h("p", { class: "muted", text: t("runs.intro") }))), live, phone, empty, list);

  let wasRunning = false;
  const load = () =>
    invoke("runs_list", { limit: 100 })
      .then(({ runs }) => {
        empty.hidden = runs.length > 0;
        list.hidden = runs.length === 0;
        list.replaceChildren(...runs.map(runRow));
      })
      .catch(showError);
  load();
  return subscribeAgents((s) => {
    live.replaceChildren(...[liveRun(s.run)].filter(Boolean));
    if (!phone.firstChild || phone.dataset.on !== String(!!s.phoneApprovals)) {
      phone.dataset.on = String(!!s.phoneApprovals);
      phone.replaceChildren(phoneCard(s));
    }
    // A run that just ended has a new status to show.
    if (wasRunning && !s.run) load();
    wasRunning = !!s.run;
  });
}
