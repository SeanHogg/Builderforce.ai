"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/chatError.ts
var chatError_exports = {};
__export(chatError_exports, {
  BrainRequestError: () => BrainRequestError,
  brainRequestError: () => brainRequestError,
  chatErrorAction: () => chatErrorAction
});
module.exports = __toCommonJS(chatError_exports);
var BrainRequestError = class extends Error {
  status;
  code;
  reason;
  unlock;
  requiredPlan;
  feature;
  constructor(message, init) {
    super(message);
    this.name = "BrainRequestError";
    this.status = init.status;
    this.code = init.code;
    this.reason = init.reason;
    this.unlock = init.unlock;
    this.requiredPlan = init.requiredPlan;
    this.feature = init.feature;
  }
};
function str(v) {
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function brainRequestError(status, body, statusText) {
  const b = body ?? {};
  const message = str(b.error) || str(b.message) || statusText || `Request failed (${status})`;
  return new BrainRequestError(message, {
    status,
    code: str(b.code),
    reason: str(b.reason),
    unlock: str(b.unlock),
    requiredPlan: str(b.requiredPlan),
    feature: str(b.feature)
  });
}
var AUTH_PROSE = /invalid or expired token|unauthor/i;
var CARD_PROSE = /validated card|add a card|card on file/i;
var UPGRADE_PROSE = /requires? a paid plan|upgrade to (pro|teams)|plan (token )?limit|not included in your plan/i;
function chatErrorAction(err) {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (err instanceof BrainRequestError) {
    const base = { requiredPlan: err.requiredPlan, feature: err.feature };
    if (err.status === 401) return { kind: "auth", ...base };
    if (err.unlock === "validate_card" || err.reason === "card_required") {
      return { kind: "validate_card", ...base };
    }
    if (err.unlock === "upgrade" || err.reason === "plan_required" || err.status === 402) {
      return { kind: "upgrade", ...base };
    }
    if (err.status === 429 && /plan_.*limit/.test(err.code ?? "")) {
      return { kind: "upgrade", ...base };
    }
  }
  if (!message) return null;
  if (AUTH_PROSE.test(message)) return { kind: "auth" };
  if (CARD_PROSE.test(message)) return { kind: "validate_card" };
  if (UPGRADE_PROSE.test(message)) return { kind: "upgrade" };
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BrainRequestError,
  brainRequestError,
  chatErrorAction
});
//# sourceMappingURL=chatError.cjs.map