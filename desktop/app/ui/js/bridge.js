// The window's only way to the service: every workspace operation is the ONE `call`
// command — the same operation surface the HTTP and MCP transports expose. Plus the
// small DOM helpers every view shares.
import { t } from "./i18n.js";

const tauri = window.__TAURI__;
export const invoke = tauri.core.invoke;
export const dialog = tauri.dialog;
export const opener = tauri.opener;
/** Subscribe to an event the app emits; resolves to the unsubscribe. */
export const listen = tauri.event.listen;

export const call = (op, body) => invoke("call", { op, body: body ?? null });

/**
 * Build an element. `props`: `class`, `text`, `title`, `attrs` (object), `on` (event →
 * handler), anything else is set as a property. Children: nodes, strings, or falsy
 * (skipped) — so optional parts read inline.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "attrs") for (const [a, av] of Object.entries(v)) el.setAttribute(a, av);
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else el[k] = v;
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** The folder name — what a person calls the workspace. */
export function basename(path) {
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || String(path);
}

export function showError(err) {
  const el = document.getElementById("error");
  el.textContent = err ? String(err) : "";
  el.hidden = !err;
}

/** Copy `text`, and say so on the button for a moment. */
export async function copyText(btn, text) {
  await navigator.clipboard.writeText(text);
  const label = btn.textContent;
  btn.textContent = t("common.copied");
  setTimeout(() => (btn.textContent = label), 1500);
}

export const route = (view, params) =>
  `#/${view}${params ? `?${new URLSearchParams(params).toString()}` : ""}`;
