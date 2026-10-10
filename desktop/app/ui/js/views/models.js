// Local models: the runtime Synapse manages (Ollama), which model the Brain answers with,
// the models installed, the hub of models sized for this machine (the quantization that
// fits its memory is chosen for each), and the compatible endpoint other AI tools use.
import { copyText, h, invoke, listen, opener, showError } from "../bridge.js";
import { bytes, num, t } from "../i18n.js";

/** Downloads in flight, by model tag: `{ status, total, completed }`. Kept across renders. */
const pulls = new Map();

function runtimeCard(s, reload) {
  const rt = s.runtime;
  if (rt.version) {
    return h("section", { class: "card row between wrap" }, h("div", { class: "row min0" }, h("span", { class: "dot ok" }), h("strong", { text: t("models.runtimeReady", { version: rt.version }) })), h("span", { class: "mono small muted", text: rt.base }));
  }
  return h(
    "section",
    { class: "card stack" },
    h("h2", { text: t("models.runtimeMissingTitle") }),
    h("p", { class: "muted", text: t("models.runtimeMissingBody") }),
    h(
      "div",
      { class: "row wrap" },
      h("button", { class: "primary", text: t("models.getOllama"), on: { click: () => opener.openUrl(rt.downloadUrl) } }),
      h("button", { class: "ghost", text: t("models.checkAgain"), on: { click: reload } }),
    ),
  );
}

function brainRoute(s, reload) {
  const select = h("select", { attrs: { "aria-label": t("models.brainModel") } });
  select.append(h("option", { value: "", text: t("models.viaGateway") }), ...s.installed.map((m) => h("option", { value: m.name, text: m.name })));
  select.value = s.settings.chatModel ?? "";
  select.addEventListener("change", async () => {
    await invoke("local_set_chat_model", { model: select.value || null }).catch(showError);
    reload();
  });
  return h(
    "section",
    { class: "card stack" },
    h("h2", { text: t("models.brainModel") }),
    h("p", { class: "muted", text: t("models.brainModelBody") }),
    h("label", { class: "field" }, select),
  );
}

function installedCard(s, reload) {
  const remove = async (name) => {
    await invoke("local_delete", { model: name }).catch(showError);
    reload();
  };
  return h(
    "section",
    { class: "card stack" },
    h("h2", { text: t("models.installedTitle") }),
    s.installed.length
      ? h(
          "ul",
          { class: "rows" },
          s.installed.map((m) =>
            h(
              "li",
              { class: "row between wrap" },
              h("div", { class: "min0" }, h("div", { class: "mono break", text: m.name }), h("div", { class: "muted small", text: [m.parameterSize, m.quantization, bytes(m.size)].filter(Boolean).join(" · ") })),
              h("button", { class: "ghost danger small", text: t("models.remove"), on: { click: () => remove(m.name) } }),
            ),
          ),
        )
      : h("p", { class: "muted", text: t("models.noneInstalled") }),
  );
}

function progress(tag) {
  const p = pulls.get(tag);
  if (!p) return null;
  const pct = p.total ? Math.round((100 * (p.completed ?? 0)) / p.total) : 0;
  return h("div", { class: "stack-tight" }, h("div", { class: "meter" }, h("span", { attrs: { style: `width:${pct}%` } })), h("span", { class: "muted small", text: p.total ? t("models.pulling", { pct: num(pct) }) : p.status }));
}

function hubCard(s, reload) {
  const hub = s.hub;
  const installed = new Set(s.installed.map((m) => m.name));
  const pull = async (tag) => {
    pulls.set(tag, { status: t("models.starting") });
    reload();
    try {
      await invoke("local_pull", { model: tag });
    } catch (e) {
      showError(e);
    }
    pulls.delete(tag);
    reload();
  };
  const variant = (v) => {
    const pick = v.pick;
    const tag = pick?.tag;
    const action = !pick
      ? h("span", { class: "pill idle", text: t("models.tooLarge") })
      : installed.has(tag)
        ? h("span", { class: "pill ok", text: t("models.installed") })
        : pulls.has(tag)
          ? progress(tag)
          : h("button", { class: "ghost small", text: t("models.install"), disabled: !s.runtime.version, on: { click: () => pull(tag) } });
    return h(
      "li",
      { class: "row between wrap" },
      h(
        "div",
        { class: "min0" },
        h("strong", { text: t("models.params", { n: num(v.paramsB) }) }),
        tag === hub.recommended && h("span", { class: "pill ok", text: t("models.recommended") }),
        h("div", { class: "muted small", text: pick ? t("models.pick", { quant: pick.quant, size: bytes(pick.bytes) }) : t("models.needs", { size: bytes(v.options[0]?.bytes ?? 0) }) }),
      ),
      action,
    );
  };
  return h(
    "section",
    { class: "card stack" },
    h("h2", { text: t("models.hubTitle") }),
    h("p", { class: "muted", text: t("models.hubBody", { memory: bytes(hub.totalMemory), budget: bytes(hub.budget) }) }),
    ...hub.models.map((m) =>
      h(
        "div",
        { class: "stack-tight" },
        h("div", { class: "row wrap" }, h("h3", { text: m.name }), h("span", { class: "chip", text: t(`models.purpose.${m.purpose}`) })),
        h("ul", { class: "rows" }, m.variants.map(variant)),
      ),
    ),
  );
}

function apiCard(s, reload) {
  const api = s.api;
  const on = h("input", { type: "checkbox", checked: api.enabled });
  const port = h("input", { type: "number", min: 1024, max: 65535, value: api.port, attrs: { "aria-label": t("models.apiPort") } });
  const apply = async () => {
    await invoke("local_set_api", { enabled: on.checked, port: Number(port.value) || null }).catch(showError);
    reload();
  };
  on.addEventListener("change", apply);
  port.addEventListener("change", apply);
  const details = h("div", { class: "stack" });
  const show = async () => {
    try {
      const c = await invoke("local_api_connect");
      const block = (label, text) => h("div", {}, h("span", { class: "muted small", text: label }), h("div", { class: "code-wrap" }, h("pre", { class: "code", text }), h("button", { class: "ghost small copy", text: t("common.copy"), on: { click: (e) => copyText(e.currentTarget, text) } })));
      details.replaceChildren(block(t("models.apiClaudeCode"), c.claudeCode), block(t("models.apiOpenAi"), c.openai));
    } catch (e) {
      showError(e);
    }
  };
  const rotate = async () => {
    await invoke("local_api_rotate_key").catch(showError);
    details.replaceChildren();
  };
  const state = !api.enabled
    ? h("span", { class: "pill idle", text: t("models.apiOff") })
    : api.running
      ? h("span", { class: "pill ok", text: t("models.apiRunning", { port: api.port }) })
      : h("span", { class: "pill bad", text: t("models.apiFailed") });
  return h(
    "section",
    { class: "card stack" },
    h("div", { class: "row between wrap" }, h("h2", { text: t("models.apiTitle") }), state),
    h("p", { class: "muted", text: t("models.apiBody") }),
    api.error && h("p", { class: "error-inline", text: api.error }),
    h("div", { class: "row wrap" }, h("label", { class: "check" }, on, t("models.apiServe")), h("label", { class: "check" }, t("models.apiPort"), port)),
    api.enabled && h("div", { class: "row wrap" }, h("button", { class: "ghost", text: t("models.apiShow"), on: { click: show } }), h("button", { class: "ghost danger", text: t("models.apiRotate"), on: { click: rotate } })),
    details,
  );
}

export function render(host) {
  const body = h("div", { class: "stack" }, h("p", { class: "muted", text: t("models.loading") }));
  host.append(h("header", { class: "page-head" }, h("div", {}, h("h1", { text: t("models.title") }), h("p", { class: "muted", text: t("models.intro") }))), body);
  let alive = true;
  const reload = () =>
    invoke("local_state")
      .then((s) => {
        if (!alive) return;
        body.replaceChildren(...[runtimeCard(s, reload), s.runtime.version && brainRoute(s, reload), s.runtime.version && installedCard(s, reload), hubCard(s, reload), apiCard(s, reload)].filter(Boolean));
      })
      .catch(showError);
  reload();
  let paintQueued = false;
  const unlisten = listen("local-pull", ({ payload }) => {
    if (payload.done) return;
    pulls.set(payload.model, payload);
    // Progress arrives many times a second; repaint at most once a second.
    if (paintQueued) return;
    paintQueued = true;
    setTimeout(() => {
      paintQueued = false;
      reload();
    }, 1000);
  });
  return () => {
    alive = false;
    unlisten.then((fn) => fn());
  };
}
