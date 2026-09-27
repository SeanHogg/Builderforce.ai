// The approval prompt: when a running skill reaches a step it must ask about (a send, a
// payment, a delete), the window says exactly what it is about to do and waits. Mounted
// once by the shell, over every view; it decides its own visibility from the live state.
import { h, invoke, showError } from "./bridge.js";
import { t } from "./i18n.js";
import { refreshAgents, subscribeAgents } from "./agentStore.js";
import { stepText, stepWhere } from "./stepText.js";

export function mountApproval() {
  let shownFor = null;
  const overlay = h("div", { class: "modal-overlay", hidden: true, attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": "approval-title" } });
  document.body.append(overlay);

  const decide = async (approve) => {
    try {
      await invoke("run_decide", { approve });
    } catch (e) {
      showError(e);
    }
    overlay.hidden = true;
    shownFor = null;
    await refreshAgents();
  };

  subscribeAgents((s) => {
    const run = s.run;
    const key = run && run.pendingApproval != null ? `${run.runId}:${run.pendingApproval}` : null;
    if (key === shownFor) return;
    shownFor = key;
    if (!key) {
      overlay.hidden = true;
      return;
    }
    const action = run.pendingAction;
    overlay.replaceChildren(
      h(
        "div",
        { class: "modal card stack" },
        h("h2", { id: "approval-title", text: t("approval.title", { name: run.skillName }) }),
        h("p", { text: t("approval.body") }),
        action && h("div", { class: "approval-step" }, h("strong", { text: stepText(action) }), stepWhere(action) && h("div", { class: "muted small", text: stepWhere(action) })),
        h("p", { class: "muted small", text: t("approval.timeout") }),
        h(
          "div",
          { class: "row wrap" },
          h("button", { class: "primary", text: t("approval.approve"), on: { click: () => decide(true) } }),
          h("button", { class: "ghost danger", text: t("approval.deny"), on: { click: () => decide(false) } }),
        ),
      ),
    );
    overlay.hidden = false;
    overlay.querySelector("button.primary")?.focus();
  });
}
