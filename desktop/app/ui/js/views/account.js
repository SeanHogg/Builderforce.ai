// Settings ▸ Account: signing in to builderforce.ai, and once signed in, the workspace in
// use, the web app, and signing out.
import { h } from "../bridge.js";
import { t } from "../i18n.js";
import { accountCard, signInCard } from "../cloud/accountPanel.js";

export function render(host) {
  const signIn = signInCard();
  const card = accountCard();
  host.append(h("header", { class: "page-head" }, h("div", {}, h("h1", { text: t("account.title") }), h("p", { class: "muted", text: t("account.intro") }))), signIn.el, card.el);
  return () => {
    signIn.stop();
    card.stop();
  };
}
