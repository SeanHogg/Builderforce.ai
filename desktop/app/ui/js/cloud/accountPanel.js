// Signing in to builderforce.ai, and the account once signed in. `signInCard()` is the
// full sign-in (Chat and Settings ▸ Account show it while signed out); `mountAccountChip()`
// is the sidebar's one-line account; `accountCard()` is the signed-in account — workspace,
// web app, sign out. Each reads the shared account poll and owns its own rendering.
import { h, opener, route, showError } from "../bridge.js";
import { t } from "../i18n.js";
import { cancelSignIn, openWeb, selectWorkspace, signIn, signOut, subscribeAccount, workspaceName } from "./accountStore.js";

const run = (fn) => (ev) => {
  ev?.preventDefault?.();
  fn().catch(showError);
};

/** The sign-in card: start, the code to approve while waiting, and why a sign-in ended. */
export function signInCard() {
  const body = h("div", { class: "stack" });
  const el = h("section", { class: "card stack sign-in" }, body);
  const stop = subscribeAccount((s) => {
    if (s.signedIn) return body.replaceChildren();
    const si = s.signIn ?? { state: "Idle" };
    if (si.state === "Waiting") {
      body.replaceChildren(
        h("h2", { text: t("account.waitingTitle") }),
        h("p", { class: "muted", text: t("account.waitingBody") }),
        h("div", { class: "sign-in-code mono", text: si.userCode, attrs: { "aria-label": t("account.codeAria") } }),
        h(
          "div",
          { class: "row wrap" },
          h("button", { class: "primary", text: t("account.openAgain"), on: { click: () => opener.openUrl(si.verificationUri) } }),
          h("button", { class: "ghost", text: t("account.cancel"), on: { click: run(cancelSignIn) } }),
        ),
      );
      return;
    }
    const notice = si.state === "Failed" ? t(`account.failed.${si.reason}`) : s.expired ? t("account.expired") : null;
    body.replaceChildren(
      h("h2", { text: t("account.signInTitle") }),
      h("p", { class: "muted", text: t("account.signInBody") }),
      notice && h("p", { class: "notice", attrs: { role: "status" }, text: notice }),
      h("div", { class: "row" }, h("button", { class: "primary", text: t("account.signIn"), on: { click: run(signIn) } })),
    );
  });
  return { el, stop };
}

/** The sidebar's account line: who and where, or a way to sign in. */
export function mountAccountChip(host) {
  const el = h("a", { class: "account-chip", href: route("account") });
  host.append(el);
  subscribeAccount((s) => {
    el.classList.toggle("signed-in", s.signedIn);
    el.replaceChildren(
      h("span", { class: `dot ${s.signedIn ? (s.reachable ? "ok" : "busy") : "idle"}` }),
      h("span", { class: "account-chip-text", text: s.signedIn ? workspaceName(s) || t("account.signedIn") : t("account.signInShort") }),
    );
    el.title = s.signedIn ? (s.reachable ? t("account.signedInTitle", { workspace: workspaceName(s) }) : t("account.offline")) : t("account.signInBody");
  });
}

/** Signed in: the workspace in use (and switching it), the web app, and signing out. */
export function accountCard() {
  const select = h("select", { attrs: { "aria-label": t("account.workspace") } });
  select.addEventListener("change", () => selectWorkspace(Number(select.value)).catch(showError));
  const status = h("p", { class: "muted small" });
  const el = h(
    "section",
    { class: "card stack account-card" },
    h("h2", { text: t("account.workspace") }),
    h("label", { class: "stack-tight workspace-picker" }, select),
    status,
    h(
      "div",
      { class: "row wrap" },
      h("button", { class: "ghost", text: t("account.openWebApp"), on: { click: () => openWeb("/").catch(showError) } }),
      h("button", { class: "ghost danger", text: t("account.signOut"), on: { click: run(signOut) } }),
    ),
  );
  const stop = subscribeAccount((s) => {
    el.hidden = !s.signedIn;
    if (!s.signedIn) return;
    const ids = s.workspaces.map((w) => String(w.id)).join(",");
    if (select.dataset.ids !== ids) {
      select.dataset.ids = ids;
      select.replaceChildren(...s.workspaces.map((w) => h("option", { value: String(w.id), text: w.name })));
    }
    if (s.workspaceId != null) select.value = String(s.workspaceId);
    select.disabled = s.workspaces.length < 2;
    status.textContent = s.reachable ? t("account.signedInTitle", { workspace: workspaceName(s) }) : t("account.offline");
  });
  return { el, stop };
}
