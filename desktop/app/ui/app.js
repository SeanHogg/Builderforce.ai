// Builderforce Desktop window. Every workspace operation goes through the ONE `call`
// command (the same operation surface the HTTP and MCP transports expose).
(function () {
  const tauri = window.__TAURI__;
  const invoke = tauri.core.invoke;
  const call = (op, body) => invoke("call", { op, body: body ?? null });
  const $ = (id) => document.getElementById(id);
  const POLL_BUSY_MS = 1500;
  const POLL_IDLE_MS = 10000;

  applyI18n();

  function showError(err) {
    const el = $("error");
    el.textContent = err ? String(err) : "";
    el.hidden = !err;
  }

  function phaseLabel(phase) {
    if (phase.state === "scanning") return { text: t("phase.scanning", phase), cls: "warn" };
    if (phase.state === "embedding") return { text: t("phase.embedding"), cls: "warn" };
    return { text: t("phase.ready"), cls: "ok" };
  }

  function progress(ws) {
    if (ws.phase.state === "scanning") return ws.phase.total ? (100 * ws.phase.done) / ws.phase.total : 0;
    if (ws.phase.state === "embedding") return ws.chunks ? (100 * ws.embedded) / ws.chunks : 0;
    return 100;
  }

  function renderWorkspaces(list) {
    const ul = $("workspaces");
    ul.replaceChildren();
    $("empty").hidden = list.length > 0;
    const tpl = $("row");
    for (const ws of list) {
      const li = tpl.content.firstElementChild.cloneNode(true);
      applyI18n(li);
      li.querySelector(".path").textContent = ws.root;
      const ph = phaseLabel(ws.phase);
      const pill = li.querySelector(".phase");
      pill.textContent = ph.text;
      pill.classList.add(ph.cls);
      const pct = Math.round(progress(ws));
      li.querySelector(".meter > span").style.width = `${pct}%`;
      li.querySelector(".meter").setAttribute("aria-valuenow", String(pct));
      li.querySelector(".stats").textContent = t("workspaces.stats", ws);
      li.querySelector(".rescan").addEventListener("click", () => act("rescan", ws.root));
      li.querySelector(".remove").addEventListener("click", () => act("remove", ws.root));
      ul.appendChild(li);
    }
  }

  async function act(op, root) {
    try {
      showError(null);
      await call(op, { root });
      await refresh();
    } catch (e) {
      showError(e);
    }
  }

  let timer = null;
  async function refresh() {
    clearTimeout(timer);
    let busy = false;
    try {
      const [health, ws] = await Promise.all([call("health"), call("workspaces")]);
      $("version").textContent = t("version", { version: health.version });
      const emb = $("embeddings");
      emb.textContent = t(`embeddings.${health.embeddings}`);
      emb.className = `pill ${health.embeddings === "ready" ? "ok" : "warn"}`;
      emb.title = health.embeddingsError || "";
      renderWorkspaces(ws.workspaces);
      busy = health.embeddings === "loading" || ws.workspaces.some((w) => w.phase.state !== "ready");
    } catch (e) {
      showError(e);
    }
    timer = setTimeout(refresh, busy ? POLL_BUSY_MS : POLL_IDLE_MS);
  }

  $("add").addEventListener("click", async () => {
    const picked = await tauri.dialog.open({ directory: true, multiple: false });
    if (typeof picked === "string" && picked) await act("ensure", picked);
  });

  async function loadConnect() {
    try {
      const info = await invoke("connect_info");
      $("claude").textContent = info.claudeCode;
      $("mcp").textContent = info.mcpJson;
    } catch (e) {
      showError(e);
    }
  }

  for (const btn of document.querySelectorAll("[data-copy]")) {
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText($(btn.dataset.copy).textContent);
      btn.textContent = t("connect.copied");
      setTimeout(() => (btn.textContent = t("connect.copy")), 1500);
    });
  }

  async function checkUpdate() {
    try {
      const u = await invoke("check_update");
      if (!u.newer || !u.url) return;
      $("update-text").textContent = t("update.available", { version: u.latest });
      $("update-open").onclick = () => tauri.opener.openUrl(u.url);
      $("update").hidden = false;
    } catch {
      // Offline or rate-limited: no banner is the right outcome.
    }
  }

  refresh();
  loadConnect();
  checkUpdate();
})();
