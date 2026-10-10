// UI strings for the five product locales. One catalog per locale file; `t(key, vars)`
// interpolates {name} placeholders and falls back to English per key. Numbers and
// relative times go through Intl, so they read naturally in every locale.
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

export function applyI18n(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.getAttribute("data-i18n"));
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.getAttribute("data-i18n-title"));
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
}

const numberFmt = new Intl.NumberFormat(lang);
export const num = (n) => numberFmt.format(n ?? 0);

const gbFmt = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
/** A size in bytes, as gigabytes ("4.7 GB") or megabytes below one gigabyte. */
export const bytes = (n) => (n >= 1e9 ? `${gbFmt.format(n / 1e9)} GB` : `${gbFmt.format((n ?? 0) / 1e6)} MB`);

const relFmt = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
const STEPS = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.35, "week"],
  [12, "month"],
  [Number.POSITIVE_INFINITY, "year"],
];

/** "3 minutes ago" for an epoch-milliseconds timestamp. */
export function relTime(ms) {
  let delta = (ms - Date.now()) / 1000;
  for (const [size, unit] of STEPS) {
    if (Math.abs(delta) < size) return relFmt.format(Math.round(delta), unit);
    delta /= size;
  }
  return "";
}
