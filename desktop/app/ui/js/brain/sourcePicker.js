// Which Evermind the page (and the sidebar brain) shows: this machine's private one, or a
// model of the signed-in workspace. Reads the shared source; says why the workspace
// models are missing when they are (signed out, none yet, unreachable).
import { h, route } from "../bridge.js";
import { t } from "../i18n.js";
import { accountState, workspaceName } from "../cloud/accountStore.js";
import { selectSource, subscribeSource } from "../cloud/evermindSource.js";

export function sourcePicker() {
  const select = h("select", { attrs: { "aria-label": t("evermind.source") } });
  const hint = h("p", { class: "muted small source-hint" });
  const el = h("div", { class: "source-picker" }, h("label", { class: "stack-tight" }, h("span", { class: "muted small", text: t("evermind.source") }), select), hint);
  select.addEventListener("change", () => selectSource(select.value === "local" ? "local" : Number(select.value)));

  const stop = subscribeSource((s) => {
    const acct = accountState();
    const builds = s.builds ?? [];
    // Name the parent Project only when the models span more than one.
    const multi = new Set(builds.map((b) => b.containerProjectId ?? 0)).size > 1;
    const options = [h("option", { value: "local", text: t("evermind.sourceLocal") })];
    if (builds.length) {
      options.push(
        h(
          "optgroup",
          { label: workspaceName(acct) || t("evermind.sourceWorkspace") },
          ...builds.map((b) => h("option", { value: String(b.storageProjectId), text: multi ? `${b.name} — ${b.containerName ?? t("evermind.ungrouped")}` : b.name })),
        ),
      );
    }
    select.replaceChildren(...options);
    select.value = String(s.selected);

    let why = "";
    if (!acct.signedIn) why = t("evermind.signInForModels");
    else if (s.builds == null) why = t("evermind.modelsLoading");
    else if (s.buildsError) why = t("evermind.modelsUnavailable");
    else if (!builds.length) why = t("evermind.noWorkspaceModels");
    hint.replaceChildren(why, !acct.signedIn ? h("a", { href: route("account"), text: ` ${t("account.signInShort")}` }) : "");
    hint.hidden = !why;
  });
  return { el, stop };
}
