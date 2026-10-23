// src/chatError.ts
var NOT_SIGNED_IN = "not_signed_in";
var NO_LOCAL_MODEL = "no_local_model";
var NO_SPECIFIC_MODEL = "no_specific_model";
var LOCAL_ENGINE_FAILURE_CODES = ["bfi_engine_crashed", "page_engine_detached", "model_keeps_crashing"];
var LOCAL_ENGINE_CODE_RE = new RegExp(`\\b(${LOCAL_ENGINE_FAILURE_CODES.join("|")})\\b`);
function localEngineCode(code, message) {
  if (code && LOCAL_ENGINE_FAILURE_CODES.includes(code)) return code;
  return LOCAL_ENGINE_CODE_RE.exec(message)?.[1];
}
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
  const nested = b.error && typeof b.error === "object" ? b.error : void 0;
  const message = str(b.error) || str(nested?.message) || str(b.message) || statusText || `Request failed (${status})`;
  return new BrainRequestError(message, {
    status,
    code: str(b.code) ?? str(nested?.code),
    reason: str(b.reason),
    unlock: str(b.unlock),
    requiredPlan: str(b.requiredPlan),
    feature: str(b.feature)
  });
}
var PLATFORM_CODE_RE = /\bplatform_(synchronize|gateway_inference|connected_feature|authenticate|model_download|direct_provider|external_mcp|git_remote|send)_disabled\b/;
var PLATFORM_SETTING = {
  synchronize: "synchronize",
  "gateway-inference": "inferenceMode",
  "connected-feature": "inferenceMode",
  authenticate: "inferenceMode",
  "model-download": "modelDownloads",
  "direct-provider": "directProviders",
  "external-mcp": "externalMcp",
  "git-remote": "gitRemotes",
  send: "inferenceMode"
};
function platformRefusal(err, message) {
  const fields = err && typeof err === "object" ? err : {};
  if (typeof fields.capability === "string" && fields.capability in PLATFORM_SETTING && fields.code === "PLATFORM_ACCESS_DENIED") {
    return fields.capability;
  }
  if (fields.code === "PLATFORM_SEND_DISABLED") return "send";
  const match = PLATFORM_CODE_RE.exec(message)?.[1];
  return match ? match.replaceAll("_", "-") : null;
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
  if (message === NOT_SIGNED_IN) return { kind: "sign_in" };
  if (message === NO_LOCAL_MODEL) return { kind: "no_local_model" };
  if (message === NO_SPECIFIC_MODEL) return { kind: "no_specific_model" };
  const engineCode = localEngineCode(err instanceof BrainRequestError ? err.code : void 0, message);
  if (engineCode) return { kind: "local_engine_failed", engineCode };
  const refused = platformRefusal(err, message);
  if (refused) return { kind: "platform_refused", capability: refused, setting: PLATFORM_SETTING[refused] };
  if (AUTH_PROSE.test(message)) return { kind: "auth" };
  if (CARD_PROSE.test(message)) return { kind: "validate_card" };
  if (UPGRADE_PROSE.test(message)) return { kind: "upgrade" };
  return null;
}

export {
  NOT_SIGNED_IN,
  NO_LOCAL_MODEL,
  NO_SPECIFIC_MODEL,
  LOCAL_ENGINE_FAILURE_CODES,
  BrainRequestError,
  brainRequestError,
  chatErrorAction
};
//# sourceMappingURL=chunk-O2ZJ2CSX.mjs.map