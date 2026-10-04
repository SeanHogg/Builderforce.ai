// Spawn's UI strings in the five product locales. `t(key, vars)` interpolates {name}
// placeholders and falls back to English per key; numbers go through Intl.
import en from "./locales/en.js";
import de from "./locales/de.js";
import es from "./locales/es.js";
import fr from "./locales/fr.js";
import zh from "./locales/zh.js";

const catalogs = { en, de, es, fr, zh };
const requested = (navigator.language || "en").toLowerCase().split(/[-_]/)[0];
export const lang = catalogs[requested] ? requested : "en";
document.documentElement.lang = lang;
const active = catalogs[lang];

export function t(key, vars) {
  const raw = active[key] ?? en[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`)) : raw;
}

/** Whether a key has a sentence (used to tell a known refusal code from an unknown one). */
export const has = (key) => key in en;

export function applyI18n(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.getAttribute("data-i18n"));
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
}

const numberFmt = new Intl.NumberFormat(lang);
export const num = (n) => numberFmt.format(n ?? 0);
