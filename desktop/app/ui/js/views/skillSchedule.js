// A skill's routine: every N minutes or daily at a local time, with the values its
// non-secret parameters take (secrets come from the vault at run time). One routine per
// skill; saving replaces it, removing clears it.
import { h, invoke, showError } from "../bridge.js";
import { t } from "../i18n.js";

const pad = (n) => String(n).padStart(2, "0");

export function scheduleForm(skill, onSaved) {
  const r = skill.routine;
  const every = h(
    "select",
    { attrs: { "aria-label": t("schedule.every") } },
    h("option", { value: "minutes", text: t("schedule.everyMinutes"), selected: r?.schedule.every !== "day" }),
    h("option", { value: "day", text: t("schedule.everyDay"), selected: r?.schedule.every === "day" }),
  );
  const minutes = h("input", { type: "number", min: 1, max: 10080, value: r?.schedule.minutes ?? 60, attrs: { "aria-label": t("schedule.minutes") } });
  const time = h("input", { type: "time", value: r?.schedule.every === "day" ? `${pad(r.schedule.hour)}:${pad(r.schedule.minute)}` : "09:00", attrs: { "aria-label": t("schedule.time") } });
  const enabled = h("input", { type: "checkbox", checked: r ? r.enabled : true });
  const values = { ...(r?.values ?? {}) };
  const valueInputs = skill.params
    .filter((p) => !p.secret)
    .map((p) => {
      values[p.name] ??= p.default ?? "";
      return h("label", { class: "field" }, h("span", { text: p.label || p.name }), h("input", { value: values[p.name], on: { input: (e) => (values[p.name] = e.target.value) } }));
    });
  const sync = () => {
    minutes.parentElement.hidden = every.value !== "minutes";
    time.parentElement.hidden = every.value !== "day";
  };
  every.addEventListener("change", sync);

  const save = async (routine) => {
    try {
      await invoke("skill_schedule", { id: skill.id, routine });
      onSaved?.();
    } catch (e) {
      showError(e);
    }
  };
  const submit = (ev) => {
    ev.preventDefault();
    const [hh, mm] = time.value.split(":").map(Number);
    const schedule = every.value === "day" ? { every: "day", hour: hh || 0, minute: mm || 0 } : { every: "minutes", minutes: Math.max(1, Number(minutes.value) || 1) };
    save({ schedule, values, enabled: enabled.checked });
  };
  const form = h(
    "form",
    { class: "stack", on: { submit } },
    h(
      "div",
      { class: "grid-2" },
      h("label", { class: "field" }, h("span", { text: t("schedule.every") }), every),
      h("label", { class: "field" }, h("span", { text: t("schedule.minutes") }), minutes),
      h("label", { class: "field" }, h("span", { text: t("schedule.time") }), time),
    ),
    valueInputs.length > 0 && h("div", { class: "grid-2" }, valueInputs),
    skill.params.some((p) => p.secret) && h("p", { class: "muted small", text: t("schedule.secretsFromVault") }),
    h("label", { class: "check" }, enabled, t("schedule.enabled")),
    h(
      "div",
      { class: "row wrap" },
      h("button", { class: "primary", type: "submit", text: t("schedule.save") }),
      r && h("button", { class: "ghost danger", type: "button", text: t("schedule.remove"), on: { click: () => save(null) } }),
    ),
  );
  queueMicrotask(sync);
  return form;
}

/** "Every 15 minutes" / "Daily at 09:30", or null when there is no routine. */
export function routineText(routine) {
  if (!routine) return null;
  const s = routine.schedule;
  const when = s.every === "day" ? t("schedule.dailyAt", { time: `${pad(s.hour)}:${pad(s.minute)}` }) : t("schedule.everyN", { n: s.minutes });
  return routine.enabled ? when : t("schedule.paused", { when });
}
