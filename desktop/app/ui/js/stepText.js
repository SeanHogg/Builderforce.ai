// How a step reads to a person, in their language — ONE definition for recorded steps
// (review, live recording) and skill steps (runs, approvals). Rust keeps steps
// structured; the words are made here.
import { h } from "./bridge.js";
import { t } from "./i18n.js";

export function targetLabel(target) {
  if (!target) return "";
  const name = (target.name || "").trim() || (target.automationId || "").trim();
  return name || t("step.unnamed", { type: target.controlType || "?" });
}

/** One sentence for a recorded action or a skill action. */
export function stepText(action) {
  const field = targetLabel(action.target);
  switch (action.kind) {
    case "click":
      return t("step.click", { name: field });
    case "keys":
      return field ? t("step.keysIn", { keys: action.keys, name: field }) : t("step.keys", { keys: action.keys });
    case "setValue": {
      // A recorded step carries `value`/`secret`; a skill step carries `value.from`.
      if (action.secret) return t("step.setSecret", { name: field });
      if (typeof action.value === "string") return t("step.setValue", { name: field, value: action.value });
      if (action.value?.from === "param") return t("step.setParam", { name: field, param: action.value.name });
      return t("step.setValue", { name: field, value: action.value?.text ?? "" });
    }
    default:
      return action.kind;
  }
}

/** The window a step happened in, for context under the sentence. */
export function stepWhere(action) {
  const w = action.target?.windowTitle;
  return w ? t("step.inWindow", { window: w }) : "";
}

export function stepLine(action) {
  return h("div", { class: "step-text min0" }, h("span", { text: stepText(action) }), stepWhere(action) && h("span", { class: "muted small", text: stepWhere(action) }));
}
