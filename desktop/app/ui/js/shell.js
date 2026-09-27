// The window: sidebar navigation, the service status in its footer, the update notice,
// and a hash router that mounts one view at a time. A view's `render(host, params)`
// returns its cleanup (the store unsubscribe), so leaving a view stops its updates.
import { invoke, opener, showError } from "./bridge.js";
import { applyI18n, t } from "./i18n.js";
import { subscribe, refresh } from "./store.js";
import * as workspaces from "./views/workspaces.js";
import * as workspace from "./views/workspace.js";
import * as search from "./views/search.js";
import * as activity from "./views/activity.js";
import * as connect from "./views/connect.js";
import * as teach from "./views/teach.js";
import * as review from "./views/review.js";
import * as skills from "./views/skills.js";
import * as runs from "./views/runs.js";
import * as evermind from "./views/evermind.js";
import * as chat from "./views/chat.js";
import { mountApproval } from "./approval.js";
import { refreshAgents } from "./agentStore.js";
import { mountSidebarBrain } from "./brain/sidebarBrain.js";
import { mountAccountChip } from "./cloud/accountPanel.js";

const VIEWS = { chat, workspaces, workspace, search, activity, connect, teach, review, skills, runs, evermind };
// The nav entry a view belongs under (a workspace's page sits under Workspaces).
const NAV_OF = { workspace: "workspaces", review: "teach" };
const $ = (id) => document.getElementById(id);

let cleanup = null;

function mount() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const name = VIEWS[path] ? path : "workspaces";
  cleanup?.();
  showError(null);
  const host = $("view");
  host.replaceChildren();
  host.className = `view view-${name}`;
  cleanup = VIEWS[name].render(host, new URLSearchParams(query)) ?? null;
  const nav = NAV_OF[name] ?? name;
  for (const a of document.querySelectorAll("[data-nav]")) {
    if (a.dataset.nav === nav) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  document.querySelector(".content").scrollTo(0, 0);
}

function renderStatus(s) {
  const e = s.health?.embeddings ?? "loading";
  $("status-dot").className = `dot ${e === "ready" ? "ok" : e === "loading" ? "busy" : "idle"}`;
  $("status-text").textContent = t(`status.embeddings.${e}`);
  $("status").title = s.health?.embeddingsError || t(`status.embeddingsHint.${e}`);
  $("version").textContent = t("status.version", { version: s.health?.version ?? "" });
  const count = $("nav-count");
  count.textContent = String(s.workspaces.length);
  count.hidden = s.workspaces.length === 0;
}

async function checkUpdate() {
  try {
    const u = await invoke("check_update");
    if (!u.newer || !u.url) return;
    $("update-text").textContent = t("update.available", { version: u.latest });
    $("update").onclick = (ev) => {
      ev.preventDefault();
      opener.openUrl(u.url);
    };
    $("update").hidden = false;
  } catch {
    // Offline or rate-limited: no notice is the right outcome.
  }
}

applyI18n();
subscribe(renderStatus);
window.addEventListener("hashchange", mount);
mount();
refresh();
checkUpdate();
// The approval prompt sits over every view; the agents' live state drives it.
mountApproval();
refreshAgents();
// Learning, always in view: the brain sits at the foot of the sidebar.
mountSidebarBrain(document.querySelector(".sidebar-foot"));
// Signed in to builderforce.ai (or a way to sign in), under the brand.
mountAccountChip(document.getElementById("account"));
