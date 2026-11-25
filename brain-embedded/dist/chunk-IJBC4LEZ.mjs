import {
  isClosedTaskStatus,
  liftProseAskUser,
  malformedCallOutcome,
  runAgentLoop,
  trimRepetitionLoop
} from "./chunk-3DTCUCDH.mjs";

// src/streamFailureDetail.ts
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
var seconds = (ms) => `${Math.round(ms / 1e3)}s`;
function describeStreamFailure(d) {
  const parts = [
    `destination ${d.destination.label} (${d.destination.host})`,
    d.phase === "headers" ? "no response headers" : "stream failed after headers",
    `after ${seconds(d.elapsedMs)}`,
    `request ${(d.requestBytes / 1024).toFixed(1)} KB`,
    `${d.messageCount} message${d.messageCount === 1 ? "" : "s"}`,
    `${d.toolCount} tool${d.toolCount === 1 ? "" : "s"}`
  ];
  if (d.bytesReceived !== void 0) parts.push(`${d.bytesReceived} B received`);
  if (d.credential) parts.push(`credential ${d.credential}`);
  return parts.join(" \xB7 ");
}

// ../packages/local-first/src/policy.ts
var LOCAL_FIRST_POLICY = Object.freeze({
  synchronize: false,
  gatewayInference: false,
  connectedFeatures: false,
  authenticate: false,
  modelDownloads: false,
  directProviders: false,
  externalMcp: false,
  gitRemotes: false
});

// ../packages/local-first/src/inferenceMode.ts
var INFERENCE_MODES = Object.freeze(["hybrid", "local-only", "specific"]);
function isInferenceMode(value) {
  return typeof value === "string" && INFERENCE_MODES.includes(value);
}
function defaultInferenceMode(context) {
  return context.signedIn ? "hybrid" : "local-only";
}

// ../packages/local-first/src/platformRoutes.ts
var PLATFORM_ROUTE_RULES = Object.freeze([
  { path: "/api/auth", match: "contains", capability: "authenticate", note: "token exchange and session" },
  { path: "/api/vscode/tenants/*/token", capability: "authenticate", note: "the editor's tenant token exchange" },
  { path: "/chat/completions", match: "contains", capability: "gateway-inference", content: true, note: "a gateway completion \u2014 the prompt" },
  { path: "/api/brain/stream", capability: "gateway-inference", content: true, note: "the Brain's streamed turn \u2014 the prompt" },
  { path: "/llm/v1/models", capability: "connected-feature", note: "the model catalog" },
  { path: "/api/llm/models", capability: "connected-feature", note: "the model catalog" },
  { path: "/api/limbic/block", capability: "connected-feature", content: true, note: "personality block \u2014 once per session; the per-turn affect is appraised on the device" },
  { path: "/api/limbic", match: "prefix", capability: "connected-feature", content: true, note: "the personality / affect store" },
  { path: "/api/projects/*/evermind/recall", capability: "connected-feature", content: true, note: "memory recall \u2014 a read that sends the prompt" },
  { path: "/api/projects/*/evermind", match: "contains", capability: "connected-feature", content: true, note: "a project's Evermind memory" },
  { path: "/api/evermind", match: "contains", capability: "connected-feature", content: true, note: "Evermind memory" },
  { path: "/api/sync", match: "prefix", capability: "synchronize", content: true, note: "the local-first sync transport \u2014 the records themselves" },
  // PRD 36: a signed-in editor BINDS its local chat to a server chat so the chat's
  // tickets, usage and memory land on it. The bind sends a title and a project — never
  // the transcript (that is `/messages`, below, and the sync transport above).
  { path: "/api/brain/chats", capability: "connected-feature", note: "binding a chat to the account \u2014 its title and project only" },
  { path: "/api/brain/chats/*/messages", content: true, note: "a Brain chat's transcript" },
  { path: "/api/chats/*/messages", content: true, note: "a chat's transcript" },
  { path: "/api/brain/upload", content: true, note: "an uploaded file" },
  { path: "/api/brain/fetch-url", content: true, note: "a page fetched for the Brain \u2014 the URL the person gave" },
  { path: "/product-report", match: "suffix", content: true, note: "an error report \u2014 what was on screen" },
  // Sockets that carry the person's content (an upgrade is a GET, so these keep the
  // read default): live canvas sync, rooms and meetings, an execution's stream, an
  // agent host's chat. A socket that only says "something changed" is not tagged.
  { path: "/api/creation-sessions/*/ws", content: true, note: "a canvas session's live sync" },
  { path: "/api/guest/rooms/*/ws", content: true, note: "a guest room's shared transcript and meeting" },
  { path: "/api/agile/ceremonies/rooms/*/ws", content: true, note: "a ceremony room's live conversation" },
  { path: "/api/meetings/rooms/*/ws", content: true, note: "a meeting room's signalling" },
  { path: "/api/runtime/executions/*/stream", content: true, note: "an execution's live stream \u2014 messages, tool results, file changes" },
  { path: "/api/agent-hosts/*/ws", content: true, note: "an agent host's chat" },
  { path: "/api/guest/research", match: "prefix", content: true, note: "a guest canvas's research call \u2014 the query" },
  { path: "/api/guest/career", match: "prefix", content: true, note: "a guest canvas's career tool \u2014 the r\xE9sum\xE9 / job text" },
  { path: "/search", match: "suffix", capability: "connected-feature", note: "a search \u2014 a read" },
  { path: "/api/dashboards/query", capability: "connected-feature", note: "a dashboard query \u2014 a read" },
  { path: "/api/data-sources/*/query", capability: "connected-feature", note: "a data-source query \u2014 a read" },
  { path: "/api/vscode/connect", capability: "connected-feature", note: "the editor presence beat" }
]);

// ../packages/local-first/src/entityId.ts
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var SYNC_ID_TEXT_RE = /^[1-9]\d*$/;
var TIER_REF_RE = /^([A-Za-z][\w-]*):(\S.*)$/;
function isLocalId(v) {
  return typeof v === "string" && UUID_RE.test(v);
}
function parseSyncId(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v !== "string" || !SYNC_ID_TEXT_RE.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}
function syncIdText(id) {
  return String(id);
}
function parseEntityRef(v) {
  if (typeof v === "number") {
    const sync = parseSyncId(v);
    return sync === null ? null : { sync };
  }
  if (typeof v === "string") {
    if (isLocalId(v)) return { local: v };
    const sync = parseSyncId(v);
    if (sync !== null) return { sync };
    const tier2 = TIER_REF_RE.exec(v);
    return tier2 ? { tier: { kind: tier2[1], ref: tier2[2] } } : null;
  }
  if (typeof v === "object" && v !== null) {
    const ref = v;
    if ("local" in ref) return isLocalId(ref.local) ? { local: ref.local } : null;
    if ("sync" in ref) {
      const sync = parseSyncId(ref.sync);
      return sync === null ? null : { sync };
    }
    if ("tier" in ref && typeof ref.tier === "object" && ref.tier !== null) {
      const { kind, ref: tierRef } = ref.tier;
      if (typeof kind === "string" && kind !== "" && typeof tierRef === "string" && tierRef !== "") {
        return { tier: { kind, ref: tierRef } };
      }
    }
  }
  return null;
}

// ../packages/local-first/src/records.ts
var CANVAS_ENTITY_TYPES = [
  "canvas-board",
  "canvas-object",
  "canvas-edge",
  "canvas-timeline",
  "canvas-media"
];
var UNBOUND_DESTINATION = { kind: "unbound" };
function destinationKey(destination) {
  if (destination.kind === "unbound") return "unbound";
  const parts = [
    destination.platformInstance ?? "",
    destination.accountId ?? "",
    destination.tenantId ?? "",
    destination.projectId ?? "",
    destination.repository ?? ""
  ];
  const raw = parts.join("\0");
  let key = DESTINATION_KEYS.get(raw);
  if (key === void 0) {
    key = parts.map(encodeURIComponent).join(":");
    if (DESTINATION_KEYS.size >= 1024) DESTINATION_KEYS.clear();
    DESTINATION_KEYS.set(raw, key);
  }
  return key;
}
var DESTINATION_KEYS = /* @__PURE__ */ new Map();

// ../packages/local-first/src/payloadHash.ts
function fnv1a32(text, seed = 2166136261) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function hashPayload(payload) {
  const text = JSON.stringify(payload) ?? "null";
  return `fnv1a:${fnv1a32(text).toString(16).padStart(8, "0")}`;
}

// ../packages/local-first/src/recordPayloadMarker.ts
var MARKER_NOT_BEFORE = "9999-12-31T23:59:59.999Z";
var RECORD_PAYLOAD_FENCE_KEY = "builderforce:record-payload-fence:v1";
var RECORD_PAYLOAD_FENCE_ID = "00000000-0000-4000-8000-00000000fe0c";
var RECORD_PAYLOAD_FENCE_REASON = "record_payload_fence";
var NULL_PAYLOAD_HASH = hashPayload(null);
function recordPayloadMarker() {
  return { payload: null, payloadFrom: "record", nextAttemptAt: MARKER_NOT_BEFORE };
}
function fencedDependsOn(dependsOn) {
  return dependsOn.includes(RECORD_PAYLOAD_FENCE_KEY) ? [...dependsOn] : [...dependsOn, RECORD_PAYLOAD_FENCE_KEY];
}
function isRecordPayloadFence(event) {
  return event.idempotencyKey === RECORD_PAYLOAD_FENCE_KEY;
}
function isRecordPayloadMarker(event) {
  if (event.payloadFrom === "record") return true;
  return event.materializedAt === void 0 && event.destination?.kind === "bound" && event.operation !== "delete" && event.payload === null && event.payloadHash === NULL_PAYLOAD_HASH;
}
async function ensureRecordPayloadFence(tx, destination) {
  const key = destinationKey(destination);
  const lookup = tx.pendingLookup?.();
  let present = false;
  if (lookup) {
    present = lookup.byKey(RECORD_PAYLOAD_FENCE_KEY).some((event) => destinationKey(event.destination) === key);
  } else {
    await tx.scanPending((event) => {
      if (isRecordPayloadFence(event)) present = true;
    }, destination);
  }
  if (present) return;
  const at2 = (/* @__PURE__ */ new Date()).toISOString();
  const fence = await tx.append({
    idempotencyKey: RECORD_PAYLOAD_FENCE_KEY,
    clientEntityId: RECORD_PAYLOAD_FENCE_ID,
    entityType: "policy-snapshot",
    operation: "create",
    schemaVersion: 1,
    occurredAt: at2,
    dependsOn: [],
    destination,
    payload: null
  });
  await tx.deadLetter(fence.eventId, RECORD_PAYLOAD_FENCE_REASON, at2);
}

// ../packages/local-first/src/recordIndex.ts
function defineRecordIndex(entityType, name, keyOf) {
  return Object.freeze({ entityType, name, keyOf });
}
function indexKeyOf(index, row) {
  if (row.deletedAt) return void 0;
  try {
    return index.keyOf(row);
  } catch {
    return void 0;
  }
}

// ../packages/local-first/src/storeContract.ts
var SCAN_STOP = /* @__PURE__ */ Symbol.for("builderforce.local-first.scan-stop");

// ../packages/local-first/src/clone.ts
function clone(value) {
  return structuredClone(value);
}

// ../packages/local-first/src/store.ts
async function selectRecords(tx, type, where) {
  const matches = [];
  await tx.scan(type, (row) => {
    if (!where || where(row)) matches.push(row);
  });
  return clone(matches);
}
async function scanByIndex(tx, index, key, visit) {
  if (tx.scanIndex) return tx.scanIndex(index, key, visit);
  return tx.scan(index.entityType, (row) => indexKeyOf(index, row) === key ? visit(row) : void 0);
}
function newLocalRecord(input) {
  const at2 = input.occurredAt ?? (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: input.id,
    entityType: input.entityType,
    schemaVersion: input.schemaVersion ?? 1,
    version: 1,
    destination: input.destination ?? UNBOUND_DESTINATION,
    occurredAt: at2,
    updatedAt: at2,
    payload: input.payload,
    provenance: { deviceId: input.deviceId, source: "local" }
  };
}

// ../packages/local-first/src/dependencyGraph.ts
var KNOWN_TYPES = /* @__PURE__ */ new Set([
  "project",
  "ticket",
  "chat",
  "message",
  "execution",
  "step",
  "approval",
  "audit-definition",
  "audit-run",
  "audit-finding",
  "change-set",
  "memory-fact",
  "attachment-manifest",
  "policy-snapshot",
  "remediation",
  "usage",
  "run-outcome",
  "chat-ticket-link",
  "run-delta",
  ...CANVAS_ENTITY_TYPES
]);
var bySequence = (a, b) => a.localSequence - b.localSequence;

// ../packages/local-first/src/pendingQueries.ts
async function scanPendingOfRow(tx, clientEntityId, visit, destination) {
  if (tx.scanPendingOf) return tx.scanPendingOf(clientEntityId, visit, destination);
  return tx.scanPending((event) => event.clientEntityId === clientEntityId ? visit(event) : void 0, destination);
}
async function selectPendingOf(tx, entityType, clientEntityId, where, destination) {
  const matches = [];
  await scanPendingOfRow(tx, clientEntityId, (event) => {
    if (event.deadLetter || event.entityType !== entityType) return;
    if (!where || where(event)) matches.push(event);
  }, destination);
  matches.sort(bySequence);
  return clone(matches);
}

// ../packages/local-first/src/domainToolClass.ts
var LOCAL_DOMAIN_TOOL_NAMES = Object.freeze([
  "project-create",
  "project-update",
  "project-move",
  "project-archive",
  "ticket-create",
  "ticket-update",
  "ticket-move",
  "ticket-archive",
  "ticket-delete",
  "memory-recall",
  "local-memory-recall",
  "audit-finding",
  "local-audit-finding"
]);
var CONNECTED_ONLY_DOMAIN_TOOL_NAMES = Object.freeze([
  "cloud-execution",
  "meeting-join",
  "remote-session-read"
]);
var LOCAL = new Set(LOCAL_DOMAIN_TOOL_NAMES);
var CONNECTED = new Set(CONNECTED_ONLY_DOMAIN_TOOL_NAMES);
var LOCAL_CLASS = Object.freeze({ mode: "local" });
var CONNECTED_CLASS = Object.freeze({ mode: "connected-only" });
var UNKNOWN_CLASS = Object.freeze({ mode: "unknown" });

// ../packages/local-first/src/journalCodec.ts
var MAGIC_BYTES = 5;
var JOURNAL_HEADER_BYTES = MAGIC_BYTES + 8;
var RESET_PREFIX = new TextEncoder().encode('{"reset":true');
var TABLES = (() => {
  const tables = new Int32Array(8 * 256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? c >>> 1 ^ 3988292384 : c >>> 1;
    tables[n] = c;
  }
  for (let n = 0; n < 256; n += 1) {
    let c = tables[n];
    for (let k = 1; k < 8; k += 1) {
      c = tables[c & 255] ^ c >>> 8;
      tables[k * 256 + n] = c;
    }
  }
  return tables;
})();

// ../packages/local-first/src/journalCompaction.ts
var DEFAULT_JOURNAL_COMPACTION = Object.freeze({
  maxFrames: 8192,
  maxBytes: 64 * 1024 * 1024
});
var DEFAULT_COMPACTION_FRAME = Object.freeze({
  maxBytes: 256 * 1024,
  maxRows: 500
});
var encoder = new TextEncoder();

// ../packages/local-first/src/creationDestination.ts
var LOCAL_CREATE_PATHS = Object.freeze([
  Object.freeze({
    id: "localWork.createProject",
    module: "localWork.ts",
    entry: "createLocalWork(store).createProject",
    writes: Object.freeze(["project"])
  }),
  Object.freeze({
    id: "localWork.createTicket",
    module: "localWork.ts",
    entry: "createLocalWork(store).createTicket",
    writes: Object.freeze(["ticket"])
  }),
  Object.freeze({
    id: "transactionalRecord.commit",
    module: "transactionalRecord.ts",
    entry: "createTransactionalRecordStore(options).commit",
    writes: Object.freeze(["project", "ticket", "chat", "audit-run", "execution"])
  }),
  Object.freeze({
    id: "hostChatRecord.ensureChat",
    module: "hostChatRecord.ts",
    entry: "createHostChatLog(store).appendTurn/appendRun/appendStep/appendApproval",
    writes: Object.freeze(["chat"])
  }),
  Object.freeze({
    id: "hostChatRecord.appendRun",
    module: "hostChatRecord.ts",
    entry: "createHostChatLog(store).appendRun",
    writes: Object.freeze(["execution"])
  }),
  Object.freeze({
    id: "localAudit.createLocalAuditFinding",
    module: "localAudit.ts",
    entry: "createLocalAuditFinding(store, input)",
    writes: Object.freeze(["audit-finding"])
  }),
  Object.freeze({
    id: "factProvenance.remember",
    module: "factProvenance.ts",
    entry: "createFactStore(store).remember",
    writes: Object.freeze(["memory-fact"])
  })
]);

// ../packages/local-first/src/journalRules.ts
var BOUND_ONLY_VERSION = 0;
var PAYLOAD_ON_DELETE = /* @__PURE__ */ new Set(["chat-ticket-link"]);
var importKey = (type, id) => `${type}:${id}:import`;
function isOwnRecord(row, deviceId) {
  return row.provenance?.source !== "imported" || row.provenance.deviceId === deviceId;
}
function isImported(mapping) {
  return mapping !== void 0 && mapping.serverVersion > BOUND_ONLY_VERSION;
}
function unboundMarker(record5, operation) {
  return { operation, ...unboundMarkerFields(record5.payload) };
}
function unboundMarkerFields(payload) {
  const text = JSON.stringify(payload) ?? "null";
  return { payloadSize: text.length, payloadHash: hashPayload(payload), payload: null };
}
async function dropPending(tx, record5) {
  const stale = await selectPendingOf(tx, record5.entityType, record5.id);
  if (stale.length > 0) await tx.acknowledge(stale.map((event) => event.eventId));
}
async function queueImport(tx, record5, chatClientId, waitsOn = []) {
  await dropPending(tx, record5);
  if (record5.deletedAt) return;
  if (record5.destination.kind === "bound") await ensureRecordPayloadFence(tx, record5.destination);
  await tx.append({
    idempotencyKey: importKey(record5.entityType, record5.id),
    clientEntityId: record5.id,
    entityType: record5.entityType,
    operation: "import",
    schemaVersion: record5.schemaVersion,
    occurredAt: record5.occurredAt,
    dependsOn: fencedDependsOn([...chatClientId && record5.entityType !== "chat" ? [importKey("chat", chatClientId)] : [], ...waitsOn]),
    destination: record5.destination,
    ...recordPayloadMarker()
  });
}
async function journalWrite(tx, record5, operation, options) {
  if (record5.destination.kind === "unbound") {
    await tx.append({
      idempotencyKey: options.key,
      clientEntityId: record5.id,
      entityType: record5.entityType,
      schemaVersion: record5.schemaVersion,
      occurredAt: record5.occurredAt,
      ...record5.baseVersion !== void 0 ? { baseVersion: record5.baseVersion } : {},
      dependsOn: options.dependsOn ?? [],
      destination: record5.destination,
      // The marker carries size + a content hash of the real payload, never the
      // payload itself; the record is the only copy while unbound (module comment).
      ...unboundMarker(record5, operation)
    });
    return;
  }
  const mapping = await tx.mapping(record5.entityType, record5.id, record5.destination);
  if (!isImported(mapping)) {
    await queueImport(tx, record5, options.chatClientId);
    return;
  }
  await dropPending(tx, record5);
  await tx.append({
    idempotencyKey: `${options.key}:server`,
    clientEntityId: record5.id,
    entityType: record5.entityType,
    operation,
    schemaVersion: record5.schemaVersion,
    occurredAt: record5.occurredAt,
    baseVersion: mapping.serverVersion,
    dependsOn: [],
    destination: record5.destination,
    payload: operation === "delete" && !PAYLOAD_ON_DELETE.has(record5.entityType) ? null : record5.payload
  });
}

// ../packages/local-first/src/holdLimits.ts
var SYNC_EVENT_RETENTION_DAYS = 90;
var DAY_MS = 24 * 60 * 60 * 1e3;
var HOLD_MAX_AGE_MS = 7 * DAY_MS;
var DEPENDENCY_PENDING_MAX_AGE_MS = SYNC_EVENT_RETENTION_DAYS * DAY_MS;
var HOLD_BACKOFF_CAP_MS = 60 * 60 * 1e3;

// ../packages/local-first/src/chatBindLease.ts
var CHAT_BIND_LEASE_MS = 12e4;
var leaseKey = (clientId) => `chatBind:${clientId}`;
var BIND_PENDING_HOLDER = "bind-pending";
var HOLDER_SEPARATOR = "#";
function parseLease(mark) {
  if (mark === void 0) return void 0;
  const cut = mark.indexOf(HOLDER_SEPARATOR);
  const since = Date.parse(cut === -1 ? mark : mark.slice(0, cut));
  if (!Number.isFinite(since)) return void 0;
  return cut === -1 ? { since } : { since, holder: mark.slice(cut + 1) };
}
var isLive = (since, at2) => Math.abs(at2 - since) < CHAT_BIND_LEASE_MS;
var isChatImport = (event) => event.entityType === "chat" && event.operation === "import";
async function liveChatBindHolder(tx, clientId, now) {
  const lease = parseLease(await tx.readMark(leaseKey(clientId)));
  return lease && isLive(lease.since, now.getTime()) ? lease.holder : void 0;
}
async function claimChatBind(tx, clientId, now, holder) {
  const sent = await selectPendingOf(tx, "chat", clientId, (event) => isChatImport(event) && !isRecordPayloadMarker(event));
  if (sent.length > 0) return false;
  const current = await liveChatBindHolder(tx, clientId, now);
  if (current !== void 0 && holder !== void 0 && current !== holder) return false;
  await tx.setReadMark(leaseKey(clientId), holder === void 0 ? now.toISOString() : `${now.toISOString()}${HOLDER_SEPARATOR}${holder}`);
  return true;
}
async function releaseChatBind(tx, clientId, holders) {
  const mark = await tx.readMark(leaseKey(clientId));
  if (!mark) return;
  if (holders !== void 0) {
    const held = parseLease(mark)?.holder;
    const mine = typeof holders === "string" ? [holders] : holders;
    if (held !== void 0 && !mine.includes(held)) return;
  }
  await tx.setReadMark(leaseKey(clientId), void 0);
}

// ../packages/local-first/src/tombstone.ts
var RESNAPSHOT = Object.freeze({ action: "resnapshot" });

// ../packages/local-first/src/chatTicketLink.ts
var TASK_TABLE_KINDS = /* @__PURE__ */ new Set(["task", "epic", "gap"]);

// ../packages/local-first/src/syncLease.ts
var DEFAULT_COORDINATOR_WORK_TIMEOUT_MS = 5 * 6e4;

// ../packages/local-first/src/redaction.ts
var INDEXEDDB_REDACTED_KEYS = [
  "token",
  "password",
  "authorization",
  "cookie",
  "apikey",
  "clientsecret"
];
var INDEXEDDB_REDACTION_RULE = `Only exportForUploadOrLog() output may be uploaded or logged. It strips every secret-shaped key at every depth \u2014 a key whose lowercase name is one of ${INDEXEDDB_REDACTED_KEYS.join(", ")} or contains token, secret, password, authorization, cookie, or apikey \u2014 so accessToken, client_secret and sessionCookie are stripped too. The strip is recursive through arrays and nested objects, the input is not mutated, and a dropped key is absent rather than blanked. export() is the unfiltered local record and must not leave the device.`;

// ../packages/local-first/src/httpSyncTransport.ts
var MAX_RETRY_AFTER_MS = 60 * 60 * 1e3;

// ../packages/local-first/src/applyServerCursor.ts
var RESNAPSHOT2 = Object.freeze({ resnapshotRequired: true });

// ../packages/spend-contract/src/cost.ts
var MILLICENTS_PER_USD = 1e5;
var MEDIAN_TURN_TOKENS = Object.freeze({ prompt: 6e3, completion: 400 });
function millicentsToUsd(millicents) {
  return Number(millicents ?? 0) / MILLICENTS_PER_USD;
}
var CACHE_READ_MULTIPLIER = 0.1;
var CACHE_CREATION_MULTIPLIER = 1.25;
function computeCostMillicents(pricing, usage) {
  if (!pricing) return 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheCreation = usage.cacheCreationTokens ?? 0;
  const fullPrompt = Math.max(0, usage.promptTokens - cacheRead - cacheCreation);
  const usd2 = fullPrompt * pricing.prompt + cacheRead * pricing.prompt * CACHE_READ_MULTIPLIER + cacheCreation * pricing.prompt * CACHE_CREATION_MULTIPLIER + usage.completionTokens * pricing.completion;
  return Math.round(usd2 * 1e5);
}

// ../packages/model-catalog/src/price.ts
var TOKENS_PER_MILLION = 1e6;
function perMillionToPerToken(usdPerMillion) {
  return usdPerMillion / TOKENS_PER_MILLION;
}
function perTokenToPerMillion(usdPerToken) {
  return usdPerToken * TOKENS_PER_MILLION;
}
var ZERO_PRICE = Object.freeze({ input: 0, output: 0 });

// ../packages/model-catalog/src/tier.ts
var UNKNOWN_TIER_RANK = 4;
var STRONGEST_FIRST = {
  ULTRA: 0,
  PREMIUM: 1,
  STANDARD: 2,
  FREE: 3
};
function tierRank(tier2) {
  return tier2 && tier2 in STRONGEST_FIRST ? STRONGEST_FIRST[tier2] : UNKNOWN_TIER_RANK;
}
var STANDARD_MAX_OUTPUT_PER_MILLION = 8;
var PREMIUM_MAX_OUTPUT_PER_MILLION = 20;
function tierForPrice(price) {
  if (price.input === 0 && price.output === 0) return "FREE";
  const outputPerMillion = perTokenToPerMillion(price.output);
  if (outputPerMillion < STANDARD_MAX_OUTPUT_PER_MILLION) return "STANDARD";
  return outputPerMillion < PREMIUM_MAX_OUTPUT_PER_MILLION ? "PREMIUM" : "ULTRA";
}
function resolveModelTier(known) {
  if (known.catalogTier) return known.catalogTier;
  return known.price ? tierForPrice(known.price) : void 0;
}
var AGENTIC_TIERS = /* @__PURE__ */ new Set(["PREMIUM", "ULTRA"]);
function isAgenticTier(tier2) {
  return tier2 ? AGENTIC_TIERS.has(tier2) : void 0;
}

// ../packages/model-catalog/src/priceTiers.ts
var tier = (aboveInputTokens, inputPerMillion, outputPerMillion) => ({
  aboveInputTokens,
  input: perMillionToPerToken(inputPerMillion),
  output: perMillionToPerToken(outputPerMillion)
});
var PRICE_TIERS = Object.freeze({
  // Google AI Studio / Vertex list price: $1.25 / $10 per M up to 200K prompt tokens,
  // $2.50 / $15 above (ai.google.dev/gemini-api/docs/pricing). Verify against vendor pricing page.
  "gemini-2-5-pro": [tier(2e5, 2.5, 15)],
  // Anthropic long-context pricing for the 1M-window Sonnet 4 / 4.5: $3 / $15 per M up
  // to 200K input, $6 / $22.50 above (docs.claude.com pricing, "long context").
  // Verify against vendor pricing page.
  "claude-sonnet-4": [tier(2e5, 6, 22.5)],
  "claude-sonnet-4-5": [tier(2e5, 6, 22.5)],
  // Claude Haiku 5.5: $0.10 / $0.50 per M for prompts up to 100K, $0.50 / $2.50 beyond
  // (Anthropic model pricing table, 2026-10). Verify against vendor pricing page.
  "claude-haiku-5-5": [tier(1e5, 0.5, 2.5)]
});
function priceTierFamily(modelId) {
  let id = (modelId ?? "").trim().toLowerCase();
  id = id.slice(id.lastIndexOf("/") + 1);
  id = id.replace(/^(?:[a-z]{2,3}\.)?anthropic\./, "");
  id = id.replace(/:.*$/, "");
  id = id.replace(/\./g, "-");
  id = id.replace(/-\d{8}(?:-v\d+)?$/, "");
  return id;
}
function priceTiersFor(modelId) {
  return PRICE_TIERS[priceTierFamily(modelId)];
}
function priceTierBoundary(modelId) {
  const tiers = priceTiersFor(modelId);
  return tiers && tiers.length > 0 ? Math.min(...tiers.map((t) => t.aboveInputTokens)) : void 0;
}
function withPriceTiers(modelId, price) {
  const tiers = price.priceTiers ?? priceTiersFor(modelId);
  return tiers ? { ...price, priceTiers: tiers } : price;
}

// ../packages/model-catalog/src/priceBook.ts
function directCatalogId(model) {
  return model.startsWith("direct/") ? model.slice("direct/".length).toLowerCase() : void 0;
}
function catalogPriceId(model) {
  return model.startsWith("openrouter/") ? model.slice("openrouter/".length) : model;
}
function listPriceOf(book2, model) {
  return book2.listPriceOf ? book2.listPriceOf(model) : book2.priceOf(model);
}
function priceBookFromPrices(prices) {
  const byId = /* @__PURE__ */ new Map();
  const byLowerId = /* @__PURE__ */ new Map();
  for (const [id, price] of prices) {
    byId.set(id, price);
    byLowerId.set(id.toLowerCase(), price);
  }
  const priceOf = (model) => byId.get(catalogPriceId(model));
  return {
    priceOf,
    listPriceOf: (model) => {
      const direct = directCatalogId(model);
      return priceOf(model) ?? (direct ? byLowerId.get(direct) : void 0);
    }
  };
}

// ../packages/model-catalog/src/generated/priceSnapshot.ts
var PRICE_SNAPSHOT = {
  "~anthropic/claude-fable-latest": [8e-6, 4e-5],
  "~anthropic/claude-haiku-latest": [1e-7, 5e-7],
  "~anthropic/claude-opus-latest": [4e-6, 2e-5],
  "~anthropic/claude-sonnet-latest": [2e-6, 1e-5],
  "~deepseek/deepseek-flash-latest": [3e-8, 2e-7],
  "~deepseek/deepseek-pro-latest": [999e-10, 5e-6],
  "~deepseek/deepseek-v4-flash-latest": [44e-9, 132e-9],
  "~google/gemini-flash-latest": [15e-7, 75e-7],
  "~google/gemini-pro-latest": [2e-6, 1e-5],
  "~moonshotai/kimi-latest": [1824e-10, 110055e-10],
  "~openai/gpt-astra-latest": [8e-6, 4e-5],
  "~openai/gpt-luna-latest": [1e-7, 5e-7],
  "~openai/gpt-mini-latest": [75e-8, 45e-7],
  "~openai/gpt-sol-latest": [2e-6, 1e-5],
  "~openai/gpt-terra-latest": [1e-6, 5e-6],
  "~unbiased/pareto-latest": [8e-7, 32e-7],
  "~x-ai/grok-latest": [2e-6, 6e-6],
  "~z-ai/glm-flash-latest": [356e-10, 815e-10],
  "~z-ai/glm-latest": [699e-10, 14e-7],
  "aion-labs/aion-2.0": [8e-7, 16e-7],
  "aion-labs/aion-3.0": [3e-6, 6e-6],
  "aion-labs/aion-3.0-mini": [7e-7, 14e-7],
  "aion-labs/aion-3.5": [3e-6, 6e-6],
  "aion-labs/aion-3.5-mini": [7e-7, 14e-7],
  "aion-labs/aion-rp-llama-3.1-8b": [8e-7, 16e-7],
  "amazon/nova-2-lite-v1": [3e-7, 25e-7],
  "amazon/nova-lite-v1": [6e-8, 24e-8],
  "amazon/nova-micro-v1": [35e-9, 14e-8],
  "amazon/nova-premier-v1": [25e-7, 125e-7],
  "amazon/nova-pro-v1": [8e-7, 32e-7],
  "anthracite-org/magnum-v4-72b": [25e-7, 5e-6],
  "anthropic/claude-fable-5": [1e-5, 5e-5],
  "anthropic/claude-fable-5:batch": [5e-6, 25e-6],
  "anthropic/claude-fable-5.1": [1e-5, 5e-5],
  "anthropic/claude-fable-5.1:batch": [5e-6, 25e-6],
  "anthropic/claude-fable-5.2": [8e-6, 4e-5],
  "anthropic/claude-fable-5.2:batch": [4e-6, 2e-5],
  "anthropic/claude-haiku-4.5": [1e-6, 5e-6],
  "anthropic/claude-haiku-4.5:batch": [5e-7, 25e-7],
  "anthropic/claude-haiku-5.5": [1e-7, 5e-7],
  "anthropic/claude-haiku-5.5:batch": [5e-8, 25e-8],
  "anthropic/claude-opus-4.1": [15e-6, 75e-6],
  "anthropic/claude-opus-4.1:batch": [75e-7, 375e-7],
  "anthropic/claude-opus-4.5": [5e-6, 25e-6],
  "anthropic/claude-opus-4.5:batch": [25e-7, 125e-7],
  "anthropic/claude-opus-4.6": [5e-6, 25e-6],
  "anthropic/claude-opus-4.6:batch": [25e-7, 125e-7],
  "anthropic/claude-opus-4.7": [5e-6, 25e-6],
  "anthropic/claude-opus-4.7:batch": [25e-7, 125e-7],
  "anthropic/claude-opus-4.8": [5e-6, 25e-6],
  "anthropic/claude-opus-4.8:batch": [25e-7, 125e-7],
  "anthropic/claude-opus-5": [5e-6, 25e-6],
  "anthropic/claude-opus-5:batch": [25e-7, 125e-7],
  "anthropic/claude-opus-5.5": [4e-6, 2e-5],
  "anthropic/claude-opus-5.5:batch": [2e-6, 1e-5],
  "anthropic/claude-sonnet-4.5": [3e-6, 15e-6],
  "anthropic/claude-sonnet-4.5:batch": [15e-7, 75e-7],
  "anthropic/claude-sonnet-4.6": [3e-6, 15e-6],
  "anthropic/claude-sonnet-4.6:batch": [15e-7, 75e-7],
  "anthropic/claude-sonnet-5": [2e-6, 1e-5],
  "anthropic/claude-sonnet-5:batch": [1e-6, 5e-6],
  "anthropic/claude-sonnet-5.5": [2e-6, 1e-5],
  "anthropic/claude-sonnet-5.5:batch": [1e-6, 5e-6],
  "baidu/ernie-5.5-flash-preview:free": [0, 0],
  "baidu/ernie-light-dt-1.0-intl": [113e-8, 394e-8],
  "bytedance-seed/seed-2-1-turbo": [5e-7, 25e-7],
  "bytedance-seed/seed-2.0-lite": [25e-8, 2e-6],
  "bytedance-seed/seed-2.0-mini": [1e-7, 4e-7],
  "bytedance/ui-tars-1.5-7b": [1e-7, 2e-7],
  "cognitivecomputations/dolphin-mistral-24b-venice-edition": [2e-7, 9e-7],
  "cohere/command-a": [25e-7, 1e-5],
  "cohere/command-a-plus": [3e-7, 15e-7],
  "cohere/command-r-08-2024": [15e-8, 6e-7],
  "cohere/command-r-plus-08-2024": [25e-7, 1e-5],
  "cohere/command-r7b-12-2024": [375e-10, 15e-8],
  "deepseek/deepseek-chat": [2574e-10, 10287e-10],
  "deepseek/deepseek-chat-v3-0324": [25e-8, 1e-6],
  "deepseek/deepseek-chat-v3.1": [25e-8, 95e-8],
  "deepseek/deepseek-r1-0528": [571e-9, 2286e-9],
  "deepseek/deepseek-v3.1-terminus": [27e-8, 1e-6],
  "deepseek/deepseek-v3.2": [26e-8, 38e-8],
  "deepseek/deepseek-v3.2-exp": [27e-8, 41e-8],
  "deepseek/deepseek-v4-flash": [9e-8, 18e-8],
  "deepseek/deepseek-v4-flash-0731": [443e-10, 3e-7],
  "deepseek/deepseek-v4-flash-0731:batch": [48e-9, 144e-9],
  "deepseek/deepseek-v4-flash-vision-exp": [2156e-10, 6468e-10],
  "deepseek/deepseek-v4-pro": [128e-8, 256e-8],
  "deepseek/deepseek-v4-pro-0813": [111e-9, 444e-8],
  "deepseek/deepseek-v4.1-flash": [498e-10, 1992e-10],
  "deepseek/deepseek-v4.1-flash-1017": [3e-8, 2e-7],
  "deepseek/deepseek-v4.1-flash-1017:batch": [35e-9, 149e-9],
  "deepseek/deepseek-v4.1-flash:batch": [5e-8, 15e-8],
  "dots-studio/dots-3-note-preview:free": [0, 0],
  "elorian/glimpse": [6e-7, 3e-6],
  "fireworks/ember-1": [3e-6, 15e-6],
  "google/gemini-2.5-flash": [3e-7, 25e-7],
  "google/gemini-2.5-flash-image": [3e-7, 25e-7],
  "google/gemini-2.5-flash-lite": [1e-7, 4e-7],
  "google/gemini-2.5-pro": [125e-8, 1e-5],
  "google/gemini-2.5-pro-preview": [125e-8, 1e-5],
  "google/gemini-3-flash-preview": [5e-7, 3e-6],
  "google/gemini-3-flash-preview:batch": [25e-8, 15e-7],
  "google/gemini-3-pro-image": [2e-6, 12e-6],
  "google/gemini-3-pro-image-preview": [2e-6, 12e-6],
  "google/gemini-3.1-flash-image": [5e-7, 3e-6],
  "google/gemini-3.1-flash-image-preview": [5e-7, 3e-6],
  "google/gemini-3.1-flash-lite": [25e-8, 15e-7],
  "google/gemini-3.1-flash-lite-image": [25e-8, 15e-7],
  "google/gemini-3.1-flash-lite-preview": [25e-8, 15e-7],
  "google/gemini-3.1-flash-lite:batch": [125e-9, 75e-8],
  "google/gemini-3.1-pro-preview": [2e-6, 12e-6],
  "google/gemini-3.1-pro-preview-customtools": [2e-6, 12e-6],
  "google/gemini-3.1-pro-preview:batch": [1e-6, 6e-6],
  "google/gemini-3.5-flash": [15e-7, 9e-6],
  "google/gemini-3.5-flash-lite": [3e-7, 25e-7],
  "google/gemini-3.5-flash-lite:batch": [15e-8, 125e-8],
  "google/gemini-3.5-flash:batch": [75e-8, 45e-7],
  "google/gemini-3.6-flash": [75e-8, 375e-8],
  "google/gemini-3.6-flash:batch": [375e-9, 1875e-9],
  "google/gemini-3.7-flash": [75e-8, 375e-8],
  "google/gemini-3.7-flash:batch": [375e-9, 1875e-9],
  "google/gemini-3.8-flash": [825e-9, 4125e-9],
  "google/gemini-3.8-flash:batch": [375e-9, 1875e-9],
  "google/gemini-4-argon": [2e-6, 1e-5],
  "google/gemini-4-argon:batch": [1e-6, 5e-6],
  "google/gemini-4-carbon": [2e-6, 1e-5],
  "google/gemini-4-carbon:batch": [1e-6, 5e-6],
  "google/gemini-4-hydrogen": [15e-7, 75e-7],
  "google/gemini-4-hydrogen:batch": [75e-8, 375e-8],
  "google/gemini-4-neon": [3e-6, 15e-6],
  "google/gemini-4-neon:batch": [15e-7, 75e-7],
  "google/gemini-nano-banana-2.1": [15e-7, 75e-7],
  "google/gemini-omni-1.1-flash": [15e-7, 9e-6],
  "google/gemini-omni-1.2-flash": [15e-7, 9e-6],
  "google/gemma-2-27b-it": [65e-8, 65e-8],
  "google/gemma-3-12b-it": [5e-8, 15e-8],
  "google/gemma-3-27b-it": [8e-8, 16e-8],
  "google/gemma-3-4b-it": [4e-8, 5e-8],
  "google/gemma-4-26b-a4b-it": [765e-10, 255e-9],
  "google/gemma-4-26b-a4b-it:free": [0, 0],
  "google/gemma-4-31b-it": [2e-7, 4e-7],
  "google/gemma-4-31b-it:free": [0, 0],
  "google/lyria-3-clip-preview": [0, 0],
  "google/lyria-3-pro-preview": [0, 0],
  "gryphe/mythomax-l2-13b": [3e-7, 5e-7],
  "ibm-granite/granite-4.2-8b": [6e-8, 15e-8],
  "inclusionai/ling-3.0-flash": [6e-8, 18e-8],
  "inclusionai/ling-3.0-flash-vl": [6e-8, 18e-8],
  "inclusionai/ling-3.0-tiny": [15e-9, 45e-9],
  "inclusionai/ling-3.1-flash": [75e-9, 225e-9],
  "inclusionai/ling-3.2-flash:free": [0, 0],
  "inference-net/schematron-v2-small": [5e-8, 23e-8],
  "inference-net/schematron-v2-turbo": [3e-8, 15e-8],
  "kt/midm-k-3.0-pro": [2e-7, 8e-7],
  "liquid/lfm-2.5-24b-a2b": [5e-8, 7e-7],
  "liquid/lfm-3-1.7b": [8e-8, 2e-7],
  "liquid/lfm-3-1.7b:free": [0, 0],
  "mancer/weaver": [3e-7, 5e-7],
  "meta-llama/llama-3.1-70b-instruct": [72e-8, 72e-8],
  "meta-llama/llama-3.1-8b-instruct": [5e-8, 8e-8],
  "meta-llama/llama-3.2-3b-instruct": [5e-8, 33e-8],
  "meta-llama/llama-3.3-70b-instruct": [71e-8, 71e-8],
  "meta-llama/llama-4-maverick": [35e-8, 1e-6],
  "meta-llama/llama-4-scout": [1e-7, 3e-7],
  "meta-llama/llama-guard-4-12b": [18e-8, 18e-8],
  "meta/muse-ember": [1e-7, 5e-7],
  "meta/muse-glimmer-30b": [35e-8, 15e-7],
  "meta/muse-glimmer-30b:batch": [24e-8, 96e-8],
  "meta/muse-spark-1.1": [125e-8, 425e-8],
  "meta/muse-spark-1.2": [125e-8, 425e-8],
  "meta/muse-spark-1.2-contributor": [1e-7, 2e-7],
  "meta/muse-spark-1.3": [125e-8, 425e-8],
  "meta/muse-spark-1.3-contributor": [1e-7, 2e-7],
  "meta/muse-spark-open": [125e-8, 425e-8],
  "meta/muse-wonder": [4e-6, 2e-5],
  "microsoft/phi-4": [7e-8, 14e-8],
  "minimax/minimax-m2.5": [27e-8, 95e-8],
  "minimax/minimax-m2.7": [6e-7, 18e-7],
  "minimax/minimax-m3": [3e-7, 12e-7],
  "minimax/minimax-m3:batch": [224e-9, 88e-8],
  "minimax/minimax-m3.1-flash": [15e-8, 6e-7],
  "mistralai/codestral-2508": [3e-7, 9e-7],
  "mistralai/devstral-2512": [4e-7, 2e-6],
  "mistralai/ministral-14b-2512": [2e-7, 2e-7],
  "mistralai/ministral-3b-2512": [1e-7, 1e-7],
  "mistralai/ministral-8b-2512": [15e-8, 15e-8],
  "mistralai/mistral-large": [2e-6, 6e-6],
  "mistralai/mistral-large-2407": [2e-6, 6e-6],
  "mistralai/mistral-large-2512": [5e-7, 15e-7],
  "mistralai/mistral-large-4-0": [7e-7, 21e-7],
  "mistralai/mistral-medium-3": [44e-8, 22e-7],
  "mistralai/mistral-medium-3-5": [15e-7, 75e-7],
  "mistralai/mistral-medium-3-5:batch": [75e-8, 375e-8],
  "mistralai/mistral-medium-3.1": [44e-8, 22e-7],
  "mistralai/mistral-nemo": [29e-9, 3e-8],
  "mistralai/mistral-saba": [2e-7, 6e-7],
  "mistralai/mistral-small-24b-instruct-2501": [5e-8, 8e-8],
  "mistralai/mistral-small-2603": [15e-8, 6e-7],
  "mistralai/mistral-small-3.1-24b-instruct": [351e-9, 555e-9],
  "mistralai/mistral-small-3.2-24b-instruct": [75e-9, 2e-7],
  "mistralai/mixtral-8x22b-instruct": [2e-6, 6e-6],
  "mistralai/pixtral-large-2502": [2e-6, 6e-6],
  "mistralai/voxtral-small-24b-2507": [1e-7, 3e-7],
  "moondream/moondream3-preview": [3e-7, 25e-7],
  "moondream/moondream3.1-9b-a2b": [3e-7, 25e-7],
  "moonshotai/kimi-k2-0905": [6e-7, 25e-7],
  "moonshotai/kimi-k2.5": [5e-7, 25e-7],
  "moonshotai/kimi-k2.6": [65e-8, 341e-8],
  "moonshotai/kimi-k2.7-code": [6e-7, 3e-6],
  "moonshotai/kimi-k3": [192e-9, 16e-6],
  "moonshotai/kimi-k3:batch": [228e-8, 114e-7],
  "moonshotai/kimi-k3.1-pro": [2403e-10, 84023e-10],
  "moonshotai/kimi-k3.1-pro:batch": [372e-9, 5583e-9],
  "morph/morph-v3-fast": [8e-7, 12e-7],
  "morph/morph-v3-fast:batch": [4e-7, 6e-7],
  "morph/morph-v3-large": [9e-7, 19e-7],
  "morph/morph-v3-large:batch": [45e-8, 95e-8],
  "motif-technologies/motif-3": [3e-7, 12e-7],
  "nex-agi/nex-n2.5-mini": [25e-9, 1e-7],
  "nex-agi/nex-n2.5-pro": [75e-9, 25e-8],
  "nex-agi/nex-n2.6": [12e-8, 4e-7],
  "nousresearch/hermes-4-405b": [1e-6, 3e-6],
  "nvidia/nemotron-3-nano-30b-a3b": [6e-8, 24e-8],
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": [0, 0],
  "nvidia/nemotron-3-super-120b-a12b": [75e-9, 4e-7],
  "nvidia/nemotron-3-ultra-550b-a55b": [5e-7, 22e-7],
  "nvidia/nemotron-3-ultra-550b-a55b:free": [0, 0],
  "nvidia/nemotron-3.5-content-safety": [2e-7, 2e-7],
  "nvidia/nemotron-3.5-lightning": [5e-8, 2e-7],
  "nvidia/nemotron-3.5-lightning:free": [0, 0],
  "nvidia/nemotron-3.5-super-vl": [15e-8, 47e-8],
  "nvidia/nemotron-3.5-super-vl:free": [0, 0],
  "nvidia/switchyard": [0, 0],
  "openai/gpt-3.5-turbo-0613": [1e-6, 2e-6],
  "openai/gpt-3.5-turbo-16k": [3e-6, 4e-6],
  "openai/gpt-4": [3e-5, 6e-5],
  "openai/gpt-4-turbo:batch": [5e-6, 15e-6],
  "openai/gpt-4.1": [2e-6, 8e-6],
  "openai/gpt-4.1-mini": [4e-7, 16e-7],
  "openai/gpt-4.1-mini:batch": [2e-7, 8e-7],
  "openai/gpt-4.1-nano": [1e-7, 4e-7],
  "openai/gpt-4.1-nano:batch": [5e-8, 2e-7],
  "openai/gpt-4.1:batch": [1e-6, 4e-6],
  "openai/gpt-4o": [25e-7, 1e-5],
  "openai/gpt-4o-2024-05-13": [5e-6, 15e-6],
  "openai/gpt-4o-2024-08-06": [25e-7, 1e-5],
  "openai/gpt-4o-2024-11-20": [25e-7, 1e-5],
  "openai/gpt-4o-mini": [15e-8, 6e-7],
  "openai/gpt-4o-mini-2024-07-18": [15e-8, 6e-7],
  "openai/gpt-4o-mini:batch": [75e-9, 3e-7],
  "openai/gpt-4o:batch": [125e-8, 5e-6],
  "openai/gpt-5": [125e-8, 1e-5],
  "openai/gpt-5-image": [1e-5, 1e-5],
  "openai/gpt-5-image-mini": [25e-7, 2e-6],
  "openai/gpt-5-mini": [25e-8, 2e-6],
  "openai/gpt-5-mini:batch": [125e-9, 1e-6],
  "openai/gpt-5-nano": [5e-8, 4e-7],
  "openai/gpt-5-nano:batch": [25e-9, 2e-7],
  "openai/gpt-5-pro": [15e-6, 12e-5],
  "openai/gpt-5-pro:batch": [75e-7, 6e-5],
  "openai/gpt-5:batch": [625e-9, 5e-6],
  "openai/gpt-5.1": [125e-8, 1e-5],
  "openai/gpt-5.1-codex": [125e-8, 1e-5],
  "openai/gpt-5.1-codex-max": [125e-8, 1e-5],
  "openai/gpt-5.1-codex-mini": [25e-8, 2e-6],
  "openai/gpt-5.1:batch": [625e-9, 5e-6],
  "openai/gpt-5.2": [175e-8, 14e-6],
  "openai/gpt-5.2-chat": [175e-8, 14e-6],
  "openai/gpt-5.2-codex": [175e-8, 14e-6],
  "openai/gpt-5.2-pro": [21e-6, 168e-6],
  "openai/gpt-5.2-pro:batch": [105e-7, 84e-6],
  "openai/gpt-5.2:batch": [875e-9, 7e-6],
  "openai/gpt-5.3-codex": [175e-8, 14e-6],
  "openai/gpt-5.4": [25e-7, 15e-6],
  "openai/gpt-5.4-image-2": [8e-6, 15e-6],
  "openai/gpt-5.4-mini": [75e-8, 45e-7],
  "openai/gpt-5.4-mini:batch": [375e-9, 225e-8],
  "openai/gpt-5.4-nano": [2e-7, 125e-8],
  "openai/gpt-5.4-nano:batch": [1e-7, 625e-9],
  "openai/gpt-5.4-pro": [3e-5, 18e-5],
  "openai/gpt-5.4-pro:batch": [15e-6, 9e-5],
  "openai/gpt-5.4:batch": [125e-8, 75e-7],
  "openai/gpt-5.5": [5e-6, 3e-5],
  "openai/gpt-5.5-pro": [3e-5, 18e-5],
  "openai/gpt-5.5-pro:batch": [15e-6, 9e-5],
  "openai/gpt-5.5:batch": [25e-7, 15e-6],
  "openai/gpt-5.6-luna": [2e-7, 12e-7],
  "openai/gpt-5.6-luna-pro": [2e-7, 12e-7],
  "openai/gpt-5.6-luna-pro:batch": [1e-7, 6e-7],
  "openai/gpt-5.6-luna:batch": [1e-7, 6e-7],
  "openai/gpt-5.6-sol": [4e-6, 2e-5],
  "openai/gpt-5.6-sol-pro": [4e-6, 2e-5],
  "openai/gpt-5.6-sol-pro:batch": [2e-6, 1e-5],
  "openai/gpt-5.6-sol:batch": [2e-6, 1e-5],
  "openai/gpt-5.6-terra": [2e-6, 12e-6],
  "openai/gpt-5.6-terra-pro": [2e-6, 12e-6],
  "openai/gpt-5.6-terra-pro:batch": [1e-6, 6e-6],
  "openai/gpt-5.6-terra:batch": [1e-6, 6e-6],
  "openai/gpt-6-astra": [1e-5, 5e-5],
  "openai/gpt-6-astra-pro": [1e-5, 5e-5],
  "openai/gpt-6-astra-pro:batch": [5e-6, 25e-6],
  "openai/gpt-6-astra:batch": [5e-6, 25e-6],
  "openai/gpt-6-luna": [1e-7, 5e-7],
  "openai/gpt-6-luna-pro": [1e-7, 5e-7],
  "openai/gpt-6-luna-pro:batch": [5e-8, 25e-8],
  "openai/gpt-6-luna:batch": [5e-8, 25e-8],
  "openai/gpt-6-sol": [2e-6, 1e-5],
  "openai/gpt-6-sol-pro": [2e-6, 1e-5],
  "openai/gpt-6-sol-pro:batch": [1e-6, 5e-6],
  "openai/gpt-6-sol:batch": [1e-6, 5e-6],
  "openai/gpt-6.1-sol": [2e-6, 1e-5],
  "openai/gpt-6.1-sol-pro": [2e-6, 1e-5],
  "openai/gpt-6.1-sol-pro:batch": [1e-6, 5e-6],
  "openai/gpt-6.1-sol:batch": [1e-6, 5e-6],
  "openai/gpt-6.1-terra": [1e-6, 5e-6],
  "openai/gpt-6.1-terra-pro": [1e-6, 5e-6],
  "openai/gpt-6.1-terra-pro:batch": [5e-7, 25e-7],
  "openai/gpt-6.1-terra:batch": [5e-7, 25e-7],
  "openai/gpt-6.2-astra": [8e-6, 4e-5],
  "openai/gpt-6.2-astra-pro": [8e-6, 4e-5],
  "openai/gpt-6.2-astra-pro:batch": [4e-6, 2e-5],
  "openai/gpt-6.2-astra:batch": [4e-6, 2e-5],
  "openai/gpt-6.2-sol": [2e-6, 1e-5],
  "openai/gpt-6.2-sol-pro": [2e-6, 1e-5],
  "openai/gpt-6.2-sol-pro:batch": [1e-6, 5e-6],
  "openai/gpt-6.2-sol:batch": [1e-6, 5e-6],
  "openai/gpt-audio": [25e-7, 1e-5],
  "openai/gpt-audio-mini": [6e-7, 24e-7],
  "openai/gpt-chat-latest": [5e-6, 3e-5],
  "openai/gpt-oss-120b": [5e-8, 25e-8],
  "openai/gpt-oss-120b:batch": [296e-10, 136e-9],
  "openai/gpt-oss-20b": [3e-8, 13e-8],
  "openai/gpt-oss-20b:batch": [24e-9, 112e-9],
  "openai/gpt-oss-safeguard-20b": [75e-9, 3e-7],
  "openai/o3": [2e-6, 8e-6],
  "openai/o3-mini:batch": [55e-8, 22e-7],
  "openai/o3-pro": [2e-5, 8e-5],
  "openai/o3:batch": [1e-6, 4e-6],
  "openai/o4-mini:batch": [55e-8, 22e-7],
  "openrouter/auto": [0, 0],
  "openrouter/auto-beta": [0, 0],
  "openrouter/auto-code": [0, 0],
  "openrouter/bodybuilder": [0, 0],
  "openrouter/free": [0, 0],
  "openrouter/fusion": [0, 0],
  "openrouter/pareto-code": [0, 0],
  "particle-ai/particle-1": [7e-8, 5e-7],
  "particle-ai/particle-1:free": [0, 0],
  "perceptron/perceptron-mk1": [15e-8, 15e-7],
  "perceptron/perceptron-mk1.5": [15e-8, 15e-7],
  "perplexity/sonar": [1e-6, 1e-6],
  "perplexity/sonar-deep-research": [2e-6, 8e-6],
  "perplexity/sonar-pro": [3e-6, 15e-6],
  "perplexity/sonar-pro-search": [3e-6, 15e-6],
  "perplexity/sonar-reasoning-pro": [2e-6, 8e-6],
  "prism-ml/ternary-bonsai-2-27b": [75e-9, 5e-7],
  "prism-ml/ternary-bonsai-2-9b": [8e-8, 13e-8],
  "qwen/qwen-2.5-72b-instruct": [36e-8, 4e-7],
  "qwen/qwen-2.5-coder-32b-instruct": [66e-8, 1e-6],
  "qwen/qwen-plus": [26e-8, 78e-8],
  "qwen/qwen2.5-vl-72b-instruct": [8e-7, 1e-6],
  "qwen/qwen3-14b": [12e-8, 24e-8],
  "qwen/qwen3-235b-a22b-2507": [14e-8, 8e-7],
  "qwen/qwen3-235b-a22b-thinking-2507": [45e-8, 35e-7],
  "qwen/qwen3-30b-a3b": [12e-8, 5e-7],
  "qwen/qwen3-30b-a3b-instruct-2507": [1e-7, 3e-7],
  "qwen/qwen3-32b": [8e-8, 28e-8],
  "qwen/qwen3-coder": [3e-7, 1e-6],
  "qwen/qwen3-coder-30b-a3b-instruct": [7e-8, 28e-8],
  "qwen/qwen3-coder-flash": [195e-9, 975e-9],
  "qwen/qwen3-coder-next": [12e-8, 8e-7],
  "qwen/qwen3-next-80b-a3b-instruct": [1e-7, 11e-7],
  "qwen/qwen3-vl-235b-a22b-instruct": [21e-8, 19e-7],
  "qwen/qwen3-vl-30b-a3b-instruct": [15e-8, 6e-7],
  "qwen/qwen3-vl-8b-instruct": [25e-8, 75e-8],
  "qwen/qwen3.5-122b-a10b": [26e-8, 208e-8],
  "qwen/qwen3.5-27b": [26e-8, 26e-7],
  "qwen/qwen3.5-35b-a3b": [14e-8, 1e-6],
  "qwen/qwen3.5-397b-a17b": [45e-8, 3e-6],
  "qwen/qwen3.5-9b": [17e-8, 25e-8],
  "qwen/qwen3.5-flash-02-23": [65e-9, 26e-8],
  "qwen/qwen3.5-plus-02-15": [26e-8, 156e-8],
  "qwen/qwen3.5-plus-20260420": [3e-7, 18e-7],
  "qwen/qwen3.6-27b": [32e-8, 32e-7],
  "qwen/qwen3.6-35b-a3b": [5e-8, 7e-7],
  "qwen/qwen3.6-flash": [1875e-10, 1125e-9],
  "qwen/qwen3.6-plus": [325e-9, 195e-8],
  "qwen/qwen3.7-flash": [3e-8, 13e-8],
  "qwen/qwen3.7-max": [1475e-9, 4425e-9],
  "qwen/qwen3.7-plus": [32e-8, 128e-8],
  "qwen/qwen3.7-plus:batch": [23e-8, 92e-8],
  "qwen/qwen3.8-2.4t-a95b": [2e-6, 6e-6],
  "qwen/qwen3.8-27b": [35e-9, 15e-7],
  "qwen/qwen3.8-27b:batch": [16e-8, 2e-6],
  "qwen/qwen3.8-flash": [15e-8, 47e-8],
  "qwen/qwen3.8-max-0902": [2e-6, 6e-6],
  "qwen/qwen3.8-max-0902:batch": [115e-8, 345e-8],
  "qwen/qwen3.8-max-prime": [4e-6, 12e-6],
  "qwen/qwen3.8-omni-flash": [15e-8, 47e-8],
  "qwen/qwen4-max": [1425e-9, 4275e-9],
  "radixark/daisyrose-27b": [15e-8, 1875e-9],
  "recursive/flint-v1.0:free": [0, 0],
  "reflection/beam-1.0-501b-a23b": [25e-8, 1e-6],
  "rekaai/reka-edge": [1e-7, 1e-7],
  "rekaai/reka-flash-3": [1e-7, 2e-7],
  "relace/relace-apply-3": [85e-8, 125e-8],
  "relace/relace-search": [1e-6, 3e-6],
  "ricursiveai/ripple-65b-preview": [1e-7, 3e-7],
  "sakana/fugu-max": [2e-6, 6e-6],
  "sakana/fugu-ultra": [5e-6, 3e-5],
  "sakana/fugu-ultra-v2": [5e-6, 3e-5],
  "sakana/sakana-namazu": [95e-8, 4e-6],
  "sao10k/l3-lunaris-8b": [4e-8, 5e-8],
  "sao10k/l3.1-euryale-70b": [85e-8, 85e-8],
  "scaledown/extract": [4e-8, 0],
  "scaledown/summarize": [4e-8, 0],
  "stepfun/step-3.7-flash": [2e-7, 115e-8],
  "stepfun/step-5-preview": [1e-6, 27e-7],
  "tencent/hy-mt2-1.8b": [44e-9, 177e-9],
  "tencent/hy-mt2-30b-a3b": [74e-9, 295e-9],
  "tencent/hy-mt2-7b": [74e-9, 295e-9],
  "tencent/hy3": [132e-9, 528e-9],
  "tencent/hy4": [417e-9, 12505e-10],
  "tencent/hy4-flash": [35e-9, 1405e-10],
  "tencent/hy4-preview": [834e-9, 2501e-9],
  "thedrummer/cydonia-24b-v4.1": [3e-7, 5e-7],
  "thedrummer/skyfall-36b-v2": [55e-8, 8e-7],
  "thedrummer/unslopnemo-12b": [4e-7, 4e-7],
  "thinkingmachines/inkling": [1e-6, 405e-8],
  "thinkingmachines/inkling-2-mini": [75e-9, 3e-7],
  "thinkingmachines/inkling-2-small": [3e-7, 1e-6],
  "thinkingmachines/inkling-small": [45e-8, 12e-7],
  "thinkingmachines/inkling-small:batch": [36e-8, 96e-8],
  "typesafe/jev-router": [0, 0],
  "unbiased/pareto-26.10": [8e-7, 32e-7],
  "unbiased/pareto-26.10-preview": [8e-7, 32e-7],
  "unbiased/pareto-26.9": [25e-7, 75e-7],
  "undi95/remm-slerp-l2-13b": [3e-7, 5e-7],
  "upstage/solar-mini4": [5e-8, 2e-7],
  "upstage/solar-pro4": [15e-8, 6e-7],
  "writer/palmyra-x5": [6e-7, 6e-6],
  "x-ai/grok-4.20": [125e-8, 25e-7],
  "x-ai/grok-4.20-multi-agent": [125e-8, 25e-7],
  "x-ai/grok-4.3": [125e-8, 25e-7],
  "x-ai/grok-4.3:batch": [1e-6, 2e-6],
  "x-ai/grok-4.5": [2e-6, 6e-6],
  "x-ai/grok-4.6": [2e-6, 6e-6],
  "x-ai/grok-4.6:batch": [16e-7, 48e-7],
  "x-ai/grok-4.7": [2e-6, 6e-6],
  "x-ai/grok-4.7:batch": [16e-7, 48e-7],
  "xiaomi/mimo-v2.5": [4e-7, 2e-6],
  "xiaomi/mimo-v2.6-flash": [14e-8, 28e-8],
  "xiaomi/mimo-v2.6-pro": [435e-9, 87e-8],
  "xiaomi/mimo-v2.6-pro-ultraspeed": [435e-8, 87e-7],
  "z-ai/glm-4.5": [6e-7, 22e-7],
  "z-ai/glm-4.5-air": [13e-8, 85e-8],
  "z-ai/glm-4.5v": [6e-7, 18e-7],
  "z-ai/glm-4.6": [5e-7, 2e-6],
  "z-ai/glm-4.6v": [3e-7, 9e-7],
  "z-ai/glm-4.7": [6e-7, 22e-7],
  "z-ai/glm-4.7-flash": [605e-10, 4e-7],
  "z-ai/glm-5": [1e-6, 32e-7],
  "z-ai/glm-5-turbo": [12e-7, 4e-6],
  "z-ai/glm-5.1": [14e-7, 44e-7],
  "z-ai/glm-5.2": [62e-8, 242e-8],
  "z-ai/glm-5.2:batch": [322e-9, 989e-9],
  "z-ai/glm-5.3": [699e-10, 14e-7],
  "z-ai/glm-5.3-flash": [12e-8, 38e-8],
  "z-ai/glm-5.3-flash:batch": [23e-9, 68e-9],
  "z-ai/glm-5.3-flashx": [37e-8, 125e-8],
  "z-ai/glm-5.3-flashx-legal": [37e-8, 125e-8],
  "z-ai/glm-5.3-prime": [168e-8, 528e-8],
  "z-ai/glm-5.3:batch": [28e-8, 1249e-9],
  "z-ai/glm-5v-turbo": [12e-7, 4e-6]
};

// ../packages/model-catalog/src/snapshotPriceBook.ts
var book;
function snapshotPriceBook() {
  book ??= priceBookFromPrices(
    Object.entries(PRICE_SNAPSHOT).map(([id, [input, output]]) => [id, withPriceTiers(id, { input, output })])
  );
  return book;
}

// ../packages/model-catalog/src/anthropic.ts
var ANTHROPIC_RELEASES = {
  opus: ["5.5", "5", "4.8", "4.7", "4.6", "4.5", "4.1", "4.0"],
  sonnet: ["5.5", "5", "4.6", "4.5", "4.0"],
  haiku: ["5.5", "4.5"],
  fable: ["5.1", "5"]
};
var CLAUDE_ID = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:([-.])(\d{1,2})(?=-|$))?(-.*)?$/;
function parseAnthropicModelId(id) {
  const match = CLAUDE_ID.exec(id.trim().toLowerCase());
  if (!match) {
    return void 0;
  }
  return {
    family: match[1],
    version: [Number(match[2]), Number(match[4] ?? 0)],
    separator: match[3] === "." ? "." : "-",
    suffix: match[5] ?? ""
  };
}

// ../packages/model-catalog/src/weakerModel.ts
function catalogIdCandidates(model) {
  const ids2 = [model];
  const claude = parseAnthropicModelId(model.slice(model.lastIndexOf("/") + 1));
  if (claude) {
    const [major, minor] = claude.version;
    ids2.push(`anthropic/claude-${claude.family}-${major}.${minor}`);
    if (minor === 0) ids2.push(`anthropic/claude-${claude.family}-${major}`);
  }
  return ids2;
}
function tierOfModel(model, book2 = snapshotPriceBook()) {
  if (!model || model === "default") return void 0;
  for (const id of catalogIdCandidates(model)) {
    const price = listPriceOf(book2, id);
    if (price) return resolveModelTier({ price });
  }
  return void 0;
}
function isWeakerModel(requested, served, book2 = snapshotPriceBook()) {
  const asked = tierOfModel(requested, book2);
  const got = tierOfModel(served, book2);
  return asked !== void 0 && got !== void 0 && tierRank(got) > tierRank(asked);
}

// ../packages/model-catalog/src/providers.ts
var LLM_PROVIDER_INFO = [
  { id: "anthropic", label: "Anthropic (Claude)", credential: "api_key", keyPlaceholder: "sk-ant-\u2026", subscription: "paste", signInDomains: ["claude.ai", "anthropic.com"] },
  { id: "openai", label: "OpenAI", credential: "api_key", keyPlaceholder: "sk-\u2026", subscription: "paste", signInDomains: ["openai.com"] },
  { id: "google", label: "Google (Gemini)", credential: "api_key", keyPlaceholder: "AIza\u2026", subscription: null },
  { id: "meta", label: "Meta AI (MUSE)", credential: "api_key", keyPlaceholder: "meta-\u2026", subscription: null },
  // A Kimi Code subscription issues no API key at all — its own config leaves `api_key`
  // empty beside an OAuth record — so it connects by device-code redirect, never paste.
  { id: "kimi", label: "Kimi", credential: "api_key", keyPlaceholder: "sk-\u2026", subscription: "device", signInDomains: ["kimi.ai", "kimi.com"] },
  { id: "moonshot", label: "Moonshot AI", credential: "api_key", keyPlaceholder: "sk-\u2026", subscription: null },
  { id: "qwen", label: "Qwen", credential: "api_key", keyPlaceholder: "sk-\u2026", subscription: null },
  { id: "minimax", label: "MiniMax", credential: "api_key", keyPlaceholder: "sk-\u2026", subscription: null },
  { id: "xai", label: "xAI (Grok)", credential: "api_key", keyPlaceholder: "xai-\u2026", subscription: "paste", signInDomains: ["x.ai"] },
  { id: "ollama", label: "Ollama Cloud", credential: "api_key", keyPlaceholder: "sk-\u2026", subscription: null },
  {
    id: "ollama-local",
    label: "Ollama",
    credential: "local_runtime",
    keyPlaceholder: "",
    subscription: null,
    localRuntime: { defaultBaseUrl: "http://127.0.0.1:11434", exampleModel: "llama3.1:8b" }
  },
  // FreeToken's engine default; it serves whatever model the tenant loaded, so no example.
  {
    id: "freetoken",
    label: "FreeToken",
    credential: "local_runtime",
    keyPlaceholder: "",
    subscription: null,
    localRuntime: { defaultBaseUrl: "http://127.0.0.1:1919" }
  }
];
var LLM_PROVIDERS = LLM_PROVIDER_INFO.map((p) => p.id);
var INFO_BY_ID = new Map(LLM_PROVIDER_INFO.map((p) => [p.id, p]));

// ../packages/spend-contract/src/fold.ts
var AVOIDED_SOURCES = /* @__PURE__ */ new Set(["memory_answer", "evermind_answer", "response_cache", "deterministic"]);
var LOCAL_MODEL_SOURCE = "local_model";
function addSaving(acc, source, mc, tokens, events, estimated) {
  if (tokens === 0 && mc === 0) return;
  const key = `${source}:${estimated ? "e" : "m"}`;
  const prev = acc.get(key) ?? { source, mc: 0, tokens: 0, events: 0, estimated };
  acc.set(key, { ...prev, mc: prev.mc + mc, tokens: prev.tokens + tokens, events: prev.events + events });
}
function savedFrom(acc, spentUsd) {
  let measuredMc = 0;
  let estimatedMc = 0;
  let tokensSaved = 0;
  const bySource = [];
  for (const v of acc.values()) {
    if (v.estimated) estimatedMc += v.mc;
    else measuredMc += v.mc;
    tokensSaved += v.tokens;
    bySource.push({ source: v.source, usd: millicentsToUsd(v.mc), tokens: v.tokens, events: v.events, estimated: v.estimated });
  }
  bySource.sort((a, b) => b.usd - a.usd);
  const saved = {
    measuredUsd: millicentsToUsd(measuredMc),
    estimatedUsd: millicentsToUsd(estimatedMc),
    netUsd: millicentsToUsd(measuredMc + estimatedMc),
    tokensSaved: Math.max(0, tokensSaved),
    bySource
  };
  const denom = spentUsd + Math.max(0, saved.netUsd);
  return { saved, savedPct: denom > 0 ? Math.max(0, saved.netUsd) / denom : null };
}
function foldSpendSavings(slices, book2) {
  const spend = {
    platformUsd: 0,
    yourKeyUsd: 0,
    totalUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    unpricedTokens: 0,
    requests: 0
  };
  let platformMc = 0;
  let yourKeyMc = 0;
  const acc = /* @__PURE__ */ new Map();
  for (const g of slices) {
    if (g.savingsSource && AVOIDED_SOURCES.has(g.savingsSource)) {
      addSaving(acc, g.savingsSource, g.savedCostMc, g.savedPrompt + g.savedCompletion, g.rows, g.savingsEstimated);
      continue;
    }
    spend.promptTokens += g.prompt;
    spend.completionTokens += g.completion;
    spend.cacheReadTokens += g.cacheRead;
    spend.totalTokens += g.total;
    spend.requests += g.calls;
    if (g.savingsSource === LOCAL_MODEL_SOURCE) {
      addSaving(acc, LOCAL_MODEL_SOURCE, g.savedCostMc, g.savedPrompt + g.savedCompletion, g.calls, true);
      continue;
    }
    platformMc += g.costMc;
    const price = listPriceOf(book2, g.model);
    const pricing = price ? { prompt: price.input, completion: price.output } : void 0;
    if (g.unpriced) spend.unpricedTokens += g.total;
    else if (g.byo && pricing) {
      yourKeyMc += computeCostMillicents(pricing, {
        promptTokens: g.prompt,
        completionTokens: g.completion,
        totalTokens: g.total,
        cacheReadTokens: g.cacheRead,
        cacheCreationTokens: g.cacheCreation
      });
    }
    if (pricing && !g.unpriced) {
      addSaving(acc, "context_trim", Math.round(g.savedPrompt * pricing.prompt * 1e5), g.savedPrompt, g.trimCalls, true);
      addSaving(acc, "recall_overhead", -Math.round(g.recallPrompt * pricing.prompt * 1e5), -g.recallPrompt, g.recallCalls, true);
      const net = (g.cacheRead * (1 - CACHE_READ_MULTIPLIER) - g.cacheCreation * (CACHE_CREATION_MULTIPLIER - 1)) * pricing.prompt;
      addSaving(acc, "prompt_cache", Math.round(net * 1e5), g.cacheRead, g.cacheCalls, false);
    } else {
      addSaving(acc, "context_trim", 0, g.savedPrompt, g.trimCalls, true);
      addSaving(acc, "recall_overhead", 0, -g.recallPrompt, g.recallCalls, true);
    }
  }
  spend.platformUsd = millicentsToUsd(platformMc);
  spend.yourKeyUsd = millicentsToUsd(yourKeyMc);
  spend.totalUsd = millicentsToUsd(platformMc + yourKeyMc);
  return { spend, ...savedFrom(acc, spend.totalUsd) };
}
function combineSpendSavings(a, b) {
  const sum = (k) => a.spend[k] + b.spend[k];
  const spend = {
    platformUsd: sum("platformUsd"),
    yourKeyUsd: sum("yourKeyUsd"),
    totalUsd: sum("totalUsd"),
    promptTokens: sum("promptTokens"),
    completionTokens: sum("completionTokens"),
    cacheReadTokens: sum("cacheReadTokens"),
    totalTokens: sum("totalTokens"),
    unpricedTokens: sum("unpricedTokens"),
    requests: sum("requests"),
    ...a.spend.estimated || b.spend.estimated ? { estimated: true } : {}
  };
  const acc = /* @__PURE__ */ new Map();
  for (const row of [...a.saved.bySource, ...b.saved.bySource]) {
    addSaving(acc, row.source, Math.round(row.usd * 1e5), row.tokens, row.events, row.estimated);
  }
  return { spend, ...savedFrom(acc, spend.totalUsd) };
}

// ../packages/spend-contract/src/runBudget.ts
var RUN_BUDGET_WARN_AT = 0.8;
var capOf = (n) => typeof n === "number" && Number.isFinite(n) ? n : null;
function runBudgetBreach(caps, usage) {
  const spendCap = capOf(caps.maxSpendMillicents);
  if (spendCap != null && usage.spendMillicents >= spendCap) return { kind: "spend", used: usage.spendMillicents, cap: spendCap };
  const tokenCap = capOf(caps.maxTokens);
  const tokens = usage.tokens ?? 0;
  if (tokenCap != null && tokens >= tokenCap) return { kind: "tokens", used: tokens, cap: tokenCap };
  return null;
}
function runBudgetUsedShare(caps, usage) {
  const spend = caps.maxSpendMillicents ? usage.spendMillicents / caps.maxSpendMillicents : 0;
  const tokens = caps.maxTokens ? (usage.tokens ?? 0) / caps.maxTokens : 0;
  return Math.max(spend, tokens);
}
function runBudgetWarnDue(caps, usage) {
  return runBudgetUsedShare(caps, usage) >= RUN_BUDGET_WARN_AT;
}

// ../packages/spend-contract/src/index.ts
var USAGE_SURFACES = ["web", "vsix", "on_prem", "cloud", "sdk", "rovr"];
function isUsageSurface(raw) {
  return typeof raw === "string" && USAGE_SURFACES.includes(raw);
}
var USAGE_SURFACE_HEADER = "x-builderforce-surface";

// src/provenance.ts
var PROVENANCE_META_KEY = "provenance";
function asProvenanceAccount(value) {
  return value === "own" || value === "shared" || value === "shared_byo_unused" ? value : void 0;
}
function isConnectedAccountUnused(prov) {
  return prov?.account === "shared_byo_unused";
}
function parseMessageProvenance(msg) {
  if (!msg.metadata) return null;
  try {
    const p = JSON.parse(msg.metadata).provenance;
    if (p && typeof p.model === "string" && p.model.length > 0) {
      const ev = p.evermind;
      const evermind = ev && typeof ev.version === "number" && ev.version >= 1 ? { version: ev.version } : void 0;
      const account = asProvenanceAccount(p.account);
      const requestedModel = typeof p.requestedModel === "string" && p.requestedModel && p.requestedModel !== p.model ? p.requestedModel : void 0;
      return {
        model: p.model,
        ...account ? { account } : {},
        ...typeof p.vendor === "string" ? { vendor: p.vendor } : {},
        ...evermind ? { evermind } : {},
        ...requestedModel ? { requestedModel } : {}
      };
    }
  } catch {
  }
  return null;
}
function lastServedModel(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const prov = parseMessageProvenance(messages[i]);
    if (prov) return prov.model;
  }
  return void 0;
}
function withProvenanceMetadata(provenance, base) {
  const meta = { ...base ?? {} };
  if (provenance) meta[PROVENANCE_META_KEY] = provenance;
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : void 0;
}
function formatAssistantTranscriptHeading(assistantName, message) {
  const prov = parseMessageProvenance(message);
  if (!prov?.model) return `## ${assistantName}`;
  if (prov.requestedModel) return `## ${assistantName} \xB7 ${prov.model} (requested ${prov.requestedModel})`;
  return `## ${assistantName} \xB7 ${prov.model}`;
}

// src/stoppedTurn.ts
var STOPPED_TURN_META_KEY = "stoppedByUser";
var STOPPED_TURN_STEP = "agent.stopped";
function stoppedTurnMetadata(source) {
  const account = asProvenanceAccount(source.account);
  const provenance = source.model ? { model: source.model, ...account ? { account } : {} } : null;
  return withProvenanceMetadata(provenance, { [STOPPED_TURN_META_KEY]: true }) ?? "{}";
}
var STOPPED_BEFORE_START_META_KEY = "stoppedBeforeStart";
var flagged = (msg, key) => {
  if (!msg.metadata) return false;
  try {
    return JSON.parse(msg.metadata)?.[key] === true;
  } catch {
    return false;
  }
};
function isStoppedTurn(msg) {
  return flagged(msg, STOPPED_TURN_META_KEY);
}
function isStoppedBeforeStart(msg) {
  return flagged(msg, STOPPED_BEFORE_START_META_KEY);
}
function stoppedBeforeStartRow() {
  return { role: "assistant", content: "Stopped before it started.", metadata: JSON.stringify({ [STOPPED_TURN_META_KEY]: true, [STOPPED_BEFORE_START_META_KEY]: true }) };
}

// src/types.ts
function serverChatIdOf(chat) {
  if (!chat) return null;
  const bound = parseSyncId(chat.serverId);
  if (bound != null) return bound;
  return chat.origin === "local" ? null : chat.id;
}
var STEP_MESSAGE_ROLE = "tool";
function isStepMessage(m) {
  return m.role === STEP_MESSAGE_ROLE;
}
function attachEvermindLearn(messages, outcome) {
  if (!outcome) return messages;
  return messages.map((m) => m.role === "assistant" ? { ...m, evermindLearn: outcome } : m);
}
function formatEvermindLearnStep(outcome) {
  if (!outcome) return null;
  const targets = outcome.targets;
  if (targets && targets.length > 0) {
    const label = (t) => `${t.name} (proj #${t.projectId}${t.version ? ` v${t.version}` : ""})`;
    const learned = targets.filter((t) => t.learned);
    const skipped2 = targets.filter((t) => !t.learned && t.reason && t.reason !== "too-short");
    const parts = [];
    if (learned.length > 0) parts.push(`Contributed this turn to ${learned.map(label).join(", ")}`);
    for (const t of skipped2) {
      const why = t.reason === "not-seeded" ? "not set up yet" : t.reason === "frozen" ? "frozen (read-only)" : String(t.reason);
      parts.push(`skipped ${label(t)} \u2014 ${why}`);
    }
    return parts.length > 0 ? `\u{1F9E0} ${parts.join("; ")}.` : null;
  }
  if (outcome.learned) return `\u{1F9E0} Contributed this turn to the project Evermind (v${outcome.version}).`;
  switch (outcome.reason) {
    case "not-attached":
      return "\u{1F9E0} Not learned this turn \u2014 this chat isn't attached to a project, so it can't train a project Evermind.";
    case "not-seeded":
      return "\u{1F9E0} Not learned this turn \u2014 this project's Evermind isn't set up yet.";
    case "frozen":
      return "\u{1F9E0} Not learned this turn \u2014 this project's Evermind is frozen (read-only).";
    default:
      return null;
  }
}

// ../packages/agent-stall/src/classifyRequest.ts
function hasExplicitQuestionIntent({ intent, signals }) {
  return intent === "question" && (signals.questionLead || signals.questionMark || signals.researchLead);
}
var CHANGE_VERBS = "add|change|fix|update|reduce|increase|remove|delete|rename|refactor|implement|create|build|make|move|set|wire|migrate|replace|adjust|enable|disable|improve|write|edit|apply|correct|resolve|shrink|expand|hide|show|bump|revert|restore|install|upgrade|downgrade|rewrite|extract|split|merge|convert|port";
var CHANGE_VERB = new RegExp(`\\b(${CHANGE_VERBS})\\b`, "i");
var REPORT_OBJECTS = "summary|report|findings|notes|overview|write-?up|answer|explanation|list|table|recommendations?";
var CHANGE_VERB_AIMED = new RegExp(
  `\\b(${CHANGE_VERBS})\\b(?!\\s+(me|us)\\b|\\s+(up\\s+)?((a|an|the|your|me|us|my)\\s+)?(short\\s+|brief\\s+)?(${REPORT_OBJECTS})\\b)`,
  "i"
);
var FINISH_OBJECT = "(complete|finish|finali[sz]e)\\s+(the|this|that|these|those|it|my|our|your|all|implementation|work|task|change)\\b";
var FINISH_ORDER = new RegExp(`^\\s*(please\\s+)?(now\\s+)?${FINISH_OBJECT}`, "i");
var CHAINED_FINISH = new RegExp(`(\\band|\\bthen|[,.;])\\s+((also|then|please|now)\\s+)*${FINISH_OBJECT}`, "i");
var RESUMES_WORK = /^\s*(please\s+)?(now\s+)?(continue|resume|carry on with|pick up)\b[^?\n]{0,80}\b(work|tasks?|tickets?|implementation|changes?|items?|threads?)\b/i;
var INTERROGATIVE = /^\s*(what|why|how|where|when|which|who|is|are|was|were|does|do|did|should|would|will)\b/i;
var DO_WORK_ORDER = /^\s*(please\s+)?do\s+(?:(?:the|these|those|both|all)\s+)?(?:[\w-]+\s+){0,3}(?:work|tasks?|tickets?|changes?|items?|steps?|slices?)\s*[.!]?\s*$/i;
var REQUEST_MODAL = /^\s*(can|could)\b/i;
var QUESTION_LEADS = [
  /\bis this something (?:we|you) want\b/i,
  /\bshould we\b/i,
  /\bdo we want\b/i,
  /\bwhat do you think\b/i,
  /\bworth doing\b/i,
  /\breview\b[^?]{0,120}[;,—–-]\s*(?:is|are|should|do|does|can|would|will)\b[^?]{0,120}\?/i
];
var RESEARCH_LEAD = /^\s*(explain|describe|summar\w*|tell me|show me|list|compare|review|analyse|analyze|research|investigate|find|locate|trace|audit|look into|search)\b/i;
var CHAINED_CHANGE = new RegExp(
  `(\\band|\\bthen|[,.;])\\s+((also|then|please|now)\\s+)*(${CHANGE_VERBS})\\b(?!\\s+(me|us)\\b|\\s+(up\\s+)?((a|an|the|your|me|us|my)\\s+)?(short\\s+|brief\\s+)?(${REPORT_OBJECTS})\\b)`,
  "i"
);
var POINTS_BELOW = /\b(below|the following|as follows)\b|\bthis\b/i;
var ASK_HEAD_CHARS = 600;
var CONTINUATION = /^\s*(?:ok(?:ay)?[,\s]*)?(?:please\s+)?(?:now\s+)?(?:just\s+)?(?:go\s+ahead|carry\s+on|keep\s+going|make\s+it\s+so|do\s+it|do\s+that|do\s+so|fix\s+it|fix\s+that|apply\s+it|apply\s+that|apply|fix|go|proceed|continue|yes|yep|yeah|y|sure|confirm(?:ed)?|approved?|ship\s+it|send\s+it|run\s+it|do\s+the\s+fix|make\s+the\s+change)\s*[.!]*\s*$/i;
var MAX_CONTINUATION_CHARS = 40;
function isContinuationText(text) {
  const t = text.trim();
  return !!t && t.length <= MAX_CONTINUATION_CHARS && CONTINUATION.test(t);
}
function splitAskAndContext(text) {
  const t = text.trim();
  const blank = t.search(/\n[ \t]*\n/);
  if (blank > 0) {
    const lead = t.slice(0, blank).trim();
    if (/[?:]\s*$/.test(lead) || POINTS_BELOW.test(lead)) {
      return { ask: lead, context: t.slice(blank).trim() };
    }
  }
  return { ask: t, context: "" };
}
function classifyRequest(text) {
  const { ask, context } = splitAskAndContext(text ?? "");
  const head = ask.slice(0, ASK_HEAD_CHARS);
  const interrogative = INTERROGATIVE.test(head);
  const modal = REQUEST_MODAL.test(head);
  const questionMark = /\?\s*$/.test(ask);
  const lead = QUESTION_LEADS.some((re) => re.test(head));
  const researchLead = RESEARCH_LEAD.test(head);
  const chainedChange = CHAINED_CHANGE.test(head) || CHAINED_FINISH.test(head);
  const finishOrder = FINISH_ORDER.test(head);
  const resumesWork = RESUMES_WORK.test(head);
  const changeVerb = CHANGE_VERB.test(head);
  const aimedAtUs = CHANGE_VERB_AIMED.test(head) || chainedChange || finishOrder;
  const continuation = isContinuationText(ask);
  const signals = {
    questionLead: interrogative || modal || lead,
    questionMark,
    researchLead,
    chainedChange,
    changeVerb,
    finishOrder,
    resumesWork,
    continuation,
    askSplit: context.length > 0
  };
  const verdict = (intent) => ({ intent, ask, context, signals });
  if (!ask) return verdict("question");
  if (continuation) return verdict("change");
  if (resumesWork) return verdict("change");
  if (DO_WORK_ORDER.test(ask)) return verdict("change");
  if (researchLead) return verdict(chainedChange ? "change" : "question");
  if (interrogative) return verdict("question");
  if (lead) return verdict(aimedAtUs ? "change" : "question");
  if (modal || questionMark) return verdict(aimedAtUs ? "change" : "question");
  return verdict(changeVerb || finishOrder || chainedChange ? "change" : "question");
}

// ../packages/agent-stall/src/requestIntent.ts
function asksForChange(text) {
  return classifyRequest(text).intent === "change";
}
var NOTHING_DONE = /\b(nothing (has been|was|is) (changed|modified|applied|edited|written|saved)|no (changes?|edits?) (have been|were|was) (made|applied|written|saved)|(not|never) (yet )?(been )?(applied|written|saved|committed)|has not been (changed|applied|modified)|before (applying|making) the edit)\b/i;
var DEFERRED_PROMISE = /\b(re-?run me|run me again|ask me again|in a follow-?up|next run|on the next turn|say the word|let me know and I'?ll|I'?ll (then )?(apply|make|write|implement|create|edit|fix|update|do|proceed|carry)|I will (then )?(apply|make|write|implement|create|edit|fix|update|proceed))\b/i;
var BUDGET_EXHAUSTED = /\b(tool-?call budget|step budget|iteration (cap|limit|budget)|ran out of (tool calls|steps|budget)|hit (the|my) (tool|step|budget))\b/i;
function promisesUnfinishedWork(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  return NOTHING_DONE.test(t) || DEFERRED_PROMISE.test(t) || BUDGET_EXHAUSTED.test(t);
}
function isContinuationDirective(text) {
  return isContinuationText(text ?? "");
}
var CURRENT_STATE = /^\s*(?:(?:so|ok(?:ay)?|and|hey)[,\s]+)?(?:(?:what(?:'s| is) )?(?:the )?(?:current |latest )?(?:status|progress|update|updates|news|eta|state of (?:play|things))\b|any (?:updates?|news|progress)\b|where (?:are|do) (?:we|things|you) (?:stand|at)\b|where are we\b|how(?:'s| is) it going\b|how far along\b|is it (?:done|finished|ready|working|fixed)\b|are (?:we|you) done\b|what(?:'s| is) (?:left|next|remaining|the latest|happening)\b|still working\b)/i;
function asksAboutCurrentState(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  return CURRENT_STATE.test(t.slice(0, 200));
}
function memoryReplayable(question, context = {}) {
  const q = (question ?? "").trim();
  if (!q || context.followUp === true) return false;
  return !asksForChange(q) && !asksAboutCurrentState(q) && !isContinuationDirective(q);
}
function continuationDirective() {
  return `The user's last message is a bare directive ("fix", "do it", "go ahead") with no subject of its own. It refers to the proposal in YOUR immediately preceding message, which described work you had not yet carried out. Carry out that exact proposal now, using the tools, starting from the files and the change it already named \u2014 do NOT ask the user what to fix, and do NOT re-derive the analysis you have already done and can read above. If the earlier proposal named a specific file and edit, apply that edit. Report what you changed when it is done.`;
}

// ../packages/agent-stall/src/handoff.ts
var EXECUTION_TOOLS = /* @__PURE__ */ new Set([
  "run_command",
  "run_shell_command",
  "execute_command",
  "bash",
  "shell",
  "terminal",
  "git_commit",
  "git_push",
  "git_sync_latest",
  "open_pull_request",
  // The SERVER addressed-agent reply has no shell of its own — its shell lives in the
  // agent's runtime, and this tool is the door to it. Its own system prompt already
  // says "NEVER reply that you lack a git or file tool"; without this entry the gate
  // that enforces that sentence could never fire on the one surface it was written for.
  "builtin_chats_execute_as_agent"
]);
function canExecuteCommands(toolNames) {
  return (toolNames ?? []).some((n) => EXECUTION_TOOLS.has(n.toLowerCase()));
}
var RUNNER = "(?:npm|pnpm|yarn|npx|bun|deno|node|git|make|cargo|go|dotnet|mvn|gradle|python3?|pip3?|poetry|uv|ruby|rake|bundle|composer|php|docker(?:\\s+compose)?|kubectl|helm|terraform|wrangler|vercel|netlify|vite|webpack|tsc|tsgo|eslint|prettier|pytest|jest|vitest|playwright|cypress|bash|sh|zsh|pwsh|powershell|curl|wget|sed|awk|rsync|vsce)\\b";
var SCRIPT_NOUN = "(?:build|tests?|test suite|type-?check(?:ing)?|typecheck|lint(?:er|ing)?|guards?|checks?|install|dev server|migrations?|deploy(?:ment)?|codegen|bundle|vsix|package|commit|push|pull request|pr\\b|branch|lockfile|extension host)";
var CMD_MARK = "\u2983cmd\u2984";
var ID_MARK = "\u2983id\u2984";
var OUT_OF_REACH = /\b(credential|password|api ?key|secret|auth token|\.env\b|environment variable|2fa|mfa|sign ?in|log ?in|browser|incognito|restart vs ?code|reload the window|reinstall the extension|github ui|web ui|dashboard|billing|payment|admin console|approve|permission|by hand|manually)\b/i;
var TAIL_CHARS = 900;
var WINDOW_BEFORE = 80;
var WINDOW_AFTER = 220;
function normalise(text) {
  const mark = (body) => new RegExp(RUNNER, "i").test(body) ? ` ${CMD_MARK} ` : ` ${ID_MARK} `;
  return text.replace(/```[\s\S]*?(?:```|$)/g, (m) => mark(m)).replace(/`[^`\n]+`/g, (m) => mark(m));
}
var HANDOFF_VERB = "(?:re-?run|run|execute|apply|install|re-?install|rebuild|build|compile|commit|push|deploy|publish|restart|relaunch|launch|start|test|verify|lint|type-?check|typecheck|migrate|regenerate|package|bump|trigger|kick off)";
var HANDS_OFF = new RegExp(
  [
    // "you can run", "you'll need to run", "you should now commit", "you must rebuild"
    `\\byou(?:'ll|'d|'ve| will| would| should| must| may| might| can| could| still| then| now)?(?:\\s+(?:then|now|also|just|still|next|first|finally|want to|need to|have to|be able to))*\\s+${HANDOFF_VERB}\\b`,
    // "please run the guards"
    `\\bplease\\s+(?:now\\s+|then\\s+)?${HANDOFF_VERB}\\b`,
    // "once you've run the build", "after you push"
    `\\b(?:once|after|when|before)\\s+you(?:'ve| have| had)?\\s+${HANDOFF_VERB}\\b`,
    // "run the following", "apply these changes", "execute this command"
    `\\b${HANDOFF_VERB}\\s+(?:the\\s+following|these|this)\\b`,
    // "to verify, run …" / "to apply the fix you need to run …"
    `\\bto\\s+(?:apply|verify|confirm|finish|complete|deploy|ship|land|pick up|see)\\b[^.\\n]{0,60}?,?\\s*(?:you\\s+(?:can|should|must|will|need to|have to)\\s+)?${HANDOFF_VERB}\\b`,
    // A steps list: "1. Run the type-check", "- Commit the change", "Then push to main"
    `(?:^|\\n)[ \\t]*(?:\\d+[.)]|[-*+]|#{1,6}|>)?[ \\t]*(?:then|now|next|finally|first)?[,:]?[ \\t]*${HANDOFF_VERB}\\b`,
    // The same imperative mid-paragraph: "I applied the fix. Now run the type-check."
    // The adverb is REQUIRED here, unlike the line-leading form above — without it a
    // plain sentence that happens to open with one of these words ("Build output is
    // clean now.") would read as an instruction.
    `[.!?]\\s+(?:then|now|next|finally|first)[,:]?\\s+${HANDOFF_VERB}\\b`
  ].join("|"),
  "gi"
);
var COMMAND_NEARBY = new RegExp(`${CMD_MARK}|${RUNNER}|\\b${SCRIPT_NOUN}`, "i");
function handsWorkToUser(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  const scanned = normalise(t.slice(-TAIL_CHARS));
  HANDS_OFF.lastIndex = 0;
  for (let m = HANDS_OFF.exec(scanned); m; m = HANDS_OFF.exec(scanned)) {
    const window = scanned.slice(
      Math.max(0, m.index - WINDOW_BEFORE),
      m.index + m[0].length + WINDOW_AFTER
    );
    if (!COMMAND_NEARBY.test(window)) continue;
    if (OUT_OF_REACH.test(window)) continue;
    HANDS_OFF.lastIndex = 0;
    return true;
  }
  return false;
}
function delegatesExecutableWork(text, ctx) {
  if (!canExecuteCommands(ctx.availableToolNames)) return false;
  if (!asksForChange(ctx.requestText)) return false;
  return handsWorkToUser(text);
}
function handoffRecoveryNudge(lastChance) {
  return "Your last turn ended by telling the USER to run commands. You are the one holding the tools \u2014 `run_command` for shell steps, the git tools to commit and push \u2014 so those steps are yours, not theirs. Carry them out NOW in this turn: run the commands you just listed, read their output, and fix anything that fails before you answer. Verification you hand to the user is verification nobody does. Only leave a step to the user when you genuinely cannot do it here \u2014 it needs a credential, a browser, or a decision that is theirs \u2014 and then say which step and why." + (lastChance ? " This is your last chance to act: your answer after this turn is shown to the user as-is, so either run the commands now or state plainly, at the top of your reply, that the change is UNVERIFIED and exactly which steps were never run." : "");
}

// ../packages/agent-stall/src/permissionMenu.ts
var TAIL_CHARS2 = 900;
var ACTION_VERB = "(?:run|execute|apply|implement|install|rebuild|build|compile|commit|push|merge|rebase|deploy|publish|release|ship|open|create|file|draft|write|add|update|patch|edit|change|modify|fix|resolve|refactor|rename|move|delete|remove|drop|close|cancel|archive|assign|dispatch|schedule|start|kick off|trigger|link|list|enumerate|show|generate|produce|proceed|continue|go ahead|do (?:it|that|this|them|so|first|next|now|any|all)|handle|take care of|work through|go through|tackle|clean up|tidy|sort out|migrate|convert|split|extract|bump|revert|restore|retry|re-?try|re-?run|verify|test|check|review|investigate|dig into|look into)";
var OFFER = new RegExp(
  [
    // "Would you like me to open the PRs?" · "Do you want me to merge these?"
    // · "Would you like me to proceed?"
    `\\b(?:would|do)\\s+you\\s+(?:like|want|prefer)\\s+(?:me|us)\\s+to\\b`,
    // "Shall I open PRs?" · "Should I cancel the stalled tickets?" · "Can I proceed?"
    // · "May I go ahead?"
    `\\b(?:shall|should|can|may)\\s+i\\b[^.?\\n]{0,80}\\?`,
    // "Want me to push these?" — the subjectless form.
    `\\bwant\\s+(?:me|us)\\s+to\\b`,
    // "Let me know if you'd like me to…" · "Let me know which of these to do"
    // · "Tell me which you'd prefer" · "Just say the word and I'll merge them"
    // "how" earns its place: "let me know how you'd like to proceed" is the single most
    // common way this pause is phrased, and it names no option at all.
    `\\blet me know\\b[^.\\n]{0,80}\\b(?:if|whether|which|what|how)\\b`,
    `\\b(?:tell|let)\\s+me\\s+know\\s+(?:which|what|whether|if)\\b`,
    `\\bsay the word\\b`,
    // "I can open the PRs if you'd like." · "I could cancel them if you want."
    // · "I'm happy to merge these if that's what you want."
    `\\bi\\s+(?:can|could|am happy to|'?m happy to|would be happy to)\\b[^.\\n]{0,120}?\\bif\\s+(?:you|that|you'?d|you would)\\b`,
    // "Confirm and I'll proceed." · "Approve and I'll merge them."
    `\\b(?:confirm|approve|give me the go-?ahead|give the go-?ahead)\\b[^.\\n]{0,40}\\band\\s+i(?:'ll| will)\\b`,
    // "Which would you like me to do first?" · "Which of these should I start with?"
    `\\bwhich\\s+(?:one|of these|of those)?\\s*(?:would|do|should|shall)\\s+(?:you|i)\\b`,
    // "Your call." · "Up to you." · "How would you like to proceed?" — and the
    // declarative order the same sentence takes inside a clause, "…how you would like
    // to proceed", which the interrogative-only form used to miss.
    `\\b(?:your call|up to you|it'?s your call)\\b`,
    `\\bhow\\s+(?:you\\s+(?:would|do)|(?:would|do)\\s+you)\\s+(?:want|like|prefer)\\b`
  ].join("|"),
  "gi"
);
var WINDOW_AFTER2 = 400;
var WINDOW_BEFORE2 = 120;
var ACTION_NEARBY = new RegExp(`\\b${ACTION_VERB}\\b`, "i");
var USERS_OWN_CHOICE = /\b(?:did you mean|do you mean|what did you (?:mean|intend)|which did you mean|prefer(?:ence|red)?\b|intended behaviou?r|by design|is that (?:right|correct|intended|what you)|am i (?:right|correct) (?:that|in)|credential|password|api ?key|secret|which account|whose|budget|deadline|priorit(?:y|ise|ize))\b/i;
function offersMenuInsteadOfActing(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  const scanned = t.slice(-TAIL_CHARS2);
  OFFER.lastIndex = 0;
  for (let m = OFFER.exec(scanned); m; m = OFFER.exec(scanned)) {
    const window = scanned.slice(
      Math.max(0, m.index - WINDOW_BEFORE2),
      m.index + m[0].length + WINDOW_AFTER2
    );
    if (!ACTION_NEARBY.test(window)) continue;
    OFFER.lastIndex = 0;
    return true;
  }
  return false;
}
function pausesOnUsersOwnChoice(text) {
  return USERS_OWN_CHOICE.test((text ?? "").slice(-TAIL_CHARS2));
}
var ASK_USER_TOOL_NAME = "ask_user";
function askUserAdvertised(toolNames) {
  return (toolNames ?? []).some((n) => n.toLowerCase() === ASK_USER_TOOL_NAME);
}
function asksPermissionForRequestedWork(text, ctx) {
  if (!asksForChange(ctx.requestText)) return false;
  if (!offersMenuInsteadOfActing(text)) return false;
  if (pausesOnUsersOwnChoice(text) && !askUserAdvertised(ctx.availableToolNames)) return false;
  return true;
}
function permissionRecoveryNudge(lastChance, askUserAvailable = false) {
  const askBranch = askUserAvailable ? ` If some part of it genuinely IS the user's decision \u2014 two defensible options with no sensible default, something only they know \u2014 call \`${ASK_USER_TOOL_NAME}\` with the options as labelled choices instead of listing them in prose. That puts them on screen as buttons; a question in prose ends the run and costs a full round trip to answer. Do the parts that are NOT in question first, then ask about the rest.` : ` If some part of it genuinely IS the user's decision, say which single question you need answered, state which option you recommend and why, and carry out everything that does NOT depend on the answer before you stop.`;
  return "Your last turn ended by asking the user whether to do work they had ALREADY asked for. You hold the tools to do it, so the answer is yes and it is yours to carry out: pick the sensible default for anything you offered as an option, and DO IT NOW in this turn. Report what you did afterwards \u2014 do not re-state the offer." + askBranch + (lastChance ? " This is your last chance to act: your answer after this turn is shown to the user as-is, so either start the work now or state plainly, at the top of your reply, exactly what you did NOT do and the one decision you are blocked on." : "");
}

// ../packages/agent-stall/src/index.ts
var ANNOUNCE_SUBJECT = "\\b(?:i(?: will|'ll| am going to|'m going to| am about to| plan to|'d need to| would need to| will need to| need to)|let(?:'?s| me| us)|going to|about to|next,? i'?l?l?|now)";
var ANNOUNCE_FILLER = "(?:\\s+(?:now|then|first|next|quickly|briefly|just|also|actually|go ahead and|try to|attempt to))*";
var ANNOUNCE_VERB = "(?:call|use|invoke|run|execute|trigger|query|fetch|retrieve|request|look|search|scan|find|locate|examine|inspect|review|read|list|check|verify|confirm|get|grab|pull|load|open|gather|dig|explore|investigate|analy[sz]e|start|begin|take|do|act|see|walk|trace|map)";
var ANNOUNCE_GERUND = "(?:searching|fetching|retrieving|querying|loading|checking|looking|scanning|reading|listing|gathering|pulling|examining|inspecting|reviewing|analy[sz]ing)";
var TOOL_IDENT = "(?:builtin_[a-z0-9]+(?:_[a-z0-9]+)+|mcp__[a-z0-9_]+)";
function toolNamesMentionedIn(text) {
  return [...new Set(text.match(new RegExp(TOOL_IDENT, "gi")) ?? [])];
}
var PSEUDO_CALL = [
  // "call builtin_x", "run tool builtin_x", "invoke the function mcp__srv__x"
  `(?:call|run|invoke|execute)\\s+(?:the\\s+)?(?:tool\\s+|function\\s+)?${TOOL_IDENT}`,
  // "builtin_x({…})" / "builtin_x(" — the call written as code
  `${TOOL_IDENT}\\s*[({]`,
  // "builtin_x with chatId is 85" — the call written as an argument clause
  `${TOOL_IDENT}\\s+(?:with|args|arguments)\\b`
];
var ANNOUNCED_ACTION = new RegExp(
  [
    "calling (the|this|that|a|it|them|these) [\\w\\s-]*?(tool|function|api|now)",
    `${ANNOUNCE_SUBJECT}${ANNOUNCE_FILLER}\\s+${ANNOUNCE_VERB}\\b`,
    "(one|just a) (moment|second|sec)\\b",
    `${ANNOUNCE_GERUND} (it|that|this|these|those|the [\\w-]+|now|for)\\b`,
    // A sentence that OPENS on a gerund and signs off with "now": "Pulling linked tickets
    // and the roster code now." The object-led form above wants the/this/now straight
    // after the verb, so a bare noun phrase slipped through. Measured on VS Code chat #105
    // (`xai-oauth/grok-4.6`): turns 1-2 were caught and re-prompted, turn 3 said exactly
    // this, scored as a complete answer, and the run ended with a recovery still unspent.
    `(?:^|[.!?\\n]\\s*)${ANNOUNCE_GERUND}\\b[^.!?\\n]{0,80}\\bnow\\b`,
    "stand ?by\\b",
    ...PSEUDO_CALL
  ].join("|"),
  "i"
);
var TAIL_CHARS3 = 240;
function announcesUntakenAction(text) {
  const t = text.trim();
  if (!t) return false;
  return ANNOUNCED_ACTION.test(t.slice(-TAIL_CHARS3));
}
var FILE_EXTENSION = "(?:ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml|sql|toml|lock|txt|env|html|css|py|go|rs|sh|png|svg|csv|xml)\\b";
var DOTTED_TOOL_IDENT = `\\b[a-z][a-z0-9_]{2,}\\.(?!${FILE_EXTENSION})[a-z][a-z0-9_]{2,}\\b`;
function catalogToolNamesMentionedIn(text) {
  return [...new Set(text.match(new RegExp(DOTTED_TOOL_IDENT, "gi")) ?? [])];
}
var UNCALLED_TOOL_CLAIM = new RegExp(
  [
    // "The tools required are X, Y and Z." / "The required tools are …"
    "\\b(?:required tools?\\b|tools? required\\b|tools? (?:i |we )?(?:need|require)\\b)",
    // "…tools have not returned results" / "…the tool has not returned anything yet"
    "\\btools?\\b[^.!?]{0,80}?\\b(?:have|has|had|were|was)(?:n'?t| not)\\s+(?:yet\\s+)?(?:return|returned|provided|available|run|called)",
    // "no tool results", "no results from the tools", "no tool outputs for project 11"
    "\\bno\\s+(?:new\\s+)?tools?\\s+(?:results?|outputs?|data|returns?)\\b",
    // "No other tools provide the needed data." — the same claim aimed at the CATALOG
    // rather than at the results: an inventory of what it would need, from a turn that
    // called none of it. Observed as the closing sentence of the measured replies.
    "\\bno\\s+other\\s+tools?\\b[^.!?]{0,40}?\\b(?:provide|provides|give|gives|return|returns|have|has|offer|offers)\\b",
    "\\bno\\s+results?\\s+(?:from|for)\\s+(?:the\\s+)?tools?\\b",
    // "tool outputs never provided" / "the tool results were never returned"
    "\\btools?\\s+(?:results?|outputs?)\\b[^.!?]{0,40}?\\b(?:never|not)\\s+(?:been\\s+)?(?:provided|returned|available)",
    // "requires the tool outputs" / "awaiting the tool results"
    "\\b(?:requires?|awaiting|waiting on|pending)\\s+(?:those\\s+|the\\s+)?tools?\\s+(?:results?|outputs?)",
    // The same claim with the TOOL NAMED instead of the word "tool" — "no results from
    // manager.digest", "missing builtin_manager_policy results". The name IS the
    // discriminator here: prose does not carry tool identifiers by accident.
    `\\bno\\s+(?:new\\s+)?(?:results?|data|outputs?|returns?)\\s+(?:from|for|on)\\s+(?:the\\s+)?(?:${TOOL_IDENT}|${DOTTED_TOOL_IDENT})`,
    `\\b(?:missing|awaiting|pending|without)\\s+(?:the\\s+|those\\s+)?(?:results?\\s+(?:from|of|for)\\s+)?(?:${TOOL_IDENT}|${DOTTED_TOOL_IDENT})`
  ].join("|"),
  "i"
);
function claimsMissingToolData(text) {
  const t = text.trim();
  if (!t) return false;
  return UNCALLED_TOOL_CLAIM.test(t);
}
var MAX_ANNOUNCEMENT_RECOVERIES = 3;
function stallRecoveryNudge(lastChance, shape, ctx) {
  if (shape === "handed-off") return handoffRecoveryNudge(lastChance);
  if (shape === "asked-permission") {
    return permissionRecoveryNudge(lastChance, askUserAdvertised(ctx?.availableToolNames));
  }
  return (
    // Covers BOTH stall shapes: the promise ("I'll check…") and the missing-data claim
    // ("the required tools have not returned results"). The second wording matters —
    // a model told only "you said you would call a tool" when it never said any such
    // thing tends to repeat the same excuse rather than act.
    "Your last turn made zero tool calls. You either said you would call a tool and did not, reported that tool results were missing \u2014 no results exist because you never made the call \u2014 or returned nothing at all. Make the call NOW in this turn, then answer using its result. If no tool can give you that data, say plainly which data you are missing and answer with what you already have. Do not announce another call, and do not reply with an empty message." + (lastChance ? " This is your last chance to act: you have now stated an intention without acting several times in a row. Either emit a tool call in this turn, or give your complete final answer from what you already know \u2014 an answer that only describes what you are about to do will be shown to the user as-is." : "")
  );
}
function isEmptyTurn(input) {
  return input.toolCallCount === 0 && input.availableToolCount > 0 && input.text.trim() === "";
}
function stallShape(input) {
  if (input.toolCallCount !== 0 || input.availableToolCount <= 0) return null;
  if (isEmptyTurn(input)) return "empty";
  if (asksPermissionForRequestedWork(input.text, input)) return "asked-permission";
  if (delegatesExecutableWork(input.text, input)) return "handed-off";
  if (announcesUntakenAction(input.text)) return "announced";
  if (claimsMissingToolData(input.text)) return "missing-data";
  return null;
}
function isStalledTurn(input) {
  return stallShape(input) !== null;
}
function shouldRecoverStalledTurn(input) {
  return isStalledTurn(input) && input.recoveriesUsed < MAX_ANNOUNCEMENT_RECOVERIES;
}
function isExhaustedStall(input) {
  return isStalledTurn(input) && input.recoveriesUsed >= MAX_ANNOUNCEMENT_RECOVERIES;
}
function resolveShape(arg) {
  if (arg === true) return "empty";
  if (typeof arg === "string") return arg;
  return "announced";
}
function whatItDid(shape) {
  const rounds = `${MAX_ANNOUNCEMENT_RECOVERIES} turns in a row`;
  switch (shape) {
    case "empty":
      return `returned an empty turn \u2014 no tool call and no words \u2014 ${rounds}`;
    case "handed-off":
      return `handed the remaining work back to you as commands to run yourself, ${rounds}, rather than running them with the tools it holds`;
    case "asked-permission":
      return `asked your permission to carry out work you had already asked for, ${rounds}, rather than carrying it out`;
    case "missing-data":
      return `reported that tool results were missing without ever calling a tool, ${rounds}`;
    default:
      return `described tool calls instead of making them, ${rounds}`;
  }
}
function whatYouGot(shape) {
  switch (shape) {
    case "empty":
      return "there is no answer above to show you.";
    case "handed-off":
      return "the steps above are still yours to run \u2014 treat the change as UNVERIFIED.";
    case "asked-permission":
      return "the work you asked for has NOT been started \u2014 the answer above is an offer to start it.";
    default:
      return "the answer above is only a description of intended actions.";
  }
}
function modelFailoverNotice(from, to, shape = false) {
  const who = from && from !== "default" ? `\`${from}\`` : "The previous model";
  return `${who} ${whatItDid(resolveShape(shape))}, so it cannot complete this request. Retrying on \`${to}\`.`;
}
function stallExhaustedNotice(model, tried, shape = false) {
  const who = model && model !== "default" ? `The model \`${model}\`` : "The model";
  const kind = resolveShape(shape);
  const others = (tried ?? []).filter((m) => m && m !== model);
  return `${who} ${whatItDid(kind)}, so nothing was actually run and ` + whatYouGot(kind) + (others.length ? ` This run already failed over from ${others.map((m) => `\`${m}\``).join(", ")}, so the problem is unlikely to be any single model \u2014 check that the tool catalog loaded (see the "Tools available to the model" line in a copied diagnostics report).` : kind === "handed-off" ? " Nothing upstream failed here \u2014 the model reached the right answer and declined to carry it out, which is an agency limitation. Run the steps it listed, or retry on a model from the coding pool, which is selected for exactly this." : " Before switching models, check your runtime or gateway log for this turn: a request REJECTED upstream \u2014 a prompt over the context limit, an exhausted quota \u2014 produces exactly these symptoms, and no other model will fix it. If the log is clean, this is a model limitation and a different model is the answer.");
}
function stallRecoveryToolChoice(input) {
  return input.availableToolCount > 0 ? "required" : void 0;
}
function ids(list2) {
  return (list2 ?? []).map((m) => m.id).filter((id) => !!id);
}
function nextFallbackModel(surface, tried) {
  if (!surface) return void 0;
  const used = new Set(tried.filter(Boolean));
  const byo = ids(surface.byo?.models);
  const byoSet = new Set(byo);
  const coding = (surface.codingModels ?? []).filter(Boolean);
  const pool = ids(surface.data);
  const tiers = [
    coding.filter((m) => byoSet.has(m)),
    byo,
    coding,
    pool
  ];
  for (const tier2 of tiers) {
    const hit = tier2.find((m) => !used.has(m));
    if (hit) return hit;
  }
  return void 0;
}
var MAX_MODEL_FAILOVERS = 2;
function chooseStallFailover(input) {
  for (const m of [input.activeModel, input.resolvedModel]) {
    if (m && m !== "default" && !input.tried.includes(m)) input.tried.push(m);
  }
  if (input.failoversUsed >= (input.maxFailovers ?? MAX_MODEL_FAILOVERS)) return void 0;
  const next = input.pick ? input.pick(input.tried) : nextFallbackModel(input.surface, input.tried);
  return next && !input.tried.includes(next) ? next : void 0;
}

// ../packages/pipeline-route/src/score.ts
import { sigmoid } from "@seanhogg/builderforce-memory/stats";
var LENGTH_FLOOR_CHARS = 80;
var MAX_FILE_MENTIONS = 4;
var DEFAULT_ROUTE_THRESHOLD = 0.5;
var ROUTE_WEIGHTS = {
  bias: -0.4,
  length: 0.9,
  fileMentions: 0.35,
  multiStep: 1.2,
  broadScope: 1,
  questionOnly: -1.3,
  followUp: -0.3,
  // Outweighs every quick-leaning feature together (bias, follow-up, docs, question-only: -2.6), so a ticket or spec
  // reconciliation request always plans first (VS Code chat #157440 started "create tickets for every open item" in code).
  ticketIntent: 3,
  actionType: {
    data_migration: 1,
    refactor: 0.9,
    provisioning: 0.6,
    backend_api: 0.4,
    decision: 0.3,
    devops_ci: 0.3,
    frontend_ui: 0.2,
    analysis: -0.4,
    docs: -0.6
  }
};
var round2 = (n) => Math.round(n * 100) / 100;
function routeThreshold(raw) {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : DEFAULT_ROUTE_THRESHOLD;
}
function contributions(f, w) {
  const decades = f.requestChars > LENGTH_FLOOR_CHARS ? Math.min(2, Math.log10(f.requestChars / LENGTH_FLOOR_CHARS)) : 0;
  return [
    ["long request", w.length * decades],
    ["files named", w.fileMentions * Math.min(MAX_FILE_MENTIONS, Math.max(0, f.fileMentions))],
    ["multi-step", f.multiStep ? w.multiStep : 0],
    ["broad scope", f.broadScope ? w.broadScope : 0],
    ["question only", f.questionOnly ? w.questionOnly : 0],
    ["follow-up", f.followUp ? w.followUp : 0],
    ["ticket intent", f.ticketIntent ? w.ticketIntent ?? 0 : 0],
    [f.actionType, w.actionType[f.actionType] ?? 0]
  ];
}
function scorePipeline(f, opts = {}) {
  const w = opts.weights ?? ROUTE_WEIGHTS;
  const threshold = routeThreshold(opts.threshold);
  const parts = contributions(f, w);
  const score2 = round2(sigmoid(parts.reduce((z, [, c]) => z + c, w.bias)));
  const strongest = parts.filter(([, c]) => c !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3).map(([name]) => name);
  const why = strongest.length ? ` (${strongest.join(", ")})` : "";
  if (f.forceFull) return { score: score2, route: "full", reason: `the request asks for the full pipeline; score ${score2}${why}` };
  if (f.explicitQuestion) return { score: score2, route: "quick", reason: `the user asks a question; score ${score2}${why}` };
  if (opts.mode === "always") return { score: score2, route: "full", reason: `routing is set to always; score ${score2}${why}` };
  return score2 >= threshold ? { score: score2, route: "full", reason: `score ${score2} \u2265 ${threshold}${why}` } : { score: score2, route: "quick", reason: `score ${score2} < ${threshold}${why}` };
}
var FILE_RE = /(?:[\w@.-]+\/)+[\w.-]+|\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|cs|php|rb|swift|c|cc|cpp|h|hpp|md|json|ya?ml|toml|sql|css|scss|html|vue|svelte|sh)\b/gi;
var LIST_ITEM_RE = /^\s*(?:\d+[.)]|[-*•])\s+\S/gm;
var CHAIN_RE = /\b(?:and then|then|after that|afterwards|next|also|finally|as well as)\b/gi;
var BROAD_RE = /\b(?:every|each|across|throughout|entire|whole|codebase|repo-?wide|end[- ]to[- ]end|architecture|redesign|overhaul|migrate|migration|all (?:the )?(?:files|modules|services|packages|pages|endpoints|tests|callers|places))\b/i;
var FORCE_FULL_RE = /(?:^\s*full[- ]pipeline\s*[.!]?\s*$|(?:^|[.;!—–]|\s-\s)\s*(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:run|use|force|take|prefer)\s+(?:the\s+)?full[- ]pipeline\b)/i;
var TICKET_INTENT_PATTERNS = [
  // Filing: an exact verb, then only TICKET nouns — tasks / issues are everyday code words ("the task runner", "login issues").
  /\b(?:create|file|open|raise|make|add|log|write)\b[^.?!\n]{0,40}\b(?:tickets?|work\s+items?)\b/i,
  // Reviewing a spec by name.
  /\breview(?:s|ed|ing)?\b[^.?!\n]{0,40}\b(?:prds?|specs?|specifications?|roadmaps?|requirements|gap\s+register)\b/i,
  // Reviewing a markdown file only when ticket language follows it ("review the changes in CHANGELOG.md" is not this).
  /\breview(?:s|ed|ing)?\b[^?!\n]{0,40}\b[\w-]+\.md\b[^?!\n]{0,80}\b(?:tickets?|work\s+items?|items?\b[^.?!\n]{0,30}\b(?:completed?|done|finished|open|incomplete|outstanding|remaining))\b/i,
  // A spec's items and their status — only with a spec word or a .md path in the request ("remaining items in the cart" is not this).
  /^(?=[\s\S]*(?:\b(?:prds?|specs?|specifications?|roadmaps?|requirements|gap\s+register)\b|\b[\w-]+\.md\b))[\s\S]*?\bitems?\b[^.?!\n]{0,30}\b(?:completed?|done|finished|open|incomplete|outstanding|remaining)\b/i,
  /^(?=[\s\S]*(?:\b(?:prds?|specs?|specifications?|roadmaps?|requirements|gap\s+register)\b|\b[\w-]+\.md\b))[\s\S]*?\b(?:open|incomplete|outstanding|remaining|unfinished)\s+(?:prd\s+)?items?\b/i
];
function pipelineFeaturesOf(request, context = {}) {
  const classification = classifyRequest(request);
  const { intent, ask: text } = classification;
  const files = new Set((text.match(FILE_RE) ?? []).map((m) => m.toLowerCase()));
  const listItems = (text.match(LIST_ITEM_RE) ?? []).length;
  const chained = (text.match(CHAIN_RE) ?? []).length;
  return {
    requestChars: text.length,
    fileMentions: files.size,
    multiStep: listItems >= 2 || chained >= 2,
    broadScope: BROAD_RE.test(text),
    questionOnly: intent === "question",
    ...hasExplicitQuestionIntent(classification) ? { explicitQuestion: true } : {},
    followUp: context.followUp === true,
    actionType: context.actionType ?? "other",
    forceFull: FORCE_FULL_RE.test(text),
    ticketIntent: TICKET_INTENT_PATTERNS.some((re) => re.test(text))
  };
}

// ../packages/pipeline-route/src/report.ts
var RERUN_WINDOW_MS = 30 * 6e4;
var MIN_QUICK_RUNS_FOR_SUGGESTION = 10;
var MISROUTE_HIGH = 0.15;
var MISROUTE_LOW = 0.05;
var HISTOGRAM_BINS = 10;
var STEP = 0.05;
var floorStep = (n) => Math.floor(n / STEP + 1e-9) * STEP;
var round22 = (n) => Math.round(n * 100) / 100;
function misroutedRuns(runs, windowMs = RERUN_WINDOW_MS) {
  const out = /* @__PURE__ */ new Set();
  const byConversation = /* @__PURE__ */ new Map();
  runs.forEach((r, i) => {
    const list2 = byConversation.get(r.conversation) ?? [];
    list2.push(i);
    byConversation.set(r.conversation, list2);
  });
  for (const indexes of byConversation.values()) {
    indexes.sort((a, b) => runs[a].startedAt.localeCompare(runs[b].startedAt));
    indexes.forEach((i, k) => {
      const run = runs[i];
      if (run.route !== "quick") return;
      if (run.failed) {
        out.add(i);
        return;
      }
      const next = indexes[k + 1] !== void 0 ? runs[indexes[k + 1]] : void 0;
      if (next?.route === "full" && Date.parse(next.startedAt) - Date.parse(run.startedAt) <= windowMs) out.add(i);
    });
  }
  return out;
}
function totals(runs) {
  const scored = runs.filter((r) => typeof r.score === "number");
  const priced = runs.filter((r) => typeof r.costMc === "number" && Number.isFinite(r.costMc));
  const unpricedRuns = runs.length - priced.length;
  return {
    runs: runs.length,
    costMc: priced.reduce((sum, r) => sum + r.costMc, 0),
    ...unpricedRuns > 0 ? { unpricedRuns } : {},
    avgScore: scored.length ? round22(scored.reduce((s, r) => s + r.score, 0) / scored.length) : null
  };
}
function histogramOf(runs) {
  const bins = Array.from({ length: HISTOGRAM_BINS }, (_, i) => ({
    from: round22(i / HISTOGRAM_BINS),
    to: round22((i + 1) / HISTOGRAM_BINS),
    full: 0,
    quick: 0
  }));
  for (const r of runs) {
    if (typeof r.score !== "number" || !Number.isFinite(r.score)) continue;
    const i = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(r.score * HISTOGRAM_BINS)));
    bins[i][r.route] += 1;
  }
  return bins;
}
function suggestThreshold(runs, threshold, misrouted = misroutedRuns(runs)) {
  const quick = runs.filter((r) => r.route === "quick").length;
  if (quick < MIN_QUICK_RUNS_FOR_SUGGESTION) return { suggestedThreshold: null };
  const rate = misrouted.size / quick;
  if (rate > MISROUTE_HIGH) {
    const scores = [...misrouted].map((i) => runs[i].score).filter((s) => typeof s === "number").sort((a, b) => a - b);
    const quartile = scores.length ? scores[Math.floor((scores.length - 1) / 4)] : threshold - STEP;
    const next = round22(Math.max(STEP * 2, Math.min(threshold - STEP, floorStep(quartile))));
    return { suggestedThreshold: next };
  }
  if (rate < MISROUTE_LOW && runs.some((r) => r.route === "full")) {
    const next = round22(Math.min(0.9, threshold + STEP));
    return { suggestedThreshold: next > threshold ? next : null };
  }
  return { suggestedThreshold: null };
}
function summarizeRouteRuns(runs, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_ROUTE_THRESHOLD;
  const misrouted = misroutedRuns(runs, opts.rerunWindowMs);
  const quick = runs.filter((r) => r.route === "quick");
  return {
    runs: runs.length,
    byRoute: { full: totals(runs.filter((r) => r.route === "full")), quick: totals(quick) },
    histogram: histogramOf(runs),
    misroutes: misrouted.size,
    misrouteRate: quick.length ? round22(misrouted.size / quick.length) : null,
    threshold,
    ...suggestThreshold(runs, threshold, misrouted)
  };
}

// ../packages/run-policy/src/coderHandoff.ts
function isCoderReask(role, previousRole) {
  return role === "code" && previousRole === "plan";
}
var MAX_CALL_CHARS = 2e3;
var MAX_BRIEF_CHARS = 6e3;
function coderHandoffBrief(plannerText, calls) {
  const findings = plannerText.trim();
  const intended = calls.map((call) => {
    const args = call.args.length > MAX_CALL_CHARS ? `${call.args.slice(0, MAX_CALL_CHARS)}\u2026` : call.args;
    return `- ${call.name} ${args}`;
  });
  const parts = [
    "HAND-OFF: the analysis for this request is complete \u2014 you are the coding model taking it from here. Everything the planner read is in the conversation above; do not start the investigation over or re-read files already returned above.",
    ...findings ? ["The planner concluded:", findings] : [],
    "It was about to make this change:",
    ...intended,
    "Make that change now. Correct it if it is wrong \u2014 a file you have not seen, or text that does not match \u2014 but act on it rather than re-planning. Read only what the edit itself needs and is not already above."
  ];
  const brief = parts.join("\n");
  return brief.length > MAX_BRIEF_CHARS ? `${brief.slice(0, MAX_BRIEF_CHARS)}\u2026` : brief;
}

// ../packages/run-policy/src/latencyGuard.ts
var LATENCY_SAMPLE_WINDOW = 9;
var MAX_FAILOVER_LATENCY_RATIO = 3;
function p50(samples) {
  const valid = (samples ?? []).filter((n) => Number.isFinite(n) && n >= 0);
  if (valid.length === 0) return void 0;
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function recordLatency(samples, model, durationMs, window = LATENCY_SAMPLE_WINDOW) {
  const base = samples ?? {};
  if (!model || !Number.isFinite(durationMs) || durationMs < 0) return base;
  const next = [...base[model] ?? [], durationMs].slice(-Math.max(1, window));
  return { ...base, [model]: next };
}
function withinLatencyBudget(candidate, input) {
  const { primary } = input;
  if (input.primaryUnavailable || !primary || candidate === primary) return true;
  const base = p50(input.latency?.[primary]);
  const theirs = p50(input.latency?.[candidate]);
  if (base === void 0 || theirs === void 0 || base <= 0) return true;
  return theirs <= base * (input.maxRatio ?? MAX_FAILOVER_LATENCY_RATIO);
}
function fastestCandidate(candidates, latency) {
  let best;
  let bestP50 = Number.POSITIVE_INFINITY;
  for (const m of candidates) {
    const t = p50(latency?.[m]) ?? 0;
    if (best === void 0 || t < bestP50) {
      best = m;
      bestP50 = t;
    }
  }
  return best;
}
var MAX_GUARDED_PICKS = 32;
function guardedPick(pick, skip, input) {
  const skipped2 = [...skip];
  const slow = [];
  for (let i = 0; i < MAX_GUARDED_PICKS; i++) {
    const next = pick(skipped2);
    if (!next) break;
    if (withinLatencyBudget(next, input)) return next;
    slow.push(next);
    skipped2.push(next);
  }
  return fastestCandidate(slow, input.latency);
}

// ../packages/run-policy/src/phaseModels.ts
function reviewPhaseModel(phaseModels, legacyReviewModel) {
  for (const candidate of [phaseModels?.review, phaseModels?.verify, legacyReviewModel]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return void 0;
}
function configuredPhaseModel(options, phase) {
  if (phase === "verify") return reviewPhaseModel(options.phaseModels, options.reviewModel);
  const fromMap = options.phaseModels?.[phase];
  return typeof fromMap === "string" && fromMap.trim() ? fromMap.trim() : void 0;
}
function reviewing(state) {
  return state.phase === "verify" && state.options.fixedRole !== "verify";
}
function phaseDefaultModel(state) {
  if (state.phase === "verify" || state.options.fixedRole) return void 0;
  const model = configuredPhaseModel(state.options, state.phase);
  return model && !state.broken.includes(model) ? model : void 0;
}

// ../packages/run-policy/src/policy.ts
var PIN_RELEASE_STATUSES = [429, 413, 503];
var DECLINE_STATUS = 400;
var NONE = { kind: "none" };
function initialRunPolicy(opts = {}) {
  const model = opts.pinnedModel || void 0;
  return {
    phase: opts.startPhase ?? "plan",
    model,
    locked: false,
    pin: model,
    // Strictness belongs to a pin. With nothing pinned it would otherwise make the
    // run's first LOCK strict, which no host asks for.
    strictPin: !!opts.strictPin && !!model,
    broken: [...new Set((opts.excludeModels ?? []).filter(Boolean))],
    proven: [],
    tried: [],
    ...opts.latencySeed && Object.keys(opts.latencySeed).length > 0 ? { latency: opts.latencySeed } : {},
    failovers: 0,
    turnRetries: 0,
    planTurns: 0,
    handOffForced: false,
    codeTurns: 0,
    changeForced: false,
    outcome: NONE,
    options: {
      pinReleasable: !!opts.pinReleasable,
      lockAfterFirstSuccess: !!opts.lockAfterFirstSuccess,
      maxFailovers: opts.maxFailovers ?? MAX_MODEL_FAILOVERS,
      decliningModelPrefixes: [...opts.decliningModelPrefixes ?? []],
      strictFailover: !!opts.strictFailover,
      preferProvenFailover: !!opts.preferProvenFailover,
      pinStrict: !!opts.strictPin && !!model,
      ...opts.fixedRole ? { fixedRole: opts.fixedRole } : {},
      ...opts.phaseModels ? { phaseModels: opts.phaseModels } : {},
      ...opts.reviewModel !== void 0 ? { reviewModel: opts.reviewModel } : {}
    }
  };
}
function nextTurn(state, turn) {
  const verifying = state.phase === "verify";
  const review = reviewing(state);
  const author = state.authorModel;
  const reviewModel = review ? configuredPhaseModel(state.options, "verify") : void 0;
  const mapped = reviewModel && !state.broken.includes(reviewModel) ? reviewModel : void 0;
  let model = mapped ?? state.model ?? phaseDefaultModel(state);
  if (verifying && author && model === author) model = void 0;
  const excludeModels = [...state.broken];
  if (verifying && author && !excludeModels.includes(author)) excludeModels.push(author);
  return {
    // A coding run's verify-phase turn reviews its change (the strongest models), whatever
    // fixedRole the child had — except a child delegated the mechanical checks themselves.
    role: turn.hasTools ? review ? "review" : state.options.fixedRole ?? state.phase : "chat",
    model,
    strict: !!model && state.strictPin,
    excludeModels
  };
}
function offersHandOff(state) {
  return state.phase === "plan";
}
var PLAN_TURN_BUDGET = 20;
function handOffDue(state) {
  return state.phase === "plan" && state.planTurns >= PLAN_TURN_BUDGET;
}
function changeDue(state, progressed, budget = PLAN_TURN_BUDGET) {
  return state.phase === "code" && !progressed && !state.changeForced && state.codeTurns >= budget;
}
var QUICK_CHANGE_TURN_BUDGET = 8;
function reduceRunPolicy(state, event) {
  const s = { ...state, outcome: NONE };
  switch (event.type) {
    case "turn_succeeded":
      return succeeded(s, event.model, event.acted === true, event.durationMs);
    case "code_change_attempted":
      if (s.phase !== "plan") return s;
      return { ...s, phase: "code", outcome: s.model ? NONE : { kind: "reask_as_coder" } };
    case "plan_budget_spent":
      return s.phase === "plan" ? { ...s, phase: "code" } : s;
    case "hand_off_forced":
      return { ...s, handOffForced: true };
    case "change_forced":
      return { ...s, changeForced: true };
    case "hand_off":
      return s.phase === "plan" ? { ...s, phase: "code", outcome: { kind: "handed_off" } } : { ...s, outcome: { kind: "hand_off_rejected" } };
    case "verify_started": {
      if (s.phase === "verify") return s;
      const author = s.authorModel ?? s.model ?? phaseDefaultModel(s);
      const review = s.options.fixedRole === "verify" ? void 0 : configuredPhaseModel(s.options, "verify");
      const distinct = review && review !== author ? review : void 0;
      return {
        ...s,
        phase: "verify",
        ...author ? { authorModel: author } : {},
        // No distinct review pin ⇒ drop the author pin so the gateway must pick
        // someone else. The author stays in excludeModels either way.
        model: distinct,
        strictPin: distinct ? s.strictPin : false,
        locked: distinct ? s.locked : false
      };
    }
    case "stalled":
      return stalled(s, event);
    case "transport_failed":
      return transportFailed(s, event);
    case "escalated": {
      const from = s.model;
      if (!event.to || event.to === from || s.broken.includes(event.to)) return s;
      return {
        ...s,
        model: event.to,
        locked: false,
        strictPin: true,
        tried: from && !s.tried.includes(from) ? [...s.tried, from] : s.tried
      };
    }
  }
}
function succeeded(s, resolved, acted, durationMs) {
  const proven = acted && resolved && resolved !== "default" && !s.proven.includes(resolved) ? [...s.proven, resolved] : s.proven;
  const served = resolved && resolved !== "default" ? resolved : void 0;
  const timed = served ?? s.model;
  const next = {
    ...s,
    ...acted && timed && durationMs !== void 0 ? { latency: recordLatency(s.latency, timed, durationMs) } : {},
    ...acted && served && s.pin && s.model === s.pin && !s.pinResolved ? { pinResolved: served } : {},
    turnRetries: 0,
    proven,
    planTurns: s.phase === "plan" ? s.planTurns + 1 : s.planTurns,
    codeTurns: s.phase === "code" ? s.codeTurns + 1 : s.codeTurns
  };
  if (s.options.lockAfterFirstSuccess && !(s.model && s.strictPin) && resolved && resolved !== "default") {
    return { ...next, model: resolved, locked: true };
  }
  return next;
}
function stalled(s, e) {
  const tried = [...s.tried];
  const to = chooseStallFailover({
    activeModel: s.model,
    resolvedModel: e.resolvedModel,
    tried,
    failoversUsed: s.failovers,
    maxFailovers: s.options.maxFailovers,
    surface: e.surface,
    pick: failoverPicker(s, e)
  });
  if (!to) {
    const returned = s.model !== s.pin ? { model: s.pin, locked: false, strictPin: !!s.pin && s.options.pinStrict } : {};
    return { ...s, ...returned, tried, outcome: { kind: "failover_exhausted", tried } };
  }
  const failovers = s.failovers + 1;
  return {
    ...s,
    tried,
    failovers,
    model: to,
    locked: false,
    ...s.options.strictFailover ? { strictPin: true } : {},
    outcome: { kind: "failed_over", from: e.resolvedModel ?? s.model, to, attempt: failovers, of: s.options.maxFailovers }
  };
}
function failoverPicker(s, e) {
  const proven = s.options.preferProvenFailover ? [...s.proven].reverse() : [];
  if (proven.length === 0 && !e.pick && !e.surface) return void 0;
  const guard = latencyGuardFor(s, e);
  if (proven.length === 0 && s.broken.length === 0 && !guard) return e.pick;
  const source = (skip) => e.pick ? e.pick(skip) : nextFallbackModel(e.surface, skip);
  return (tried) => {
    const skip = [...tried, ...s.broken];
    const open = proven.filter((m) => !skip.includes(m));
    if (!guard) return open[0] ?? source(skip);
    const fastProven = open.find((m) => withinLatencyBudget(m, guard));
    if (fastProven) return fastProven;
    const picked = guardedPick(source, skip, guard);
    if (picked && withinLatencyBudget(picked, guard)) return picked;
    return fastestCandidate([...open, ...picked ? [picked] : []], guard.latency);
  };
}
function latencyGuardFor(s, e) {
  if (s.phase === "plan" || e.primaryUnavailable || !s.latency) return void 0;
  const pinPrimary = s.pin ? s.pinResolved : void 0;
  return { primary: pinPrimary ?? s.proven[0] ?? e.resolvedModel ?? s.model, latency: s.latency };
}
function transportFailed(s, e) {
  if (s.turnRetries >= 1 || e.kind === "unreachable") return { ...s, outcome: { kind: "fail_turn" } };
  const releasable = s.locked || s.options.pinReleasable;
  if (s.model && releasable && e.status !== void 0 && releasesPin(s, s.model, e.status)) {
    return {
      ...s,
      model: void 0,
      locked: false,
      pin: void 0,
      strictPin: false,
      turnRetries: s.turnRetries + 1,
      outcome: { kind: "retry_turn", released: s.model, status: e.status }
    };
  }
  if (isRequestRefusalStatus(e.status)) return { ...s, outcome: { kind: "fail_turn" } };
  if (s.model && e.kind === "interrupted" && !userPinHeld(s)) {
    const brokenModel = e.model ?? s.model;
    const pinned = s.pin !== void 0 && s.model === s.pin;
    const broken2 = [.../* @__PURE__ */ new Set([...s.broken, brokenModel, s.model])];
    const backToPin = !pinned && s.pin !== void 0 && !broken2.includes(s.pin) ? s.pin : void 0;
    return {
      ...s,
      model: backToPin,
      locked: false,
      strictPin: backToPin !== void 0 && s.options.pinStrict,
      ...pinned ? { pin: void 0 } : {},
      broken: broken2,
      turnRetries: s.turnRetries + 1,
      outcome: { kind: "retry_turn", broken: brokenModel, ...s.locked || pinned ? { released: s.model } : {} }
    };
  }
  if (s.model) return { ...s, outcome: { kind: "fail_turn" } };
  const phaseModel = phaseDefaultModel(s);
  const releasedPhase = phaseModel && e.status !== void 0 && releasesPin(s, phaseModel, e.status) ? phaseModel : void 0;
  const interrupted = e.kind === "interrupted" && e.model ? e.model : void 0;
  const broken = [.../* @__PURE__ */ new Set([...s.broken, ...interrupted ? [interrupted] : [], ...releasedPhase ? [releasedPhase] : []])];
  return {
    ...s,
    broken,
    turnRetries: s.turnRetries + 1,
    outcome: { kind: "retry_turn", ...e.kind === "interrupted" && e.model ? { broken: e.model } : {} }
  };
}
function userPinHeld(s) {
  return s.pin !== void 0 && s.model === s.pin && !s.options.pinReleasable;
}
function releasesPin(s, model, status) {
  return PIN_RELEASE_STATUSES.includes(status) || status === DECLINE_STATUS && s.options.decliningModelPrefixes.some((prefix) => model.startsWith(prefix));
}
function isRequestRefusalStatus(status) {
  return status !== void 0 && status >= 400 && status < 500 && status !== 408 && !PIN_RELEASE_STATUSES.includes(status);
}

// ../packages/run-policy/src/stallStep.ts
function resolveStallStep(policy, turn, recoveriesUsed, source = {}) {
  const input = {
    text: turn.text,
    toolCallCount: turn.toolCallCount,
    availableToolCount: turn.availableToolNames.length,
    recoveriesUsed,
    availableToolNames: turn.availableToolNames,
    ...turn.requestText !== void 0 ? { requestText: turn.requestText } : {}
  };
  const shape = stallShape(input);
  const toolChoice = stallRecoveryToolChoice(input);
  if (shouldRecoverStalledTurn(input)) {
    const used = recoveriesUsed + 1;
    return {
      policy,
      step: {
        kind: "nudge",
        nudge: stallRecoveryNudge(used >= MAX_ANNOUNCEMENT_RECOVERIES, shape, input),
        ...toolChoice ? { toolChoice } : {},
        recoveriesUsed: used,
        shape
      }
    };
  }
  if (!isExhaustedStall(input)) return { policy, step: { kind: "none" } };
  const next = reduceRunPolicy(policy, {
    type: "stalled",
    ...turn.resolvedModel ? { resolvedModel: turn.resolvedModel } : {},
    ...source.surface !== void 0 ? { surface: source.surface } : {},
    ...source.pick ? { pick: source.pick } : {}
  });
  const outcome = next.outcome;
  if (outcome.kind === "failed_over") {
    return {
      policy: next,
      step: {
        kind: "failover",
        // The incoming model gets the FIRST nudge, not the last-chance one: the outgoing
        // model's failures say nothing about it.
        nudge: stallRecoveryNudge(false, shape, input),
        ...toolChoice ? { toolChoice } : {},
        notice: modelFailoverNotice(outcome.from, outcome.to, shape),
        from: outcome.from,
        to: outcome.to,
        attempt: outcome.attempt,
        of: outcome.of,
        recoveriesUsed: 0,
        shape
      }
    };
  }
  const tried = outcome.kind === "failover_exhausted" ? outcome.tried : next.tried;
  const spent = turn.resolvedModel ?? policy.model;
  return { policy: next, step: { kind: "exhausted", notice: stallExhaustedNotice(spent, tried, shape), tried, shape } };
}

// ../packages/run-policy/src/handoffBudget.ts
var DEFAULT_HANDOFF_RESERVE_TOKENS = 4096;
function toolSchemaTokens(schemas, estimate) {
  return schemas && schemas.length > 0 ? estimate(JSON.stringify(schemas)) : 0;
}
function handoffReserveTokens(maxTokens) {
  return maxTokens && maxTokens > 0 ? maxTokens : DEFAULT_HANDOFF_RESERVE_TOKENS;
}
function handoffTokenBudget(input) {
  const reserve = Math.max(0, input.reserveOutputTokens ?? 0);
  const bounds = [];
  if (input.costCapTokens && input.costCapTokens > 0) bounds.push(input.costCapTokens);
  if (input.contextWindow && input.contextWindow > 0) bounds.push(input.contextWindow - reserve);
  if (input.priceTierBoundary && input.priceTierBoundary > 0) bounds.push(input.priceTierBoundary);
  if (bounds.length === 0) return void 0;
  return Math.max(1, Math.min(...bounds));
}

// ../packages/run-policy/src/outputCaps.ts
var ROLE_OUTPUT_CAPS = {
  explore: 2048,
  utility: 2048,
  verify: 2048,
  chat: 4096,
  plan: 4096,
  // A review writes a verdict and its findings — a plan's length, not a check's.
  review: 4096,
  code: 8192
};
function roleOutputCap(role) {
  return role && role in ROLE_OUTPUT_CAPS ? ROLE_OUTPUT_CAPS[role] : void 0;
}
function cappedMaxTokens(role, callerMaxTokens) {
  const cap2 = roleOutputCap(role);
  if (cap2 === void 0) return callerMaxTokens;
  return callerMaxTokens && callerMaxTokens > 0 ? Math.min(cap2, callerMaxTokens) : cap2;
}

// ../packages/run-policy/src/cascade.ts
var MAX_UNIT_ESCALATIONS = 2;
function initialCascadeState() {
  return { escalations: 0, reasoningBoost: 0 };
}
function weakestTierModel(ladder, exclude = []) {
  const usable = ladder.candidates.filter((m) => !exclude.includes(m));
  if (usable.length === 0) return void 0;
  const floor = Math.min(...usable.map((m) => ladder.rankOf(m)));
  return usable.find((m) => ladder.rankOf(m) === floor);
}
function nextTierModel(ladder, current, exclude = []) {
  const usable = ladder.candidates.filter((m) => !exclude.includes(m) && m !== current);
  if (usable.length === 0) return void 0;
  const known = current !== void 0 && ladder.candidates.includes(current);
  const from = known ? ladder.rankOf(current) : Math.min(...ladder.candidates.map((m) => ladder.rankOf(m)));
  const above = usable.map((m) => ladder.rankOf(m)).filter((r) => r > from);
  if (above.length === 0) return void 0;
  const next = Math.min(...above);
  return usable.find((m) => ladder.rankOf(m) === next);
}
function cascadeVerdict(state, kind, verdict, ctx) {
  if (verdict.inconclusive) return { state, action: { kind: "none" } };
  const open = state.open && state.open.kind === kind ? state.open : void 0;
  if (verdict.passed) {
    if (!open) return { state, action: { kind: "none" } };
    const next = { ...state, open: void 0, reasoningBoost: 0 };
    const base = open.baseModel;
    return { state: next, action: base && open.escalations > 0 && base !== ctx.current ? { kind: "deescalate", to: base } : { kind: "none" } };
  }
  const unit = open ?? { kind, escalations: 0, ...ctx.current ? { baseModel: ctx.current } : {} };
  if (unit.escalations >= MAX_UNIT_ESCALATIONS) {
    return {
      state: { ...state, open: unit },
      action: { kind: "exhausted", steer: cascadeSteer(kind, verdict, ctx.current, void 0, true) }
    };
  }
  const to = nextTierModel(ctx.ladder, ctx.current, ctx.exclude ?? []);
  return {
    state: {
      ...state,
      open: { ...unit, escalations: unit.escalations + 1 },
      escalations: state.escalations + 1,
      reasoningBoost: Math.min(state.reasoningBoost + 1, MAX_UNIT_ESCALATIONS)
    },
    action: { kind: "escalate", to, escalateReasoning: true, steer: cascadeSteer(kind, verdict, ctx.current, to, false) }
  };
}
var UNIT_WORDS = {
  code_edit: "your last code change",
  finish: "your finish attempt",
  structured_output: "your structured answer"
};
function cascadeSteer(kind, verdict, from, to, exhausted) {
  const why = verdict.reason ? `: ${verdict.reason.trim().slice(0, 1200)}` : ".";
  const who = exhausted ? "The run has already escalated this unit as far as it may \u2014 fix it on this model." : to ? `It has been handed one tier up${from ? ` from ${from}` : ""} to ${to}, with more reasoning.` : "No stronger model is available, so reasoning has been raised instead.";
  return `Verifier check (${verdict.verifier}) failed on ${UNIT_WORDS[kind]}${why}
${who} Read the failure above, correct exactly what it names, and verify again before moving on.`;
}

// ../packages/agent-tools/src/stableStringify.ts
function stableStringify(value) {
  if (value === null || value === void 0) return "null";
  if (typeof value === "number" && !Number.isFinite(value)) return JSON.stringify(String(value));
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Error) {
    return stableStringify({ name: value.name, message: value.message, stack: value.stack });
  }
  if (value instanceof Uint8Array) {
    return stableStringify({ type: "Uint8Array", data: Array.from(value) });
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record5 = value;
  const keys = Object.keys(record5).filter((k) => record5[k] !== void 0).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record5[k])}`).join(",")}}`;
}

// ../packages/agent-tools/src/toolFailure.ts
function isFailedToolResult(result) {
  if (result == null) return false;
  if (typeof result === "object") {
    const r = result;
    if (r.ok === false) return true;
    if (typeof r.error === "string" && r.error) return true;
    return false;
  }
  if (typeof result === "string") {
    return /"ok"\s*:\s*false/.test(result) || /"error"\s*:\s*"[^"]/.test(result);
  }
  return false;
}

// ../packages/agent-tools/src/modelRoles.ts
var MODEL_ROLES = ["plan", "code", "review", "verify", "explore", "chat", "utility"];
var MODEL_ROLE_DESCRIPTIONS = {
  plan: "Deciding \u2014 choosing an approach, breaking work down, sequencing it. Produces a decision, not code.",
  code: "Writing or editing code or files. Only when the child must CHANGE something; reading and reporting is never code.",
  review: "Judging \u2014 auditing, comparing, aligning or reconciling one thing against another (tickets vs roadmap, a diff vs its spec, a plan vs the code) and saying what is wrong or missing.",
  verify: "Mechanical checks \u2014 building, compiling, running tests and reading their output.",
  explore: "Locating and summarising \u2014 finding where something lives, bulk-reading pages or files and reporting what is there, without judging it.",
  chat: "A conversational answer with no task-shaped work behind it.",
  utility: "Small, mechanical, low-stakes work \u2014 formatting, extraction, a lookup."
};
var MISSING_ROLE_ERROR = `role is required \u2014 say what kind of work the child does so it is routed to a model suited to it: ${MODEL_ROLES.join(" | ")}. Auditing, comparing or aligning is review; locating or bulk-reading and summarising is explore; deciding is plan; code is only for a child that must change files.`;
var ROLE_SET = new Set(MODEL_ROLES);
function isModelRole(value) {
  return typeof value === "string" && ROLE_SET.has(value);
}
function requiredDelegationRole(raw) {
  const role = typeof raw === "string" ? raw.trim().toLowerCase() : raw;
  return isModelRole(role) ? role : null;
}

// ../packages/agent-tools/src/callShape.ts
function callPathOf(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const a = args;
  for (const p of [a.path, a.file_path, a.filePath]) {
    if (typeof p === "string" && p.trim()) return p.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  }
  return null;
}
function str(a, ...keys) {
  for (const k of keys) {
    const v = a[k];
    if (typeof v === "string") return v;
  }
  return void 0;
}
function entryOf(e, fallback, batched) {
  const content = str(e, "content");
  const before = str(e, "old_string", "oldString", "find");
  const after = str(e, "new_string", "newString", "replace");
  return {
    path: callPathOf(e) ?? fallback,
    batched,
    ...content !== void 0 ? { content } : {},
    ...before !== void 0 ? { before } : {},
    ...after !== void 0 ? { after } : {}
  };
}
function callWriteEntriesOf(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  const a = args;
  const top = entryOf(a, null, false);
  const out = [top];
  if (Array.isArray(a.edits)) {
    for (const raw of a.edits) {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) out.push(entryOf(raw, top.path, true));
    }
  }
  return out;
}
function callChangesOf(args) {
  const out = [];
  for (const e of callWriteEntriesOf(args)) {
    if (!e.path) continue;
    if (e.content !== void 0) out.push({ path: e.path, content: e.content });
    else if (e.before !== void 0 && e.after !== void 0 && e.before !== e.after) out.push({ path: e.path, from: e.before, to: e.after });
  }
  return out;
}
function changedPathsOf(args) {
  return [...new Set(callChangesOf(args).map((c) => c.path))];
}

// ../packages/agent-tools/src/edit-match.ts
var toLF = (s) => s.replace(/\r\n/g, "\n");
var countNewlines = (s) => s.split("\n").length - 1;
function dominantEol(content) {
  const all = countNewlines(content);
  if (all === 0) return null;
  const crlf = content.split("\r\n").length - 1;
  return crlf >= all - crlf ? "\r\n" : "\n";
}
function withEol(text, eol) {
  if (!eol) return text;
  const lf = toLF(text);
  return eol === "\n" ? lf : lf.replace(/\n/g, "\r\n");
}
function foldToLF(content) {
  const lf = toLF(content);
  const at2 = new Int32Array(lf.length + 1);
  let j = 0;
  for (let i = 0; i < content.length; i += 1) {
    at2[j] = i;
    if (content.charCodeAt(i) === 13 && content.charCodeAt(i + 1) === 10) i += 1;
    j += 1;
  }
  at2[j] = content.length;
  return { lf, at: at2 };
}
function spansOf(hay, needle, all) {
  const spans = [];
  for (let at2 = hay.indexOf(needle); at2 !== -1; at2 = hay.indexOf(needle, at2 + needle.length)) {
    spans.push([at2, at2 + needle.length]);
    if (!all && spans.length === 2) break;
  }
  return spans;
}
function exactSpans(content, needle, all) {
  const { lf, at: at2 } = foldToLF(content);
  const folded = spansOf(lf, toLF(needle), all).map(([s, e]) => [at2[s], at2[e]]);
  if (folded.length > 0) return { tier: content.slice(folded[0][0], folded[0][1]) === needle ? "exact" : "crlf", spans: folded };
  return { tier: "exact", spans: spansOf(content, needle, all) };
}
var ESCAPE = /\\(["'nt\\])/g;
var UNESCAPED = { '"': '"', "'": "'", n: "\n", t: "	", "\\": "\\" };
var unescape = (s, kinds) => s.replace(ESCAPE, (seq, c) => kinds.has(c) ? UNESCAPED[c] : seq);
function overEscapedKinds(content, oldString) {
  const kinds = /* @__PURE__ */ new Set();
  for (const m of oldString.matchAll(ESCAPE)) {
    if (!content.includes(m[0])) kinds.add(m[1]);
  }
  return kinds.size ? kinds : null;
}
function fileLines(content) {
  const out = [];
  let start = 0;
  while (start <= content.length) {
    const nl = content.indexOf("\n", start);
    const lineEnd = nl === -1 ? content.length : nl;
    const end = lineEnd > start && content.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
    out.push({ start, end, next: nl === -1 ? content.length : nl + 1, text: content.slice(start, end) });
    if (nl === -1) break;
    start = nl + 1;
  }
  return out;
}
var indentOf = (line) => /^[ \t]*/.exec(line)[0];
var isWord = (ch) => ch !== void 0 && /\w/.test(ch);
var boundary = (a, b) => !isWord(a) || !isWord(b);
function fitLine(file, old, k, n, lastMustBeFull) {
  const f = file.trim();
  const o = old.trim();
  if (f === o) return "full";
  if (n === 1 || o === "") return null;
  if (k === 0 && f.endsWith(o) && boundary(f[f.length - o.length - 1], o[0])) return "suffix";
  if (k === n - 1 && !lastMustBeFull && f.startsWith(o) && boundary(o[o.length - 1], f[o.length])) return "prefix";
  return null;
}
var widthOf = (indent) => [...indent].reduce((w, ch) => w + (ch === "	" ? 4 : 1), 0);
function indentMap(lines, i, old, fits) {
  const map = [];
  for (let k = 0; k < old.length; k += 1) {
    if (fits[k] !== "full" || old[k].trim() === "") continue;
    const from = indentOf(old[k]);
    const to = indentOf(lines[i + k].text);
    const seen = map.find(([o]) => o === from);
    if (seen && seen[1] !== to) return null;
    if (!seen) map.push([from, to]);
  }
  for (const [oa, fa] of map) {
    for (const [ob, fb] of map) {
      const dOld = widthOf(oa) - widthOf(ob);
      const dFile = widthOf(fa) - widthOf(fb);
      if (Math.sign(dOld) !== Math.sign(dFile)) return null;
    }
  }
  return map;
}
function reindent(line, map) {
  if (line.trim() === "") return "";
  const ind = indentOf(line);
  let best;
  for (const pair of map) {
    if (ind.startsWith(pair[0]) && (!best || pair[0].length > best[0].length)) best = pair;
  }
  return best ? best[1] + line.slice(best[0].length) : line;
}
function whitespaceSplices(content, oldString, newString, all, eol) {
  const oldLF = toLF(oldString);
  const endsWithNewline = oldLF.endsWith("\n");
  const old = (endsWithNewline ? oldLF.slice(0, -1) : oldLF).split("\n");
  if (old.every((l) => l.trim() === "")) return [];
  const lines = fileLines(content);
  const n = old.length;
  const splices = [];
  for (let i = 0; i + n <= lines.length; ) {
    const fits = [];
    for (let k = 0; k < n; k += 1) {
      const fit = fitLine(lines[i + k].text, old[k], k, n, endsWithNewline);
      if (!fit) break;
      fits.push(fit);
    }
    const anchored = fits.length === n && fits.some((fit, k) => fit === "full" && old[k].trim() !== "");
    const map = anchored ? indentMap(lines, i, old, fits) : null;
    if (!map) {
      i += 1;
      continue;
    }
    splices.push(whitespaceSplice(content, lines, i, old, fits, map, newString, endsWithNewline, eol));
    if (!all && splices.length === 2) break;
    i += n;
  }
  return splices;
}
function whitespaceSplice(content, lines, i, old, fits, map, newString, endsWithNewline, eol) {
  const n = old.length;
  const first = lines[i];
  const last = lines[i + n - 1];
  const start = fits[0] === "suffix" ? first.start + first.text.trimEnd().length - old[0].trim().length : first.start;
  let end;
  let newLF = toLF(newString);
  if (fits[n - 1] === "prefix") end = last.start + indentOf(last.text).length + old[n - 1].trim().length;
  else if (!endsWithNewline) end = last.end;
  else if (last.next > last.end) end = last.next;
  else {
    end = content.length;
    if (newLF.endsWith("\n")) newLF = newLF.slice(0, -1);
  }
  const out = newLF.split("\n").map((l, k) => k === 0 && fits[0] === "suffix" ? l.trimStart() : reindent(l, map));
  return { start, end, text: out.join(eol) };
}
function matchEdit(content, oldString, newString, replaceAll, eol) {
  const decide = (tier2, splices) => {
    if (splices.length === 0) return null;
    if (splices.length > 1 && !replaceAll) return { ambiguous: true };
    return { tier: tier2, splices };
  };
  const spliced = (spans, text) => spans.map(([start, end]) => ({ start, end, text }));
  const exact = exactSpans(content, oldString, replaceAll);
  const t1 = decide(exact.tier, spliced(exact.spans, withEol(newString, eol)));
  if (t1) return t1;
  const kinds = overEscapedKinds(content, oldString);
  const repaired = kinds ? unescape(oldString, kinds) : null;
  const newRepaired = kinds ? unescape(newString, kinds) : newString;
  if (repaired !== null) {
    const t2 = decide("unescaped", spliced(exactSpans(content, repaired, replaceAll).spans, withEol(newRepaired, eol)));
    if (t2) return t2;
  }
  const writeEol = eol ?? "\n";
  const t3 = decide("whitespace", whitespaceSplices(content, oldString, newString, replaceAll, writeEol));
  if (t3 || repaired === null) return t3;
  return decide("whitespace", whitespaceSplices(content, repaired, newRepaired, replaceAll, writeEol));
}

// ../packages/agent-tools/src/edit.ts
var MIN_CONTAINS_NEEDLE = 8;
var EXCERPT_RADIUS = 3;
var EDIT_EXCERPT_CONTEXT = 2;
var EDIT_EXCERPT_MAX_LINES = 40;
function numberedLines(lines, from, to) {
  return lines.slice(from, to).map((l, i) => `${from + i + 1}: ${l}`).join("\n");
}
function excerptAfterEdit(content, region) {
  const lines = content.split(/\r?\n/);
  const from = Math.max(0, region.startLine - 1 - EDIT_EXCERPT_CONTEXT);
  const to = Math.min(lines.length, region.endLine + EDIT_EXCERPT_CONTEXT);
  if (to - from <= EDIT_EXCERPT_MAX_LINES) return numberedLines(lines, from, to);
  const half = Math.floor(EDIT_EXCERPT_MAX_LINES / 2);
  return `${numberedLines(lines, from, from + half)}
\u2026
${numberedLines(lines, to - half, to)}`;
}
function regionAt(content, offset, newS) {
  const startLine = countNewlines(content.slice(0, offset)) + 1;
  return { startLine, endLine: startLine + countNewlines(newS) };
}
function findNearest(content, oldString) {
  const needle = oldString.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!needle) return void 0;
  const lines = content.split(/\r?\n/);
  let index = lines.findIndex((l) => l.trim() === needle);
  if (index === -1 && needle.length >= MIN_CONTAINS_NEEDLE) index = lines.findIndex((l) => l.includes(needle));
  if (index === -1) return void 0;
  const from = Math.max(0, index - EXCERPT_RADIUS);
  const to = Math.min(lines.length, index + EXCERPT_RADIUS + 1);
  return { line: index + 1, excerpt: numberedLines(lines, from, to) };
}
function applyStringEdit(content, oldString, newString, replaceAll = false) {
  if (typeof oldString !== "string" || oldString.length === 0) {
    return { ok: false, error: "oldString is required" };
  }
  const match = matchEdit(content, oldString, newString, replaceAll, dominantEol(content));
  if (match && "ambiguous" in match) {
    return {
      ok: false,
      error: "oldString is not unique; add more surrounding context or set replaceAll"
    };
  }
  if (match) {
    const parts = [];
    let from = 0;
    for (const { start, end, text } of match.splices) {
      parts.push(content.slice(from, start), text);
      from = end;
    }
    parts.push(content.slice(from));
    const next = parts.join("");
    const first = match.splices[0];
    const region = regionAt(content, first.start, first.text);
    return { ok: true, content: next, replaced: match.splices.length, region, excerpt: excerptAfterEdit(next, region), matchedBy: match.tier };
  }
  const nearest = findNearest(content, oldString);
  return {
    ok: false,
    error: "oldString not found in file \u2014 read_file and copy the exact text (including indentation)",
    ...nearest ? { nearest } : {}
  };
}
function editedFilesOf(toolName, args) {
  const entries = callWriteEntriesOf(args);
  const top = entries[0] ?? null;
  const out = [];
  if (toolName === "edit_file") {
    for (const e of entries) {
      if (!e.path) continue;
      if (e.before !== void 0 || e.after !== void 0) {
        out.push({ path: e.path, ...e.before !== void 0 ? { before: e.before } : {}, ...e.after !== void 0 ? { after: e.after } : {} });
      } else if (e.batched) {
        out.push({ path: e.path });
      }
    }
  } else if (toolName === "write_file" && top?.path) {
    out.push({ path: top.path, ...top.content !== void 0 ? { after: top.content } : {} });
  }
  if (out.length === 0 && top?.path) out.push({ path: top.path });
  return out;
}
function editedPathsOf(toolName, args) {
  return [...new Set(editedFilesOf(toolName, args).map((f) => f.path))];
}
var EDIT_BATCH_MAX = 20;
function entryProblem(e) {
  if (typeof e.path !== "string" || e.path.trim() === "") return "path is required";
  if (typeof e.old_string !== "string" || e.old_string.length === 0) return "old_string is required";
  if (typeof e.new_string !== "string") return "new_string is required";
  return null;
}
function planBatchEdits(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { edits: [], error: "edits must be a non-empty array" };
  if (raw.length > EDIT_BATCH_MAX) return { edits: [], error: `edits takes at most ${EDIT_BATCH_MAX} edits per call \u2014 split the rest into another edit_file` };
  const edits = raw;
  for (let i = 0; i < edits.length; i += 1) {
    const problem = entryProblem(edits[i]);
    if (problem) return { edits: [], error: `edit ${i + 1} (${edits[i].path ?? "?"}): ${problem}`, invalidAt: i };
  }
  return { edits };
}
async function applyBatchEdits(plan, io) {
  if (plan.error || plan.invalidAt !== void 0) {
    return { ok: false, files: [{ path: "", ok: false, error: plan.error ?? "invalid edits" }] };
  }
  const overlay = /* @__PURE__ */ new Map();
  const outcomes = [];
  for (let i = 0; i < plan.edits.length; i += 1) {
    const e = plan.edits[i];
    const base = overlay.has(e.path) ? overlay.get(e.path) : await io.read(e.path) ?? null;
    if (base === null || base === void 0) {
      return { ok: false, files: [...outcomes, { path: e.path, ok: false, error: `edit ${i + 1}: file not found \u2014 ${e.path}` }] };
    }
    const r = applyStringEdit(overlay.get(e.path) ?? base, e.old_string, e.new_string, e.replace_all === true);
    if (!r.ok || r.content == null) {
      return {
        ok: false,
        files: [...outcomes, { path: e.path, ok: false, error: `edit ${i + 1} (${e.path}): ${r.error ?? "did not match"}`, ...r.nearest ? { nearest: r.nearest } : {} }]
      };
    }
    overlay.set(e.path, r.content);
    outcomes.push({
      path: e.path,
      ok: true,
      content: r.content,
      ...r.replaced != null ? { replaced: r.replaced } : {},
      ...r.region ? { region: r.region } : {},
      ...r.excerpt ? { excerpt: r.excerpt } : {},
      ...r.matchedBy && r.matchedBy !== "exact" ? { matchedBy: r.matchedBy } : {}
    });
  }
  const written = /* @__PURE__ */ new Set();
  for (const o of outcomes) {
    if (written.has(o.path)) continue;
    written.add(o.path);
    await io.write(o.path, overlay.get(o.path));
  }
  return { ok: true, files: outcomes.map(({ content: _c, ...rest }) => rest) };
}

// ../packages/agent-tools/src/editBalance.ts
var LEXED_EXTENSIONS = /* @__PURE__ */ new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "json",
  "jsonc"
]);
var JSX_EXTENSIONS = /* @__PURE__ */ new Set(["jsx", "tsx"]);
var EXPRESSION_KEYWORDS = /* @__PURE__ */ new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await"
]);
var ZERO = Object.freeze({ curly: 0, paren: 0, square: 0 });
var WORD_START = /[A-Za-z_$]/;
var WORD_CHAR = /[\w$]/;
var JSX_NAME = /^[A-Za-z_$][\w$.:-]*/;
function extensionOf(ext) {
  const dot = ext.lastIndexOf(".");
  return (dot >= 0 ? ext.slice(dot + 1) : ext).toLowerCase();
}
function bracketBalance(text, options = {}) {
  const jsx = options.jsx === true;
  const out = { curly: 0, paren: 0, square: 0 };
  const n = text.length;
  let i = 0;
  let expr = true;
  const skipQuoted = (quote, multiline) => {
    i += 1;
    while (i < n && text[i] !== quote && (multiline || text[i] !== "\n")) i += !multiline && text[i] === "\\" ? 2 : 1;
    i += 1;
  };
  const tryRegex = () => {
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const c = text[j];
      if (c === "\n") return false;
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        j += 1;
        while (j < n && /[a-z]/i.test(text[j])) j += 1;
        i = j;
        return true;
      }
      j += 1;
    }
    return false;
  };
  const container = () => {
    out.curly += 1;
    i += 1;
    code(true);
    if (text[i] === "}") {
      out.curly -= 1;
      i += 1;
    }
  };
  const skipSpace = () => {
    while (i < n && /\s/.test(text[i])) i += 1;
  };
  const jsxChildren = () => {
    while (i < n) {
      const c = text[i];
      if (c === "{") {
        container();
        continue;
      }
      if (c === "<") {
        if (text[i + 1] === "/") {
          const end = text.indexOf(">", i);
          i = end < 0 ? n : end + 1;
          return;
        }
        if (tryJsxElement()) continue;
      }
      i += 1;
    }
  };
  const tryJsxElement = () => {
    const start = i;
    i += 1;
    if (text[i] === ">") {
      i += 1;
      jsxChildren();
      return true;
    }
    const name = JSX_NAME.exec(text.slice(i, i + 200));
    if (!name) {
      i = start;
      return false;
    }
    i += name[0].length;
    let first = true;
    while (i < n) {
      skipSpace();
      if (i >= n) return true;
      const c = text[i];
      if (c === "/" && text[i + 1] === ">") {
        i += 2;
        return true;
      }
      if (c === ">") {
        i += 1;
        jsxChildren();
        return true;
      }
      if (c === "{") {
        container();
        first = false;
        continue;
      }
      const attr = JSX_NAME.exec(text.slice(i, i + 200));
      if (!attr || first && attr[0] === "extends") {
        i = start;
        return false;
      }
      first = false;
      i += attr[0].length;
      skipSpace();
      if (text[i] !== "=") continue;
      i += 1;
      skipSpace();
      if (text[i] === '"' || text[i] === "'") skipQuoted(text[i], true);
      else if (text[i] === "{") container();
    }
    return true;
  };
  function code(nested) {
    let depth = 0;
    while (i < n) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === "\n") {
        expr = true;
        i += 1;
        continue;
      }
      if (/\s/.test(ch)) {
        i += 1;
        continue;
      }
      if (ch === "/" && next === "/") {
        const end = text.indexOf("\n", i);
        i = end < 0 ? n : end;
        continue;
      }
      if (ch === "/" && next === "*") {
        const end = text.indexOf("*/", i + 2);
        i = end < 0 ? n : end + 2;
        continue;
      }
      if (ch === "/" && expr && tryRegex()) {
        expr = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        skipQuoted(ch, false);
        expr = false;
        continue;
      }
      if (ch === "`") {
        i += 1;
        template();
        expr = false;
        continue;
      }
      if (ch === "<" && jsx && expr && tryJsxElement()) {
        expr = false;
        continue;
      }
      if (WORD_START.test(ch) || /\d/.test(ch)) {
        const start = i;
        while (i < n && WORD_CHAR.test(text[i])) i += 1;
        expr = EXPRESSION_KEYWORDS.has(text.slice(start, i));
        continue;
      }
      if (ch === "{") {
        out.curly += 1;
        depth += 1;
        expr = true;
      } else if (ch === "}") {
        if (nested && depth === 0) return;
        out.curly -= 1;
        if (depth > 0) depth -= 1;
        expr = true;
      } else if (ch === "(" || ch === "[") {
        out[ch === "(" ? "paren" : "square"] += 1;
        expr = true;
      } else if (ch === ")" || ch === "]") {
        out[ch === ")" ? "paren" : "square"] -= 1;
        expr = false;
      } else expr = ch !== ".";
      i += 1;
    }
  }
  function template() {
    while (i < n) {
      const ch = text[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") {
        i += 1;
        return;
      }
      if (ch === "$" && text[i + 1] === "{") {
        i += 2;
        expr = true;
        code(true);
        if (text[i] === "}") i += 1;
        continue;
      }
      i += 1;
    }
  }
  code(false);
  return out;
}
function bracketDelta(before, after, ext) {
  const e = extensionOf(ext);
  if (!LEXED_EXTENSIONS.has(e)) return { ...ZERO };
  const options = { jsx: JSX_EXTENSIONS.has(e) };
  const b = bracketBalance(before, options);
  const a = bracketBalance(after, options);
  return { curly: a.curly - b.curly, paren: a.paren - b.paren, square: a.square - b.square };
}
function changesBalance(delta) {
  return delta.curly !== 0 || delta.paren !== 0 || delta.square !== 0;
}
function describeBracketDelta(d, style = "name") {
  const glyph = { curly: "`{}`", paren: "`()`", square: "`[]`" };
  return ["curly", "paren", "square"].filter((k) => d[k] !== 0).map((k) => `${style === "glyph" ? glyph[k] : k} ${d[k] > 0 ? "+" : ""}${d[k]}`).join(style === "glyph" ? ", " : " \xB7 ");
}

// ../packages/agent-tools/src/workstreamScope.ts
function normalizeScopePath(path) {
  return path.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}
function inScope(path, scope) {
  const p = normalizeScopePath(path);
  return scope.some((entry) => {
    const s = normalizeScopePath(entry);
    return s === "" || p === s || p.startsWith(`${s}/`);
  });
}
function overlappingScopes(scopes) {
  for (let i = 0; i < scopes.length; i++) {
    for (let j = i + 1; j < scopes.length; j++) {
      for (const path of scopes[i].paths) {
        if (inScope(path, scopes[j].paths) || scopes[j].paths.some((q) => inScope(q, [path]))) {
          return { a: scopes[i].label, b: scopes[j].label, path: normalizeScopePath(path) };
        }
      }
    }
  }
  return null;
}

// ../packages/agent-tools/src/writeScope.ts
function norm(path) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}
function isAbs(path) {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(norm(path));
}
function hasParent(path) {
  return norm(path).split("/").includes("..");
}
function join(root, rel2) {
  const base = norm(root);
  const rest = norm(rel2).replace(/^\.\//, "");
  return rest ? `${base}/${rest}` : base;
}
function resolveScope(entry, paths) {
  if (entry.key === "root") return norm(paths.root);
  const base = norm(paths[entry.key]);
  const sub = entry.sub?.replace(/^[/\\]+|[/\\]+$/g, "");
  if (!sub || hasParent(sub)) return base;
  return `${base}/${norm(sub)}`;
}
function within(folder, target, workspaceRoot) {
  const folderNorm = norm(folder);
  const root = norm(workspaceRoot);
  const raw = norm(target).replace(/^\.\//, "");
  const abs = isAbs(raw) ? raw : join(root, raw);
  if (abs === folderNorm || abs.startsWith(`${folderNorm}/`)) return true;
  const folderRel = folderNorm.startsWith(`${root}/`) ? folderNorm.slice(root.length + 1) : folderNorm;
  if (raw === folderRel || raw.startsWith(`${folderRel}/`)) return true;
  const withoutDot = folderRel.replace(/^\.builderforce\//, "");
  return raw === withoutDot || raw.startsWith(`${withoutDot}/`);
}
function describe(entry) {
  if (entry.key === "root") return "the workspace root";
  return entry.sub ? `${entry.key}/${entry.sub}` : entry.key;
}
function writeAllowed(scope, paths, target, roleName) {
  if (scope === void 0) return { allowed: true };
  if (!target.trim() || hasParent(target)) {
    return { allowed: false, reason: `${roleName} may not write a path that leaves its scope` };
  }
  const folders = scope.map((entry) => resolveScope(entry, paths));
  if (folders.some((folder) => within(folder, target, paths.root))) return { allowed: true };
  const where = scope.map(describe).join(" or ");
  return { allowed: false, reason: `${roleName} may only write under ${where}` };
}

// ../packages/agent-tools/src/gzipText.ts
async function readGzipText(bytes) {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  const decoded = await new Response(stream.readable).arrayBuffer();
  return new TextDecoder().decode(decoded);
}
function latin1Bytes(content) {
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 255;
  return bytes;
}
function isGzipPath(path) {
  return path.toLowerCase().endsWith(".gz");
}

// ../packages/agent-tools/src/jsonKeyRead.ts
var JSON_KEY_READ_MAX_CHARS = 12e3;
var MAX_LISTED_KEYS = 60;
function keysOf(value) {
  return value !== null && typeof value === "object" ? Object.keys(value) : [];
}
function readJsonKey(text, key) {
  let root;
  try {
    root = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "the file is not valid JSON, so `key` cannot be used \u2014 read it by line window instead" };
  }
  const segments = key.split(".").filter((s) => s.length > 0);
  if (segments.length === 0) return { ok: false, error: '`key` is empty \u2014 name a dot path such as "admin.visitorFlow"' };
  let node = root;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const container = node !== null && typeof node === "object" ? node : null;
    if (!container || !Object.prototype.hasOwnProperty.call(container, segment)) {
      const at2 = segments.slice(0, i).join(".") || "(root)";
      return {
        ok: false,
        error: `key "${segments.slice(0, i + 1).join(".")}" not found \u2014 ${at2} has no "${segment}"`,
        availableKeys: keysOf(node).slice(0, MAX_LISTED_KEYS)
      };
    }
    node = container[segment];
  }
  const content = JSON.stringify(node, null, 2) ?? "null";
  if (content.length <= JSON_KEY_READ_MAX_CHARS) return { ok: true, key: segments.join("."), content };
  return { ok: true, key: segments.join("."), tooLarge: true, size: content.length, childKeys: keysOf(node).slice(0, MAX_LISTED_KEYS) };
}

// ../packages/agent-tools/src/glob.ts
var REGEX_SPECIALS = /* @__PURE__ */ new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\", "/"]);
function globToRegExp(pattern) {
  pattern = pattern.replace(/\*{3,}/g, "**").replace(/(?:\*\*\/){2,}/g, "**/");
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i++;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += REGEX_SPECIALS.has(c) ? "\\" + c : c;
    }
  }
  return new RegExp("^" + collapseWildcards(re) + "$", "i");
}
function collapseWildcards(re) {
  let prev;
  do {
    prev = re;
    re = re.replace(/(?:\.\*|\[\^\/\]\*)(?:\.\*|\[\^\/\]\*)+/g, (run) => run.includes(".*") ? ".*" : "[^/]*");
  } while (re !== prev);
  return re;
}
function matchGlob(pathPosix, pattern) {
  const re = globToRegExp(pattern);
  if (!pattern.includes("/")) {
    const base = pathPosix.slice(pathPosix.lastIndexOf("/") + 1);
    return re.test(base);
  }
  return re.test(pathPosix);
}
function normalizeScopeDir(raw) {
  return (raw ?? "").split("\\").join("/").trim().replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
}
function emptyGlobListingNote(glob, scopeDir, truncated) {
  const scope = normalizeScopeDir(scopeDir);
  const base = `No file matches glob "${glob}"${scope ? ` under "${scope}"` : ""}.`;
  if (truncated) {
    return `${base} This is NOT proof the file does not exist: the search was cut off before the tree was fully scanned, so this only means "not among the paths scanned so far". Narrow \`path\` to a smaller folder and re-run, or use \`search_code\`/\`find_symbol\` for a specific name, before concluding anything is missing.`;
  }
  return `${base} Try a broader pattern (e.g. "*${glob.replace(/[*?/]/g, "")}*"), or list_files without a glob to see the tree. 0 matches means no such file exists in the paths scanned \u2014 do not claim one is missing without trying a broader glob first.`;
}

// ../packages/agent-tools/src/tool.ts
function defineTool(def) {
  return {
    name: def.name,
    requires: def.requires ?? [],
    schema: {
      type: "function",
      function: { name: def.name, description: def.description, parameters: def.parameters }
    },
    execute: def.execute
  };
}

// ../packages/agent-tools/src/toolAliases.ts
var TOOL_NAME_ALIASES = {
  list_dir: "list_files",
  listdir: "list_files",
  list_directory: "list_files",
  list_directories: "list_files",
  ls_dir: "list_files",
  // Shell / terminal
  bash: "run_command",
  shell: "run_command",
  run_terminal_cmd: "run_command",
  execute_command: "run_command",
  run_shell_command: "run_command",
  // Search
  grep: "search_code",
  codebase_search: "search_code",
  search_files: "search_code",
  find_files: "list_files",
  glob_file_search: "list_files",
  // Edit / write
  str_replace: "edit_file",
  search_replace: "edit_file",
  apply_patch: "edit_file",
  write_to_file: "write_file",
  create_file: "write_file",
  delete: "delete_file"
};
function normalizeToolName(name) {
  return name.trim().toLowerCase();
}
function resolveToolAlias(name) {
  const key = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[key] ?? name;
}

// ../packages/agent-tools/src/registry.ts
function schemaForCapabilities(def, caps) {
  if (!def.describeFor) return def.schema;
  return { ...def.schema, function: { ...def.schema.function, description: def.describeFor(caps) } };
}
var ToolRegistry = class {
  tools = /* @__PURE__ */ new Map();
  constructor(defs = []) {
    for (const d of defs) this.register(d);
  }
  /** Register a tool. Throws on a duplicate name so two tools can't silently shadow. */
  register(def) {
    if (this.tools.has(def.name)) throw new Error(`duplicate tool '${def.name}'`);
    this.tools.set(def.name, def);
    return this;
  }
  has(name) {
    return this.tools.has(name);
  }
  get(name) {
    return this.tools.get(name);
  }
  /** True when `provider` advertises every capability `def` requires. */
  satisfies(def, caps) {
    return def.requires.every((c) => caps.has(c));
  }
  /** The tool definitions runnable under a raw capability set, in registration order. */
  toolsForCapabilities(caps) {
    return [...this.tools.values()].filter((d) => this.satisfies(d, caps));
  }
  /** The tool definitions a surface can actually run, in registration order. */
  toolsFor(provider) {
    return this.toolsForCapabilities(provider.capabilities);
  }
  /** The OpenAI-schema array for a raw capability set (schema-only surfaces, e.g. a
   *  container that runs its own loop and just needs the advertised schema). */
  schemasForCapabilities(caps) {
    return this.toolsForCapabilities(caps).map((d) => schemaForCapabilities(d, caps));
  }
  /** The OpenAI-schema array to send to the model for this surface. */
  schemasFor(provider) {
    return this.schemasForCapabilities(provider.capabilities);
  }
  /** Comma-separated tool names available to a surface — for the "unknown tool"
   *  error message so the model is told what it *can* call here. */
  availableNames(provider) {
    return this.toolsFor(provider).map((d) => d.name);
  }
  /**
   * Dispatch one tool call. Enforces capability gating at call time too (defense in
   * depth: a model can hallucinate a tool the surface didn't advertise), returning a
   * structured `ok:false` rather than throwing so the loop can feed it back.
   */
  async dispatch(name, args, ctx) {
    const resolved = resolveToolAlias(name);
    const def = this.tools.get(resolved);
    if (!def) {
      return {
        data: {
          ok: false,
          error: `unknown tool '${name}'. Available tools: ${this.availableNames(ctx.caps).join(", ")}.`
        }
      };
    }
    if (!this.satisfies(def, ctx.caps.capabilities)) {
      return {
        data: {
          ok: false,
          error: `tool '${resolved}' is not available on this surface (missing capability: ${def.requires.filter((c) => !ctx.caps.capabilities.has(c)).join(", ")}).`
        }
      };
    }
    return def.execute(args, ctx);
  }
};

// ../packages/agent-tools/src/toolNaming.ts
var BUILTIN_TOOL_PREFIX = "builtin_";
var NAMESPACE_SEPARATOR = "__";
var NON_IDENT = /[^a-zA-Z0-9]+/g;
function advertisedToolName(id) {
  return `${BUILTIN_TOOL_PREFIX}${id.replace(NON_IDENT, "_")}`;
}
function resolveAdvertisedToolName(requested, knownNames) {
  const name = requested.trim();
  if (!name) return null;
  const known = knownNames instanceof Set ? knownNames : new Set(knownNames);
  if (known.has(name)) return name;
  if (name.includes(NAMESPACE_SEPARATOR)) return null;
  const flat = name.replace(NON_IDENT, "_").replace(/^_+|_+$/g, "");
  if (!flat) return null;
  const candidate = flat.toLowerCase().startsWith(BUILTIN_TOOL_PREFIX) ? `${BUILTIN_TOOL_PREFIX}${flat.slice(BUILTIN_TOOL_PREFIX.length)}` : advertisedToolName(flat);
  return known.has(candidate) ? candidate : null;
}
function resolveCallName(raw, knownNames) {
  const alias = resolveToolAlias(raw);
  return resolveAdvertisedToolName(alias, knownNames) ?? alias;
}
var nameSets = /* @__PURE__ */ new WeakMap();
function toolNameSet(tools, nameOf) {
  let set = nameSets.get(tools);
  if (!set) {
    set = new Set(tools.map(nameOf).filter((n) => !!n));
    nameSets.set(tools, set);
  }
  return set;
}

// ../packages/agent-tools/src/gatePaths.ts
var PATCH_MARKERS = {
  begin: "*** Begin Patch",
  end: "*** End Patch",
  add: "*** Add File: ",
  delete: "*** Delete File: ",
  update: "*** Update File: ",
  move: "*** Move to: "
};
function parsePatchHeader(line) {
  const text = line.trim();
  for (const kind of ["add", "delete", "update", "move"]) {
    const marker = PATCH_MARKERS[kind];
    if (text.startsWith(marker)) return { kind, path: text.slice(marker.length) };
  }
  return null;
}
function patchHeaderPaths(input) {
  if (typeof input !== "string" || !input.includes(PATCH_MARKERS.begin)) return [];
  const out = [];
  for (const line of input.split(/\r?\n/)) {
    const header = parsePatchHeader(line);
    if (header && header.path.trim()) out.push(header.path.trim());
  }
  return out;
}
function toolCallPaths(args) {
  if (!args) return [];
  const out = [];
  const add = (v) => {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  };
  add(args.path);
  add(args.filePath);
  add(args.file_path);
  add(args.oldPath);
  add(args.newPath);
  if (Array.isArray(args.paths)) {
    for (const p of args.paths) add(p);
  }
  for (const p of patchHeaderPaths(args.input)) add(p);
  return out;
}
function segmentsOf(path) {
  const raw = path.trim().replace(/\\/g, "/");
  const rooted = raw.startsWith("/") || raw.startsWith("~") || /^[A-Za-z]:\//.test(raw);
  const segments = [];
  let climbs = false;
  for (const seg of raw.replace(/^[A-Za-z]:/, "").split("/")) {
    if (!seg || seg === "." || seg === "~") continue;
    if (seg === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
      else {
        segments.push("..");
        climbs = true;
      }
      continue;
    }
    segments.push(seg);
  }
  return { segments, rooted, climbs };
}
function gatePathCandidates(path, workspaceRoot) {
  if (!path.trim()) return [];
  const { segments, rooted, climbs } = segmentsOf(path);
  const resolved = segments.join("/");
  if (!rooted && !climbs) return [resolved];
  if (rooted && workspaceRoot?.trim()) {
    const root = segmentsOf(workspaceRoot);
    const same = (a, b) => a === b || a.toLowerCase() === b.toLowerCase();
    const inside = root.rooted && !root.climbs && root.segments.length > 0 && root.segments.every((seg, i) => segments[i] !== void 0 && same(seg, segments[i]));
    if (inside) return [segments.slice(root.segments.length).join("/")];
  }
  const named = segments.filter((s) => s !== "..");
  const tails = named.map((_, i) => named.slice(i).join("/"));
  return [.../* @__PURE__ */ new Set([resolved, ...tails])].filter(Boolean);
}

// ../packages/agent-tools/src/tool-side-effect.ts
var TOOL_SIDE_EFFECT = {
  // ── CORE_TOOLS (includes symbols, semantic, git) ──────────────────────────
  list_files: "read",
  search_code: "read",
  read_file: "read",
  find_symbol: "read",
  file_outline: "read",
  semantic_search: "read",
  repo_map: "read",
  read_compressed: "read",
  // Its answer cache under .builderforce/ is a cache, like the symbol index
  // find_symbol keeps there — no change the person would review.
  local_research: "read",
  // Shells out to the analyzers and writes their artifacts under
  // .builderforce/code-analysis/, so it is a working-tree write, not a read.
  analyze_codebase: "mutate",
  write_file: "mutate",
  edit_file: "mutate",
  delete_file: "mutate",
  run_checks: "verify",
  run_command: "mutate",
  // A background job's status is a read; stopping one kills processes.
  command_status: "read",
  // Filters an output already retained from an earlier run_command — runs nothing.
  output_filter: "read",
  command_stop: "mutate",
  git_status: "read",
  git_diff: "read",
  git_history: "read",
  git_sync_latest: "mutate",
  git_undo: "mutate",
  git_redo: "mutate",
  git_commit: "mutate",
  git_push: "mutate",
  open_pull_request: "mutate",
  git_cleanup_merged: "mutate",
  web_fetch: "read",
  web_search: "read",
  memory_recall: "read",
  memory_remember: "mutate",
  memory_forget: "mutate",
  claim_resource: "mutate",
  release_resource: "mutate",
  workspace_note: "mutate",
  workspace_read: "read",
  ask_human: "read",
  update_prd: "mutate",
  finish: "read",
  // ── SKILL_TOOLS ───────────────────────────────────────────────────────────
  skill_propose: "mutate",
  skill_list: "read",
  // ── SUBAGENT_TOOLS (includes live control verbs) ──────────────────────────
  spawn_agent: "mutate",
  spawn_agents: "mutate",
  wait_agents: "read",
  message_agent: "mutate",
  stop_agent: "mutate"
};
function toolSideEffect(name) {
  return Object.prototype.hasOwnProperty.call(TOOL_SIDE_EFFECT, name) ? TOOL_SIDE_EFFECT[name] : void 0;
}
function isProgressBookkeeping(name) {
  return name === "remember_fact" || name === "memory_remember";
}
function normalizeAction(value) {
  if (typeof value !== "string") return void 0;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized || void 0;
}
function classifyTool(name, declared, args) {
  const cataloged = toolSideEffect(name);
  if (cataloged) return cataloged;
  if (declared?.mutates !== void 0) return declared.mutates ? "mutate" : "read";
  if (HOST_READ_ONLY_TOOLS.has(name.trim().toLowerCase())) return "read";
  const action = normalizeAction(args?.action);
  if (action && READ_ONLY_ACTIONS.has(action) && isActionDispatchedHostTool(name)) return "read";
  return "mutate";
}
function isMutatingTool(name, declared) {
  return classifyTool(name, declared) === "mutate";
}
function sideEffectLabel(effect) {
  return effect === "mutate" ? "mutating" : effect === "verify" ? "verification" : "read-only";
}
function classScopedDirective(directive, sideEffect) {
  return directive && sideEffect ? `For any ${sideEffectLabel(sideEffect)} tool: ${directive}` : directive;
}
var HOST_READ_ONLY_TOOLS = /* @__PURE__ */ new Set([
  "read",
  "ls",
  "find",
  "grep",
  "glob",
  "memory_search",
  "memory_get",
  "sessions_list",
  "sessions_history",
  "agents_list"
]);
var ACTION_DISPATCHED_HOST_TOOLS = /* @__PURE__ */ new Set(["process", "cron", "canvas", "gateway", "nodes", "browser"]);
function isActionDispatchedHostTool(name) {
  const normalized = name.trim().toLowerCase();
  return ACTION_DISPATCHED_HOST_TOOLS.has(normalized) || normalized.endsWith("_actions");
}
var READ_ONLY_ACTIONS = /* @__PURE__ */ new Set([
  "get",
  "list",
  "read",
  "status",
  "show",
  "fetch",
  "search",
  "query",
  "view",
  "poll",
  "log",
  "inspect",
  "check",
  "probe"
]);
var CONTROL_TOOL_NAMES = ["finish", "ask_human", "ask_user"];

// ../packages/agent-tools/src/spec.ts
function pathHitsPattern(path, pattern) {
  return matchGlob(path, pattern) || inScope(path, [pattern]);
}
function gateMatchesPath(g, callPath, workspaceRoot) {
  const patterns = g.paths;
  if (!patterns || patterns.length === 0) return true;
  const callPaths = (Array.isArray(callPath) ? callPath : callPath ? [callPath] : []).flatMap((p) => gatePathCandidates(p, workspaceRoot)).filter(Boolean);
  if (callPaths.length === 0) return false;
  return callPaths.some((p) => patterns.some((pat) => pathHitsPattern(p, pat)));
}
function bulletBlock(header, items) {
  return [header, ...items.map((x) => `- ${x}`)].join("\n");
}
function policyGateDirective(g) {
  const effectLabel = g.sideEffect ? sideEffectLabel(g.sideEffect) : "";
  const anyTool = g.sideEffect ? `any ${effectLabel} tool` : "any tool";
  const scope = !g.tool || g.tool === "*" ? anyTool : `the \`${g.tool}\` tool${g.sideEffect ? ` when it is a ${effectLabel} tool` : ""}`;
  const pathScope = g.paths?.length ? ` on ${g.paths.map((p) => `\`${p}\``).join(", ")}` : "";
  switch (g.effect) {
    case "inject-directive":
      return classScopedDirective((g.directive ?? "").trim(), g.sideEffect);
    case "require-approval":
      return `Before using ${scope}${pathScope}, pause and request explicit human approval${g.reason ? ` (${g.reason})` : ""}.`;
    case "block":
      return `Never use ${scope}${pathScope}${g.reason ? ` \u2014 ${g.reason}` : ""}. Refuse and explain instead.`;
  }
}
function renderPolicyDirectives(gates) {
  const lines = (gates ?? []).map(policyGateDirective).filter(Boolean);
  if (lines.length === 0) return "";
  return bulletBlock("Governance (these gates are binding):", lines);
}
function evaluatePolicyGate(gates, toolName, path, workspaceRoot, declared) {
  const called = normalizeToolName(toolName);
  const matches = (gates ?? []).filter(
    (g) => (!g.tool || g.tool === "*" || normalizeToolName(g.tool) === called) && (!g.sideEffect || classifyTool(called, declared) === g.sideEffect) && gateMatchesPath(g, path, workspaceRoot)
  );
  const blocked = matches.find((g) => g.effect === "block");
  if (blocked) return { action: "block", gateId: blocked.baseGateId ?? blocked.id, reason: blocked.reason ?? "blocked by policy" };
  const approval = matches.find((g) => g.effect === "require-approval");
  if (approval) {
    return { action: "require-approval", gateId: approval.baseGateId ?? approval.id, reason: approval.reason ?? "approval required by policy" };
  }
  return { action: "allow" };
}

// ../packages/agent-tools/src/gate-lowering.ts
var CONTROL = new Set(CONTROL_TOOL_NAMES);

// ../packages/agent-tools/src/policyGateCallKey.ts
function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
function policyGateCallKey(gateId, toolName, args) {
  return `${gateId}|${toolName}|${hash32(stableStringify(args))}`;
}

// ../packages/agent-tools/src/fileWindow.ts
var READ_DEFAULT_LINE_LIMIT = 2e3;
function windowFileContent(content, opts) {
  const lines = content.split("\n");
  const totalLines = lines.length;
  const start = opts?.offset && opts.offset > 1 ? Math.min(Math.floor(opts.offset), totalLines + 1) : 1;
  const limit = opts?.limit && opts.limit > 0 ? Math.floor(opts.limit) : READ_DEFAULT_LINE_LIMIT;
  const slice = lines.slice(start - 1, start - 1 + limit);
  const end = start - 1 + slice.length;
  return { content: slice.join("\n"), truncated: end < totalLines, totalLines, offset: start, returnedLines: slice.length };
}
function fileWindowNote(win) {
  if (!win.truncated) return void 0;
  const lastLine = win.offset + win.returnedLines - 1;
  return `Showing lines ${win.offset}\u2013${lastLine} of ${win.totalLines}. To continue, call read_file again with offset ${lastLine + 1}.`;
}

// ../packages/agent-tools/src/preSearch.ts
var DEFAULTS = {
  maxIdentifiers: 6,
  definitionsPerIdentifier: 3,
  referencesPerIdentifier: 4,
  maxChars: 3e3
};
var TOKEN = /[A-Za-z_$][\w$]*/g;
var REFERENCE_TEXT_MAX = 140;
function looksLikeIdentifier(word) {
  if (word.length < 3) return false;
  if (/^_+$/.test(word)) return false;
  if (word.includes("_") || word.includes("$")) return true;
  if (/[a-z][A-Z]/.test(word)) return true;
  if (/[0-9][A-Z]/.test(word) && /[a-z]/.test(word)) return true;
  if (/^[A-Z][A-Z0-9]*\d$/.test(word)) return true;
  return false;
}
function extractIdentifiers(request, max = DEFAULTS.maxIdentifiers) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (word) => {
    if (!word || seen.has(word) || out.length >= max) return;
    seen.add(word);
    out.push(word);
  };
  const text = request ?? "";
  for (const span of text.matchAll(/`([^`\n]{1,120})`/g)) {
    const words2 = span[1].match(TOKEN) ?? [];
    const last = words2[words2.length - 1];
    if (last && last.length >= 2) add(last);
  }
  for (const m of text.matchAll(/([A-Za-z_$][\w$]*)(\s*\()?/g)) {
    const word = m[1];
    const after = text.charAt((m.index ?? 0) + word.length);
    if (after === "." && /[A-Za-z]/.test(text.charAt((m.index ?? 0) + word.length + 1)) && !looksLikeIdentifier(word)) continue;
    if (m[2] && word.length >= 3 && /[a-z]/.test(word)) add(word);
    else if (looksLikeIdentifier(word)) add(word);
  }
  return out;
}
function escapeRegex(identifier) {
  return identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clip(s, n) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}\u2026` : t;
}
function renderPreSearchBlock(r, maxChars = DEFAULTS.maxChars) {
  if (r.definitions.length === 0 && r.references.length === 0) return "";
  const lines = [
    "## Pre-search (symbol index + text search, gathered before this run with no model call)",
    `Identifiers in the request: ${r.identifiers.map((i) => `\`${i}\``).join(", ")}`
  ];
  for (const id of r.identifiers) {
    for (const d of r.definitions.filter((x) => x.identifier === id)) {
      lines.push(`- \`${id}\` defined at ${d.path}:${d.line} (${d.kind}${d.exported ? ", exported" : ""})`);
    }
    for (const ref of r.references.filter((x) => x.identifier === id)) {
      lines.push(`- \`${id}\` at ${ref.path}:${ref.line} \u2014 ${clip(ref.text, REFERENCE_TEXT_MAX)}`);
    }
  }
  lines.push("Start from these locations (read_file with a line range) instead of searching for them again.");
  let out = lines.join("\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars).replace(/\n[^\n]*$/, "")}
- \u2026`;
  return out;
}
async function preSearch(request, ports, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const { signal } = options;
  const identifiers = extractIdentifiers(request, o.maxIdentifiers);
  const empty = { identifiers, definitions: [], references: [], block: "" };
  if (identifiers.length === 0 || signal?.aborted) return empty;
  const perId = await Promise.all(identifiers.map(async (identifier) => {
    const [defs, refs] = await Promise.all([
      ports.findSymbol ? ports.findSymbol(identifier).catch(() => ({ ok: false })) : Promise.resolve({ ok: false }),
      ports.searchText ? ports.searchText(escapeRegex(identifier), signal).catch(() => ({ ok: false })) : Promise.resolve({ ok: false })
    ]);
    const exact = (defs.ok ? defs.matches ?? [] : []).filter((m) => m.name === identifier && m.kind !== "heading");
    const definitions2 = exact.slice(0, o.definitionsPerIdentifier).map((m) => ({
      identifier,
      path: m.path,
      line: m.line,
      kind: m.kind,
      exported: m.exported
    }));
    const defined = new Set(definitions2.map((d) => `${d.path}:${d.line}`));
    const references2 = [];
    for (const m of refs.ok ? refs.matches ?? [] : []) {
      if (references2.length >= o.referencesPerIdentifier) break;
      const line = typeof m.line === "number" ? m.line : Number(m.line);
      if (!Number.isFinite(line) || defined.has(`${m.path}:${line}`)) continue;
      references2.push({ identifier, path: m.path, line, text: typeof m.text === "string" ? m.text : "" });
    }
    return { definitions: definitions2, references: references2 };
  }));
  const definitions = perId.flatMap((p) => p.definitions);
  const references = perId.flatMap((p) => p.references);
  const result = { identifiers, definitions, references };
  return { ...result, block: renderPreSearchBlock(result, o.maxChars) };
}
function preSearchFiles(r, max = 6) {
  const out = [];
  for (const p of [...r.definitions.map((d) => d.path), ...r.references.map((x) => x.path)]) {
    if (!out.includes(p)) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

// ../packages/agent-tools/src/knowledge/codeMask.ts
var SPACES = " ".repeat(256);

// ../packages/agent-tools/src/callScan.ts
var ID = "[A-Za-z_$][\\w$]*";
var MAX_SCANNED_LINE = 2048;
var JSX_TAG = new RegExp(`<(\\/?)([A-Z][\\w$]*(?:\\.${ID})*)(?=[\\s/>]|$)`, "g");

// ../packages/agent-tools/src/testPaths.ts
var TEST_SOURCE_PATH = /(?:^|\/)(?:__tests__|tests?|spec|e2e)\/|(?:^|\/)(?:test|spec)\.[^/]+$|\.(?:test|spec|e2e|e2e-spec)\.[^/]+$/i;
function isTestSourcePath(path) {
  return TEST_SOURCE_PATH.test(path.replace(/\\/g, "/"));
}

// ../packages/agent-tools/src/callbackOwners.ts
var MAX_OWNER_LITERAL = 80;
var STATEMENT = new RegExp(`^([ \\t]*)(${ID}(?:\\??\\.${ID})*)\\s*\\(`);
var CALLBACK_AT_END = new RegExp(`(?:\\([^()]*\\)(?:\\s*:\\s*[^=()]+)?\\s*=>|\\b${ID}\\s*=>|\\bfunction\\b[^(]*\\([^()]*\\))\\s*\\{\\s*$`);
var TOP_BLOCK = /^(?:if\s*\(.*\)|\}?\s*else(?:\s+if\s*\(.*\))?|try|\}?\s*finally|\{)\s*\{\s*$/;
var NOT_OWNERS = /* @__PURE__ */ new Set([
  "describe",
  "it",
  "test",
  "suite",
  "bench",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "requestAnimationFrame",
  "void",
  "await",
  "return",
  "new",
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "with",
  "do",
  "else",
  "try",
  "typeof",
  "yield"
]);
function owningOpen(line, at2) {
  const open = [];
  for (let i = 0; i < at2; i += 1) {
    const c = line[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i += 1; i < at2 && line[i] !== c; i += 1) if (line[i] === "\\") i += 1;
    } else if (c === "(") open.push(i);
    else if (c === ")") open.pop();
  }
  return open.length ? open[open.length - 1] : -1;
}
function callbackOwnerName(line) {
  if (line.length > MAX_SCANNED_LINE) return void 0;
  const st = STATEMENT.exec(line);
  const cb = st ? CALLBACK_AT_END.exec(line) : null;
  if (!st || !cb) return void 0;
  const lead = st[2].replace(/\?/g, "");
  const root = lead.split(".")[0];
  if (NOT_OWNERS.has(root)) return void 0;
  let open = owningOpen(line, cb.index);
  if (open < 0) return void 0;
  const before = line.slice(0, open).trimEnd();
  const member = /(?:^|[^\w$])([A-Za-z_$][\w$]*)$/.exec(before)?.[1];
  let callee;
  if (open === st[0].length - 1) callee = lead;
  else if (member && /\)\s*\.\s*$/.test(before.slice(0, before.length - member.length))) callee = `${root}.${member}`;
  else {
    callee = lead;
    open = st[0].length - 1;
  }
  if (member && NOT_OWNERS.has(member) && callee !== lead) return void 0;
  const first = /^\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/.exec(line.slice(open + 1));
  const literal = first && !first[2].includes("${") ? first[2].slice(0, MAX_OWNER_LITERAL) : void 0;
  return literal !== void 0 ? `${callee} "${literal}"` : callee;
}
var CallbackOwnerScan = class {
  enabled;
  /** The indent of the first-level statements of a column-0 non-declaration block ("" before its first one is seen). */
  topBlock;
  /** The indent of the owner whose body we are in, until a line at that indent closes it. */
  inside;
  named = /* @__PURE__ */ new Map();
  constructor(path) {
    this.enabled = !isTestSourcePath(path);
  }
  /** True while the line is inside an owner's body (no definition is read there). Call for EVERY line, in order. */
  inBody(line) {
    if (this.inside === void 0) return false;
    const rest = line.startsWith(this.inside) ? line.slice(this.inside.length) : void 0;
    if (rest !== void 0 && /^[})]/.test(rest)) {
      this.inside = void 0;
      return true;
    }
    if (!/^\S/.test(line) || /^[})\]`]/.test(line)) return true;
    this.inside = void 0;
    return false;
  }
  /** Tracks the column-0 blocks; call for every line outside an owner's body, before the definitions are read. */
  track(line) {
    if (/^\S/.test(line)) this.topBlock = TOP_BLOCK.test(line) ? "" : void 0;
    else if (this.topBlock === "" && line.trim()) this.topBlock = /^[ \t]*/.exec(line)[0];
  }
  /** The owner a line outside any class declares, if any. */
  ownerAt(line, lineNo) {
    if (!this.enabled) return void 0;
    const indent = /^[ \t]*/.exec(line)[0];
    if (indent !== "" && indent !== this.topBlock) return void 0;
    const base = callbackOwnerName(line);
    if (!base) return void 0;
    const n = (this.named.get(base) ?? 0) + 1;
    this.named.set(base, n);
    this.inside = indent;
    return { name: n === 1 ? base : `${base} #${n}`, kind: "function", line: lineNo, exported: false, callback: true };
  }
};

// ../packages/agent-tools/src/symbols.ts
var SYMBOL_KINDS = [
  "function",
  "method",
  "class",
  "interface",
  "type",
  "enum",
  "const",
  "struct",
  "trait",
  "module",
  "table",
  "heading"
];
var MAX_SYMBOLS_PER_FILE = 400;
var LANGUAGE_BY_EXT = {
  ts: "js",
  tsx: "js",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  mts: "js",
  cts: "js",
  py: "python",
  go: "go",
  rs: "rust",
  java: "oo",
  kt: "oo",
  kts: "oo",
  cs: "oo",
  swift: "oo",
  php: "oo",
  scala: "oo",
  rb: "ruby",
  sql: "sql",
  md: "markdown",
  mdx: "markdown"
};
function extensionOf2(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}
function languageOf(path) {
  return LANGUAGE_BY_EXT[extensionOf2(path.replace(/\\/g, "/"))];
}
function group(m, n) {
  return m[n] ?? "";
}
var symbolCap = MAX_SYMBOLS_PER_FILE;
function eachLine(lines, out, visit) {
  for (let i = 0; i < lines.length && out.length < symbolCap; i += 1) {
    visit(lines[i] ?? "", i + 1);
  }
}
var ID2 = "[A-Za-z_$][\\w$]*";
var JS_RULES = [
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${ID2})`), kind: "function" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+(${ID2})`), kind: "class" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?interface\\s+(${ID2})`), kind: "interface" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?type\\s+(${ID2})\\s*[<=]`), kind: "type" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:const\\s+)?enum\\s+(${ID2})`), kind: "enum" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+(${ID2})`), kind: "const" },
  // `namespace A.B {`, `declare module "x" {` — the module's name, its quotes dropped.
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:namespace|module)\\s+(${ID2}(?:\\.${ID2})*|"[^"]+"|'[^']+')\\s*\\{`), kind: "module" }
];
var JS_METHOD = new RegExp(
  `^(?:\\t|  |    )(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set)\\s+)*\\*?\\s*(${ID2})\\s*(?:<[^>]*>)?\\s*\\(.*\\)?[^;]*\\{\\s*$`
);
var JS_ABSTRACT_METHOD = new RegExp(
  `^(?:\\t|  |    )(?:(?:public|private|protected|static|readonly|override)\\s+)*abstract\\s+(?:(?:public|private|protected|static|readonly|override|async)\\s+)*(${ID2})\\s*\\??\\s*(?:<[^>]*>)?\\s*\\(`
);
var JS_METHOD_OPEN = new RegExp(
  `^(?:\\t|  |    )(?:(?:public|private|protected|static|readonly|override|async|get|set)\\s+)*\\*?\\s*(${ID2})\\s*(?:<[^>]*>)?\\s*\\(\\s*$`
);
var JS_SIGNATURE_CLOSE = /^\s*\)\s*(?::[^;=]*)?\{\s*$/;
var MAX_SIGNATURE_LINES = 40;
var JS_KEYWORDS = /* @__PURE__ */ new Set(["if", "for", "while", "switch", "catch", "return", "function", "with", "do", "else", "try"]);
function closesWithBody(lines, at2) {
  for (let i = at2 + 1; i < Math.min(lines.length, at2 + MAX_SIGNATURE_LINES); i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*\)/.test(line)) return JS_SIGNATURE_CLOSE.test(line);
  }
  return false;
}
function extractJs(lines, out, path = "") {
  let cls;
  const owners = new CallbackOwnerScan(path);
  eachLine(lines, out, (line, lineNo) => {
    if (/^\}/.test(line)) cls = void 0;
    if (owners.inBody(line)) return;
    owners.track(line);
    for (const rule of JS_RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const exported = !!m[1];
      if (!exported && /^\s/.test(line)) continue;
      const name2 = group(m, 2).replace(/^["']|["']$/g, "");
      out.push({ name: name2, kind: rule.kind, line: lineNo, exported });
      if (rule.kind === "class") cls = name2;
      return;
    }
    if (cls === void 0) {
      const owner = owners.ownerAt(line, lineNo);
      if (owner) out.push(owner);
      return;
    }
    const open = JS_METHOD_OPEN.exec(line);
    const method = JS_METHOD.exec(line) ?? JS_ABSTRACT_METHOD.exec(line) ?? (open && closesWithBody(lines, lineNo - 1) ? open : null);
    const name = method ? group(method, 1) : "";
    if (name && !JS_KEYWORDS.has(name)) out.push({ name, kind: "method", line: lineNo, exported: false, container: cls });
  });
}
function extractPython(lines, out) {
  let cls;
  let memberIndent;
  eachLine(lines, out, (line, lineNo) => {
    const m = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(line);
    const indent = m ? group(m, 1) : /^(\s*)\S/.exec(line)?.[1] ?? "";
    if (indent === "" && /^[^\s@#)\]}]/.test(line) && !(m && group(m, 2) === "class")) {
      cls = void 0;
      memberIndent = void 0;
    }
    if (!m) return;
    const name = group(m, 3);
    if (group(m, 2) === "class") {
      if (indent === "") {
        cls = name;
        memberIndent = void 0;
        out.push({ name, kind: "class", line: lineNo, exported: !name.startsWith("_") });
        return;
      }
      if (cls !== void 0 && (memberIndent === void 0 || indent === memberIndent)) {
        memberIndent ??= indent;
        out.push({ name, kind: "class", line: lineNo, exported: !name.startsWith("_"), container: cls });
      }
      return;
    }
    if (indent === "") {
      out.push({ name, kind: "function", line: lineNo, exported: !name.startsWith("_") });
      return;
    }
    if (cls === void 0) return;
    memberIndent ??= indent;
    if (indent === memberIndent) out.push({ name, kind: "method", line: lineNo, exported: !name.startsWith("_"), container: cls });
  });
}
var goReceiver = (receiver) => /\(\s*(?:[A-Za-z_]\w*\s+)?\*?\s*([A-Za-z_]\w*)/.exec(receiver)?.[1];
function extractGo(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const fn = /^func\s+(\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(line);
    if (fn) {
      const name2 = group(fn, 2);
      const container = fn[1] ? goReceiver(fn[1]) : void 0;
      out.push({ name: name2, kind: fn[1] ? "method" : "function", line: lineNo, exported: /^[A-Z]/.test(name2), ...container ? { container } : {} });
      return;
    }
    const ty = /^type\s+([A-Za-z_]\w*)\s+(struct|interface)?/.exec(line);
    if (!ty) return;
    const name = group(ty, 1);
    const word = group(ty, 2);
    const kind = word === "struct" ? "struct" : word === "interface" ? "interface" : "type";
    out.push({ name, kind, line: lineNo, exported: /^[A-Z]/.test(name) });
  });
}
function rustImplTarget(line) {
  const m = /^\s*(?:unsafe\s+)?impl\b(?:\s*<[^>]*>)?\s+([^{]*)/.exec(line);
  if (!m) return void 0;
  const text = group(m, 1).replace(/\bwhere\b.*$/, "");
  const target = text.includes(" for ") ? text.slice(text.indexOf(" for ") + 5) : text;
  return /(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)/.exec(target.replace(/^[\s&]+(?:mut\s+|dyn\s+)?/, ""))?.[1];
}
function extractRust(lines, out) {
  let block;
  eachLine(lines, out, (line, lineNo) => {
    if (/^\}/.test(line)) block = void 0;
    const target = rustImplTarget(line);
    if (target) {
      block = target;
      return;
    }
    const m = /^(\s*)(pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*(fn|struct|enum|trait|mod|type)\s+([A-Za-z_]\w*)/.exec(line);
    if (!m) return;
    const word = group(m, 3);
    const indented = group(m, 1).length > 0;
    const kind = word === "fn" ? indented ? "method" : "function" : word === "mod" ? "module" : word;
    const name = group(m, 4);
    const container = kind === "method" ? block : void 0;
    out.push({ name, kind, line: lineNo, exported: !!m[2], ...container ? { container } : {} });
    if (word === "trait" && !indented) block = name;
  });
}
var OO_TYPE = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|export|inline|value)\s+)*(class|interface|enum|record|object|struct|protocol|trait)\s+([A-Za-z_]\w*)/;
var OO_FUNC = /^\s*(?:(?:public|private|protected|internal|static|final|override|open|suspend|inline|abstract)\s+)*(?:fun|func|function)\s+([A-Za-z_]\w*)/;
function extractOo(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const exported = !/\bprivate\b/.test(line);
    const ty = OO_TYPE.exec(line);
    if (ty) {
      const word = group(ty, 1);
      const kind = word === "interface" || word === "protocol" ? "interface" : word === "enum" ? "enum" : word === "struct" ? "struct" : word === "trait" ? "trait" : "class";
      out.push({ name: group(ty, 2), kind, line: lineNo, exported });
      return;
    }
    const fn = OO_FUNC.exec(line);
    if (fn) out.push({ name: group(fn, 1), kind: /^\s/.test(line) ? "method" : "function", line: lineNo, exported });
  });
}
function extractRuby(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const ty = /^\s*(class|module)\s+([A-Z]\w*(?:::\w+)*)/.exec(line);
    if (ty) {
      out.push({ name: group(ty, 2), kind: group(ty, 1) === "module" ? "module" : "class", line: lineNo, exported: true });
      return;
    }
    const fn = /^(\s*)def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/.exec(line);
    if (fn) out.push({ name: group(fn, 2), kind: group(fn, 1).length > 0 ? "method" : "function", line: lineNo, exported: true });
  });
}
var SQL_CREATE = /^\s*create\s+(?:or\s+replace\s+)?(?:unique\s+)?(table|view|materialized\s+view|function|procedure|index|type|trigger)\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w."]+)/i;
function extractSql(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const m = SQL_CREATE.exec(line);
    if (!m) return;
    const word = group(m, 1).toLowerCase();
    const kind = word === "function" || word === "procedure" || word === "trigger" ? "function" : word === "index" || word === "type" ? "type" : "table";
    out.push({ name: group(m, 2).replace(/"/g, ""), kind, line: lineNo, exported: true });
  });
}
function extractMarkdown(lines, out) {
  let fenced2 = false;
  eachLine(lines, out, (line, lineNo) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced2 = !fenced2;
      return;
    }
    if (fenced2) return;
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ name: `${group(m, 1)} ${group(m, 2).slice(0, 120)}`, kind: "heading", line: lineNo, exported: true });
  });
}
var EXTRACTORS = {
  js: extractJs,
  python: extractPython,
  go: extractGo,
  rust: extractRust,
  oo: extractOo,
  ruby: extractRuby,
  sql: extractSql,
  markdown: extractMarkdown
};
function extractSymbols(path, content, cap2 = MAX_SYMBOLS_PER_FILE) {
  const language = languageOf(path);
  if (!language) return [];
  const out = [];
  const outer = symbolCap;
  symbolCap = cap2;
  try {
    EXTRACTORS[language](content.split(/\r?\n/), out, path.replace(/\\/g, "/"));
  } finally {
    symbolCap = outer;
  }
  return out;
}
function formatSymbol(symbol) {
  return `L${symbol.line} ${symbol.kind} ${symbol.name}${symbol.exported && symbol.kind !== "heading" ? " (export)" : ""}`;
}

// ../packages/agent-tools/src/symbol-tools.ts
var FIND_DEFAULT_LIMIT = 20;
var FIND_MAX_LIMIT = 50;
var OUTLINE_MAX_ENTRIES = 150;
function asKind(v) {
  return typeof v === "string" && SYMBOL_KINDS.includes(v) ? v : void 0;
}
var findSymbolTool = defineTool({
  name: "find_symbol",
  description: "Find where a function, class, method, type, constant, SQL table or Markdown heading is DEFINED, from the workspace's symbol index \u2014 one instant call instead of search_code plus reading files to tell the definition from its call sites. Pass `query` as the symbol name or part of it (case-insensitive; exact matches rank first). Each match is `path:line kind name`; then read_file with `offset` a few lines above that line and a small `limit`. Narrow with `path` (a subdirectory) or `kind`. For USAGES, string literals or config values (not definitions), use search_code instead.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: 'Symbol name or a distinctive part of it, e.g. "buildGitCommand" or "GitCommand".' },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict to, e.g. "api/src".' },
      kind: { type: "string", enum: [...SYMBOL_KINDS], description: "Optional: only this kind of definition." },
      limit: { type: "number", description: `Max matches (default ${FIND_DEFAULT_LIMIT}, max ${FIND_MAX_LIMIT}).` }
    },
    required: ["query"]
  },
  requires: ["repo.symbols"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { data: { ok: false, error: "query is required" } };
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : void 0;
    const kind = asKind(args.kind);
    const requested = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.floor(args.limit) : FIND_DEFAULT_LIMIT;
    const limit = Math.min(FIND_MAX_LIMIT, Math.max(1, requested));
    const r = await ctx.caps.symbols.find(query, { scope, kind, limit, staleOk: true });
    if (!r.ok) return { data: r };
    const data = {
      ok: true,
      query,
      total: r.total ?? 0,
      truncated: r.truncated === true,
      matches: (r.matches ?? []).map((m) => `${m.path}:${m.line} ${m.kind} ${m.name}${m.exported && m.kind !== "heading" ? " (export)" : ""}`),
      indexedFiles: r.indexedFiles,
      ...r.staleIndex ? { staleIndex: true } : {}
    };
    if (r.staleIndex) {
      data.note = "The symbol index is refreshing. Confirm these locations with read_file, or use search_code if a match is missing.";
    } else if ((r.total ?? 0) === 0) {
      data.note = r.partialIndex ? `No definition named like "${query}" in the indexed files \u2014 but the index is PARTIAL (file cap reached), so this is not proof it does not exist. Try search_code${scope ? "" : " with a `path`"}.` : `No definition named like "${query}"${scope ? ` under "${scope}"` : ""}. It may be defined in a form the index does not recognise (a re-export, an object property, a generated file) \u2014 use search_code for the exact text.`;
    } else if (r.truncated) {
      data.note = `Showing ${r.matches?.length ?? 0} of ${r.total} matches \u2014 pass a longer \`query\`, a \`path\` or a \`kind\` to narrow.`;
    }
    return { data };
  }
});
var fileOutlineTool = defineTool({
  name: "file_outline",
  description: "List what a file DEFINES \u2014 functions, classes, methods, types, constants, or a Markdown file's headings \u2014 each with its line number, without reading the file's contents. Call this BEFORE paging through a large file: find the symbol you need, then read_file with `offset` at its line and a small `limit`, instead of reading 2,000-line windows until you reach it. Pass `kind` to list only one kind of definition.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative file path, e.g. "api/src/service.ts".' },
      kind: { type: "string", enum: [...SYMBOL_KINDS], description: "Optional: only this kind of definition." }
    },
    required: ["path"]
  },
  requires: ["repo.read", "repo.symbols"],
  async execute(args, ctx) {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) return { data: { ok: false, error: "path is required" } };
    const kind = asKind(args.kind);
    const file = await ctx.caps.repoRead.readFile(path);
    if (!file.ok) return { data: file };
    const content = file.content ?? "";
    const all = extractSymbols(path, content).filter((s) => !kind || s.kind === kind);
    const shown = all.slice(0, OUTLINE_MAX_ENTRIES);
    const data = {
      ok: true,
      path: file.path ?? path,
      totalLines: content.split("\n").length,
      total: all.length,
      symbols: shown.map(formatSymbol)
    };
    if (all.length === 0) {
      data.note = kind ? `No ${kind} definitions found in ${path}.` : `No definitions recognised in ${path} (unsupported language, or a data/config file) \u2014 read_file it directly.`;
    } else if (all.length > shown.length) {
      const lastLine = shown.at(-1)?.line ?? 0;
      data.note = `Showing the first ${shown.length} of ${all.length} definitions (through line ${lastLine}). Pass \`kind\` to list one kind, or find_symbol for a specific name.`;
    }
    return { data };
  }
});
function markdownOutline(path, content) {
  return extractSymbols(path, content).filter((s) => s.kind === "heading").slice(0, OUTLINE_MAX_ENTRIES).map((s) => ({ heading: s.name, line: s.line }));
}
var SYMBOL_TOOLS = [findSymbolTool, fileOutlineTool];

// ../packages/agent-tools/src/fileRead.ts
var WHOLE_READ_MAX_CHARS = 64e3;
var WIDEN_WINDOW_MIN_LINES = 150;
var OUTLINE_FIRST_PREFIX_LINES = 40;
function outlineFirstApplies(content, leverOn2) {
  if (leverOn2 !== true) return false;
  return content.length > WHOLE_READ_MAX_CHARS;
}
function dropsLimit(content, opts, sourceTruncated) {
  if (sourceTruncated) return false;
  if (opts.limit === void 0) return false;
  if (content.length > WHOLE_READ_MAX_CHARS) return false;
  return content.split("\n").length >= WIDEN_WINDOW_MIN_LINES;
}
var READ_FILE_MAX_PATHS = 8;
var MARKDOWN_OUTLINE_MIN_CHARS = 16e3;
function readFileKey(path, file, key) {
  if (file.truncated === true) {
    return { ok: false, path, key, error: "the file is too large to load whole, so `key` cannot be used \u2014 page it with offset/limit" };
  }
  const read = readJsonKey(file.content ?? "", key);
  if (!read.ok) return { path, key, ...read };
  if ("tooLarge" in read) {
    return {
      ok: true,
      path,
      key: read.key,
      childKeys: read.childKeys,
      note: `"${read.key}" is ${read.size} characters \u2014 too large to return whole. Read one of its childKeys, e.g. key "${read.key}.${read.childKeys[0] ?? "\u2026"}".`
    };
  }
  return { ok: true, path, key: read.key, content: read.content };
}
var isMarkdown = (path) => /\.mdx?$/i.test(path);
async function readOneFile(path, opts, caps, leverOn2) {
  const r = await caps.repoRead.readFile(path);
  if (!r.ok) return r;
  const gzip = isGzipPath(r.path ?? path) && typeof r.content === "string" && r.content.length > 0;
  if (gzip) r.content = await readGzipText(latin1Bytes(r.content));
  if (opts.key) return { ...readFileKey(r.path ?? path, r, opts.key), ...gzip ? { decompressed: true } : {} };
  const content = r.content ?? "";
  if (opts.offset === void 0 && opts.limit === void 0 && outlineFirstApplies(content, leverOn2) && r.truncated !== true) {
    const symbols = extractSymbols(path, content).slice(0, 150).map((s) => `L${s.line} ${s.kind} ${s.name}${s.exported && s.kind !== "heading" ? " (export)" : ""}`);
    const head = windowFileContent(content, { offset: 1, limit: OUTLINE_FIRST_PREFIX_LINES });
    return {
      ok: true,
      path: r.path ?? path,
      outline: symbols,
      totalLines: head.totalLines,
      content: head.content,
      truncated: true,
      offset: 1,
      note: (symbols.length > 0 ? `This file is larger than one read: \`outline\` lists its ${symbols.length} definitions with line numbers. ` : "This file is larger than one read. ") + `The first ${OUTLINE_FIRST_PREFIX_LINES} lines follow. To read a span, call read_file again with \`offset\` (the outline's line) and no \`limit\` \u2014 each read returns as much as fits.`
    };
  }
  const limitDropped = dropsLimit(content, opts, r.truncated === true);
  const fromLine = opts.offset !== void 0 && opts.offset > 1 ? Math.floor(opts.offset) : 1;
  const limit = limitDropped ? Math.max(opts.limit, content.split("\n").length - fromLine + 1) : opts.limit;
  const win = windowFileContent(content, { offset: opts.offset, limit });
  const extended = limitDropped && !win.truncated && win.returnedLines > opts.limit;
  const data = {
    ok: true,
    path: r.path ?? path,
    content: win.content,
    truncated: win.truncated || r.truncated === true,
    totalLines: win.totalLines,
    offset: win.offset
  };
  let note = fileWindowNote(win);
  if (extended) {
    note = `Extended the window to the end of the file (lines ${win.offset}\u2013${win.totalLines}) \u2014 the rest fits in one read. Lines already returned need not be read again.`;
  }
  if (opts.offset === void 0 && isMarkdown(data.path ?? path) && (content.length > MARKDOWN_OUTLINE_MIN_CHARS || win.truncated)) {
    const outline = markdownOutline(data.path ?? path, content);
    if (outline.length > 0) {
      data.outline = outline;
      if (!(limitDropped && !win.truncated)) {
        const pointer = "This document is larger than one read: `outline` lists its headings with their line numbers \u2014 page by heading line with offset instead of reading it window by window.";
        note = note ? `${note} ${pointer}` : pointer;
      }
    }
  }
  if (note) data.note = note;
  if (gzip) data.decompressed = true;
  return data;
}
async function readManyFiles(paths, opts, caps, leverOn2) {
  return Promise.all(
    paths.map(
      (path) => readOneFile(path, opts, caps, leverOn2).catch((err) => ({ ok: false, path, error: err instanceof Error ? err.message : String(err) }))
    )
  );
}

// ../packages/agent-tools/src/compress.ts
var DEFAULT_COMPRESS_MIN_CHARS = 4e3;
var DEFAULT_COMPRESS_RATE = 0.5;
var FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
function fenceRun(line) {
  return FENCE_OPEN.exec(line)?.[1] ?? null;
}
function splitFences(text) {
  const out = [];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let buf = "";
  let fence = null;
  const flush = (kind) => {
    if (buf) out.push({ kind, text: buf });
    buf = "";
  };
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, "");
    if (!fence) {
      const run2 = fenceRun(bare);
      if (run2) {
        flush("prose");
        fence = { ch: run2.charAt(0), len: run2.length };
      }
      buf += line;
      continue;
    }
    buf += line;
    const run = fenceRun(bare);
    const open = fence;
    if (run && run.charAt(0) === open.ch && run.length >= open.len && [...bare.trim()].every((c) => c === open.ch)) {
      flush("fence");
      fence = null;
    }
  }
  flush(fence ? "fence" : "prose");
  return out;
}
async function compressLargeContext(text, opts = {}) {
  const minChars = opts.minChars ?? DEFAULT_COMPRESS_MIN_CHARS;
  const rate = opts.rate ?? DEFAULT_COMPRESS_RATE;
  const unchanged = { text, compressed: false, originalTokens: 0, keptTokens: 0 };
  if (!opts.compress || text.length < minChars || !(rate > 0 && rate < 1)) return unchanged;
  let compressed = false;
  let originalTokens = 0;
  let keptTokens = 0;
  const parts = [];
  for (const seg of splitFences(text)) {
    if (seg.kind === "fence" || seg.text.trim().length < minChars) {
      parts.push(seg.text);
      continue;
    }
    let r;
    try {
      r = await opts.compress(seg.text, rate);
    } catch {
      r = { ok: false };
    }
    if (r.ok && typeof r.text === "string" && r.text.length < seg.text.length) {
      parts.push(r.text);
      compressed = true;
      originalTokens += r.originalTokens ?? 0;
      keptTokens += r.keptTokens ?? 0;
    } else {
      parts.push(seg.text);
    }
  }
  return compressed ? { text: parts.join(""), compressed, originalTokens, keptTokens } : unchanged;
}
async function compressToolOutput(text, ctx, tool) {
  const semantic = ctx.caps.semantic;
  if (ctx.compressLargeOutputs !== true || !semantic?.compress) {
    return { text, compressed: false, originalTokens: 0, keptTokens: 0 };
  }
  const r = await compressLargeContext(text, { compress: (t, rate) => semantic.compress(t, rate) });
  if (r.compressed) {
    ctx.emit?.({ level: "debug", message: `${tool}: output compressed (C8)`, detail: { originalTokens: r.originalTokens, keptTokens: r.keptTokens } });
  }
  return r;
}
async function compressShellResult(r, ctx) {
  if (!r.ok || r.exitCode !== void 0 && r.exitCode !== 0 || typeof r.stdout !== "string") return r;
  const c = await compressToolOutput(r.stdout, ctx, "run_command");
  return c.compressed ? { ...r, stdout: c.text, compressed: true } : r;
}
async function compressWebFetchResult(r, ctx) {
  if (!r.ok || typeof r.content !== "string") return r;
  const c = await compressToolOutput(r.content, ctx, "web_fetch");
  return c.compressed ? { ...r, content: c.text, compressed: true } : r;
}

// ../packages/agent-tools/src/git-repo-scope.ts
function safeGitArg(v) {
  return typeof v === "string" && /^[\w./@-]+$/.test(v) && !v.startsWith("-") ? v : null;
}
function shellQuote(v) {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}
function safeRepoArg(repo) {
  const arg = safeGitArg(typeof repo === "string" ? repo.replace(/\\/g, "/") : repo);
  return arg && !arg.split("/").includes("..") && !arg.startsWith("/") ? arg : null;
}
function invalidRepoResult(action, repo) {
  if (typeof repo !== "string" || repo === "" || safeRepoArg(repo) !== null) return null;
  return { data: { ok: false, action, error: `repo '${repo}' must be a directory inside the workspace (no '..', not absolute), so nothing was run` } };
}
function inferRepoFromPath(path) {
  if (typeof path !== "string" || !path.trim()) return null;
  const parts = path.split(/[\\/]/).filter((s) => s.length > 0 && s !== ".");
  if (parts.length < 2) return null;
  return safeRepoArg(parts[0]);
}
function buildListCheckoutsCommand() {
  return 'for d in */; do [ -e "$d.git" ] && printf "%s\\n" "${d%/}"; done';
}
function parseCheckoutList(stdout) {
  if (!stdout) return [];
  const names = [];
  for (const line of stdout.split(/\r?\n/)) {
    const name = line.trim().replace(/\/+$/, "");
    if (!name || name === "*" || name === "." || name === "..") continue;
    const safe = safeRepoArg(name);
    if (safe) names.push(safe);
  }
  return names;
}
function notARepoResult(action, candidates = []) {
  const named = candidates.filter(Boolean);
  const extra = named.length ? `Candidate repositories: ${named.map((c) => `"${c}"`).join(", ")}. Re-run this tool with \`repo\` set to the one holding the code you are working on (e.g. { "repo": "${named[0]}" }).` : "No git checkouts were found at the top level of the open folder. File edits still work; only the git tools need a repository.";
  return {
    data: {
      ok: false,
      action,
      error: "not a git repository at the workspace root \u2014 this usually means the open folder CONTAINS the repositories rather than being one (several checkouts side by side). " + extra,
      ...named.length ? { candidates: named } : {}
    }
  };
}
function shellRunWithStop(ctx, command, cwd) {
  const shell = ctx.caps.shell;
  const opts = { ...ctx.signal ? { signal: ctx.signal } : {}, ...cwd ? { cwd } : {} };
  return Object.keys(opts).length > 0 ? shell.run(command, opts) : shell.run(command);
}
function defaultRepoOf(ctx) {
  return safeRepoArg(ctx.caps.shell?.defaultRepo);
}
function pathsInRepo(path, repo) {
  if (!path) return [];
  return repo ? commitPathCandidates(path, repo) : [path];
}
async function notARepoWithCandidates(action, ctx) {
  const listed = await shellRunWithStop(ctx, buildListCheckoutsCommand());
  return notARepoResult(action, parseCheckoutList(listed.stdout));
}
var NOT_A_REPO = /not a git repository/i;
function isNotARepo(r) {
  return NOT_A_REPO.test(`${r.stdout ?? ""} ${r.error ?? ""}`);
}
function commitPathCandidates(path, repo) {
  const out = [path];
  const dir = safeRepoArg(repo);
  if (dir) {
    const prefix = `${dir.replace(/\/+$/, "")}/`;
    if (path.startsWith(prefix)) out.push(path.slice(prefix.length));
    const leaf = dir.split("/").filter(Boolean).pop();
    if (leaf && path.startsWith(`${leaf}/`)) out.push(path.slice(leaf.length + 1));
  }
  return [...new Set(out)].filter((p) => p.trim() !== "");
}
var rootNotARepo = /* @__PURE__ */ new WeakSet();
function scopeAttempts(ctx, path) {
  const fallback = defaultRepoOf(ctx);
  const shell = ctx.caps.shell;
  const attempts = [];
  if (!(fallback && shell && rootNotARepo.has(shell))) attempts.push({ paths: pathsInRepo(path) });
  const inferred = inferRepoFromPath(path);
  if (inferred) attempts.push({ repo: inferred, paths: pathsInRepo(path, inferred) });
  if (fallback && fallback !== inferred) attempts.push({ repo: fallback, paths: pathsInRepo(path, fallback) });
  return attempts;
}
async function runInRepoScope(ctx, scope, run) {
  if (scope.repo) return { r: await run(scope.repo, pathsInRepo(scope.path, scope.repo)), repo: scope.repo };
  for (const attempt of scopeAttempts(ctx, scope.path)) {
    const r = await run(attempt.repo, attempt.paths);
    if (!isNotARepo(r)) return attempt.repo ? { r, repo: attempt.repo } : { r };
    if (!attempt.repo && ctx.caps.shell) rootNotARepo.add(ctx.caps.shell);
  }
  return null;
}

// ../packages/agent-tools/src/shell-command-shape.ts
function withoutQuoted(command) {
  return command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}
function isChained(bare) {
  return /&&|\|\||;|\n/.test(bare);
}
function stages(bare) {
  return bare.split(/(?<!\|)\|(?!\|)/).map((s) => s.trim());
}
function verbOf(stage) {
  const word = /^[\w./-]+/.exec(stage.replace(/^(?:\w+=\S*\s+)+/, ""))?.[0] ?? "";
  return word.slice(word.lastIndexOf("/") + 1).toLowerCase().replace(/\.exe$/, "");
}
var SEARCH_VERBS = /* @__PURE__ */ new Set(["grep", "egrep", "fgrep", "rg", "findstr", "ag", "ack"]);
function isSearchStage(stage) {
  const verb = verbOf(stage);
  if (SEARCH_VERBS.has(verb)) return true;
  if (verb === "git") return /^\S+\s+(?:-\S+\s+)*grep\b/.test(stage.replace(/^(?:\w+=\S*\s+)+/, ""));
  return verb === "select-string" || verb === "sls";
}
function isSearchCommand(command) {
  const bare = withoutQuoted(command);
  if (isChained(bare)) return false;
  return isSearchStage(stages(bare).pop() ?? "");
}
var NO_OUTPUT = /^\s*(\(no output\))?\s*$/;
function searchNoMatch(command, result) {
  if (result.ok || result.exitCode !== 1 || result.aborted || result.error) return result;
  if (!NO_OUTPUT.test(result.stdout ?? "") || !isSearchCommand(command)) return result;
  const { exitCode: _exit, ...rest } = result;
  return { ...rest, ok: true, matches: 0, stdout: "(no matches \u2014 the search exited 1 with no output)" };
}

// ../packages/agent-tools/src/shell-pipe.ts
var TRAILING_TAIL = /\s*\|\s*(?:2>&1\s*\|\s*)?tail\s+(?:-\s*(?:n\s+)?)?(\d+)\s*$/;
function stripTailLimit(command) {
  const m = TRAILING_TAIL.exec(command);
  if (!m) return { command, stripped: false };
  const n = Number.parseInt(m[1] ?? "", 10);
  return { command: command.slice(0, m.index).trimEnd(), tail: Number.isFinite(n) ? n : void 0, stripped: true };
}

// ../packages/agent-tools/src/shell-output-filter.ts
var DEFAULT_WINDOW = 200;
var MAX_LINE_CHARS = 2e3;
function lineCount(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : void 0;
}
function matcher(grep, ignoreCase) {
  try {
    const re = new RegExp(grep, ignoreCase ? "i" : "");
    return (line) => re.test(line);
  } catch {
    const needle = ignoreCase ? grep.toLowerCase() : grep;
    return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle);
  }
}
function filterShellOutput(text, filter) {
  const all = text.split("\n");
  const numbered = all.map((line, i) => ({ n: i + 1, line }));
  const test = filter.grep ? matcher(filter.grep, filter.ignoreCase === true) : void 0;
  const matched = test ? numbered.filter((l) => test(l.line)) : numbered;
  let head = lineCount(filter.head);
  let tail = lineCount(filter.tail);
  if (head === void 0 && tail === void 0 && matched.length > DEFAULT_WINDOW) {
    head = DEFAULT_WINDOW / 2;
    tail = DEFAULT_WINDOW / 2;
  }
  let kept = matched;
  if (head !== void 0 || tail !== void 0) {
    const first = matched.slice(0, head ?? 0);
    const last = tail ? matched.slice(Math.max(first.length, matched.length - tail)) : [];
    kept = [...first, ...last];
  }
  const cut = (line) => line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}\u2026` : line;
  const output = kept.map((l) => test ? `${l.n}: ${cut(l.line)}` : cut(l.line)).join("\n");
  return { totalLines: all.length, matchedLines: matched.length, output, truncated: kept.length < matched.length };
}
var outputFilterTool = defineTool({
  name: "output_filter",
  description: "Filter the FULL output of a command you already ran \u2014 by the outputId run_command / command_status returned \u2014 with grep / head / tail. Nothing is re-run. Use this instead of running a command again to grep, head or tail its output.",
  parameters: {
    type: "object",
    properties: {
      outputId: { type: "string", description: "The outputId a run_command or command_status result returned." },
      grep: { type: "string", description: "Optional: keep only lines matching this regular expression (each kept line is prefixed with its line number)." },
      head: { type: "number", description: "Optional: keep the first N (matching) lines." },
      tail: { type: "number", description: "Optional: keep the last N (matching) lines." },
      ignoreCase: { type: "boolean", description: "Optional: case-insensitive grep." }
    },
    required: ["outputId"]
  },
  requires: ["shell.outputs"],
  async execute(args, ctx) {
    const outputId = typeof args.outputId === "string" ? args.outputId.trim() : "";
    if (!outputId) return { data: { ok: false, error: "outputId is required" } };
    const read = ctx.caps.shell?.output;
    if (!read) return { data: { ok: false, error: "retained command outputs are not available on this surface" } };
    const text = await read.call(ctx.caps.shell, outputId);
    if (text === void 0) {
      return { data: { ok: false, outputId, error: `no retained output "${outputId}" in this run (only the last commands are kept) \u2014 run the command again` } };
    }
    const filter = {
      ...typeof args.grep === "string" && args.grep ? { grep: args.grep } : {},
      ...lineCount(args.head) !== void 0 ? { head: lineCount(args.head) } : {},
      ...lineCount(args.tail) !== void 0 ? { tail: lineCount(args.tail) } : {},
      ...args.ignoreCase === true ? { ignoreCase: true } : {}
    };
    const r = filterShellOutput(text, filter);
    return { data: { ok: true, outputId, ...r, ...filter.grep ? { matches: r.matchedLines } : {} } };
  }
});

// ../packages/agent-tools/src/shell-segments.ts
var CONSTRUCT_WORDS = /* @__PURE__ */ new Set(["then", "else", "fi", "do", "done", "esac", "{", "}", "(", ")"]);
function splitShellSegments(command) {
  const out = [];
  let current = "";
  let quote = null;
  let depth = 0;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "$" && command[i + 1] === "(") {
      depth += 1;
      current += "$(";
      i += 1;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === "&" && (command[i - 1] === ">" || command[i - 1] === "<" || command[i + 1] === ">")) {
      current += ch;
      continue;
    }
    if (depth === 0 && (ch === ";" || ch === "\n" || ch === "|" || ch === "&")) {
      if ((ch === "&" || ch === "|") && command[i + 1] === ch) i += 1;
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (quote || depth !== 0) return null;
  if (current.trim()) out.push(current.trim());
  return out;
}
function shellTokens(segment) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m = re.exec(segment);
  while (m) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
    m = re.exec(segment);
  }
  return out;
}
function commandWords(words2) {
  let i = 0;
  while (i < words2.length) {
    const first = words2[i] ?? "";
    const leads = CONSTRUCT_WORDS.has(first) || /^[A-Za-z_]\w*=/.test(first) || first === "if" || first === "while" || first === "until" || first === "!";
    if (!leads) break;
    i += 1;
  }
  return words2.slice(i);
}
var GIT_VALUED_GLOBALS = /* @__PURE__ */ new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);
function gitSubcommand(args) {
  let i = 0;
  let dir;
  while (i < args.length && (args[i] ?? "").startsWith("-")) {
    if (args[i] === "-C") dir = args[i + 1];
    i += GIT_VALUED_GLOBALS.has(args[i] ?? "") ? 2 : 1;
  }
  return { ...args[i] !== void 0 ? { sub: args[i] } : {}, rest: args.slice(i + 1), ...dir !== void 0 ? { dir } : {} };
}

// ../packages/agent-tools/src/branch-switch.ts
var CHECKOUT_CREATE = /* @__PURE__ */ new Set(["-b", "-B", "--orphan"]);
var SWITCH_CREATE = /* @__PURE__ */ new Set(["-c", "-C", "--create", "--force-create", "--orphan"]);
var CHECKOUT_PATH_MODES = /* @__PURE__ */ new Set(["-p", "--patch", "--ours", "--theirs", "-2", "-3"]);
var REDIRECT = /^\d*[<>]|^&>/;
var BARE_REDIRECT = /^(\d*(>>?|<)|&>>?)$/;
var PLAIN_WRAPPERS = /* @__PURE__ */ new Set(["command", "time", "nohup", "exec"]);
var SHELLS = /* @__PURE__ */ new Set(["sh", "bash", "zsh", "dash"]);
var SHELL_C_FLAG = /^-[a-zA-Z]*c[a-zA-Z]*$/;
var MAX_DEPTH = 3;
function withoutRedirects(words2) {
  const out = [];
  for (let i = 0; i < words2.length; i += 1) {
    const word = words2[i] ?? "";
    if (BARE_REDIRECT.test(word)) {
      i += 1;
      continue;
    }
    if (!REDIRECT.test(word)) out.push(word);
  }
  return out;
}
function attachedCreate(sub, word) {
  const m = (sub === "checkout" ? /^-[bB](.+)$/ : /^-[cC](.+)$/).exec(word);
  return m?.[1];
}
function switchOf(sub, rest) {
  const createFlags = sub === "checkout" ? CHECKOUT_CREATE : SWITCH_CREATE;
  let created;
  let creates = false;
  let detach = false;
  let endsOptions = false;
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const word = rest[i] ?? "";
    if (word === "--") {
      if (i < rest.length - 1) return void 0;
      endsOptions = true;
      break;
    }
    if (sub === "checkout" && (CHECKOUT_PATH_MODES.has(word) || word.startsWith("--pathspec-from-file"))) return void 0;
    const [flag, inline] = word.startsWith("--") && word.includes("=") ? [word.slice(0, word.indexOf("=")), word.slice(word.indexOf("=") + 1)] : [word, void 0];
    if (createFlags.has(flag)) {
      creates = true;
      created = inline ?? rest[i + 1];
      if (inline === void 0) i += 1;
      continue;
    }
    const attached = attachedCreate(sub, word);
    if (attached !== void 0) {
      creates = true;
      created = attached;
      continue;
    }
    if (word === "--detach" || sub === "switch" && word === "-d") {
      detach = true;
      continue;
    }
    if (word === "-") {
      positional.push(word);
      continue;
    }
    if (word.startsWith("-")) continue;
    positional.push(word);
  }
  if (creates) return { ...created ? { target: created } : {}, creates: true };
  if (detach) return { ...positional[0] ? { target: positional[0] } : {}, creates: false };
  if (positional.length !== 1 || positional[0] === ".") return void 0;
  const target = positional[0];
  return sub === "checkout" && target !== "-" && !endsOptions ? { target, creates: false, ambiguous: true } : { target, creates: false };
}
function enter(base, dir) {
  const clean = dir.replace(/[\\/]+$/, "").replace(/^(\.\/)+/, "") || ".";
  if (!base || /^([\\/~]|[A-Za-z]:)/.test(clean)) return clean;
  return clean === "." ? base : `${base}/${clean}`;
}
function parenBalance(segment) {
  const bare = segment.replace(/"[^"]*"|'[^']*'/g, "");
  return (bare.match(/\(/g)?.length ?? 0) - (bare.match(/\)/g)?.length ?? 0);
}
function unwrapSubshell(words2) {
  const out = [...words2];
  if (out[0]?.startsWith("(")) out[0] = out[0].replace(/^\(+/, "");
  const last = out.length - 1;
  if (last >= 0 && out[last]?.endsWith(")")) out[last] = out[last].replace(/\)+$/, "");
  return commandWords(out.filter((w) => w !== ""));
}
function peelWrappers(words2) {
  let out = [...words2];
  for (let guard = 0; guard < 8; guard += 1) {
    const [head, ...rest] = out;
    if (head === "env") {
      let i = 0;
      while (i < rest.length && ((rest[i] ?? "").startsWith("-") || /^[A-Za-z_]\w*=/.test(rest[i] ?? ""))) i += rest[i] === "-u" || rest[i] === "-C" ? 2 : 1;
      out = rest.slice(i);
    } else if (head !== void 0 && PLAIN_WRAPPERS.has(head)) {
      let i = 0;
      while (i < rest.length && (rest[i] ?? "").startsWith("-")) i += 1;
      out = rest.slice(i);
    } else if (head === "timeout") {
      let i = 0;
      while (i < rest.length && (rest[i] ?? "").startsWith("-")) i += rest[i] === "-s" || rest[i] === "-k" ? 2 : 1;
      out = rest.slice(i + 1);
    } else {
      return out;
    }
  }
  return out;
}
function segmentSwitch(words2, cdDir, depth) {
  const [program, ...args] = words2;
  if (program !== void 0 && SHELLS.has(program)) {
    const flag = args.findIndex((a) => SHELL_C_FLAG.test(a));
    const script = flag === -1 ? void 0 : args.slice(flag + 1).find((a) => !a.startsWith("-"));
    if (script === void 0 || depth >= MAX_DEPTH) return void 0;
    const inner = detectIn(script, depth + 1);
    if (!inner) return void 0;
    const where2 = inner.dir !== void 0 ? enter(cdDir, inner.dir) : cdDir;
    return { ...inner, ...where2 !== void 0 ? { dir: where2 } : {} };
  }
  if (program !== "git") return void 0;
  const { sub, rest, dir } = gitSubcommand(args);
  if (sub !== "checkout" && sub !== "switch") return void 0;
  const found = switchOf(sub, withoutRedirects(rest));
  if (!found) return void 0;
  const where = dir !== void 0 ? enter(cdDir, dir) : cdDir;
  return { ...found, ...where !== void 0 ? { dir: where } : {} };
}
function detectIn(command, depth) {
  const segments = splitShellSegments(command.trim());
  if (!segments) return void 0;
  let cdDir;
  const outer = [];
  for (const segment of segments) {
    const net = parenBalance(segment);
    for (let k = 0; k < net; k += 1) outer.push(cdDir);
    const words2 = peelWrappers(unwrapSubshell(commandWords(shellTokens(segment))));
    if ((words2[0] === "cd" || words2[0] === "pushd") && words2[1] !== void 0 && words2[1] !== "-") {
      cdDir = enter(cdDir, words2[1]);
    } else {
      const found = segmentSwitch(words2, cdDir, depth);
      if (found) return found;
    }
    for (let k = 0; k < -net && outer.length > 0; k += 1) cdDir = outer.pop();
  }
  return void 0;
}
function detectBranchSwitch(command) {
  return detectIn(command, 0);
}

// ../packages/agent-tools/src/git-status.ts
var GIT_STATUS_COMMAND = "git status --short --branch";
var GIT_STATUS_MAX_PATHS = 20;
var MAX_ENTRIES = 200;
var PATH_MARK = "@@bf-path";
var PUSHED_MARK = "@@bf-pushed";
var LOG_FORMAT = "%H %an%x1f%ae%x1f%aI%x1f%s";
var US = "";
function statusPaths(paths) {
  const clean = (paths ?? []).filter((p) => typeof p === "string").map((p) => p.trim()).filter(Boolean);
  return [...new Set(clean)].slice(0, GIT_STATUS_MAX_PATHS);
}
function buildStatusCommand(paths, repo) {
  const wanted = statusPaths(paths);
  if (wanted.length === 0) return GIT_STATUS_COMMAND;
  const candidatesOf = (p) => commitPathCandidates(p, repo);
  const spec2 = [...new Set(wanted.flatMap(candidatesOf))].map(shellQuote).join(" ");
  const log = (p) => `"$(git --no-pager log -1 --format='${LOG_FORMAT}' -- ${shellQuote(p)} 2>/dev/null)"`;
  const lines = [`${GIT_STATUS_COMMAND} -- ${spec2} || exit $?`];
  wanted.forEach((p, i) => {
    const [first, ...rest] = candidatesOf(p);
    lines.push(`echo "${PATH_MARK} ${i}"`);
    lines.push(`L=${log(first ?? p)}`);
    for (const c of rest) lines.push(`[ -n "$L" ] || L=${log(c)}`);
    lines.push(
      `[ -z "$L" ] || { printf '%s\\n' "$L"; git merge-base --is-ancestor "\${L%% *}" '@{u}' 2>/dev/null && echo "${PUSHED_MARK} yes" || echo "${PUSHED_MARK} no"; }`
    );
  });
  return lines.join("\n");
}
function unquoteGitPath(s) {
  if (s.length < 2 || !s.startsWith('"') || !s.endsWith('"')) return s;
  const body = s.slice(1, -1);
  const enc = new TextEncoder();
  const bytes = [];
  const simple = { n: "\n", t: "	", r: "\r", '"': '"', "\\": "\\", a: "\x07", b: "\b", f: "\f", v: "\v" };
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c !== "\\" || i === body.length - 1) {
      bytes.push(...enc.encode(c));
      continue;
    }
    const next = body[i + 1];
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else {
      bytes.push(...enc.encode(simple[next] ?? next));
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
function parseHeader(line) {
  const header = { branch: null, upstream: null, ahead: 0, behind: 0 };
  if (!line) return header;
  const text = line.replace(/^##\s*/, "");
  const initial = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(text);
  if (initial) return { ...header, branch: initial[1].trim(), noCommits: true };
  if (/^HEAD \(no branch\)/.test(text)) return { ...header, detached: true };
  const [names = "", bracket = ""] = text.split(/ \[(.*)\]$/);
  const dots = names.indexOf("...");
  header.branch = (dots === -1 ? names : names.slice(0, dots)).trim() || null;
  if (dots !== -1) header.upstream = names.slice(dots + 3).trim() || null;
  header.ahead = Number(/ahead (\d+)/.exec(bracket)?.[1] ?? 0);
  header.behind = Number(/behind (\d+)/.exec(bracket)?.[1] ?? 0);
  if (/\bgone\b/.test(bracket)) header.upstreamGone = true;
  return header;
}
var CONFLICT = /* @__PURE__ */ new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
function porcelainEntry(line) {
  if (line.startsWith("##")) return void 0;
  const full = /^(..) (.+)$/.exec(line);
  const trimmed = full ? null : /^([MADRCUT]) (.+)$/.exec(line);
  const xy = full ? full[1] ?? "" : trimmed ? ` ${trimmed[1]}` : void 0;
  const rest = (full ?? trimmed)?.[2] ?? "";
  if (xy === void 0 || xy === "!!") return void 0;
  if (xy === "??") return { xy, path: unquoteGitPath(rest) };
  const arrow = rest.indexOf(" -> ");
  return arrow === -1 ? { xy, path: unquoteGitPath(rest) } : { xy, path: unquoteGitPath(rest.slice(arrow + 4)), from: unquoteGitPath(rest.slice(0, arrow)) };
}
var NO_OUTPUT2 = "(no output)";
function parsePorcelainPaths(stdout) {
  if (stdout.trim() === NO_OUTPUT2) return [];
  return stdout.split(/\r?\n/).flatMap((line) => {
    const entry = porcelainEntry(line);
    return entry ? [entry.path] : [];
  });
}
function pendingChangesSummary(paths, named = 3) {
  const more = paths.length > named ? `, and ${paths.length - named} more` : "";
  return `${paths.length} uncommitted change(s) (${paths.slice(0, named).join(", ")}${more})`;
}
function parseEntries(lines) {
  const out = { staged: [], unstaged: [], untracked: [], conflicted: [] };
  for (const line of lines) {
    const entry = line.length < 4 ? void 0 : porcelainEntry(line);
    if (!entry) continue;
    const { xy, path, from } = entry;
    if (xy === "??") {
      out.untracked.push(path);
      continue;
    }
    if (CONFLICT.has(xy)) {
      out.conflicted.push(path);
      continue;
    }
    const [x, y] = [xy[0], xy[1]];
    if (x !== " ") out.staged.push({ path, status: x, ...from && (x === "R" || x === "C") ? { from } : {} });
    if (y !== " ") out.unstaged.push({ path, status: y });
  }
  return out;
}
function parsePathSections(sections, paths, upstreamUsable) {
  return paths.map((path, i) => {
    const lines = sections[i] ?? [];
    const logLine = lines.find((l) => l.includes(US));
    if (!logLine) return { path, lastCommit: null, onUpstream: null };
    const space = logLine.indexOf(" ");
    const [author = "", email = "", date = "", ...subject] = logLine.slice(space + 1).split(US);
    const pushed = lines.find((l) => l.startsWith(PUSHED_MARK));
    return {
      path,
      lastCommit: { sha: logLine.slice(0, space), subject: subject.join(US), author, email, date },
      onUpstream: upstreamUsable && pushed ? pushed.endsWith(" yes") : null
    };
  });
}
function parseGitStatusOutput(stdout, paths) {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n");
  const firstMark = lines.findIndex((l) => l.startsWith(PATH_MARK));
  const statusLines = firstMark === -1 ? lines : lines.slice(0, firstMark);
  const sections = [];
  if (firstMark !== -1) {
    for (const line of lines.slice(firstMark)) {
      const mark = new RegExp(`^${PATH_MARK} (\\d+)$`).exec(line);
      if (mark) sections[Number(mark[1])] = [];
      else sections[sections.length - 1]?.push(line);
    }
  }
  const header = parseHeader(statusLines.find((l) => l.startsWith("##")));
  const entries = parseEntries(statusLines);
  const truncated = Object.values(entries).some((list2) => list2.length > MAX_ENTRIES);
  const report3 = {
    ...header,
    staged: entries.staged.slice(0, MAX_ENTRIES),
    unstaged: entries.unstaged.slice(0, MAX_ENTRIES),
    untracked: entries.untracked.slice(0, MAX_ENTRIES),
    conflicted: entries.conflicted.slice(0, MAX_ENTRIES),
    clean: Object.values(entries).every((list2) => list2.length === 0),
    ...truncated ? { truncated: true } : {}
  };
  const wanted = statusPaths(paths);
  if (wanted.length > 0) report3.paths = parsePathSections(sections, wanted, !!header.upstream && !header.upstreamGone);
  return { output: statusLines.join("\n").trim(), report: report3 };
}

// ../packages/agent-tools/src/worktree-path.ts
function worktreeNameFor(branch) {
  return `${branch.replace(/\//g, "-")}-wt`;
}
function worktreePathFor(branch) {
  return `../${worktreeNameFor(branch)}`;
}
function worktreeNameShell(branchVar) {
  return `$(echo "$${branchVar}" | tr / -)-wt`;
}
var DIRTY_WORKTREE_EXIT = 14;
var WORKTREE_KEPT_EXIT = 15;
function checkConventionWorktreeShell(branchVar) {
  return [
    `WT="$(cd "$(git rev-parse --show-toplevel)/.." && pwd -P)/${worktreeNameShell(branchVar)}"`,
    'WT_AT="$(git worktree list --porcelain 2>/dev/null | sed -n "s/^worktree //p" | while IFS= read -r W; do if [ "$(cd "$W" 2>/dev/null && pwd -P)" = "$WT" ]; then printf "%s\\n" "$W"; break; fi; done; true)"',
    `if [ -n "$WT_AT" ]; then [ -z "$(git -C "$WT_AT" status --porcelain 2>/dev/null)" ] || { echo "DIRTY_WORKTREE $WT_AT"; exit ${DIRTY_WORKTREE_EXIT}; }; fi`
  ];
}
function removeFoundWorktreeShell() {
  return `if [ -n "$WT_AT" ]; then git worktree remove "$WT_AT" 2>/dev/null || { echo "WORKTREE_KEPT $WT_AT"; exit ${WORKTREE_KEPT_EXIT}; }; fi`;
}

// ../packages/agent-tools/src/branch-switch-guard.ts
var UNSAFE = /["$`%!\n\r]/;
function gitDirArg(dir) {
  if (dir === void 0) return "";
  const normal = dir.replace(/\\/g, "/");
  if (normal.startsWith("~") || UNSAFE.test(normal)) return null;
  return `-C "${normal}" `;
}
function branchSwitchRefusal(command, found, paths) {
  const branch = found.target && found.target !== "-" ? found.target : "<branch>";
  return `Refused: \`${command}\` switches branches, but the working tree has ${pendingChangesSummary(paths)}. Switching branches would carry them onto the other branch or abort mid-way, so branches are never switched over pending changes \u2014 the command was not run. Instead: (a) to put this work on a branch, call git_commit with \`branch\` (it commits through a worktree; this checkout is never switched), then push / open_pull_request; (b) to read another branch, use \`git show ${branch}:<path>\` or \`git diff ${branch}\`; (c) to work on another branch side by side, run \`git worktree add ${worktreePathFor(branch)} ${branch}\` from the repository's top level (\`git worktree add -b ${branch} ${worktreePathFor(branch)}\` to create it) and run your commands there; (d) to discard a file's edits, use \`git restore <path>\` (a bare \`git checkout <x>\` is read as a branch switch when \`<x>\` names a commit). If this command commits or stashes first, run that part on its own, then the switch.`;
}
function unverifiableRefusal(command, dir) {
  return `Refused: \`${command}\` switches branches in \`${dir}\`, which could not be verified clean (that directory cannot be passed to git safely) \u2014 the command was not run. Pass the checkout as \`cwd\` (relative to the workspace root) and run the git command without \`cd\` / \`-C\`, so its working tree can be checked first.`;
}
var succeeded2 = (r) => r.ok && (r.exitCode ?? 0) === 0;
var unanswered = (r) => !r.ok && r.exitCode === void 0;
function unreadableRefusal(command, why) {
  return `Refused: \`${command}\` switches branches, but this checkout's state could not be read (${why ?? "git timed out or its output was too large"}), so it could not be verified clean \u2014 the command was not run. Pass the checkout as \`cwd\` and retry, or commit (git_commit with \`branch\`) first.`;
}
async function namesCommit(git, target) {
  if (UNSAFE.test(target)) return true;
  const sha = await git(`rev-parse --verify --quiet "${target}^{commit}"`);
  if (unanswered(sha)) return true;
  if (succeeded2(sha) && /^[0-9a-f]{7,64}\r?$/m.test(sha.stdout ?? "")) return true;
  const remote = await git(`for-each-ref --count=1 "--format=%(refname)" "refs/remotes/*/${target}"`);
  if (unanswered(remote)) return true;
  return succeeded2(remote) && /^refs\/remotes\//m.test(remote.stdout ?? "");
}
async function refuseBranchSwitchOverChanges(command, dir, ctx) {
  const found = detectBranchSwitch(command);
  if (!found) return void 0;
  const at2 = gitDirArg(found.dir);
  if (at2 === null) return unverifiableRefusal(command, found.dir ?? "");
  const opts = { ...dir ? { cwd: dir } : {}, ...ctx.signal ? { signal: ctx.signal } : {}, fresh: true };
  const git = (args) => ctx.caps.shell.run(`git ${at2}${args}`, opts);
  const status = await git("status --porcelain --branch");
  if (unanswered(status)) return unreadableRefusal(command, status.error);
  if (!succeeded2(status)) return void 0;
  const paths = parsePorcelainPaths(status.stdout ?? "");
  if (paths.length === 0) return void 0;
  if (found.ambiguous && found.target && !await namesCommit(git, found.target)) return void 0;
  return branchSwitchRefusal(command, found, paths);
}

// ../packages/agent-tools/src/shell-tools.ts
var SHELL_WAIT_MAX_MS = 10 * 60 * 1e3;
function waitArg(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), SHELL_WAIT_MAX_MS) : void 0;
}
function cwdArg(v) {
  if (v == null || v === "") return void 0;
  if (typeof v !== "string") return null;
  const dir = v.trim().split("\\").join("/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (dir === "" || dir === ".") return ".";
  return safeRepoArg(dir);
}
function commandDir(command, cwd, defaultRepo) {
  if (cwd) return cwd === "." ? void 0 : cwd;
  if (/^\s*(cd|pushd)\s/i.test(command)) return void 0;
  return safeRepoArg(defaultRepo) ?? void 0;
}
var jobNote = (id) => `Running in the background (job ${id}). Keep working; check it with command_status { "id": "${id}" } (pass waitMs to wait for it), stop it with command_stop { "id": "${id}" }.`;
function finishedJob(st) {
  return {
    ok: st.status === "exited" && st.exitCode === 0,
    ...st.exitCode !== void 0 ? { exitCode: st.exitCode } : {},
    stdout: st.output ?? "",
    ...st.outputId ? { outputId: st.outputId } : {},
    ...st.status === "killed" ? { aborted: true, error: st.error ?? "the job was stopped" } : st.error ? { error: st.error } : {}
  };
}
function shapeResult(command, r) {
  return searchNoMatch(command, r);
}
async function runShellCommand(args, ctx) {
  const stripped = stripTailLimit(typeof args.command === "string" ? args.command : "");
  const command = stripped.command;
  const tailNote = stripped.stripped ? `ran without the trailing \`| tail -${stripped.tail}\` \u2014 the full output is retained under \`outputId\`; read its head with output_filter { outputId, head: \u2026 }. ` : "";
  if (!command.trim()) return { data: { ok: false, error: "command is required" } };
  const cwd = cwdArg(args.cwd);
  if (cwd === null) {
    return { data: { ok: false, error: "`cwd` must be a directory inside the workspace, relative to its root (no `..`, no absolute path)." } };
  }
  const shell = ctx.caps.shell;
  const dir = commandDir(command, cwd, shell.defaultRepo);
  const where = dir ? { cwd: dir } : {};
  const background = args.background === true;
  const yieldMs = waitArg(args.yieldMs);
  let note;
  const refused = await refuseBranchSwitchOverChanges(command, dir, ctx);
  if (refused) return { data: { ok: false, refused: "branch-switch", error: refused, ...where } };
  if (background || yieldMs !== void 0) {
    if (shell.start && shell.poll) {
      if (ctx.signal?.aborted) return { data: { ok: false, aborted: true, error: "stopped before the command started", ...where } };
      const started = await (dir ? shell.start(command, { cwd: dir }) : shell.start(command));
      if (!started.ok || !started.id) return { data: { ok: false, error: started.error ?? "the background job did not start", ...where } };
      const id = started.id;
      if (background) return { data: { ok: true, background: true, id, status: "running", note: jobNote(id), ...where } };
      const st = await shell.poll(id, { waitMs: yieldMs, ...ctx.signal ? { signal: ctx.signal } : {} });
      if (st.status === "running") {
        const why = ctx.signal?.aborted ? "The wait was interrupted" : `Still running after ${yieldMs}ms`;
        return { data: { ok: true, background: true, id, status: "running", output: st.output ?? "", note: `${why}, so it moved to the background. ${jobNote(id)}`, ...where } };
      }
      const r2 = await compressShellResult(shapeResult(command, finishedJob(st)), ctx);
      return { data: { ...r2, ...st.status === "unknown" ? { id } : {}, ...where } };
    }
    note = "This surface has no background shell, so the command ran in the foreground.";
  }
  const ran = args.fresh === true ? await shell.run(command, { ...ctx.signal ? { signal: ctx.signal } : {}, ...where, fresh: true }) : await shellRunWithStop(ctx, command, dir);
  const r = await compressShellResult(shapeResult(command, ran), ctx);
  const notes = [tailNote, r.note, note].filter(Boolean).join(" ");
  return { data: { ...r, ...where, ...notes ? { note: notes } : {} } };
}
async function compressedJobStatus(st, ctx) {
  if (st.status === "running" || typeof st.output !== "string") return st;
  const r = await compressShellResult(finishedJob(st), ctx);
  return r.compressed && typeof r.stdout === "string" ? { ...st, output: r.stdout } : st;
}
function jobId(args) {
  return typeof args.id === "string" ? args.id.trim() : "";
}
var commandStatusTool = defineTool({
  name: "command_status",
  description: "Check a BACKGROUND command started by run_command (background:true, or one that outlived its yieldMs): whether it is still running, its exit code, and the tail of its output. Pass waitMs to wait up to that long for it to finish first. Use this instead of re-running a long command.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The job id run_command returned." },
      waitMs: { type: "number", description: "Optional: wait up to this many milliseconds for the job to finish before answering (max 600000)." }
    },
    required: ["id"]
  },
  requires: ["shell.jobs"],
  async execute(args, ctx) {
    const id = jobId(args);
    if (!id) return { data: { ok: false, error: "id is required" } };
    const poll = ctx.caps.shell?.poll;
    if (!poll) return { data: { ok: false, error: "background commands are not available on this surface" } };
    const waitMs = waitArg(args.waitMs);
    const st = await poll.call(ctx.caps.shell, id, { ...waitMs !== void 0 ? { waitMs } : {}, ...ctx.signal ? { signal: ctx.signal } : {} });
    return { data: await compressedJobStatus(st, ctx) };
  }
});
var commandStopTool = defineTool({
  name: "command_stop",
  description: "Stop a BACKGROUND command started by run_command \u2014 it and every process it started are killed. Returns its final output tail.",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "The job id run_command returned." } },
    required: ["id"]
  },
  requires: ["shell.jobs"],
  async execute(args, ctx) {
    const id = jobId(args);
    if (!id) return { data: { ok: false, error: "id is required" } };
    const kill = ctx.caps.shell?.kill;
    if (!kill) return { data: { ok: false, error: "background commands are not available on this surface" } };
    const st = await kill.call(ctx.caps.shell, id);
    return { data: await compressedJobStatus(st, ctx) };
  }
});
var SHELL_JOB_TOOLS = [commandStatusTool, commandStopTool, outputFilterTool];

// ../packages/agent-tools/src/git-script-parts.ts
var RESOLVE_BASE = `BASE="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"; [ -n "$BASE" ] || BASE=main`;
var IDENTITY_EMAIL = 'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"';
var IDENTITY_NAME = 'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"';
var REPO_PARAM = {
  type: "string",
  description: 'Optional subdirectory holding the repository, when the open folder CONTAINS checkouts rather than being one (e.g. "my-project"). Omit when the workspace root is itself the repo.'
};

// ../packages/agent-tools/src/git-publish-tools.ts
function buildCommitCommand(opts) {
  const branch = safeGitArg(opts.branch);
  const resolveLines = opts.paths.map((p, i) => {
    const candidates = commitPathCandidates(p, opts.repo).map(shellQuote).join(" ");
    if (!branch && opts.allowBaseBranch) {
      return `P${i}=""; for c in ${candidates}; do if [ -e "$c" ] || git ls-files --error-unmatch -- "$c" >/dev/null 2>&1; then P${i}="$c"; break; fi; done; [ -n "$P${i}" ] || MISSING="$MISSING "${shellQuote(p)}`;
    }
    if (!branch) {
      return `P${i}="$(pick ${candidates})" || MISSING="$MISSING "${shellQuote(p)}`;
    }
    return `P${i}=""; for c in ${candidates}; do if [ -e "$ORIG/$c" ]; then P${i}="$c"; mkdir -p "$(dirname "$WT/$c")"; cp -R "$ORIG/$c" "$WT/$c"; break; elif [ -e "$c" ]; then P${i}="$c"; rm -f "$WT/$c"; break; fi; done; [ -n "$P${i}" ] || MISSING="$MISSING "${shellQuote(p)}`;
  });
  const paths = opts.paths.map((_, i) => `"$P${i}"`).join(" ");
  return [
    "set -e",
    RESOLVE_BASE,
    'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
    'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    // A ticket branch was named: do NOT `git checkout` away from the branch the human is
    // on. Instead create the branch in a dedicated worktree (the "sub graph") and run the
    // whole commit there — the checkout the person is using keeps its current branch and
    // its (possibly dirty) working tree. If the branch already exists as a worktree, reuse
    // it; otherwise make it from the current HEAD. The worktree lives one level up so it
    // is never inside the checkout being edited, and is named for the branch.
    ...branch ? [
      'ORIG="$(git rev-parse --show-toplevel)"',
      // THE worktree convention (`worktree-path.ts`) — the run_command refusal names the same path.
      `WT="$ORIG/${worktreePathFor(branch)}"`,
      // This checkout's git-common-dir, physical and absolute: the identity of the
      // repository. A worktree of THIS repo shares it; a foreign checkout does not.
      'COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"',
      // Reuse the worktree when the branch already has one there; create it from HEAD
      // otherwise. The reuse arm tolerates a worktree that is already registered at
      // that path ("already registered" would otherwise fail the whole commit) — but
      // ONLY when it belongs to this repository. A foreign repo's checkout sitting at
      // `../<branch>-wt` on a same-named branch would otherwise receive the commit (and
      // the agent's files copied into it), so it is refused instead.
      `git worktree add "$WT" -b "${branch}" 2>/dev/null || git worktree add "$WT" "${branch}" 2>/dev/null || { [ "$(git -C "$WT" rev-parse --abbrev-ref HEAD 2>/dev/null)" = ${shellQuote(branch)} ] || { echo WORKTREE_FAILED; exit 12; }; WT_COMMON="$(cd "$WT" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)" || WT_COMMON=""; [ "$WT_COMMON" = "$COMMON" ] || { echo "WORKTREE_FOREIGN: $WT"; exit 13; }; }`,
      'cd "$WT"'
    ] : opts.allowBaseBranch ? [] : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }'],
    // A path is "there" if it is on disk OR tracked by git — the second arm is what
    // lets a DELETION be committed, since the file is gone by definition.
    'pick() { for c in "$@"; do if [ -e "$c" ] || git ls-files --error-unmatch -- "$c" >/dev/null 2>&1; then printf %s "$c"; return 0; fi; done; return 1; }',
    'MISSING=""',
    ...resolveLines,
    '[ -z "$MISSING" ] || { echo "MISSING_PATHS:$MISSING"; exit 8; }',
    `git add -- ${paths}`,
    // Nothing staged is a fact, not a failure — say which rather than exiting 1 with
    // git's own "nothing to commit" that reads like a broken tool.
    "git diff --cached --quiet && { echo NOTHING_STAGED; exit 6; }",
    `git commit -m ${shellQuote(opts.message)}`,
    'echo "Committed on $(git rev-parse --abbrev-ref HEAD): $(git rev-parse --short HEAD)"'
  ].join("\n");
}
function buildPushCommand(opts) {
  const branch = safeGitArg(opts.branch);
  return [
    "set -e",
    RESOLVE_BASE,
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    // A named ticket branch is pushed by REF — the commit landed in its worktree, so the
    // checkout the human is on is irrelevant here. That is the whole point: the pipeline
    // never moves the person's checkout off their branch.
    ...branch ? [`[ "${branch}" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }`, `PUSHED="${branch}"`] : [...opts.allowBaseBranch ? [] : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }'], 'PUSHED="$CUR"'],
    // `-u` so a brand-new ticket branch gets its upstream on the first push.
    'git push -u origin "$PUSHED"',
    'echo "Pushed $PUSHED to origin"',
    // Report where the push LANDED — the branch header (`## main...origin/main`, with any
    // `[ahead N]` still owed) plus whatever is still uncommitted. That is the evidence a
    // host needs to call the change shipped, so the push verifies itself rather than
    // depending on the agent remembering a separate status call. Never fails the push.
    "git status --short --branch 2>/dev/null || true"
  ].join("\n");
}
function buildPullRequestCommand(opts) {
  const base = safeGitArg(opts.base);
  const branch = safeGitArg(opts.branch);
  const reviewers = (opts.reviewers ?? []).map((r) => safeGitArg(r)).filter((r) => !!r);
  return [
    "set -e",
    "command -v gh >/dev/null 2>&1 || { echo NO_GH_CLI; exit 7; }",
    ...base ? [`BASE="${base}"`] : [RESOLVE_BASE],
    // HEAD_REF is the named ticket branch when one was passed — the branch lives in a
    // worktree, so the checkout's CURRENT branch is not it. Named-by-ref keeps the PR on
    // the ticket branch without ever switching the checkout.
    ...branch ? [`HEAD_REF="${branch}"`] : ['HEAD_REF="$(git rev-parse --abbrev-ref HEAD)"'],
    '[ "$HEAD_REF" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }',
    // Push first when the branch has no upstream — `gh pr create` fails on an unpushed
    // head, and "open a PR" plainly means the branch has to exist on the remote.
    'git rev-parse --verify --quiet "refs/remotes/origin/$HEAD_REF" >/dev/null 2>&1 || git push -u origin "$HEAD_REF"',
    `gh pr create --base "$BASE" --head "$HEAD_REF" --title ${shellQuote(opts.title)} --body ${shellQuote(opts.body)}` + reviewers.map((r) => ` --reviewer "${r}"`).join("")
  ].join("\n");
}
function buildCleanupCommand(opts) {
  const branch = safeGitArg(opts.branch);
  const base = safeGitArg(opts.baseBranch);
  return [
    "set -e",
    ...base ? [`BASE="${base}"`] : [RESOLVE_BASE],
    ...branch ? [`TARGET="${branch}"`] : ['TARGET="$(git rev-parse --abbrev-ref HEAD)"'],
    '[ "$TARGET" != "$BASE" ] || { echo NOTHING_TO_CLEAN; exit 9; }',
    '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
    'git rev-parse --verify --quiet "$TARGET" >/dev/null || { echo NO_SUCH_BRANCH; exit 11; }',
    // THE convention's worktree (`worktree-path.ts`) — the one git_commit and the run_command
    // refusal both create — found and checked for uncommitted work NOW, before the fetch and the
    // checkout below, so a refused cleanup changes nothing.
    ...checkConventionWorktreeShell("TARGET"),
    // Was this branch ever pushed? Read BEFORE the prune, which is what removes the
    // evidence — a branch that had an upstream and no longer exists on the remote was
    // merged and deleted by the host, however it was merged.
    'HAD_UPSTREAM=0; git rev-parse --verify --quiet "refs/remotes/origin/$TARGET" >/dev/null && HAD_UPSTREAM=1',
    "git fetch --prune origin",
    'REMOTE_EXISTS=0; git ls-remote --exit-code --heads origin "$TARGET" >/dev/null 2>&1 && REMOTE_EXISTS=1',
    // Get onto the base branch and bring it up to date — the state the user expects to
    // be left in. `--ff-only` so a divergent local base is reported, never merged.
    'git checkout "$BASE"',
    'git merge --ff-only "origin/$BASE" >/dev/null 2>&1 || echo "note: local $BASE has diverged from origin/$BASE and was left alone"',
    'MERGED=0; git branch --merged "origin/$BASE" | sed "s/^[* ] *//" | grep -qx "$TARGET" && MERGED=1',
    // Squash-merged: the commits are in the base under a new hash, so `--merged` says
    // no, but the host deleted the remote branch when the PR landed.
    '[ "$MERGED" = 1 ] || { [ "$HAD_UPSTREAM" = 1 ] && [ "$REMOTE_EXISTS" = 0 ] && MERGED=1; } || true',
    ...opts.force ? ["MERGED=1"] : [],
    '[ "$MERGED" = 1 ] || { echo NOT_MERGED; exit 10; }',
    // The ticket branch may live in a worktree (the commit flow never switches the
    // checkout), and git refuses to delete a branch that is checked out anywhere — so
    // remove the (clean, checked above) worktree first; one git will not remove (locked,
    // submodules) stops here with WORKTREE_KEPT rather than failing the branch delete.
    removeFoundWorktreeShell(),
    // `-D`, not `-d`: the merged-ness check above is STRICTER than git's own (it also
    // accepts the squash-merge case git cannot see), so `-d` would refuse exactly the
    // branches this tool exists to remove. Nothing reaches this line unmerged.
    'git branch -D "$TARGET"',
    // The remote branch is usually ALREADY gone (the host deletes it on merge). That is
    // the goal state, not an error, so it is only pushed when it is actually there.
    '[ "$REMOTE_EXISTS" = 0 ] || git push origin --delete "$TARGET"',
    "git remote prune origin >/dev/null 2>&1 || true",
    'echo "Cleaned up $TARGET \u2014 on $BASE (updated), branch deleted locally and on origin"'
  ].join("\n");
}
function publishToolResult(action, r) {
  const out = (r.stdout ?? "").trim();
  const fail = (error) => ({ data: { ok: false, action, error, output: out } });
  if (r.exitCode === 5 || /\bON_BASE_BRANCH\b/.test(out)) {
    return fail(
      action === "push" ? "you are on the BASE branch (main/master) and `allowBaseBranch` was not set \u2014 pushing here bypasses pull-request review. Open a pull request instead (git_commit with a `branch`, then open_pull_request). If the human has explicitly asked you to push the base branch, or your session instructions make you the reviewer of your own change and you have self-reviewed it, re-call with allowBaseBranch:true; they will be prompted to approve it." : "you are on the BASE branch (main/master) and `allowBaseBranch` was not set \u2014 committing here bypasses pull-request review. Pass `branch` to git_commit to work on a ticket branch (it is created for you), then open_pull_request. If the human has explicitly asked you to commit to the base branch directly, or your session instructions make you the reviewer of your own change and you have self-reviewed it, re-call with allowBaseBranch:true; they will be prompted to approve it."
    );
  }
  if (r.exitCode === 6 || /\bNOTHING_STAGED\b/.test(out)) {
    return fail("none of the named paths have uncommitted changes \u2014 nothing was committed. Run git_status to see what actually differs; do not report a commit that did not happen.");
  }
  const missing = /MISSING_PATHS:([^\n]*)/.exec(out);
  if (r.exitCode === 8 || missing) {
    const named = (missing?.[1] ?? "").trim();
    return fail(
      `these paths do not exist in the repository, so nothing was committed:${named ? ` ${named}` : ""}. \`paths\` are relative to the REPOSITORY root \u2014 when you pass \`repo\`, that means relative to the repo directory, NOT to the workspace root your file tools use. Run git_status (with the same \`repo\`) and copy the paths it prints.`
    );
  }
  if (r.exitCode === 9 || /\bNOTHING_TO_CLEAN\b/.test(out)) {
    return fail("you are already on the base branch and no ticket branch was named \u2014 there is nothing to clean up. Pass `branch` to name the merged branch to delete.");
  }
  if (r.exitCode === 10 || /\bNOT_MERGED\b/.test(out)) {
    return fail(
      "that branch's commits are NOT in the base branch, so it was left alone \u2014 deleting it would destroy unmerged work. If the pull request was SQUASH-merged (the commits are in main under a new hash and the remote branch still exists), re-call with force:true to delete it anyway."
    );
  }
  if (r.exitCode === 11 || /\bNO_SUCH_BRANCH\b/.test(out)) {
    return fail("no local branch by that name \u2014 it has already been deleted. Nothing to do.");
  }
  const foreign = /WORKTREE_FOREIGN:([^\n]*)/.exec(out);
  if (r.exitCode === 13 || foreign) {
    const at2 = (foreign?.[1] ?? "").trim();
    return fail(
      `the ticket branch's worktree path${at2 ? ` (${at2})` : ""} is already a checkout of a DIFFERENT repository on a branch of the same name \u2014 nothing was committed there, and the checkout was not switched. Do not commit into it. Tell the human which directory is in the way (it must be moved or removed), or re-try git_commit with a different \`branch\` name.`
    );
  }
  if (r.exitCode === 12 || /\bWORKTREE_FAILED\b/.test(out)) {
    return fail("the ticket branch's worktree could not be created or reused \u2014 nothing was committed and the checkout was not switched. Run git_status, then re-try git_commit with the same branch (a stale worktree can be cleared with `git worktree prune`).");
  }
  const dirtyWorktree = /DIRTY_WORKTREE ([^\n]*)/.exec(out);
  if (r.exitCode === DIRTY_WORKTREE_EXIT || dirtyWorktree) {
    const at2 = (dirtyWorktree?.[1] ?? "").trim();
    return fail(
      `the branch's worktree${at2 ? ` (${at2})` : ""} has uncommitted changes, so it was kept and the branch was NOT deleted \u2014 removing it would destroy that work. Commit those changes (git_commit / run_command in that worktree) or discard them there (\`git restore\` / \`git clean\`), then re-run git_cleanup_merged.`
    );
  }
  const kept = /WORKTREE_KEPT ([^\n]*)/.exec(out);
  if (r.exitCode === WORKTREE_KEPT_EXIT || kept) {
    const at2 = (kept?.[1] ?? "").trim();
    return fail(
      `the branch's worktree${at2 ? ` (${at2})` : ""} could not be removed \u2014 it is locked or has submodules \u2014 so the branch was NOT deleted. Only if its contents are not needed, unlock/remove it with \`git worktree remove --force ${at2 || "<path>"}\`, then re-run git_cleanup_merged.`
    );
  }
  if (r.exitCode === 4 || /\bDIRTY\b/.test(out)) {
    return fail("you have uncommitted changes \u2014 commit or discard them before cleaning up (this refuses to discard uncommitted work).");
  }
  if (r.exitCode === 7 || /\bNO_GH_CLI\b/.test(out)) {
    return fail("the GitHub CLI (`gh`) is not installed or not on PATH, so a pull request cannot be opened from here. The branch is committed and pushed; tell the human to open the PR, and give them the branch name.");
  }
  return { data: { ok: r.ok, action, output: out.slice(0, 2e4), ...r.error ? { error: r.error } : {} } };
}
function invalidRefResult(action, refs) {
  for (const [name, value] of Object.entries(refs)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v !== "string" || v === "" || safeGitArg(v) !== null) continue;
      return {
        data: {
          ok: false,
          action,
          error: `${name} '${v}' is not a valid name \u2014 use only letters, digits and . _ / @ - (no spaces, no shell characters, not starting with '-'), so nothing was run`
        }
      };
    }
  }
  return null;
}
async function runPublishTool(action, command, repo, ctx) {
  const refused = invalidRepoResult(action, repo);
  if (refused) return refused;
  const build = (scope) => typeof command === "string" ? command : command(scope);
  const ran = await runInRepoScope(ctx, repo ? { repo } : {}, (scope) => shellRunWithStop(ctx, build(scope), safeRepoArg(scope) ?? void 0));
  if (!ran) return notARepoWithCandidates(action, ctx);
  const result = publishToolResult(action, ran.r);
  if (ran.repo && result.data.ok) result.data.repo = ran.repo;
  return result;
}
var gitCommitTool = defineTool({
  name: "git_commit",
  description: "Commit the files you changed. You must list the exact `paths` to commit \u2014 the working tree is shared with the human using it, so committing everything would sweep up their unrelated in-flight work; run git_status/git_diff first if you are unsure what you touched. The DEFAULT route is a TICKET BRANCH: pass `branch` to name it (created for you if it does not exist), then use open_pull_request so the work is reviewed. Without `branch`, a commit is refused while you are on the base branch (main/master) \u2014 unless the human has EXPLICITLY asked you to commit to main directly, or your session instructions make you the reviewer of your own change (a local editor session, after you have verified and self-reviewed it); then pass allowBaseBranch:true (the human is prompted to approve it) and follow with git_push allowBaseBranch:true.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message. One line saying what changed and why." },
      paths: { type: "array", items: { type: "string" }, description: "Repo-relative paths to commit. Exactly the files YOU changed \u2014 never a catch-all." },
      branch: { type: "string", description: 'Ticket branch to commit on, created if new (e.g. "ticket/2394-mobile-board-height"). The default route; required when on the base branch unless allowBaseBranch is set.' },
      allowBaseBranch: { type: "boolean", description: "Set ONLY when the human explicitly asked to commit to the base branch (main/master) directly. Default false, which refuses on the base branch and tells you to use a ticket branch." },
      repo: REPO_PARAM
    },
    required: ["message", "paths"]
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) return Promise.resolve({ data: { ok: false, action: "commit", error: "message is required" } });
    const paths = Array.isArray(args.paths) ? args.paths.filter((p) => typeof p === "string" && p.trim() !== "") : [];
    if (paths.length === 0) {
      return Promise.resolve({ data: { ok: false, action: "commit", error: "paths is required \u2014 list the exact files you changed. Run git_status to see them. Do not pass '.' or '-A': the working tree may hold changes that are not yours." } });
    }
    const badRef = invalidRefResult("commit", { branch: args.branch });
    if (badRef) return Promise.resolve(badRef);
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    return runPublishTool(
      "commit",
      (scope) => buildCommitCommand({ message, paths, branch: typeof args.branch === "string" ? args.branch : void 0, allowBaseBranch: args.allowBaseBranch === true, repo: scope }),
      repo,
      ctx
    );
  }
});
var gitPushTool = defineTool({
  name: "git_push",
  description: "Push the current branch to origin (setting its upstream on the first push), then report where it landed (`git status --short --branch`). Pushing the BASE branch (main/master) is refused unless you pass allowBaseBranch \u2014 that path skips pull-request review, so only set it when the human has explicitly asked for it, or when your session instructions make you the reviewer of your own change (a local editor session, after verifying and self-reviewing it); the human is prompted to approve it either way. Otherwise the route is a ticket branch: git_commit with a `branch`, git_push, then open_pull_request.",
  parameters: {
    type: "object",
    properties: {
      allowBaseBranch: { type: "boolean", description: "Set ONLY when the human explicitly asked to push the base branch directly. Default false, which refuses and tells you to open a pull request." },
      branch: { type: "string", description: "Ticket branch to push, as named to git_commit. Pushes it by ref, so the checkout the human is on is never switched. Defaults to the current branch." },
      repo: REPO_PARAM
    }
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const badRef = invalidRefResult("push", { branch: args.branch });
    if (badRef) return Promise.resolve(badRef);
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    return runPublishTool("push", buildPushCommand({ allowBaseBranch: args.allowBaseBranch === true, branch: typeof args.branch === "string" ? args.branch : void 0 }), repo, ctx);
  }
});
var openPullRequestTool = defineTool({
  name: "open_pull_request",
  description: "Open a pull request for the current ticket branch against the base branch, pushing it first if it has no upstream yet. This is how a change gets REVIEWED \u2014 prefer it over pushing the base branch, and say so when someone asks you to push directly. Pass `reviewers` to request review from specific people or teams. Returns the pull request URL; report that URL rather than claiming the work is shipped, because it is not until the PR is merged.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Pull request title \u2014 what this change does, in one line." },
      body: { type: "string", description: "Pull request description: what changed, why, and how a reviewer can verify it." },
      base: { type: "string", description: "Base branch to target. Defaults to the remote's default branch (usually main)." },
      branch: { type: "string", description: "Ticket branch to open the pull request from, as named to git_commit. Uses it by ref, so the checkout the human is on is never switched. Defaults to the current branch." },
      reviewers: { type: "array", items: { type: "string" }, description: "GitHub usernames or org/team slugs to request review from." },
      repo: REPO_PARAM
    },
    required: ["title", "body"]
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const body = typeof args.body === "string" ? args.body : "";
    if (!title) return Promise.resolve({ data: { ok: false, action: "pull_request", error: "title is required" } });
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    const reviewers = Array.isArray(args.reviewers) ? args.reviewers.filter((r) => typeof r === "string") : void 0;
    const badRef = invalidRefResult("pull_request", { base: args.base, branch: args.branch, reviewers });
    if (badRef) return Promise.resolve(badRef);
    return runPublishTool(
      "pull_request",
      buildPullRequestCommand({ title, body, base: typeof args.base === "string" ? args.base : void 0, branch: typeof args.branch === "string" ? args.branch : void 0, reviewers }),
      repo,
      ctx
    );
  }
});
var gitCleanupMergedTool = defineTool({
  name: "git_cleanup_merged",
  description: "Clean up after work that has LANDED: switch to the base branch, fast-forward it to origin, and delete the merged ticket branch locally and on origin. Call it once the pull request is merged (or once you have pushed the base branch directly) so the checkout is not left sitting on a dead branch with a stale base \u2014 do not hand-roll this with run_command. It is IDEMPOTENT: a remote branch the host already deleted on merge is the expected state, not an error. It REFUSES to delete a branch whose commits are not in the base branch, and refuses to run on a dirty working tree, so it can never destroy unmerged or uncommitted work. If the pull request was SQUASH-merged and the remote branch still exists, git cannot see the merge \u2014 re-call with force:true.",
  parameters: {
    type: "object",
    properties: {
      branch: { type: "string", description: "The merged branch to delete. Defaults to the branch you are currently on." },
      baseBranch: { type: "string", description: "Branch to return to and update. Defaults to the remote's default branch (usually main)." },
      force: { type: "boolean", description: "Delete the branch even though git cannot see its commits in the base branch. ONLY for a squash-merged pull request you have confirmed is merged." },
      repo: REPO_PARAM
    }
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const badRef = invalidRefResult("cleanup", { branch: args.branch, baseBranch: args.baseBranch });
    if (badRef) return Promise.resolve(badRef);
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    return runPublishTool(
      "cleanup",
      buildCleanupCommand({
        branch: typeof args.branch === "string" ? args.branch : void 0,
        baseBranch: typeof args.baseBranch === "string" ? args.baseBranch : void 0,
        force: args.force === true
      }),
      repo,
      ctx
    );
  }
});

// ../packages/agent-tools/src/git-tools.ts
function pathspecArg(opts) {
  const specs = (opts?.pathspecs ?? [opts?.path]).map((p) => safeGitArg(p)).filter((p) => !!p);
  return specs.length > 0 ? ` -- ${specs.map((p) => `"${p}"`).join(" ")}` : "";
}
function buildUnbornDiffCommands(opts) {
  const pathArg = pathspecArg(opts);
  return [`git --no-pager diff --cached${pathArg}`, `git --no-pager diff${pathArg}`];
}
var UNBORN_HEAD = /^fatal: .*(bad revision 'HEAD'|ambiguous argument 'HEAD'|unknown revision)/m;
function isUnbornHead(r) {
  if (r.ok || r.exitCode !== void 0 && r.exitCode !== 128) return false;
  return UNBORN_HEAD.test(`${r.stdout ?? ""}
${r.error ?? ""}`);
}
function buildGitCommand(action, opts) {
  const pathArg = pathspecArg(opts);
  const tracked = safeGitArg(opts?.trackedBranch);
  const viaSandbox = opts?.remoteViaSandbox === true;
  const fetchTracked = viaSandbox ? "" : `git fetch origin "${tracked}" 2>/dev/null && `;
  const absorb = tracked ? ["set -e", IDENTITY_EMAIL, IDENTITY_NAME, `${fetchTracked}git merge --ff-only "origin/${tracked}" 2>/dev/null || true`] : [];
  const publish = (force) => tracked && !viaSandbox ? [force ? "git push --force-with-lease origin HEAD" : "git push origin HEAD"] : [];
  switch (action) {
    case "status":
      return buildStatusCommand(opts?.paths, opts?.repo);
    case "diff":
      return `git --no-pager diff HEAD${pathArg}`;
    case "history": {
      const limit = Number.isFinite(opts?.limit) && opts.limit > 0 ? Math.min(Math.floor(opts.limit), 200) : 30;
      return `git --no-pager log --oneline -n ${limit}${pathArg}`;
    }
    case "sync_latest": {
      const base = safeGitArg(opts?.baseBranch);
      const resolveBase = base ? `BASE="${base}"` : RESOLVE_BASE;
      return [
        ...tracked ? absorb : ["set -e"],
        resolveBase,
        ...tracked ? [] : [IDENTITY_EMAIL, IDENTITY_NAME],
        ...viaSandbox ? [] : ['git fetch origin "$BASE"'],
        'git merge --no-edit "origin/$BASE" || { git merge --abort; echo MERGE_CONFLICT; exit 3; }',
        ...publish(false),
        'echo "Synced with origin/$BASE"'
      ].join("\n");
    }
    case "undo":
      return [
        ...absorb,
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        "git reset --hard HEAD~1",
        ...publish(true),
        'echo "Undid the last commit (use git_redo to reapply)"'
      ].join("\n");
    case "redo":
      return [
        ...absorb,
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        'git reset --hard "HEAD@{1}"',
        ...publish(true),
        'echo "Reapplied the last undone change"'
      ].join("\n");
  }
}
function gitToolResult(action, r, paths) {
  const out = (r.stdout ?? "").trim();
  if (action === "status" && r.ok) {
    const { output, report: report3 } = parseGitStatusOutput(out, paths);
    return { data: { ok: true, action, output: output.slice(0, 2e4), ...report3, ...r.error ? { error: r.error } : {} } };
  }
  if (r.exitCode === 3 || /MERGE_CONFLICT/.test(out)) {
    return { data: { ok: false, action, error: "merge conflict \u2014 the base branch has changes that conflict with your branch; the merge was aborted (working tree is clean). Resolve by editing the conflicting files, or ask a human.", output: out } };
  }
  if (r.exitCode === 4 || /\bDIRTY\b/.test(out)) {
    return { data: { ok: false, action, error: "you have uncommitted changes \u2014 commit or discard them before git_" + action + " (it refuses to discard uncommitted work)." } };
  }
  return { data: { ok: r.ok, action, output: out.slice(0, 2e4), ...r.error ? { error: r.error } : {} } };
}
async function runGitTool(action, opts, ctx) {
  const refused = invalidRepoResult(action, opts.repo);
  if (refused) return refused;
  const trackedBranch = ctx.caps.shell?.trackedBranch;
  const remote = trackedBranch && (action === "sync_latest" || action === "undo" || action === "redo") ? ctx.caps.shell?.git : void 0;
  let baseBranch = opts.baseBranch;
  if (remote) {
    const synced = await remote.sync({ baseBranch: opts.baseBranch });
    if (!synced.ok) return { data: { ok: false, action, error: `could not fetch from the remote: ${synced.error ?? "unknown error"}` } };
    baseBranch = synced.baseBranch ?? baseBranch;
  }
  const scope = { repo: opts.repo, path: opts.path ?? opts.paths?.[0] };
  const ran = await runInRepoScope(ctx, scope, async (repo, pathspecs) => {
    const cwd = safeRepoArg(repo) ?? void 0;
    const r = await shellRunWithStop(ctx, buildGitCommand(action, {
      baseBranch,
      limit: opts.limit,
      pathspecs,
      ...opts.paths?.length ? { paths: opts.paths, ...repo ? { repo } : {} } : {},
      ...trackedBranch ? { trackedBranch } : {},
      ...remote ? { remoteViaSandbox: true } : {}
    }), cwd);
    if (action !== "diff" || !isUnbornHead(r)) return r;
    const [staged, unstaged] = buildUnbornDiffCommands({ pathspecs });
    const a = await shellRunWithStop(ctx, staged, cwd);
    if (!a.ok) return a;
    const b = await shellRunWithStop(ctx, unstaged, cwd);
    if (!b.ok) return b;
    return { ...b, stdout: [a.stdout, b.stdout].map((s) => (s ?? "").trim()).filter(Boolean).join("\n") };
  });
  if (!ran) return notARepoWithCandidates(action, ctx);
  if (remote && ran.r.ok) {
    const published = await remote.publish({ force: action !== "sync_latest" });
    if (!published.ok) return { data: { ok: false, action, error: `the change was made locally but could not be published: ${published.error ?? "unknown error"}` } };
  }
  const result = gitToolResult(action, ran.r, opts.paths);
  if (ran.repo && result.data.ok) {
    result.data.repo = ran.repo;
  }
  return result;
}
var gitStatusTool = defineTool({
  name: "git_status",
  description: 'ONE call answers "is it committed? is it pushed? by whom?" \u2014 do not chain git_diff / git_history / run_command `git log` for that. Returns the branch, its upstream, ahead/behind counts, and the staged / unstaged / untracked / conflicted files. Pass `paths` to limit it to those files AND get, for each, the last commit that touched it (sha, subject, author, date) and `onUpstream` (true = already pushed). A path with no uncommitted entry and `onUpstream: true` is committed and pushed \u2014 possibly by someone else; the author says who. If the open folder contains several checkouts rather than being one repo, pass `repo` to name the one you mean.',
  parameters: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" }, description: `Optional files/dirs to ask about (at most ${GIT_STATUS_MAX_PATHS}): limits the entries to them and reports each one's last commit and whether it is pushed.` },
      repo: REPO_PARAM
    }
  },
  requires: ["shell"],
  execute: (args, ctx) => {
    const paths = statusPaths(Array.isArray(args.paths) ? args.paths : void 0);
    return runGitTool("status", { repo: typeof args.repo === "string" ? args.repo : void 0, ...paths.length ? { paths } : {} }, ctx);
  }
});
var gitDiffTool = defineTool({
  name: "git_diff",
  description: "Show the uncommitted diff of your working tree (optionally for one path). Use it to review exactly what you changed before finishing.",
  parameters: { type: "object", properties: { path: { type: "string", description: "Optional file/dir to scope the diff to \u2014 repo-relative or workspace-relative (with the repo folder prefix); both are accepted." }, repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("diff", { path: typeof args.path === "string" ? args.path : void 0, repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitHistoryTool = defineTool({
  name: "git_history",
  description: "Show recent commit history (git log --oneline), optionally scoped to a path. Use it to understand how a file evolved before changing it.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional file/dir to scope history to \u2014 repo-relative or workspace-relative (with the repo folder prefix); both are accepted." },
      limit: { type: "number", description: "Max commits to return (default 30, max 200)." },
      repo: REPO_PARAM
    }
  },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("history", { path: typeof args.path === "string" ? args.path : void 0, limit: typeof args.limit === "number" ? args.limit : void 0, repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitSyncLatestTool = defineTool({
  name: "git_sync_latest",
  description: "Fetch the latest base branch (e.g. main) and merge it into your working branch so you are NOT building on stale code. Run this FIRST, before editing \u2014 a branch created earlier can be far behind main, so its build fails against old dependencies and its pull request would revert newer work. On a merge conflict it safely aborts and tells you which to resolve.",
  parameters: { type: "object", properties: { baseBranch: { type: "string", description: "Base branch to sync from. Defaults to the remote's default branch (usually main)." }, repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("sync_latest", { baseBranch: typeof args.baseBranch === "string" ? args.baseBranch : void 0, repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitUndoTool = defineTool({
  name: "git_undo",
  description: "Undo your most recent commit (keeps the change recoverable \u2014 use git_redo to reapply). Refuses if you have uncommitted changes, so it can never discard unsaved work. Use it to back out a change that was wrong.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("undo", { repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitRedoTool = defineTool({
  name: "git_redo",
  description: "Reapply the change you most recently undid with git_undo (reflog redo). Refuses if you have uncommitted changes.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("redo", { repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var GIT_TOOLS = [
  gitStatusTool,
  gitDiffTool,
  gitHistoryTool,
  gitSyncLatestTool,
  gitUndoTool,
  gitRedoTool,
  gitCommitTool,
  gitPushTool,
  openPullRequestTool,
  gitCleanupMergedTool
];

// ../packages/agent-tools/src/retrievalK.ts
var ADAPTIVE_K_START = 3;
var ADAPTIVE_K_FLOOR = 0.5;
var ADAPTIVE_K_HEAD_MARGIN = 0.15;
var positiveInt = (n, fallback) => typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
function hasClearHead(scores, start = ADAPTIVE_K_START, floor = ADAPTIVE_K_FLOOR, headMargin = ADAPTIVE_K_HEAD_MARGIN) {
  const top = Number(scores[0]);
  if (!Number.isFinite(top) || top < floor || top <= 0) return false;
  if (scores.length <= start) return true;
  const firstDropped = Number(scores[start]);
  if (!Number.isFinite(firstDropped)) return true;
  return (top - firstDropped) / top >= headMargin;
}
function chooseK(input) {
  const n = input.scores.length;
  const requested = positiveInt(input.requested, 0);
  const ceiling = Math.min(requested, positiveInt(input.max, requested), n);
  if (ceiling <= 0) return 0;
  const start = Math.max(1, Math.min(positiveInt(input.start, ADAPTIVE_K_START), ceiling));
  let k = hasClearHead(input.scores, start, input.floor ?? ADAPTIVE_K_FLOOR, input.headMargin ?? ADAPTIVE_K_HEAD_MARGIN) ? start : ceiling;
  const budget = input.budgetTokens;
  if (typeof budget === "number" && Number.isFinite(budget) && input.itemTokens?.length) {
    let used = 0;
    let fit = 0;
    for (let i = 0; i < k; i++) {
      used += Math.max(0, Number(input.itemTokens[i] ?? 0) || 0);
      if (used > budget) break;
      fit = i + 1;
    }
    k = Math.max(1, fit);
  }
  return k;
}

// ../packages/agent-tools/src/proseCompress.ts
var PROSE_BY_EXT = {
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  rst: "markdown",
  adoc: "markdown",
  asciidoc: "markdown",
  org: "markdown",
  txt: "text",
  text: "text",
  log: "log"
};
var PROSE_EXTENSIONS = Object.keys(PROSE_BY_EXT).map((e) => `.${e}`);
function proseKindOf(path) {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  return PROSE_BY_EXT[ext] ?? "code";
}
async function compressProse(text, kind, opts = {}) {
  if (kind === "code" || !opts.compress) return { text, compressed: false, originalTokens: 0, keptTokens: 0 };
  return compressLargeContext(text, {
    compress: opts.compress,
    ...opts.minChars !== void 0 ? { minChars: opts.minChars } : {},
    ...opts.rate !== void 0 ? { rate: opts.rate } : {}
  });
}

// ../packages/agent-tools/src/read-compressed-tool.ts
var READ_COMPRESSED_MIN_CHARS = 1500;
var RATE_MIN = 0.2;
var RATE_MAX = 0.9;
var readCompressedTool = defineTool({
  name: "read_compressed",
  description: `Read a long PROSE file \u2014 docs, design notes, READMEs, logs (${PROSE_EXTENSIONS.join(" ")}) \u2014 compressed to about half its tokens (LLMLingua-2; code fences, paths and numbers kept verbatim). Use it to UNDERSTAND a big document without paying for every token; never to edit (read_file gives the exact text). Code files are refused.`,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path of the prose file, e.g. "docs/design/billing.md".' },
      rate: { type: "number", description: `Share of tokens to keep, ${RATE_MIN}\u2013${RATE_MAX} (default 0.5).` }
    },
    required: ["path"]
  },
  requires: ["repo.read", "repo.compress"],
  async execute(args, ctx) {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) return { data: { ok: false, error: "path is required" } };
    const kind = proseKindOf(path);
    if (kind === "code") {
      return { data: { ok: false, path, error: `read_compressed only reads prose (${PROSE_EXTENSIONS.join(" ")}). Use read_file for code \u2014 an edit needs the exact text.` } };
    }
    const semantic = ctx.caps.semantic;
    if (!semantic?.compress) return { data: { ok: false, path, error: "Compression is not available on this surface right now \u2014 use read_file." } };
    const read = await ctx.caps.repoRead.readFile(path);
    if (!read.ok || typeof read.content !== "string") return { data: read };
    const rate = typeof args.rate === "number" && Number.isFinite(args.rate) ? Math.min(RATE_MAX, Math.max(RATE_MIN, args.rate)) : void 0;
    const r = await compressProse(read.content, kind, {
      compress: (t, k) => semantic.compress(t, k),
      minChars: READ_COMPRESSED_MIN_CHARS,
      ...rate !== void 0 ? { rate } : {}
    });
    const data = { ok: true, path, content: r.text, compressed: r.compressed };
    if (r.compressed) {
      data.originalTokens = r.originalTokens;
      data.keptTokens = r.keptTokens;
      data.note = "Compressed for reading \u2014 do not quote it as the file's exact text; read_file before editing.";
    } else {
      data.note = read.content.length < READ_COMPRESSED_MIN_CHARS ? "Short enough to read as-is \u2014 returned uncompressed." : "Compression did not shorten this text \u2014 returned as-is.";
    }
    if (read.truncated) data.truncated = true;
    if (r.compressed) ctx.emit?.({ level: "debug", message: "read_compressed: compressed (C8)", detail: { originalTokens: r.originalTokens, keptTokens: r.keptTokens } });
    return { data };
  }
});

// ../packages/agent-tools/src/semantic-tools.ts
var SEARCH_DEFAULT_LIMIT = 8;
var SEARCH_MAX_LIMIT = 25;
var MAP_DEFAULT_TOKENS = 1500;
var MAP_MAX_TOKENS = 8e3;
var semanticSearchTool = defineTool({
  name: "semantic_search",
  description: `Find code by MEANING or by name in one call \u2014 returns whole functions/classes (path, line range, symbol, snippet) ranked by identifier-aware keyword match (resolveMembership matches "membership") plus local embeddings. Use it FIRST for questions phrased in words \u2014 "where is X handled", "how does Y work", "what validates Z" \u2014 where search_code needs an exact substring you do not know yet. Then read_file only the hit you will edit, at its line range. For exact strings, usages and config values use search_code; for a known symbol's definition use find_symbol.`,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: 'What you are looking for, in words or identifiers, e.g. "stripe webhook to ledger".' },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict to, e.g. "api/src".' },
      limit: { type: "number", description: `Max results (default ${SEARCH_DEFAULT_LIMIT}, max ${SEARCH_MAX_LIMIT}).` }
    },
    required: ["query"]
  },
  requires: ["repo.semantic"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { data: { ok: false, error: "query is required" } };
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : void 0;
    const explicit = typeof args.limit === "number" && Number.isFinite(args.limit);
    const requested = explicit ? Math.floor(args.limit) : SEARCH_DEFAULT_LIMIT;
    const limit = Math.min(SEARCH_MAX_LIMIT, Math.max(1, requested));
    const semantic = ctx.caps.semantic;
    const r = await semantic.search(query, { scope, limit });
    if (!r.ok) return { data: r };
    let hits = r.results ?? [];
    if (semantic.adaptive && !explicit && hits.length > 0) {
      hits = hits.slice(0, chooseK({ requested: limit, scores: hits.map((h) => typeof h.score === "number" ? h.score : Number.NaN) }));
    }
    const results = hits.map((h) => ({
      at: `${h.path}:${h.startLine}-${h.endLine}`,
      symbol: h.symbol ?? void 0,
      kind: h.kind,
      via: h.source,
      snippet: h.snippet
    }));
    const data = { ok: true, query, total: results.length, results };
    if (r.indexing) {
      data.note = "The index is still being built \u2014 these results cover only the files scanned so far. A miss is not proof of absence yet; fall back to search_code if needed.";
    } else if (results.length === 0) {
      data.note = `Nothing matched "${query}"${scope ? ` under "${scope}"` : ""}. Rephrase with likely identifier words, drop \`path\`, or use search_code for an exact string.`;
    }
    return { data };
  }
});
var repoMapTool = defineTool({
  name: "repo_map",
  description: "The repository's SHAPE in one call: files ordered by how much the rest of the code depends on them, each with its most-referenced definitions as `line: signature`. Call it once at the start of unfamiliar work instead of exploring with list_files and reads; pass `focus` (paths you are working in) to rank that area first.",
  parameters: {
    type: "object",
    properties: {
      focus: { type: "array", items: { type: "string" }, description: 'Optional repo-relative paths to rank first, e.g. ["api/src/billing"].' },
      maxTokens: { type: "number", description: `Budget for the map (default ${MAP_DEFAULT_TOKENS}, max ${MAP_MAX_TOKENS}).` },
      query: { type: "string", description: 'Optional words describing the task, e.g. "stripe webhook retries" \u2014 ranks the files that match it first.' }
    }
  },
  requires: ["repo.semantic"],
  async execute(args, ctx) {
    const focus = Array.isArray(args.focus) ? args.focus.filter((f) => typeof f === "string" && f.trim() !== "") : [];
    const requested = typeof args.maxTokens === "number" && Number.isFinite(args.maxTokens) ? Math.floor(args.maxTokens) : MAP_DEFAULT_TOKENS;
    const maxTokens = Math.min(MAP_MAX_TOKENS, Math.max(200, requested));
    const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : void 0;
    const r = await ctx.caps.semantic.repoMap({ maxTokens, focus, ...query ? { query } : {} });
    if (!r.ok) return { data: r };
    const data = { ok: true, map: r.map ?? "" };
    if (r.indexing) data.note = "The index is still being built \u2014 the map covers only the files scanned so far.";
    return { data };
  }
});
var SEMANTIC_TOOLS = [semanticSearchTool, repoMapTool, readCompressedTool];

// ../packages/agent-tools/src/researchCache.ts
function researchCacheKey(question, files) {
  const q = question.replace(/\s+/g, " ").trim();
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return JSON.stringify([q, ...sorted.map((f) => `${f.path}@${Math.round(f.mtimeMs)}:${f.size}`)]);
}

// ../packages/agent-tools/src/local-research-tool.ts
var MAX_PATHS = 8;
var DEFAULT_TIME_LIMIT_MS = 45e3;
var EXCERPT_BUDGET_CHARS = 24e3;
var HIT_WINDOW_LINES = 30;
var SYSTEM = [
  "You answer a question about a codebase using ONLY the file excerpts given.",
  "Cite every claim as path:line. Be brief and concrete: names, locations, what calls what.",
  "If the excerpts do not contain the answer, say exactly what is missing \u2014 never guess."
].join(" ");
function excerptAround(content, lines, budget, radius = HIT_WINDOW_LINES) {
  const all = content.split(/\r?\n/);
  const ranges = [];
  const anchors = lines.length > 0 ? [...lines].sort((a, b) => a - b) : [1];
  for (const line of anchors) {
    const start = Math.max(1, lines.length > 0 ? line - radius : 1);
    const end = Math.min(all.length, lines.length > 0 ? line + radius : radius * 4);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  const out = [];
  let used = 0;
  for (const [start, end] of ranges) {
    if (out.length > 0) out.push("\u2026");
    for (let n = start; n <= end; n++) {
      const row = `${n}: ${all[n - 1] ?? ""}`;
      if (used + row.length + 1 > budget) return `${out.join("\n")}
\u2026`;
      out.push(row);
      used += row.length + 1;
    }
  }
  return out.join("\n");
}
function hitLinesFor(path, hits) {
  if (!hits) return [];
  return [...hits.definitions, ...hits.references].filter((h) => h.path === path).map((h) => h.line);
}
async function readExcerpts(ctx, files, hits) {
  const out = [];
  const per = Math.floor(EXCERPT_BUDGET_CHARS / Math.max(1, files.length));
  for (const path of files) {
    const r = await ctx.caps.repoRead.readFile(path).catch(() => null);
    if (!r?.ok || typeof r.content !== "string") continue;
    out.push({ path, text: excerptAround(r.content, hitLinesFor(path, hits), per) });
  }
  return out;
}
function researchMessages(question, excerpts) {
  const body = excerpts.map((e) => `### ${e.path}
${e.text}`).join("\n\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Question: ${question}

Excerpts (each line is "line: text"):

${body}` }
  ];
}
function deadlineSignal(limitMs, outer) {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort(new Error("local_research time limit"));
  }, limitMs);
  const onOuter = () => ctl.abort(outer?.reason);
  if (outer?.aborted) ctl.abort(outer.reason);
  else outer?.addEventListener("abort", onOuter, { once: true });
  return {
    signal: ctl.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    }
  };
}
var localResearchTool = defineTool({
  name: "local_research",
  description: 'Ask a question about this codebase and have a LOCAL model on this machine read the relevant files and answer it \u2014 free, no paid tokens. Name the files in `paths`; without them, files are chosen by a symbol-index + text search for the identifiers in the question. Use it for "how does X work", "what calls Y", "summarize these files" before reading large files yourself. Answers cite path:line and are cached until a file changes. If the local model runs out of time you get the search hits instead.',
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: 'What you want to know, naming identifiers where you can, e.g. "how does resolveMembership pick the tenant?".' },
      paths: { type: "array", items: { type: "string" }, description: `Optional repo-relative files to read (max ${MAX_PATHS}).` }
    },
    required: ["question"]
  },
  requires: ["repo.read", "local.research"],
  async execute(args, ctx) {
    const question = typeof args.question === "string" ? args.question.trim() : "";
    if (!question) return { data: { ok: false, error: "question is required" } };
    const research = ctx.caps.research;
    if (!research) return { data: { ok: false, error: "No local model is available on this machine right now." } };
    const named = Array.isArray(args.paths) ? [...new Set(args.paths.filter((p) => typeof p === "string" && p.trim() !== "").map((p) => p.trim()))].slice(0, MAX_PATHS) : [];
    const hits = await preSearch(question, {
      ...ctx.caps.symbols ? { findSymbol: (q) => ctx.caps.symbols.find(q, { limit: 20 }) } : {},
      ...ctx.caps.repoRead ? { searchText: (q, signal) => ctx.caps.repoRead.searchCode(q, void 0, signal ? { signal } : void 0) } : {}
    }, ctx.signal ? { signal: ctx.signal } : {}).catch(() => null);
    const chosen = named.length > 0 ? named : hits ? preSearchFiles(hits) : [];
    if (chosen.length === 0) {
      return { data: { ok: false, question, error: "No files matched the question \u2014 pass `paths`, or name an identifier from the code." } };
    }
    const fingerprints = await research.fingerprint(chosen);
    const files = fingerprints.map((f) => f.path);
    if (files.length === 0) return { data: { ok: false, question, error: `None of these files could be read: ${chosen.join(", ")}` } };
    const key = researchCacheKey(question, fingerprints);
    const cached = await research.cache?.get(key).catch(() => void 0);
    if (cached) return { data: { ok: true, question, files, answer: cached, cached: true } };
    const excerpts = await readExcerpts(ctx, files, hits);
    const deadline = deadlineSignal(research.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS, ctx.signal);
    const partial = (reason) => ({
      data: { ok: true, partial: true, question, files, reason, ...hits?.block ? { hits: hits.block } : {}, note: "The local model did not finish \u2014 these are the deterministic search hits. Read the files they name directly." }
    });
    try {
      const stopped = new Promise((_, reject) => {
        if (deadline.signal.aborted) reject(deadline.signal.reason ?? new Error("aborted"));
        deadline.signal.addEventListener("abort", () => reject(deadline.signal.reason ?? new Error("aborted")), { once: true });
      });
      stopped.catch(() => void 0);
      const answer = (await Promise.race([research.complete(researchMessages(question, excerpts), deadline.signal), stopped])).trim();
      if (!answer) return partial("the local model returned an empty answer");
      await research.cache?.set(key, answer).catch(() => void 0);
      return { data: { ok: true, question, files, answer } };
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      return partial(deadline.timedOut() ? "the local model ran out of time" : `the local model failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      deadline.dispose();
    }
  }
});

// ../packages/agent-tools/src/codeAnalysis.ts
import {
  normalizeAnalysis,
  compareAnalysis,
  analysisMeta
} from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/dependencyCruiserRules.ts
import {
  globToRegExp as globToRegExp2,
  verdictOf,
  TOP_LEVEL_FOLDER
} from "@seanhogg/builderforce-memory/knowledge";
var LAYER_RULE_PREFIX = "kg-layer";
function alternation(globs) {
  if (globs.length === 0) return void 0;
  return globs.map((g) => `(?:${globToRegExp2(g).source})`).join("|");
}
function matchOf(rule, earlier) {
  const not = alternation(earlier.flatMap((r) => r.match));
  return { path: alternation(rule.match), ...not ? { pathNot: not } : {} };
}
function toDependencyCruiserRules(reg) {
  if (!reg.allow) return [];
  const ordered = reg.partitions;
  const named = ordered.filter((r) => r.id !== TOP_LEVEL_FOLDER && r.match.length > 0);
  const matchById = new Map(named.map((r) => [r.id, matchOf(r, ordered.slice(0, ordered.indexOf(r)))]));
  const rules = [];
  for (const from of named) {
    for (const to of named) {
      const verdict = verdictOf(from.id, to.id, reg);
      if (verdict !== "upward" && verdict !== "skips") continue;
      rules.push({
        name: `${LAYER_RULE_PREFIX}-${from.id}-to-${to.id}`,
        comment: `${from.id} may not use ${to.id} (${verdict})`,
        severity: verdict === "upward" ? "error" : "warn",
        from: matchById.get(from.id),
        to: matchById.get(to.id)
      });
    }
  }
  return rules;
}

// ../packages/agent-tools/src/analyzerPins.ts
var TYPESCRIPT_PIN = "typescript@5.6.3";
var ANALYZER_VERSIONS = {
  "dependency-cruiser": "16.10.4",
  jscpd: "4.0.5",
  knip: "5.30.0"
};

// ../packages/agent-tools/src/knowledge/workspaceFingerprint.ts
import { hashText } from "@seanhogg/builderforce-memory/ingest";

// ../packages/agent-tools/src/knowledge/fsDirectorySource.ts
import { CONTENT_HASH_RULE, contentHash, mediaTypeOfPath as mediaTypeOfPath2 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/statManifest.ts
var RACY_WINDOW_NS = BigInt(2e9);

// ../packages/agent-tools/src/knowledge/documents/withDocumentText.ts
import { isDocumentPath, mediaTypeOfPath } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/documents/documentText.ts
import { DEFAULT_MAX_FILE_BYTES } from "@seanhogg/builderforce-memory/knowledge";
var PDF_MEDIA_TYPE = "application/pdf";
var DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
var XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
var PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
var ODT_MEDIA_TYPE = "application/vnd.oasis.opendocument.text";
var ODS_MEDIA_TYPE = "application/vnd.oasis.opendocument.spreadsheet";
var ODP_MEDIA_TYPE = "application/vnd.oasis.opendocument.presentation";
var EXTRACTABLE_DOCUMENT_MEDIA_TYPES = [
  PDF_MEDIA_TYPE,
  DOCX_MEDIA_TYPE,
  XLSX_MEDIA_TYPE,
  PPTX_MEDIA_TYPE,
  ODT_MEDIA_TYPE,
  ODS_MEDIA_TYPE,
  ODP_MEDIA_TYPE
];
var isExtractableDocumentType = (mediaType) => EXTRACTABLE_DOCUMENT_MEDIA_TYPES.includes(mediaType.trim().toLowerCase());
var MAX_ENTRY_BYTES = 8 * 1024 * 1024;
var MAX_TOTAL_BYTES = 16 * 1024 * 1024;

// ../packages/agent-tools/src/knowledge/fsDirectorySource.ts
var BUILDERFORCE_INPUTS = /* @__PURE__ */ new Set([".builderforce/ignore", ".builderforce/partitions.json"]);
function isBuilderforceState(rel2) {
  const path = rel2.replace(/\\/g, "/");
  return path.split("/").includes(".builderforce") && !BUILDERFORCE_INPUTS.has(path);
}

// ../packages/agent-tools/src/knowledge/shaCache.ts
function createShaCache(opts = {}) {
  const max = opts.max ?? 8;
  const now = opts.now ?? Date.now;
  const entries = /* @__PURE__ */ new Map();
  const join2 = (key, entry, signal) => {
    entry.waiting += 1;
    if (!signal) return;
    const stop = () => {
      entry.stopped += 1;
      if (entry.settled || entry.stopped < entry.waiting) return;
      entry.controller.abort();
      if (entries.get(key) === entry) entries.delete(key);
    };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  };
  return {
    getOrRun(key, work, signal, runOpts) {
      if (key === null) return work(signal);
      const hit = entries.get(key);
      if (hit && !runOpts?.fresh && (hit.expires === void 0 || hit.expires > now())) {
        join2(key, hit, signal);
        return hit.run;
      }
      if (hit) entries.delete(key);
      const controller = new AbortController();
      const entry = { run: void 0, waiting: 0, stopped: 0, controller, settled: false };
      entries.set(key, entry);
      while (entries.size > max) entries.delete(entries.keys().next().value);
      join2(key, entry, signal);
      entry.run = work(controller.signal);
      const drop = () => {
        if (entries.get(key) === entry) entries.delete(key);
      };
      entry.run.then((value) => {
        entry.settled = true;
        const verdict = opts.keep ? opts.keep(value) : true;
        if (verdict === false) return drop();
        const lifetime = typeof verdict === "number" ? verdict : opts.ttlMs;
        if (lifetime !== void 0) entry.expires = now() + lifetime;
      }, () => {
        entry.settled = true;
        drop();
      });
      return entry.run;
    },
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    }
  };
}

// ../packages/agent-tools/src/knowledge/workspaceFingerprint.ts
var GIT = "git --no-optional-locks";
var FINGERPRINT_TTL_MS = 2e3;
var REVIEW_INPUT_FILES = [".builderforce/ignore", ".builderforce/partitions.json"];
async function gitText(ctx, command) {
  try {
    const r = await shellRunWithStop(ctx, command);
    return r.exitCode === 0 ? (r.stdout ?? "").trimEnd() : null;
  } catch {
    return null;
  }
}
var pathOfStatusLine = (line) => line.slice(3).replace(/^"|"$/g, "");
var OBJECT_ID = /^[0-9a-f]{40,64}$/;
var WORKING_TREE_SCRIPT = [
  "set -e",
  `cd "$(${GIT} rev-parse --show-toplevel)"`,
  'idx="$(mktemp -u)"',
  `trap 'rm -f "$idx"' EXIT`,
  `cp "$(${GIT} rev-parse --git-path index)" "$idx" 2>/dev/null || true`,
  'export GIT_INDEX_FILE="$idx"',
  `${GIT} add -A -- . ':(exclude,glob)**/.builderforce/**'`,
  ...REVIEW_INPUT_FILES.map((f) => `if [ -f "${f}" ]; then ${GIT} add -f -- "${f}"; fi`),
  `${GIT} write-tree`
].join("\n");
async function workingTreeId(ctx) {
  const out = await gitText(ctx, WORKING_TREE_SCRIPT);
  const id = out?.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
  return id && OBJECT_ID.test(id) ? id : null;
}
async function readFingerprint(ctx) {
  const head = await gitText(ctx, `${GIT} rev-parse --show-toplevel --show-prefix HEAD`);
  const lines = head?.split(/\r?\n/) ?? [];
  const commit = lines.at(-1)?.trim();
  if (!commit || !OBJECT_ID.test(commit)) return { commit: null, branch: null, dirty: null };
  const prefix = lines.length >= 3 ? (lines[1] ?? "").trim().replace(/\/+$/, "") : "";
  const branch = (await gitText(ctx, `${GIT} branch --show-current`))?.trim() ?? null;
  const status = await gitText(ctx, `${GIT} status --porcelain --untracked-files=all`);
  if (status === null) return { commit, branch, dirty: null, prefix };
  const changes = status.split("\n").filter((line) => line.trim() && !isBuilderforceState(pathOfStatusLine(line)));
  if (changes.length === 0) return { commit, branch, dirty: false, prefix };
  const tree = await workingTreeId(ctx);
  return { commit, branch, dirty: true, prefix, ...tree ? { dirtyHash: hashText(tree).slice(0, 16) } : {} };
}
var memos = /* @__PURE__ */ new WeakMap();
async function workspaceFingerprint(ctx) {
  const shell = ctx.caps.shell;
  if (!shell) return { commit: null, branch: null, dirty: null };
  let memo = memos.get(shell);
  if (!memo) memos.set(shell, memo = createShaCache({ ttlMs: FINGERPRINT_TTL_MS, max: 1 }));
  return memo.getOrRun("fingerprint", (shared) => readFingerprint({ caps: ctx.caps, ...shared ? { signal: shared } : {} }), ctx.signal);
}

// ../packages/agent-tools/src/delta/adapters/analyzer.ts
var ANALYZER_TIMEOUT_MS = 5 * 6e4;
var ignoredGlobs = (ignored) => (ignored ?? []).map((d) => `${d.replace(/\/+$/, "")}/**`);
function ignoredRegex(ignored) {
  const dirs = (ignored ?? []).map((d) => d.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return dirs.length > 0 ? `^(?:${dirs.join("|")})(?:/|$)` : void 0;
}

// ../packages/agent-tools/src/codeAnalysisTool.ts
function spec(name, version, extraPackages, bin, args) {
  const packages = [`${name}@${version}`, ...extraPackages];
  return { name, version, packages, bin, args, command: analyzerCommand({ packages, bin, args }, ".") };
}
var ANALYZERS = [
  spec("dependency-cruiser", ANALYZER_VERSIONS["dependency-cruiser"], [TYPESCRIPT_PIN], "depcruise", "--config=.builderforce/code-analysis/dependencies.json --output-type=json {scope}"),
  spec("jscpd", ANALYZER_VERSIONS.jscpd, [], "jscpd", "--silent --reporters=json --min-lines=5 --min-tokens=50 --ignore=**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.builderforce/** --output=.builderforce/code-analysis {scope}"),
  spec("knip", ANALYZER_VERSIONS.knip, [TYPESCRIPT_PIN], "knip", "--reporter=json --no-progress")
];
var bundled;
function bundledAnalyzers() {
  return bundled;
}
function analyzerCommand(a, scope, entry) {
  const args = a.args.replace("{scope}", () => scope);
  return entry ? `node "${entry}" ${args}` : `npm exec --yes ${a.packages.map((p) => `--package=${p}`).join(" ")} --call="${a.bin} ${args}"`;
}
function parseAnalyzerJson(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("No JSON report in analyzer output");
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("Truncated analyzer JSON report");
}
function dependencyCruiserConfig(partitions) {
  const forbidden = partitions ? toDependencyCruiserRules(partitions) : [];
  return {
    ...forbidden.length ? { forbidden } : {},
    options: { exclude: { path: "(^|/)(node_modules|[.]git|[.]builderforce|dist|out|build)(/|$)" } }
  };
}
function base64Utf8(text) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function dependencyCruiserConfigWith(partitions, ignored) {
  const config = dependencyCruiserConfig(partitions);
  const extra = ignoredRegex(ignored);
  if (!extra) return config;
  const options = config.options ?? {};
  const base = options.exclude?.path;
  return { ...config, options: { ...options, exclude: { ...options.exclude ?? {}, path: base ? `${base}|${extra}` : extra } } };
}
var jscpdArgsWith = (args, ignored) => {
  const extra = ignoredGlobs(ignored);
  return extra.length > 0 ? args.replace(/--ignore=(\S+)/, (_m, list2) => `--ignore=${list2},${extra.join(",")}`) : args;
};
function createAnalyzeCodebaseTool(options = {}) {
  const l3 = options.l3;
  const configOf = (ignored) => base64Utf8(JSON.stringify(dependencyCruiserConfigWith(options.partitions, ignored)));
  return defineTool({
    name: "analyze_codebase",
    description: "Measure JS/TS dependency edges and cycles with dependency-cruiser, duplicate code with jscpd, and unused-file/export/dependency candidates with Knip. Runs the analyzers bundled with the host when it ships them, else downloads the pinned packages through npm cache on first use; an analyzer that cannot start is reported not_measured, never as zero findings. Writes per-scan artifacts under .builderforce/code-analysis. The audit host saves the full snapshot for the visualizer; cloud images return a bounded summary after upload. Report findings normally after this tool. Preserve failed-tool coverage; do not claim missing results are clean.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Relative project/package directory; use a smaller package for large monorepos. Defaults to repository root." } } },
    requires: ["shell", "repo.read"],
    async execute(args, ctx) {
      const scope = typeof args.path === "string" ? args.path : ".";
      if (!/^[a-zA-Z0-9_.][a-zA-Z0-9_./-]*$/.test(scope) || scope.split("/").includes("..")) return { data: { error: "path must be a relative project directory without traversal or shell syntax" } };
      const tools = [];
      const id = crypto.randomUUID();
      const outputDir = `.builderforce/code-analysis/${id}`;
      const outputs = [];
      const ignored = l3 ? await l3.ignored().catch(() => []) : void 0;
      const entries = bundledAnalyzers();
      let settledTold = 0;
      const tellSettled = () => {
        while (settledTold < tools.length) {
          settledTold++;
          options.onToolSettled?.();
        }
      };
      for (const analyzer of ANALYZERS) {
        tellSettled();
        const l3Key = l3 ? await l3.keyOf(analyzer.name).catch(() => void 0) : void 0;
        const l3Hit = l3 && l3Key ? await l3.cache.get(l3Key, analyzer.name).catch(() => void 0) : void 0;
        if (l3Hit?.raw !== void 0) {
          outputs.push(l3Hit.raw);
          tools.push({ name: analyzer.name, version: analyzer.version, status: "complete" });
          continue;
        }
        const entry = entries?.[analyzer.name];
        if (entries && !entry) {
          outputs.push(null);
          tools.push({ name: analyzer.name, version: analyzer.version, status: "not_measured", reason: "analyzer-unavailable" });
          continue;
        }
        let launched = false;
        try {
          const setupFailed = (message) => {
            if (entry) return "unavailable";
            throw new Error(message);
          };
          let unavailable2;
          if (analyzer.name === "dependency-cruiser") {
            const config = await shellRunWithStop(ctx, `node -e "const f=require('fs');f.mkdirSync('${outputDir}',{recursive:true});f.writeFileSync('${outputDir}/dependencies.json',Buffer.from('${configOf(ignored)}','base64'))"`);
            if (!config.ok) unavailable2 = setupFailed("Could not create dependency analysis configuration");
          }
          if (analyzer.name === "jscpd") {
            const cleanup = await shellRunWithStop(ctx, `node -e "require('fs').mkdirSync('${outputDir}',{recursive:true})"`);
            if (!cleanup.ok) unavailable2 = setupFailed("Could not clear the previous duplication artifact");
          }
          if (unavailable2) {
            outputs.push(null);
            tools.push({ name: analyzer.name, version: analyzer.version, status: "not_measured", reason: "analyzer-unavailable" });
            continue;
          }
          const pinned = analyzerCommand(analyzer, scope, entry);
          const command = analyzer.name === "jscpd" ? jscpdArgsWith(pinned, ignored) : pinned;
          const result = await shellRunWithStop(ctx, command.replaceAll(".builderforce/code-analysis", outputDir), analyzer.name === "knip" && scope !== "." ? scope : void 0);
          launched = true;
          const artifact = analyzer.name === "jscpd" ? await ctx.caps.repoRead.readFile(`${outputDir}/jscpd-report.json`) : void 0;
          const text = artifact ? artifact.content : result.stdout;
          if (entry && !text) {
            outputs.push(null);
            tools.push({ name: analyzer.name, version: analyzer.version, status: "not_measured", reason: "analyzer-unavailable" });
            continue;
          }
          if (!text || artifact?.truncated) throw new Error("Analyzer output is empty or truncated; scan a smaller project");
          const value = parseAnalyzerJson(text);
          if (analyzer.name === "dependency-cruiser" && !Array.isArray(value.modules)) throw new Error("Invalid dependency report");
          if (analyzer.name === "jscpd" && !Array.isArray(value.duplicates)) throw new Error("Invalid duplication report");
          if (analyzer.name === "knip" && (!Array.isArray(value.files) || !Array.isArray(value.issues))) throw new Error("Invalid unused-code report");
          const unresolved = analyzer.name === "dependency-cruiser" ? value.modules.flatMap((m) => m.dependencies ?? []).filter((d) => d.couldNotResolve).length : 0;
          outputs.push(value);
          tools.push({ name: analyzer.name, version: analyzer.version, status: unresolved ? "failed" : "complete", ...unresolved ? { error: `${unresolved} imports could not be resolved; graph coverage is incomplete.` } : {} });
          if (l3 && l3Key && !unresolved) await l3.cache.put(l3Key, { result: l3.toResult(analyzer.name, analyzer.version, value), raw: value }).catch(() => void 0);
        } catch (error) {
          if (entry && !launched) {
            outputs.push(null);
            tools.push({ name: analyzer.name, version: analyzer.version, status: "not_measured", reason: "analyzer-unavailable" });
            continue;
          }
          outputs.push(null);
          tools.push({ name: analyzer.name, version: analyzer.version, status: "failed", error: String(error).slice(0, 1e3) });
        }
      }
      tellSettled();
      const { commit, branch, dirty, dirtyHash } = await workspaceFingerprint(ctx);
      const remote = (await gitText(ctx, `${GIT} remote get-url origin`))?.trim().replace(/^git@github.com:/, "https://github.com/").replace(/\.git$/, "");
      const repository = remote && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(remote) ? remote : void 0;
      const snapshot = {
        version: 1,
        id,
        capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
        source: { commit, branch, scope, dirty, ...dirtyHash ? { dirtyHash } : {}, ...repository ? { repository } : {} },
        tools,
        ...normalizeAnalysis(outputs[0], outputs[1], outputs[2], scope)
      };
      return { data: { snapshot } };
    }
  });
}
var analyzeCodebaseTool = createAnalyzeCodebaseTool();

// ../packages/agent-tools/src/writeOverwriteGuard.ts
var WRITE_OVERWRITE_LARGE_BYTES = 2048;
var WRITE_OVERWRITE_SHRINK_RATIO = 0.5;
function utf8ByteLength(text) {
  return new TextEncoder().encode(text).length;
}
var NOT_FOUND = /not found|no such file|enoent|does not exist|404\b/i;
function isNotFoundReadError(error) {
  return !!error && NOT_FOUND.test(error);
}
function probeFromRepoRead(read) {
  if (!read.ok) {
    if (isNotFoundReadError(read.error)) return { status: "missing" };
    return { status: "unreadable", reason: read.error?.trim() || "read failed" };
  }
  const content = read.content ?? "";
  if (read.truncated) {
    const contentLines = content === "" ? 0 : content.split(/\r?\n/).length;
    const totalLines = typeof read.totalLines === "number" && Number.isFinite(read.totalLines) ? read.totalLines : null;
    if (totalLines != null && contentLines > 0) {
      const windowBytes = utf8ByteLength(content);
      return { status: "ok", bytes: Math.round(windowBytes * (totalLines / contentLines)), truncated: true };
    }
    return {
      status: "unreadable",
      reason: "read was truncated; refusing to overwrite without the full file"
    };
  }
  if (content === "") {
    if (read.totalLines === 0) return { status: "ok", bytes: 0 };
    return {
      status: "unreadable",
      reason: "read returned empty contents; refusing to treat that as an empty file"
    };
  }
  return { status: "ok", bytes: utf8ByteLength(content) };
}
function refuseWriteOverwrite(probe, incoming) {
  if (probe.status === "missing") return null;
  if (probe.status === "unreadable") {
    return `cannot overwrite: ${probe.reason}. A failed or empty read is not an empty file \u2014 use edit_file after a successful read, or create a new path.`;
  }
  const incomingBytes = utf8ByteLength(incoming);
  if (probe.bytes >= WRITE_OVERWRITE_LARGE_BYTES && incomingBytes < probe.bytes * WRITE_OVERWRITE_SHRINK_RATIO) {
    return `refusing to replace a large existing file (${probe.bytes} bytes) with a much smaller body (${incomingBytes} bytes). Use edit_file for surgical changes.`;
  }
  return null;
}

// ../packages/agent-tools/src/core-tools.ts
function refuseWriteScope(path, ctx) {
  const gate = ctx.writeScope;
  if (!gate) return null;
  const decision = writeAllowed(gate.scope, gate.paths, path, gate.roleName);
  return decision.allowed ? null : decision.reason ?? "write refused";
}
var listFilesTool = defineTool({
  name: "list_files",
  description: "List repo files (recursively) on the ticket branch so you can discover the existing codebase before editing. Optionally pass `path` to scope to a subdirectory. To FIND A FILE BY NAME, pass `glob` \u2014 e.g. `ROADMAP.md` (matches that filename at any depth, case-insensitive) or `src/**/*.test.ts`. Use `glob` instead of concluding a file is missing: a large repo's unfiltered listing is summarized to directories, but a `glob` always returns the matching files in full.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Optional repo-relative subdirectory to scope to, e.g. "src/components".' },
      glob: { type: "string", description: 'Optional filename/glob filter, e.g. "ROADMAP.md", "*.md", or "src/**/*.ts". Case-insensitive; a name with no "/" matches the basename at any depth.' }
    }
  },
  requires: ["repo.read"],
  async execute(args, ctx) {
    const sub = typeof args.path === "string" ? args.path : void 0;
    const glob = typeof args.glob === "string" && args.glob.trim() ? args.glob.trim() : void 0;
    const r = await ctx.caps.repoRead.listFiles(sub, glob);
    if (glob && r.ok && (r.paths?.length ?? 0) === 0) {
      return {
        data: {
          ...r,
          note: emptyGlobListingNote(glob, sub, r.truncated === true)
        }
      };
    }
    return { data: r };
  }
});
var searchCodeTool = defineTool({
  name: "search_code",
  description: 'Search the repo for a string/symbol in one call \u2014 use this FIRST to find where something is referenced instead of reading files one by one. Returns matching file paths with line fragments. Pass `query` as an EXACT substring/regex (a symbol, import path, or config key), NOT a natural-language phrase \u2014 a multi-word phrase rarely appears verbatim on one line and will match nothing. On a large monorepo, scope the search with `path` (a subdirectory) to search just that subtree. 0 results with `truncated:false` means the term does not appear (so "remove all references to X" then means there is nothing to remove \u2014 say so, do not invent a change); 0 results with `truncated:true` means the search was cut short before scanning everything \u2014 narrow it with `path` or a more specific `query` and try again, do NOT conclude the term is absent. Then read_file the matches you intend to edit.',
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Exact text or symbol to find, e.g. a model id, function name, import path, or config key. NOT a natural-language phrase." },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict the search to, e.g. "packages/brain-ui". Use this to avoid truncation on a big repo.' }
    },
    required: ["query"]
  },
  requires: ["repo.search"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : void 0;
    const r = await ctx.caps.repoRead.searchCode(query, scope);
    if (r.ok && r.total === 0) {
      const note = r.truncated ? `Search was truncated before scanning the whole${scope ? " subtree" : " repo"} \u2014 this is NOT proof the term is absent. Re-run scoped to a subdirectory via \`path\`${scope ? " (a narrower one)" : ""}, or use a more specific \`query\`.` : `No matches${scope ? ` under "${scope}"` : ""} \u2014 the term is not referenced${scope ? " there (try without `path` to search the whole repo)" : ""}. If the task was to remove/replace it, there is nothing to change; say so instead of inventing an edit.`;
      return { data: { ...r, note } };
    }
    return { data: r };
  }
});
var readFileTool = defineTool({
  name: "read_file",
  description: "Read a repo file on the ticket branch. Returns up to " + READ_DEFAULT_LINE_LIMIT + " lines at a time: a large file comes back as a paginated line window (never a hard failure), and the result's `truncated`/`totalLines` tell you when more remains \u2014 read the next chunk by calling again with `offset`. To read several files at once pass `paths` (up to " + READ_FILE_MAX_PATHS + ') instead of `path`: you get `files`, one result per path. A first read of a large Markdown document also returns its `outline` (headings with line numbers) \u2014 page by heading line with `offset`. For a large JSON file (an i18n catalog, a config) pass `key` with a dot path such as "admin.visitorFlow" to get just that subtree instead of paging line windows. Always read a file before editing it so you preserve existing code and only change what is needed.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      paths: {
        type: "array",
        items: { type: "string" },
        maxItems: READ_FILE_MAX_PATHS,
        description: `Instead of \`path\`: up to ${READ_FILE_MAX_PATHS} repo-relative paths read in one call. offset/limit/key apply to each.`
      },
      offset: { type: "number", description: "1-based line to start reading from (for paging through a large file). Default 1." },
      limit: { type: "number", description: `Max lines to return. Default ${READ_DEFAULT_LINE_LIMIT}. Read the next window with offset = previous offset + returned lines.` },
      key: { type: "string", description: 'JSON files only: a dot path (e.g. "admin.visitorFlow") \u2014 returns that subtree, or its child keys when it is too large. Ignores offset/limit.' }
    }
  },
  requires: ["repo.read"],
  async execute(args, ctx) {
    const path = typeof args.path === "string" ? args.path : "";
    const paths = !path && Array.isArray(args.paths) ? args.paths.filter((p) => typeof p === "string" && p.trim() !== "") : [];
    if (!path && paths.length === 0) return { data: { ok: false, error: "path is required (or paths: a list of up to " + READ_FILE_MAX_PATHS + ")" } };
    if (paths.length > READ_FILE_MAX_PATHS) return { data: { ok: false, error: `paths takes at most ${READ_FILE_MAX_PATHS} files per call \u2014 split the rest into another read_file` } };
    const opts = {
      offset: typeof args.offset === "number" && args.offset > 0 ? Math.floor(args.offset) : void 0,
      limit: typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : void 0,
      key: typeof args.key === "string" ? args.key.trim() : ""
    };
    if (!path) return { data: { ok: true, files: await readManyFiles(paths, opts, ctx.caps, ctx.outlineFirstReads) } };
    return { data: await readOneFile(path, opts, ctx.caps, ctx.outlineFirstReads) };
  }
});
var writeFileTool = defineTool({
  name: "write_file",
  description: 'Create a new file, or replace a whole file you have already read, with its complete contents. Prefer edit_file for surgical changes to an existing file \u2014 write_file refuses to replace a large existing file with a much smaller body, and a failed or empty read of a path you are about to overwrite is a hard stop (not an empty file). New-file create (read 404 / not found) is still allowed. How the write lands depends on the surface: in an editor/on-prem workspace it edits the file in place; in a cloud/review run it is staged on the ticket branch as a reviewable pending change. Do NOT narrate a specific mechanism (e.g. "opened a PR") \u2014 just state what the file now contains. Use once per deliverable file. Provide the FULL file content.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      content: { type: "string", description: "Complete file content (no placeholders)." },
      summary: { type: "string", description: "One-line description of the change." }
    },
    required: ["path", "content"]
  },
  requires: ["repo.write"],
  async execute(args, ctx) {
    const path = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : "";
    const summary = typeof args.summary === "string" ? args.summary : void 0;
    if (!path || !content) return { data: { ok: false, error: "path and content are both required" } };
    const scopeRefusal = refuseWriteScope(path, ctx);
    if (scopeRefusal) return { data: { ok: false, error: scopeRefusal } };
    if (ctx.caps.repoRead) {
      let existing;
      try {
        existing = await ctx.caps.repoRead.readFile(path);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "read failed";
        return {
          data: {
            ok: false,
            error: `cannot overwrite: ${reason}. A failed or empty read is not an empty file \u2014 use edit_file after a successful read, or create a new path.`
          }
        };
      }
      const refusal = refuseWriteOverwrite(probeFromRepoRead(existing), content);
      if (refusal) return { data: { ok: false, error: refusal } };
    }
    const r = await ctx.caps.repoWrite.writeFile(path, content, summary);
    return { data: r.ok ? { ok: true, branch: r.branch, commitUrl: r.commitUrl } : { ok: false, error: r.error } };
  }
});
var deleteFileTool = defineTool({
  name: "delete_file",
  description: 'Remove a file from the ticket branch so it does NOT ship in the pull request. Use this to clean up dead code: a stub/placeholder, an unreferenced file, or a file a PRIOR pass on this branch created that should not be part of the final change. The "Files already on this branch" list in your context shows what a prior pass left \u2014 reconcile against it. Verify the file is genuinely unused (search_code for its exports) before deleting. Deleting a file not on the branch is a no-op (reported back), not an error.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path to remove, e.g. "src/utils/email.ts".' },
      reason: { type: "string", description: 'One-line why this file should not ship (e.g. "stub superseded by existing email infra").' }
    },
    required: ["path"]
  },
  requires: ["repo.delete"],
  async execute(args, ctx) {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) return { data: { ok: false, error: "path is required" } };
    const scopeRefusal = refuseWriteScope(path, ctx);
    if (scopeRefusal) return { data: { ok: false, error: scopeRefusal } };
    const reason = typeof args.reason === "string" ? args.reason : void 0;
    const r = await ctx.caps.repoWrite.deleteFile(path, reason);
    if (r.ok && r.deleted === false) return { data: { ok: true, deleted: false, note: r.note } };
    return { data: r.ok ? { ok: true, deleted: true, branch: r.branch, commitUrl: r.commitUrl } : { ok: false, error: r.error } };
  }
});
var editFileTool = defineTool({
  name: "edit_file",
  description: "Make a surgical in-place edit to an existing file on the ticket branch: replace an exact snippet with new text, without rewriting the whole file. Read the file first so `old_string` matches EXACTLY (including indentation). `old_string` must be unique in the file unless you set `replace_all`. Prefer this over write_file for small changes to large files. A success returns `excerpt` \u2014 the edited lines with line numbers and a little context \u2014 so do NOT re-read the file to check the edit. A miss returns `nearest` \u2014 the closest matching line and its neighbours \u2014 copy `old_string` from there. To change SEVERAL files (or several spots) in one call, pass `edits`: an array of {path, old_string, new_string, replace_all?} (up to 20). A batch is ATOMIC \u2014 all edits apply or none, and on failure the result names the FIRST edit that did not match \u2014 so a multi-file refactor is one call, not a chain that can half-apply.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      old_string: { type: "string", description: "The exact text to replace (must match the file byte-for-byte)." },
      new_string: { type: "string", description: "The replacement text." },
      replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring a unique match. Default false." },
      edits: {
        type: "array",
        maxItems: 20,
        description: "BATCH (instead of path/old_string/new_string): up to 20 {path, old_string, new_string, replace_all?} edits applied atomically in one call. All apply or none; a failure names the first edit that did not match.",
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
            old_string: { type: "string", description: "The exact text to replace (must match the file byte-for-byte)." },
            new_string: { type: "string", description: "The replacement text." },
            replace_all: { type: "boolean", description: "Replace every occurrence. Default false." }
          },
          required: ["path", "old_string", "new_string"]
        }
      }
    },
    required: []
  },
  requires: ["repo.edit"],
  async execute(args, ctx) {
    if (Array.isArray(args.edits)) {
      for (const edit of args.edits) {
        if (edit && typeof edit === "object" && typeof edit.path === "string") {
          const refusal = refuseWriteScope(edit.path, ctx);
          if (refusal) return { data: { ok: false, error: refusal } };
        }
      }
      const plan = planBatchEdits(args.edits);
      if (plan.error) return { data: { ok: false, error: plan.error } };
      const read = async (p) => {
        const r2 = await ctx.caps.repoRead?.readFile(p);
        return r2 && r2.ok && typeof r2.content === "string" ? r2.content : null;
      };
      const batch = await applyBatchEdits(plan, {
        read,
        write: async (p, content) => {
          await ctx.caps.repoWrite.writeFile(p, content, "edit_file batch");
        }
      });
      if (!batch.ok) {
        const failed3 = batch.files[batch.files.length - 1];
        return { data: { ok: false, error: failed3.error ?? "batch failed", files: batch.files.map(({ content: _c, ...rest }) => rest) } };
      }
      return {
        data: {
          ok: true,
          batched: true,
          count: batch.files.length,
          files: batch.files.map(({ content: _c, ok, path: path2, error, nearest, ...facts }) => ({
            path: path2,
            ok,
            ...Object.keys(facts).length ? facts : {},
            ...error ? { error } : {},
            ...nearest ? { nearest } : {}
          }))
        }
      };
    }
    const path = typeof args.path === "string" ? args.path : "";
    const oldString = typeof args.old_string === "string" ? args.old_string : "";
    const newString = typeof args.new_string === "string" ? args.new_string : "";
    const replaceAll = args.replace_all === true;
    if (!path || !oldString) return { data: { ok: false, error: "path and old_string are required" } };
    const scopeRefusal = refuseWriteScope(path, ctx);
    if (scopeRefusal) return { data: { ok: false, error: scopeRefusal } };
    const r = await ctx.caps.repoWrite.editFile(path, oldString, newString, replaceAll);
    return {
      data: r.ok ? {
        ok: true,
        ...r.branch ? { branch: r.branch } : {},
        ...r.commitUrl ? { commitUrl: r.commitUrl } : {},
        replaced: r.replaced,
        ...r.region ? { region: r.region } : {},
        ...r.excerpt ? { excerpt: r.excerpt } : {}
      } : { ok: false, error: r.error, ...r.nearest ? { nearest: r.nearest } : {} }
    };
  }
});
var memoryRecallTool = defineTool({
  name: "memory_recall",
  description: "Recall durable facts from cross-run memory that are relevant to a query \u2014 decisions, fixes, project conventions, user preferences you (or another run) stored earlier. Call this FIRST when a task touches an area you may have worked before, instead of re-reading large files or history. Returns the most relevant stored entries (key + content); 0 results means nothing relevant is stored yet.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What you want to remember about, e.g. a subsystem, decision, or convention." },
      limit: { type: "number", description: "Max entries to return (default 5)." }
    },
    required: ["query"]
  },
  requires: ["memory"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : void 0;
    const r = await ctx.caps.memory.recall(query, limit);
    return { data: r };
  }
});
var memoryRememberTool = defineTool({
  name: "memory_remember",
  description: "Store ONE durable fact in cross-run memory so a future run can recall it instead of re-deriving it \u2014 a decision, a non-obvious fix, a project constraint, or a user preference. Keep content to one tight line. Use a stable, descriptive key (e.g. 'release-checklist', 'auth-flow'); reusing a key overwrites it. Do NOT store things the repo/git already records or facts that only matter to the current turn.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Stable, descriptive identifier for the fact, e.g. 'deploy-command'." },
      content: { type: "string", description: "The fact, as one concise line." },
      tags: { type: "array", items: { type: "string" }, description: "Optional tags for grouping/filtering." },
      importance: { type: "number", description: "0\u20131; higher surfaces earlier. Default 0.5." },
      scope: {
        type: "string",
        enum: ["tenant", "project", "ticket"],
        description: "How widely this fact should be visible. 'ticket' = only this ticket's runs; 'project' (default) = every run on this project; 'tenant' = the whole workspace. Prefer the NARROWEST scope that is still true \u2014 a project convention is 'project', not 'tenant'."
      },
      ttl_days: {
        type: "number",
        description: "Forget automatically after this many days. Use it for anything time-bound (a release date, a temporary workaround, an in-flight migration). Omit only for facts that stay true indefinitely."
      }
    },
    required: ["key", "content"]
  },
  requires: ["memory"],
  async execute(args, ctx) {
    const key = typeof args.key === "string" ? args.key : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!key.trim() || !content.trim()) return { data: { ok: false, error: "key and content are required" } };
    const tags = Array.isArray(args.tags) ? args.tags.filter((t) => typeof t === "string") : void 0;
    const importance = typeof args.importance === "number" && Number.isFinite(args.importance) ? args.importance : void 0;
    const scope = MEMORY_SCOPES.includes(args.scope) ? args.scope : void 0;
    const ttlDays = typeof args.ttl_days === "number" && Number.isFinite(args.ttl_days) && args.ttl_days > 0 ? args.ttl_days : void 0;
    const r = await ctx.caps.memory.remember(key, content, { tags, importance, scope, ttlDays });
    return { data: r };
  }
});
var MEMORY_SCOPES = ["tenant", "project", "ticket"];
var memoryForgetTool = defineTool({
  name: "memory_forget",
  description: "Delete one stored fact from cross-run memory by its key. Use when a fact you (or an earlier run) stored has become WRONG \u2014 a decision was reversed, a workaround was removed, a convention changed. Correcting a fact is memory_remember with the same key; this is for facts that should no longer exist at all.",
  parameters: {
    type: "object",
    properties: { key: { type: "string", description: "The key of the fact to delete." } },
    required: ["key"]
  },
  requires: ["memory", "memory.forget"],
  async execute(args, ctx) {
    const key = typeof args.key === "string" ? args.key : "";
    if (!key.trim()) return { data: { ok: false, error: "key is required" } };
    const r = await ctx.caps.memory.forget(key);
    return { data: r };
  }
});
var claimResourceTool = defineTool({
  name: "claim_resource",
  description: "Reserve a shared resource before you work on it, so a peer agent working the same ticket does not change it underneath you. Pass a file path ('src/app.ts'), a directory ('src/api/'), or 'repo' for the whole tree. Returns granted:false with the current holder when someone else has it \u2014 then work on something else, or leave a workspace_note explaining what you need. Writes to a path held by another agent are refused whether or not you claim first.",
  parameters: {
    type: "object",
    properties: {
      resource: { type: "string", description: "What to reserve: a repo-relative file path, a directory, or 'repo'." },
      mode: {
        type: "string",
        enum: ["exclusive", "shared"],
        description: "'exclusive' (default) to write it; 'shared' to signal you are reading it and block others' exclusive claims."
      },
      reason: { type: "string", description: "One line on why you need it \u2014 shown to the peer agent that gets refused." }
    },
    required: ["resource"]
  },
  requires: ["coordinate"],
  async execute(args, ctx) {
    const resource = typeof args.resource === "string" ? args.resource : "";
    if (!resource.trim()) return { data: { ok: false, error: "resource is required" } };
    const mode = args.mode === "shared" || args.mode === "exclusive" ? args.mode : void 0;
    const reason = typeof args.reason === "string" ? args.reason : void 0;
    const r = await ctx.caps.coordination.claim(resource, { mode, reason });
    return { data: r };
  }
});
var releaseResourceTool = defineTool({
  name: "release_resource",
  description: "Release a resource you claimed, so a peer agent can take it. Do this as soon as you are finished with it rather than holding it to the end of the run. Every lease this run holds is released automatically when the run ends, so this is an optimisation, not a requirement.",
  parameters: {
    type: "object",
    properties: { resource: { type: "string", description: "The resource string you claimed." } },
    required: ["resource"]
  },
  requires: ["coordinate"],
  async execute(args, ctx) {
    const resource = typeof args.resource === "string" ? args.resource : "";
    if (!resource.trim()) return { data: { ok: false, error: "resource is required" } };
    const r = await ctx.caps.coordination.release(resource);
    return { data: r };
  }
});
var workspaceNoteTool = defineTool({
  name: "workspace_note",
  description: "Publish a short note on the shared workspace for this ticket, readable by every agent working it (now or later in the ticket's lifecycle). Use it to declare intent ('I own the DB migration'), hand off a finding, or record a decision a peer must not contradict. Reusing a key overwrites that note. This is WORKING state for the current ticket \u2014 durable cross-ticket knowledge belongs in memory_remember.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Short stable identifier, e.g. 'owns-migration' or 'api-contract'." },
      content: { type: "string", description: "The note, in one or two lines." }
    },
    required: ["key", "content"]
  },
  requires: ["coordinate"],
  async execute(args, ctx) {
    const key = typeof args.key === "string" ? args.key : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!key.trim() || !content.trim()) return { data: { ok: false, error: "key and content are required" } };
    const r = await ctx.caps.coordination.postNote(key, content);
    return { data: r };
  }
});
var workspaceReadTool = defineTool({
  name: "workspace_read",
  description: "Read the shared workspace for this ticket \u2014 notes posted by peer agents plus the resources they currently hold. Call this EARLY when a ticket may be staffed by more than one agent, so you plan around what others already own instead of colliding with them.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Optional filter; omit to read everything." },
      limit: { type: "number", description: "Max notes to return (default 20)." }
    }
  },
  requires: ["coordinate"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" && args.query.trim() ? args.query : void 0;
    const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : void 0;
    const [notes, leases] = await Promise.all([
      ctx.caps.coordination.readNotes(query, limit),
      ctx.caps.coordination.listClaims()
    ]);
    if (!notes.ok) return { data: notes };
    return { data: { ok: true, notes: notes.notes ?? [], heldResources: leases.ok ? leases.leases ?? [] : [] } };
  }
});
var webFetchTool = defineTool({
  name: "web_fetch",
  description: "Fetch a single URL and return its readable text content (HTML is reduced to text/markdown). Use to read documentation, an API spec, an issue, or any page you have an exact URL for. Returns the status and the (possibly truncated) content.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The absolute http(s) URL to fetch." }
    },
    required: ["url"]
  },
  requires: ["web"],
  async execute(args, ctx) {
    const url = typeof args.url === "string" ? args.url : "";
    if (!url.trim()) return { data: { ok: false, error: "url is required" } };
    const r = await compressWebFetchResult(await ctx.caps.web.fetch(url), ctx);
    return { data: r };
  }
});
var webSearchTool = defineTool({
  name: "web_search",
  description: 'Search the public web for a query and return ranked results (title, url, snippet) plus `coverage` and `attribution`. Use to discover sources/docs when you don\'t have an exact URL; then web_fetch the most relevant result. `coverage: "owned_index"` means this workspace\'s own previously-crawled corpus answered directly; `"web"` or `"encyclopedic"` means a vendor answered and the found pages are being indexed for next time. When `coverage` is "encyclopedic" the index behind this workspace is narrower than a general web engine \u2014 report what you actually found and say what you could not find, rather than filling the gap from memory.',
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." }
    },
    required: ["query"]
  },
  requires: ["web.search"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    if (!ctx.caps.web?.search) return { data: { ok: false, error: "web search is not available on this surface" } };
    const r = await ctx.caps.web.search(query);
    return { data: r };
  }
});
var runChecksTool = defineTool({
  name: "run_checks",
  description: "Statically validate the files you have written: it parses committed JSON/YAML and runs the platform's shell-free changed-source quality policies, returning structured path/line/rule diagnostics to fix BEFORE finishing. On the cloud Worker it ALSO polls CI (build/type-check/test) for this branch's HEAD and reports success/pending/failure \u2014 that is this executor's in-run substitute for a local shell. The same static validation runs automatically at finish, so it cannot be skipped. Never claim a build/test passed unless this tool (or run_command on a Container) reported success.",
  parameters: { type: "object", properties: {} },
  requires: ["static-check"],
  async execute(_args, ctx) {
    const r = await ctx.caps.staticCheck.verify();
    return { data: r };
  }
});
var runCommandTool = defineTool({
  name: "run_command",
  description: "Run a shell command in the checked-out repository (real shell). Use it to install dependencies and run the build, type-check, lint, and tests. Returns combined stdout/stderr and the exit code. Verify your changes this way BEFORE calling finish. Do not re-run a command to grep/head/tail its output: when the result has an outputId and the output_filter tool is available, use output_filter on it. It refuses a branch switch (git checkout / git switch) while the working tree has uncommitted changes \u2014 use a git worktree, or git_commit with `branch`, instead.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: 'The shell command to run, e.g. "npm install" or "npm test".' },
      cwd: { type: "string", description: 'Optional directory to run in, relative to the workspace root (e.g. "my-project"). Defaults to the run\'s repository; "." is the workspace root. Use this instead of a `cd X &&` prefix.' },
      background: { type: "boolean", description: "Run a long command (a dev server, a full test suite, a build) in the background: returns a job id at once; check it with command_status, stop it with command_stop." },
      yieldMs: { type: "number", description: "Optional: run in the foreground up to this many milliseconds, then hand back a background job id if it is still running." },
      fresh: { type: "boolean", description: "Optional: run it even if an identical read-only command (type-check, test, lint, git status\u2026) already ran with no file changed since \u2014 by default that earlier result comes back marked cached." }
    },
    required: ["command"]
  },
  requires: ["shell"],
  // Where it runs, Stop, and the background modes live in `shell-tools.ts`.
  execute: (args, ctx) => runShellCommand(args, ctx)
});
var askHumanTool = defineTool({
  name: "ask_human",
  description: `Pause and ask a human for input when you are genuinely BLOCKED \u2014 a requirement is ambiguous, you cannot find an expected file/system after searching, a decision needs product/business judgement, or you would otherwise have to guess. The run pauses (no further token spend) and the question goes to the team's human-requests queue with a notification; when someone answers, you resume automatically with their answer and continue. Prefer this over guessing or finishing with a "could not proceed" summary \u2014 a blocked task that asks gets unblocked; one that gives up silently does not. Do NOT use it for things you can determine yourself with list_files/search_code/read_file.`,
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The specific question for the human. Be concrete and self-contained \u2014 they may not have the full task context." },
      context: { type: "string", description: "Optional: what you have tried / why you are blocked, so the human can answer well." }
    },
    required: ["question"]
  },
  requires: ["human"],
  async execute(args, ctx) {
    const question = typeof args.question === "string" ? args.question.trim() : "";
    const context = typeof args.context === "string" ? args.context : void 0;
    if (!question) return { data: { ok: false, error: "question is required to ask a human" } };
    const r = await ctx.caps.human.ask(question, context);
    if (r.paused) {
      return {
        control: { kind: "ask_human", approvalId: r.approvalId, question },
        data: { ok: true, paused: true, note: r.note ?? "Question sent to a human. The run is paused until it is answered; you will resume with the answer." }
      };
    }
    return { data: { ok: true, paused: false, answer: r.answer ?? null, note: r.note } };
  }
});
var updatePrdTool = defineTool({
  name: "update_prd",
  description: `Record a change on THIS TICKET'S PRD \u2014 the shared spec you were given in your context and that every other agent on this ticket reads. Use mode "append" (the default, and the safe one) to add a dated, signed note: a decision you made, a constraint you discovered, an assumption you had to take, or work you deliberately left out of scope. Use mode "section" ONLY to correct a section that is actually WRONG \u2014 it replaces that section's whole body, so pass the full replacement text, not a fragment; name the section by its exact heading (e.g. "Acceptance criteria", "Implementation Notes"). If the heading does not exist the call fails and returns the headings that do \u2014 retry with one of those, or append instead. This is not a substitute for doing the work: keep it to what a later run genuinely needs to know.`,
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["append", "section"],
        description: `"append" adds a dated, attributed note at the end (nothing already written is lost). "section" REPLACES the named section's body \u2014 only for correcting something wrong.`
      },
      section: {
        type: "string",
        description: 'Required when mode is "section": the exact heading to replace, without the leading "##" (e.g. "Acceptance criteria").'
      },
      content: {
        type: "string",
        description: `The markdown to record. For mode "append", the note. For mode "section", the section's COMPLETE new body.`
      }
    },
    required: ["mode", "content"]
  },
  requires: ["prd.write"],
  async execute(args, ctx) {
    const mode = args.mode === "section" ? "section" : "append";
    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (!content) return { data: { ok: false, error: "content is required" } };
    if (mode === "section") {
      const heading = typeof args.section === "string" ? args.section.trim() : "";
      if (!heading) {
        return {
          data: {
            ok: false,
            error: 'section is required when mode is "section" \u2014 pass the exact heading to replace, or use mode "append" to add a note instead.'
          }
        };
      }
      const edited = await ctx.caps.prd.editSection(heading, content);
      return { data: edited };
    }
    const appended = await ctx.caps.prd.append(content);
    return { data: appended };
  }
});
var finishTool = defineTool({
  name: "finish",
  description: 'Call ONLY when the task is fully complete \u2014 every deliverable file written with real, working content (no stubs/placeholders) and every task/PRD requirement implemented. Your changes open a pull request for human review, so a partial scaffold is not "done". Provide a concise summary of what was delivered. Do NOT assert that a build/type-check/lint/test passed \u2014 you cannot run those here (CI on the PR verifies). If you are blocked rather than done, call ask_human instead of finishing with a "could not proceed" summary.',
  parameters: {
    type: "object",
    properties: { summary: { type: "string", description: "What was delivered." } },
    required: ["summary"]
  },
  // No capability: every surface can finish. The engine applies the honesty +
  // anti-stub finish gates around this control signal (loop policy, not a tool).
  async execute(args) {
    const summary = typeof args.summary === "string" ? args.summary.trim() : "";
    return { control: { kind: "finish", summary }, data: { ok: true } };
  }
});
var CORE_TOOLS = [
  listFilesTool,
  searchCodeTool,
  readFileTool,
  ...SYMBOL_TOOLS,
  ...SEMANTIC_TOOLS,
  localResearchTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  runChecksTool,
  runCommandTool,
  ...SHELL_JOB_TOOLS,
  analyzeCodebaseTool,
  ...GIT_TOOLS,
  webFetchTool,
  webSearchTool,
  memoryRecallTool,
  memoryRememberTool,
  memoryForgetTool,
  claimResourceTool,
  releaseResourceTool,
  workspaceNoteTool,
  workspaceReadTool,
  askHumanTool,
  updatePrdTool,
  finishTool
];
function buildCoreToolRegistry() {
  return new ToolRegistry(CORE_TOOLS);
}

// ../packages/agent-tools/src/psychometric-dims.ts
var PSYCH_DIM = {
  // HEXACO spine
  honesty: "hexaco.honesty",
  emotionality: "hexaco.emotionality",
  extraversion: "hexaco.extraversion",
  agreeableness: "hexaco.agreeableness",
  conscientiousness: "hexaco.conscientiousness",
  openness: "hexaco.openness",
  // Regulatory focus (0 = prevention, 100 = promotion)
  regulatoryFocus: "regfocus.orientation",
  // Cognition / dual-process (0 = intuitive/System-1, 100 = deliberate/System-2)
  needForCognition: "cognition.need_for_cognition",
  reflection: "cognition.reflection",
  // Decision style (GDMS) + maximizing
  decisionRational: "decision.rational",
  decisionIntuitive: "decision.intuitive",
  decisionDependent: "decision.dependent",
  decisionSpontaneous: "decision.spontaneous",
  maximizing: "decision.maximizing",
  // Moral Foundations
  moralCare: "moral.care",
  moralFairness: "moral.fairness",
  moralLoyalty: "moral.loyalty",
  moralAuthority: "moral.authority",
  moralSanctity: "moral.sanctity",
  moralLiberty: "moral.liberty",
  // Thomas-Kilmann conflict axes (mode is derived from the two)
  conflictAssertiveness: "conflict.assertiveness",
  conflictCooperativeness: "conflict.cooperativeness",
  // Schwartz basic values
  valSelfDirection: "values.self_direction",
  valStimulation: "values.stimulation",
  valHedonism: "values.hedonism",
  valAchievement: "values.achievement",
  valPower: "values.power",
  valSecurity: "values.security",
  valConformity: "values.conformity",
  valTradition: "values.tradition",
  valBenevolence: "values.benevolence",
  valUniversalism: "values.universalism",
  // Dispositional
  grit: "disp.grit",
  locusInternal: "disp.locus_internal",
  riskTolerance: "disp.risk_tolerance"
};
var NEUTRAL = 50;
function score(vector, id) {
  const raw = vector?.[id];
  if (typeof raw !== "number" || Number.isNaN(raw)) return NEUTRAL;
  return Math.max(0, Math.min(100, raw));
}

// ../packages/agent-tools/src/psychometrics.ts
function limbicTraits(profile) {
  const v = profile?.vector;
  return {
    openness: score(v, PSYCH_DIM.openness),
    emotionality: score(v, PSYCH_DIM.emotionality),
    conscientiousness: score(v, PSYCH_DIM.conscientiousness),
    extraversion: score(v, PSYCH_DIM.extraversion),
    regulatoryFocus: score(v, PSYCH_DIM.regulatoryFocus),
    riskTolerance: score(v, PSYCH_DIM.riskTolerance),
    grit: score(v, PSYCH_DIM.grit),
    stimulation: score(v, PSYCH_DIM.valStimulation)
  };
}

// ../packages/agent-tools/src/knowledge-notes.ts
import { rankByCount } from "@seanhogg/builderforce-memory/working";

// ../packages/agent-tools/src/run-knowledge.ts
import { WorkingMemory, consolidate } from "@seanhogg/builderforce-memory/working";
var FILE_TOOL_KINDS = /* @__PURE__ */ new Map([
  ["write_file", "create"],
  ["write", "create"],
  ["create", "create"],
  ["edit_file", "edit"],
  ["edit", "edit"],
  ["apply_patch", "edit"],
  ["delete_file", "delete"],
  ["delete", "delete"],
  ["read_file", "read"],
  ["read", "read"],
  ["view", "read"],
  ["file_outline", "read"],
  ["read_compressed", "read"]
]);
function fileToolKind(name) {
  return FILE_TOOL_KINDS.get(name);
}
var SEARCH_TOOLS = /* @__PURE__ */ new Map([
  ["search_code", ["query", "pattern"]],
  ["grep", ["query", "pattern"]],
  ["find_symbol", ["name", "symbol", "query"]],
  ["semantic_search", ["query"]],
  ["list_files", ["glob", "path"]],
  ["glob", ["glob", "pattern", "path"]]
]);
function searchLabel(name, args) {
  const keys = SEARCH_TOOLS.get(name);
  if (!keys || !args || typeof args !== "object") return void 0;
  const rec = args;
  const what = keys.map((k) => rec[k]).find((v) => typeof v === "string" && !!v.trim());
  if (!what) return void 0;
  const scope = typeof rec["path"] === "string" && rec["path"] !== what ? ` in ${rec["path"]}` : "";
  return `${name} "${what.trim().slice(0, 80)}"${scope}`;
}
function argPath(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return void 0;
  return toolCallPaths(args)[0];
}
var OBSERVATION = {
  create: "created",
  edit: "edited",
  delete: "deleted",
  read: "read"
};
var REMEMBER_FACT_TOOLS = /* @__PURE__ */ new Set(["remember_fact", "builtin_remember_fact"]);
var BRIEF_FACTS_MAX = 8;
var BRIEF_FACT_CHARS = 200;
var FACT_KEY_CHARS = 120;
var FACT_CONTENT_CHARS = 600;
var SAVED_FACTS_MAX = 24;
function savedFactOf(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return void 0;
  const rec = args;
  const key = typeof rec.key === "string" ? rec.key.replace(/\s+/g, " ").trim().slice(0, FACT_KEY_CHARS) : "";
  const content = typeof rec.content === "string" ? rec.content.trim() : "";
  return key && content ? { key, content } : void 0;
}
var RunKnowledgeRecorder = class _RunKnowledgeRecorder {
  memory = new WorkingMemory();
  tools = [];
  savedFacts = /* @__PURE__ */ new Map();
  /**
   * The recorder a resumed step continues with. A host that runs one step per process
   * (the cloud's Durable Object ticks) MUST carry this, or every step starts with an
   * empty memory: the brief is never worth giving and the run-end map covers one step.
   */
  static restore(state) {
    const r = new _RunKnowledgeRecorder();
    if (!state) return r;
    if (state.memory.task) r.memory.setTask(state.memory.task);
    for (const kind of ["created", "edited", "deleted", "read"]) {
      for (const path of state.memory[kind] ?? []) r.memory.observe({ kind, path });
    }
    for (const query of state.memory.searched ?? []) r.memory.observe({ kind: "searched", query });
    r.tools.push(...state.tools ?? []);
    for (const raw of state.savedFacts ?? []) {
      const f = savedFactOf(raw);
      if (f) r.rememberFact(f);
    }
    return r;
  }
  /** The state {@link restore} rebuilds this recorder from. */
  snapshot() {
    return {
      memory: this.memory.snapshot,
      tools: [...this.tools],
      ...this.savedFacts.size > 0 ? { savedFacts: [...this.savedFacts].map(([key, content]) => ({ key, content })) } : {}
    };
  }
  /** Same key replaces (re-inserted, so the newest lists last); content clamped, only the newest few kept. */
  rememberFact(fact) {
    this.savedFacts.delete(fact.key);
    this.savedFacts.set(fact.key, fact.content.slice(0, FACT_CONTENT_CHARS));
    while (this.savedFacts.size > SAVED_FACTS_MAX) this.savedFacts.delete(this.savedFacts.keys().next().value);
  }
  setPrompt(prompt) {
    this.memory.setTask(prompt);
  }
  /** Record one successful tool call. Unknown tools still count toward `tools`. */
  record(name, args) {
    this.tools.push(name);
    if (REMEMBER_FACT_TOOLS.has(name)) {
      const fact = savedFactOf(args);
      if (fact) {
        this.rememberFact(fact);
      }
      return;
    }
    const search = searchLabel(name, args);
    if (search) {
      this.memory.observe({ kind: "searched", query: search });
      return;
    }
    const kind = fileToolKind(name);
    const rec = args && typeof args === "object" && !Array.isArray(args) ? args : void 0;
    const many = kind === "read" && !!rec && !(typeof rec.path === "string" && rec.path !== "") && Array.isArray(rec.paths);
    if (kind && many) {
      for (const path of toolCallPaths(args)) this.memory.observe({ kind: OBSERVATION[kind], path });
      return;
    }
    const p = kind ? argPath(args) : void 0;
    if (kind && p) this.memory.observe({ kind: OBSERVATION[kind], path: p });
  }
  /** True when nothing has been recorded — the caller can skip the write entirely. */
  get isEmpty() {
    return this.tools.length === 0;
  }
  /** This run's activity, in the shared note format's shape. `read` keeps duplicates. */
  get activity() {
    const s = this.memory.snapshot;
    return {
      created: s.created,
      edited: s.edited,
      deleted: s.deleted,
      read: s.read,
      tools: this.tools,
      ...s.task ? { prompt: s.task } : {}
    };
  }
  brief() {
    const base = this.memory.brief({ observations: this.tools.length });
    if (this.savedFacts.size === 0) return base;
    const lines = [...this.savedFacts].slice(-BRIEF_FACTS_MAX).map(([key, content]) => {
      const line = content.replace(/\s+/g, " ");
      return `- ${key}: ${line.length > BRIEF_FACT_CHARS ? `${line.slice(0, BRIEF_FACT_CHARS - 1)}\u2026` : line}`;
    });
    const section = `Facts you saved this run:
${lines.join("\n")}`;
    return base ? `${base}

${section}` : section;
  }
  consolidate(opts) {
    return consolidate(this.memory.snapshot, opts);
  }
};

// ../packages/agent-tools/src/skill-tools.ts
var skillProposeTool = defineTool({
  name: "skill_propose",
  description: "Propose a reusable SKILL \u2014 a procedure a future agent can follow \u2014 drafted from work you just completed and verified. Use it when you worked out a repeatable way to do something non-obvious in this codebase (a migration + guard + test sequence, a release path, a debugging route) and a future run would otherwise rediscover it. Do NOT propose a skill for a one-off fix, for something the repo already documents, or for a procedure you did not actually complete. The draft goes to a human for review; it does not take effect until approved.",
  parameters: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: "Stable kebab-case id, e.g. 'add-a-schema-column'. Re-using one revises your existing draft."
      },
      name: { type: "string", description: "Short human title, e.g. 'Add a schema column end to end'." },
      description: {
        type: "string",
        description: "One line saying WHEN to use this skill \u2014 a future agent matches on this, so name the situation, not the steps."
      },
      body: {
        type: "string",
        description: "The procedure as Markdown: ordered steps, exact commands, and how to tell it worked."
      },
      evidence: {
        type: "string",
        description: "What proves this procedure works \u2014 the graded proof, the merged PR, the passing check."
      }
    },
    required: ["slug", "name", "description", "body"]
  },
  requires: ["skill.author"],
  async execute(args, ctx) {
    const str5 = (v) => typeof v === "string" ? v.trim() : "";
    const slug = str5(args.slug);
    const name = str5(args.name);
    const description = str5(args.description);
    const body = str5(args.body);
    if (!slug || !name || !description || !body) {
      return { data: { ok: false, error: "slug, name, description and body are all required" } };
    }
    const evidence = str5(args.evidence);
    const r = await ctx.caps.skillAuthor.propose({
      slug,
      name,
      description,
      body,
      ...evidence ? { evidence } : {}
    });
    return { data: r };
  }
});
var skillListTool = defineTool({
  name: "skill_list",
  description: "List the skills this workspace already has \u2014 approved ones you can follow, and drafts awaiting review. Call it before proposing, so you revise an existing draft instead of adding a near-duplicate.",
  parameters: { type: "object", properties: {} },
  requires: ["skill.author"],
  async execute(_args, ctx) {
    const r = await ctx.caps.skillAuthor.list();
    return { data: r };
  }
});
var SKILL_TOOLS = [skillProposeTool, skillListTool];

// ../packages/agent-tools/src/live-subagent-tools.ts
var LIVE_DELEGATION_NOTE = "HERE the child runs IN THE BACKGROUND: the call returns its handle at once and you keep working \u2014 plan, code, or start more children \u2014 while it does its slice. Its messages appear in the chat under its own name, and its report reaches you on its own when it finishes (call wait_agents only when you cannot go on without it). Redirect it with message_agent; cancel it with stop_agent. Do not edit the files a child is working on while it runs.";
var BLOCKING_DELEGATION_NOTE = "HERE the call BLOCKS: you wait while the child does its slice, and its report is the call's result. There is no background handle, nothing to wait for or redirect afterwards, so delegate a slice you can afford to wait for. A child cannot delegate further.";
function delegationNote(caps) {
  return caps.has("orchestrate.live") ? LIVE_DELEGATION_NOTE : BLOCKING_DELEGATION_NOTE;
}
function withDelegationNote(def) {
  return { ...def, describeFor: (caps) => def.schema.function.description.replace(LIVE_DELEGATION_NOTE, delegationNote(caps)) };
}
var VERIFY_DELEGATION_STEP = 'Hand the checking to ONE verify sub-agent (spawn_agent, role "verify"): brief it with the files changed and how to know the change is done; it runs the narrowest type-check, build and tests on a cheaper model and reports each failure verbatim. Fix what it reports \u2014 yourself or with a code sub-agent \u2014 and verify again until it passes. When the checks are only a few known commands, do not delegate them: run them yourself with run_command background:true. Never run a command a live child was briefed to run \u2014 call wait_agents for its result.';
var VERIFY_STEP = `${VERIFY_DELEGATION_STEP} Where you cannot spawn, run the narrowest type-check, build and tests that cover what you touched yourself, and fix whatever fails.`;
var RESOLVE_OPEN_ISSUES = "resolve every open issue the reports name: fix it yourself, send it back with message_agent, or hand it to a code sub-agent";
var LIVE_FANOUT_NEXT = `Keep working on anything not delegated. When their reports are in (they arrive on their own, or call wait_agents), ${RESOLVE_OPEN_ISSUES}; fix anything the slices broke between them, then check the combined result. ${VERIFY_DELEGATION_STEP} Report per workstream and ticket.`;
var OPEN_ISSUES_HEAD = `Open issues \u2014 yours before you finish (${RESOLVE_OPEN_ISSUES}; then verify again):`;
var SUBAGENT_CONTROL_TOOL_NAMES = { wait: "wait_agents", message: "message_agent", stop: "stop_agent" };
var MAX_WAIT_SECONDS = 600;
var DEFAULT_WAIT_SECONDS = 300;
var CHILD_REPORT_HEAD = "[Sub-agent ";
function isChildReportText(text) {
  return !!text && text.trimStart().startsWith(CHILD_REPORT_HEAD);
}
var handlesOf = (v) => Array.isArray(v) ? v.filter((h) => typeof h === "string" && h.trim() !== "").map((h) => h.trim()) : [];
var live = (ctx) => ctx.caps.orchestration?.live ?? null;
var unavailable = () => ({ data: { ok: false, error: "this surface runs no background sub-agents" } });
var waitAgentsTool = defineTool({
  name: SUBAGENT_CONTROL_TOOL_NAMES.wait,
  description: "Wait for your running sub-agents and collect their reports. Use it only when your next step depends on their results (e.g. verifying and committing a fan-out). Pass `agents` to wait for specific handles; omit it to wait for all of yours. Returns the reports that came in and which are still running at the timeout.",
  parameters: {
    type: "object",
    properties: {
      agents: { type: "array", items: { type: "string" }, description: "Handles to wait for, e.g. ['a1','a3']. Omit for all of yours." },
      timeout_seconds: { type: "number", description: `How long to wait (default ${DEFAULT_WAIT_SECONDS}, max ${MAX_WAIT_SECONDS}).` }
    }
  },
  requires: ["orchestrate.live"],
  async execute(args, ctx) {
    const controls = live(ctx);
    if (!controls) return unavailable();
    const seconds2 = Math.min(MAX_WAIT_SECONDS, Math.max(1, Number(args.timeout_seconds) || DEFAULT_WAIT_SECONDS));
    const { reports, running, note } = await controls.wait(handlesOf(args.agents), seconds2 * 1e3, ctx.signal);
    const changedFiles = [...new Set(reports.flatMap((r) => r.changedFiles ?? []))];
    return {
      data: {
        ok: true,
        reports,
        running,
        // Read by the ticket backstop (`codeChangesOf`) like any delegation result.
        ...changedFiles.length ? { changedFiles } : {},
        ...note ? { note } : running.length ? { note: `${running.join(", ")} still running \u2014 their reports will reach you when they finish.` } : {}
      }
    };
  }
});
var messageAgentTool = defineTool({
  name: SUBAGENT_CONTROL_TOOL_NAMES.message,
  description: "Redirect one of your running sub-agents mid-task: narrow its scope, correct a wrong assumption, hand it a fact it lacks. It reads the message before its next step. The message is shown in the chat.",
  parameters: {
    type: "object",
    properties: {
      agent: { type: "string", description: "The child's handle, e.g. 'a2'." },
      message: { type: "string", description: "The direction, standalone \u2014 it has none of your conversation." }
    },
    required: ["agent", "message"]
  },
  requires: ["orchestrate.live"],
  async execute(args, ctx) {
    const controls = live(ctx);
    if (!controls) return unavailable();
    const handle = typeof args.agent === "string" ? args.agent.trim() : "";
    const text = typeof args.message === "string" ? args.message.trim() : "";
    if (!handle || !text) return { data: { ok: false, error: "agent and message are required" } };
    const out = await controls.message(handle, text);
    return { data: out };
  }
});
var stopAgentTool = defineTool({
  name: SUBAGENT_CONTROL_TOOL_NAMES.stop,
  description: "Stop running sub-agents of yours \u2014 one or more by handle, or all of them. A stopped child reports what it had done.",
  parameters: {
    type: "object",
    properties: {
      agents: { type: "array", items: { type: "string" }, description: "Handles to stop. Omit to stop ALL of your running children." }
    }
  },
  requires: ["orchestrate.live"],
  async execute(args, ctx) {
    const controls = live(ctx);
    if (!controls) return unavailable();
    const named = handlesOf(args.agents);
    const stopped = await controls.stop(named.length ? named : "all");
    return { data: { ok: true, stopped } };
  }
});
var SUBAGENT_CONTROL_TOOLS = [waitAgentsTool, messageAgentTool, stopAgentTool];

// ../packages/agent-tools/src/subagent-tools.ts
var ROLE_ENUM_DESCRIPTION = MODEL_ROLES.map((role) => `${role} \u2014 ${MODEL_ROLE_DESCRIPTIONS[role]}`).join(" \xB7 ");
var HANDOFF_NOTE = "The child does not see this conversation. Put the job in `task` and every fact you already established (counts, conclusions, what you ruled out, pages or files already read) in `context` \u2014 the child starts from it instead of re-deriving it; where the host keeps your run record it also appends the files, windows and data calls you already made. Its report carries its coverage (what it read, with offsets) and, where the host keeps them, the path of a file holding the data it collected \u2014 read that file instead of fetching the same pages again.";
var HANDOFF_CHARS = 2e3;
var HANDOFF_HEAD = "Already established by your owner \u2014 do not re-derive:";
function ownerHandoffBlock(input, maxChars = HANDOFF_CHARS) {
  const context = (input.context ?? "").trim();
  const established = (input.established ?? []).map((l) => l.trim()).filter(Boolean);
  if (!context && established.length === 0) return "";
  const lines = [HANDOFF_HEAD];
  let used = HANDOFF_HEAD.length;
  if (context) {
    const room = Math.max(0, maxChars - used - 1);
    const clipped = context.length > room ? `${context.slice(0, Math.max(0, room - 1))}\u2026` : context;
    lines.push(clipped);
    used += clipped.length + 1;
  }
  if (established.length) {
    const head = "Your owner already made these calls; their conclusions are stated above. Re-read only what you need verbatim:";
    if (used + head.length + 1 < maxChars) {
      lines.push(head);
      used += head.length + 1;
      let shown = 0;
      for (const line of established) {
        const row = `- ${line}`;
        const rest = established.length - shown - 1;
        const tail = rest > 0 ? `- \u2026 and ${rest} more` : "";
        if (used + row.length + 1 + (rest > 0 ? tail.length + 1 : 0) > maxChars) break;
        lines.push(row);
        used += row.length + 1;
        shown += 1;
      }
      if (shown < established.length) lines.push(`- \u2026 and ${established.length - shown} more`);
    }
  }
  return lines.join("\n");
}
function briefWithHandoff(task, block) {
  return block ? `${task}

${block}` : task;
}
var CONTEXT_PARAM = {
  type: "string",
  description: "Facts you have ALREADY established that the child must not re-derive \u2014 counts, conclusions, what you ruled out, which pages/files/windows you already read and what they held. Shown to the child first under 'Already established by your owner'."
};
var spawnAgentTool = withDelegationNote(defineTool({
  name: "spawn_agent",
  description: "Delegate a self-contained sub-task to a child agent that works in its OWN context and reports back when it is done. Use it when finding something out would take many turns you do not want to carry \u2014 locating where a behaviour lives across an unfamiliar tree, checking whether a pattern is used anywhere else, summarising a large file you only need one fact from. " + HANDOFF_NOTE + " Name its `role` \u2014 it decides which model does the work. Do NOT delegate work you can do in a turn or two. The child is a clone of you: it holds every tool you hold and carries its slice out end to end \u2014 investigating, editing, running commands, recording the work. You remain accountable for what ships, so check what it reports. " + LIVE_DELEGATION_NOTE,
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "A few words naming the delegation, e.g. 'locate the auth middleware'. Shown on the run timeline."
      },
      task: {
        type: "string",
        description: "The child's job: what to find out or do, where to look, and exactly what to report back. Facts you already established go in `context`."
      },
      context: CONTEXT_PARAM,
      role: {
        type: "string",
        enum: [...MODEL_ROLES],
        description: `REQUIRED. What kind of work the child's turns are \u2014 the surface routes them to a model suited to it, and the child keeps that model for its whole life. ${ROLE_ENUM_DESCRIPTION}`
      },
      as_agent: {
        type: "string",
        description: "Run the child AS one of the workspace's agents \u2014 its id or name (e.g. 'Ada'). The child adopts that agent's role, bio, skills and personality so the delegated slice is done in that agent's voice and expertise. Prefer an agent already in this chat (builtin_chats_list_agents) or from builtin_cloud_agents_list_mine. Optional: when no teammate's role fits the slice, omit it and the child runs as a plain sub-agent."
      }
    },
    required: ["label", "task", "role"]
  },
  requires: ["orchestrate"],
  async execute(args, ctx) {
    const str5 = (v) => typeof v === "string" ? v.trim() : "";
    const label = str5(args.label);
    const task = str5(args.task);
    if (!task) return { data: { ok: false, error: "task is required \u2014 the child sees none of your conversation" } };
    const role = requiredDelegationRole(args.role);
    if (!role) return { data: { ok: false, error: MISSING_ROLE_ERROR } };
    const asAgent = str5(args.as_agent);
    const r = await ctx.caps.orchestration.spawn({
      label: label || task.slice(0, 60),
      // The cloud surface keeps no owner run record here: the hand-off is the owner's `context`.
      task: briefWithHandoff(task, ownerHandoffBlock({ context: str5(args.context) })),
      role,
      ...asAgent ? { asAgent } : {}
    });
    return { data: r, ...r.ok ? {} : { isError: true } };
  }
}));
var MAX_WORKSTREAMS = 4;
var FANOUT_OUTPUT_CHARS = 4800;
var SPAWN_AGENTS_TOOL = "spawn_agents";
function parseWorkstreams(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return "workstreams is required \u2014 one entry per independent slice";
  if (raw.length > MAX_WORKSTREAMS) {
    return `at most ${MAX_WORKSTREAMS} workstreams per call \u2014 run the rest in a second call once these are back`;
  }
  const str5 = (v) => typeof v === "string" ? v.trim() : "";
  const out = [];
  for (const [i, item] of raw.entries()) {
    const w = item ?? {};
    const task = str5(w.task);
    if (!task) return `workstream ${i + 1} has no task \u2014 each child sees none of your conversation`;
    const role = requiredDelegationRole(w.role);
    if (!role) return `workstream ${i + 1}: ${MISSING_ROLE_ERROR}`;
    const ticket = str5(w.ticket);
    const context = str5(w.context);
    out.push({
      label: str5(w.label) || task.slice(0, 60),
      task,
      ...ticket ? { ticket } : {},
      role,
      ...context ? { context } : {},
      asAgent: str5(w.as_agent)
    });
  }
  return out;
}
var spawnAgentsTool = withDelegationNote(defineTool({
  name: SPAWN_AGENTS_TOOL,
  description: `Run SEVERAL independent workstreams side by side \u2014 up to ${MAX_WORKSTREAMS} child agents at once, each in its own context, each reporting back to the chat. Use it when the request splits into slices that do not depend on each other: a PRD's workstreams, one change per package or feature. Each child is a clone of you with every tool you hold, and carries its slice out end to end. Give slices that do not touch the same files, so they do not overwrite each other; once their reports are in, check the combined result and report per workstream. File one ticket per workstream first and pass its id as \`ticket\`. Every \`task\` must stand alone: what to change, where, and how to know it is done; name each workstream's \`role\`. ` + HANDOFF_NOTE + " " + LIVE_DELEGATION_NOTE,
  parameters: {
    type: "object",
    properties: {
      workstreams: {
        type: "array",
        minItems: 1,
        maxItems: MAX_WORKSTREAMS,
        description: "One entry per independent slice of the work.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "A few words naming the workstream, e.g. 'W8: company \u2192 project'." },
            task: { type: "string", description: "The child's complete, standalone brief." },
            context: CONTEXT_PARAM,
            ticket: { type: "string", description: "The ticket this workstream delivers, echoed in the result." },
            role: { type: "string", enum: [...MODEL_ROLES], description: `REQUIRED. What kind of work this child does \u2014 it routes the child's model. ${ROLE_ENUM_DESCRIPTION}` },
            as_agent: { type: "string", description: "Run this workstream AS one of the workspace's agents (its name or id). Optional: omit it when no teammate's role fits, and the child runs as a plain sub-agent." }
          },
          required: ["label", "task", "role"]
        }
      }
    },
    required: ["workstreams"]
  },
  requires: ["orchestrate.fanout"],
  // The CLOUD form: each child is one `orchestrate` spawn — its own durable run. The
  // editor starts its children as runs in its own process (`subagentFanOutTool.ts`) on
  // the same schema and parser.
  async execute(args, ctx) {
    const parsed = parseWorkstreams(args.workstreams);
    if (typeof parsed === "string") return { data: { ok: false, error: parsed } };
    const outputChars = Math.floor(FANOUT_OUTPUT_CHARS / parsed.length);
    const results = await Promise.all(parsed.map((w) => ctx.caps.orchestration.spawn({
      label: w.label,
      task: briefWithHandoff(w.task, ownerHandoffBlock({ ...w.context ? { context: w.context } : {} })),
      role: w.role,
      outputChars,
      ...w.ticket ? { ticket: w.ticket } : {},
      ...w.asAgent ? { asAgent: w.asAgent } : {}
    }).then((r) => ({ label: w.label, ...r }))));
    return {
      data: {
        ok: results.every((r) => r.ok),
        workstreams: results,
        next: LIVE_FANOUT_NEXT
      }
    };
  }
}));
var SUBAGENT_TOOLS = [spawnAgentTool, spawnAgentsTool, ...SUBAGENT_CONTROL_TOOLS];

// ../packages/agent-tools/src/childCapabilities.ts
var DELEGATION_CAPABILITIES = ["orchestrate", "orchestrate.fanout", "orchestrate.live"];
var NON_DELEGABLE_CAPABILITIES = ["human", "skill.author"];
var CHILD_WITHHELD_CAPABILITIES = /* @__PURE__ */ new Set([...NON_DELEGABLE_CAPABILITIES, ...DELEGATION_CAPABILITIES]);

// ../packages/agent-tools/src/symbolRelations.ts
import {
  MAX_CALL_SITES_PER_EDGE,
  MAX_SYMBOL_EDGES_PER_SYMBOL
} from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/symbolImports.ts
var IMPORT_NAMED = new RegExp(`^\\s*(?:type\\s+)?(${ID})(?:\\s+as\\s+(${ID}))?\\s*$`);
var IMPORT_NAMESPACE = new RegExp(`\\*\\s*as\\s+(${ID})`);
var IMPORT_DEFAULT = new RegExp(`^\\s*(${ID})\\s*(?:,|$)`);

// ../packages/agent-tools/src/symbolRelations.ts
import {
  SYMBOL_EDGE_KINDS,
  MAX_SYMBOL_EDGES_PER_SYMBOL as MAX_SYMBOL_EDGES_PER_SYMBOL2,
  MAX_CALL_SITES_PER_EDGE as MAX_CALL_SITES_PER_EDGE2,
  isSymbolEdgeKind
} from "@seanhogg/builderforce-memory/knowledge";
var LEADING_TYPE = new RegExp(`^\\s*(${ID}(?:\\s*\\.\\s*${ID})?)`);
var FIELD = new RegExp(`^\\s*(?:(?:public|private|protected|readonly|static|declare|override|abstract|accessor)\\s+)*#?(${ID})\\s*[?!]?\\s*:\\s*([^=;]+)`);
var FIELD_INIT = new RegExp(`^\\s*(?:(?:public|private|protected|readonly|static|override)\\s+)*#?(${ID})\\s*=`);
var NEW = new RegExp(`(?:^|[^\\w$])new\\s+(${ID}(?:\\.${ID})?)`);
var PARAM_PROP = new RegExp(`\\b(?:public|private|protected|readonly)\\s+(?:readonly\\s+)?(${ID})\\s*\\??\\s*:\\s*(${ID}(?:\\.${ID})?)`, "g");
var LOCAL_DECL = new RegExp(`\\b(?:const|let|var|function\\s*\\*?|class|catch\\s*\\()\\s*(${ID})`, "g");
var LAST_ID = new RegExp(`(${ID})\\s*(?:=[^,]*)?\\s*$`);
var CALLBACK_PARAMS = new RegExp(`(?:\\(([^()]*)\\)(?:\\s*:\\s*[^=()]+)?\\s*=>|(${ID})\\s*=>|\\bfunction\\b[^(]*\\(([^()]*)\\))\\s*\\{\\s*$`);
var PARAM_NAME = new RegExp(`^\\s*(?:\\.\\.\\.)?(?:(?:public|private|protected|readonly)\\s+)*(${ID})`);

// ../packages/agent-tools/src/knowledge/codePack.ts
import {
  compareStr as compareStr8,
  loadPartitions,
  normalizeKey
} from "@seanhogg/builderforce-memory/knowledge";
import { CONTENT_HASH_FIELD as CONTENT_HASH_FIELD2, hashText as hashText4 } from "@seanhogg/builderforce-memory/ingest";

// ../packages/agent-tools/src/knowledge/codeComplexity.ts
var TERNARY = String.raw`\?(?![.:,)=]|\(\s*\)\s*:)`;
var JS_DECISIONS = new RegExp(String.raw`\b(?:if|for|while|case|catch)\b|&&|\|\||\?\?|${TERNARY}`, "g");
var OO_DECISIONS = new RegExp(String.raw`\b(?:if|for|foreach|while|case|catch)\b|&&|\|\||\?\?|${TERNARY}`, "g");

// ../packages/agent-tools/src/knowledge/codeConcurrency.ts
import { compareStr } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/codeNodes.ts
import { canonicalJson, COCHANGE_BADGE, srcRef } from "@seanhogg/builderforce-memory/knowledge";
import { areaOfPath } from "@seanhogg/builderforce-memory/working";
import { hashText as hashText2 } from "@seanhogg/builderforce-memory/ingest";
var CODE_PACK_ID = "code";
var CODE_BADGES = {
  /** The symbol extractor's language family (`js`, `python`, …). */
  language: "language",
  /** Definitions in the file. */
  symbols: "symbols",
  /** Exported definitions in the file. */
  exports: "exports",
  /** knip: `'file'` when the whole file is unused. */
  unused: "unused",
  /** knip: unused exports in the file. */
  unusedExports: "unusedExports",
  /** knip: unused dependencies declared by the file (a package manifest). */
  unusedDependencies: "unusedDependencies",
  /** knip: the names of the file's unused exports, sorted and comma-joined: one `unused-export` finding each (PRD 41 §C3). */
  unusedExportNames: "unusedExportNames",
  /** knip: the names of the manifest's unused dependencies, sorted and comma-joined: one `unused-dependency` finding each. */
  unusedDependencyNames: "unusedDependencyNames",
  /** Lines in the file (deterministic): the god-module finding's size measure. */
  lines: "lines",
  /** Sum of cyclomatic complexity over the file's functions (deterministic). */
  complexity: "complexity",
  /** The worst function's cyclomatic complexity (deterministic). */
  maxComplexity: "maxComplexity",
  /** 0..1 line coverage from `coverage-final.json` / `lcov.info` under the root (runtime). */
  coverage: "coverage",
  /** Commits touching the file in the last 90 days, from the host's `HistoryPort` (deterministic). */
  churn: "churn",
  /** The file's co-change partners over the last year of history (memory's `encodeCoChange`, PRD 38 P4); absent with none. */
  coChange: COCHANGE_BADGE,
  /** First CODEOWNERS owner of the file (deterministic). */
  owner: "owner",
  /** Comma-separated design-pattern ids (heuristic). */
  patterns: "patterns",
  /** `METHOD path` route registrations joined by `;`, capped at 50 (deterministic). */
  routes: "routes",
  /** The rule that placed the file's layer: `folder`, `name` or `imports`. */
  layerRule: "layerRule",
  /** `1` on a package entry point a manifest names (`main` / `bin` / `exports`): layer resolution reads it, never the filesystem. */
  entry: "entry",
  /** Comma-joined ids of the known external services the file imports (`postgres,llm`), from `externalServices.ts` (deterministic). */
  externals: "externals",
  /** Comma-joined concurrency the file starts (`durable-object:ChatRoom,poller`), from `codeConcurrency.ts` (deterministic). */
  concurrency: "concurrency"
};

// ../packages/agent-tools/src/knowledge/codePatterns.ts
import { compareStr as compareStr2, GOD_MODULE_LIMITS } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/codeRoutes.ts
var METHODS = "get|post|put|patch|delete|options|head|all";
var ROUTER_FILE = new RegExp(
  String.raw`\bfrom\s*['"](?:hono(?:/[^'"]*)?|@hono/[^'"]*|express|fastify|koa-router|@koa/router|[^'"]*/router(?:\.js)?)['"]` + String.raw`|\brequire\s*\(\s*['"](?:express|hono)['"]\s*\)|\bnew\s+Hono\b|\bexpress\.Router\s*\(|\bRouter\s*\(\s*\)`
);
var REGISTRATION = new RegExp(String.raw`([A-Za-z_$][\w$]*)\s*\.\s*(${METHODS}|route)\s*\(\s*(['"` + "`" + String.raw`])(/[^'"` + "`" + String.raw`]*)\3\s*(,)?`, "g");
var NEXT_WITH_PATH = new RegExp(String.raw`\s*\.\s*(${METHODS})\s*\(\s*(['"` + "`" + String.raw`])(/[^'"` + "`" + String.raw`]*)\2\s*,`, "y");
var NEXT_ANY = new RegExp(String.raw`\s*\.\s*(${METHODS})\s*\(`, "y");

// ../packages/agent-tools/src/knowledge/codeFindings.ts
import { knowledgeFacts, runKnowledgeRules } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/rules/unusedDependency.ts
import { defineRule } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/rules/unusedItems.ts
import { compareStr as compareStr3, finding, refAnchor } from "@seanhogg/builderforce-memory/knowledge";
var codeFiles = (g) => g.nodes.filter((n) => n.pack === CODE_PACK_ID && n.kind === "file").sort((a, b) => compareStr3(a.ref, b.ref));
var namesOf = (n, badge) => [...new Set(String(n.badges?.[badge] ?? "").split(",").filter(Boolean))].sort(compareStr3);
function itemFindings(n, item) {
  const ref = n.ref;
  const names = namesOf(n, item.names);
  if (names.length === 0) {
    const count2 = Number(n.badges?.[item.count] ?? 0) || 0;
    return count2 > 0 ? [finding(item.kind, CODE_PACK_ID, [ref], "info", { count: count2, files: 1 }, void 0, refAnchor(ref))] : [];
  }
  return names.map((name) => {
    const anchor = `${ref}#${name}`;
    return finding(item.kind, CODE_PACK_ID, [ref], "info", { count: 1, files: 1, name }, [anchor], { anchor, anchorKind: item.anchorKind });
  });
}

// ../packages/agent-tools/src/knowledge/rules/unusedDependency.ts
var ITEM = { kind: "unused-dependency", names: CODE_BADGES.unusedDependencyNames, count: CODE_BADGES.unusedDependencies, anchorKind: "package" };
var unusedDependencyRule = defineRule({
  id: "code.unused-dependency",
  version: 1,
  reads: [],
  // the knowledge graph only
  scope: "global",
  extraInputs: ["knowledge"],
  derive: ({ extra: { knowledge: k } }) => codeFiles(k.graph).flatMap((n) => itemFindings(n, ITEM))
});

// ../packages/agent-tools/src/knowledge/rules/unusedExport.ts
import { defineRule as defineRule2 } from "@seanhogg/builderforce-memory/knowledge";
var ITEM2 = { kind: "unused-export", names: CODE_BADGES.unusedExportNames, count: CODE_BADGES.unusedExports, anchorKind: "symbol" };
var unusedExportRule = defineRule2({
  id: "code.unused-export",
  version: 1,
  reads: [],
  // the knowledge graph only
  scope: "global",
  extraInputs: ["knowledge"],
  derive: ({ extra: { knowledge: k } }) => codeFiles(k.graph).flatMap((n) => itemFindings(n, ITEM2))
});

// ../packages/agent-tools/src/knowledge/rules/unusedFile.ts
import { defineRule as defineRule3, finding as finding2, refAnchor as refAnchor2 } from "@seanhogg/builderforce-memory/knowledge";
var unusedFileRule = defineRule3({
  id: "code.unused-file",
  version: 1,
  reads: [],
  // the knowledge graph only
  scope: "global",
  extraInputs: ["knowledge"],
  derive: ({ extra: { knowledge: k } }) => codeFiles(k.graph).filter((n) => n.badges?.[CODE_BADGES.unused] === "file").map((n) => finding2("unused-file", CODE_PACK_ID, [n.ref], "info", { count: 1, files: 1 }, void 0, refAnchor2(n.ref)))
});

// ../packages/agent-tools/src/knowledge/codeFindings.ts
var CODE_FACT_RULES = Object.freeze([unusedFileRule, unusedExportRule, unusedDependencyRule]);

// ../packages/agent-tools/src/knowledge/codeRollup.ts
import { compareStr as compareStr4, isSymbolEdgeKind as isSymbolEdgeKind2, srcRef as srcRef2 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/moduleAliases.ts
import { resolveRelativePath } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/rootId.ts
import { sha256Hex, splitSourceRef } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/deploy/deployParser.ts
import { compareStr as compareStr6 } from "@seanhogg/builderforce-memory/knowledge";
import { CONTENT_HASH_FIELD, hashText as hashText3 } from "@seanhogg/builderforce-memory/ingest";

// ../packages/agent-tools/src/knowledge/deploy/deployNodes.ts
import { compareStr as compareStr5, srcRef as srcRef3 } from "@seanhogg/builderforce-memory/knowledge";
var DEPLOY_BADGES = {
  type: "type",
  unitKind: "unitKind",
  runtime: "runtime",
  /** Comma-joined port numbers. */
  ports: "ports",
  /** Comma-joined env var NAMES (capped at 40). */
  env: "env",
  /** `;`-joined schedules. */
  cron: "cron",
  /** Comma-joined root-relative folders / files it builds from ('.' = the root). */
  source: "source",
  /** Comma-joined `kind:name` of its bindings. */
  bindings: "bindings",
  /** Comma-joined queue names it sends to / consumes. */
  produces: "produces",
  consumes: "consumes",
  externals: CODE_BADGES.externals,
  /** Binding nodes: what kind of resource it is. */
  bindingKind: "bindingKind",
  /** The descriptor's file node: its family (`wrangler`, `compose`, …) and how many units it declares. */
  deploy: "deploy",
  units: "units",
  /** A package.json's `workspaces` globs, comma-joined. */
  workspaces: "workspaces"
};
var UNIT_PREFIX = `ent:${CODE_PACK_ID}:unit:`;
var BINDING_PREFIX = `ent:${CODE_PACK_ID}:binding:`;

// ../packages/agent-tools/src/knowledge/deploy/parseDescriptor.ts
var MAX_DESCRIPTOR_CHARS = 256 * 1024;

// ../packages/agent-tools/src/knowledge/codeLayers.ts
import { compareStr as compareStr7, matchGlob as matchGlob2 } from "@seanhogg/builderforce-memory/knowledge";
var FOLDER_LAYERS = {
  presentation: ["routes", "components", "app", "pages", "webview", "views", "hooks", "handlers", "controllers", "ui"],
  application: ["application", "use-cases", "usecases", "services", "lib", "clients", "commands", "queries"],
  domain: ["domain", "models", "entities", "types"],
  infrastructure: ["infrastructure", "db", "adapters", "repositories", "providers", "storage", "persistence", "migrations"]
};
var NOT_AT_TOP_LEVEL = /* @__PURE__ */ new Set(["clients"]);
var NAME_RULES = [
  { layer: "presentation", globs: ["*.tsx", "*.jsx", "*.vue", "*.svelte"], beatsFolder: true },
  { layer: "infrastructure", globs: ["*Repository.*", "*Adapter.*", "*Provider.*", "*Storage.*", "*Gateway.*", "*Dao.*"] },
  { layer: "domain", globs: ["*.types.*", "*.model.*", "*.entity.*", "*Model.*", "*Entity.*", "*Types.*", "types.*", "models.*", "entities.*"] },
  { layer: "application", globs: ["*Service.*", "*UseCase.*", "*Client.*", "*Command.*", "*Query.*", "*Manager.*"] },
  { layer: "presentation", globs: ["use*.*"], guard: /^use[A-Z]/ },
  { layer: "presentation", globs: ["*Route.*", "*Routes.*", "*Handler.*", "*Controller.*", "*Page.*", "*View.*", "*.route.*"] }
];
var ALLOW = {
  presentation: ["application", "domain"],
  application: ["domain"],
  domain: [],
  infrastructure: ["domain", "application"]
};
var TABLE_LAYERS = Object.keys(FOLDER_LAYERS);
function defaultLayerRegistry() {
  return {
    layerSet: "default",
    partitions: TABLE_LAYERS.map((id, order) => ({
      id,
      order,
      match: [
        ...FOLDER_LAYERS[id].map((seg) => NOT_AT_TOP_LEVEL.has(seg) ? `**/*/${seg}/**` : `**/${seg}/**`),
        ...NAME_RULES.filter((r) => r.layer === id && !r.guard).flatMap((r) => r.globs.map((g) => `**/${g}`))
      ]
    })),
    allow: { ...ALLOW }
  };
}
var CODE_LAYERS = defaultLayerRegistry();

// ../packages/agent-tools/src/knowledge/knowledgePacks.ts
import { DOCS_PACK as DOCS_PACK2 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/documents/documentsPack.ts
import { DOCS_PACK } from "@seanhogg/builderforce-memory/knowledge";
import { plainTextParser } from "@seanhogg/builderforce-memory/ingest";
var DOCUMENTS_PACK_ID = "documents";
var documentsParser = {
  ...plainTextParser,
  id: "documents",
  accepts: (source) => source.content.kind === "text" && isExtractableDocumentType(source.content.mediaType ?? "")
};
var DOCUMENTS_PACK = {
  id: DOCUMENTS_PACK_ID,
  parsers: [documentsParser],
  ...DOCS_PACK.judgement ? { judgement: DOCS_PACK.judgement } : {}
};

// ../packages/agent-tools/src/knowledge/codeExtracted.ts
import { CLONE_GROUP_BADGE, compareStr as compareStr9, srcRef as srcRef4 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/facts/fileFactsOf.ts
import { canonicalFileFacts, canonicalJson as canonicalJson2, FACTS_EXTRACTOR_VERSION } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/facts/factsAst.ts
import { sha256Hex as sha256Hex2 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/reviewRunner.ts
import {
  DEFAULT_REVIEW_MODEL_CALLS,
  planDetail,
  reviewDirectory as reviewDirectory2,
  srcRef as srcRef8
} from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/codeGraph.ts
import {
  buildGraph
} from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/deploy/deployGraph.ts
import { compareStr as compareStr10, srcRef as srcRef5 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/codeRootSignals.ts
import {
  canonicalJson as canonicalJson3,
  coChangePartners,
  compareStr as compareStr11,
  decodeCoChange,
  encodeCoChange,
  srcRef as srcRef6
} from "@seanhogg/builderforce-memory/knowledge";
import { hashText as hashText5 } from "@seanhogg/builderforce-memory/ingest";

// ../packages/agent-tools/src/knowledge/codeCoverage.ts
var MAX_FILE_BYTES = 40 * 1024 * 1024;

// ../packages/agent-tools/src/knowledge/codeOwners.ts
import { matchGlob as matchGlob3 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/historyPort.ts
import { COCHANGE_MAX_COMMITS } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/fileEdits.ts
import {
  composePacks,
  contentHash as contentHash2,
  extractFile,
  filesManifestKey,
  isBinaryText,
  knownKeysOfEntities,
  putNoExtract,
  srcRef as srcRef7
} from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/workspaceAnalysis.ts
import { hashText as hashText6 } from "@seanhogg/builderforce-memory/ingest";

// ../packages/agent-tools/src/knowledge/graphIgnore.ts
import { ignoreMatcher, ignoreSourcesOf } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/workspaceAnalysis.ts
var MAX_GRAPH_FILE_BYTES = 256 * 1024;
var FAILED_RETAIN_MS = 2 * 6e4;
var cache = createShaCache({
  keep: (held) => held.retainMs === 0 ? false : held.retainMs ?? true
});

// ../packages/agent-tools/src/knowledge/reviewJudgePass.ts
import {
  orderForJudging,
  pathOfRef,
  refreshPlan,
  reviewDirectory
} from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/judgement.ts
import {
  validateCompare,
  validateExtract
} from "@seanhogg/builderforce-memory/knowledge";
var MAX_JUDGE_TEXT = 8e3;
var KNOWLEDGE_EXTRACT_SYSTEM = [
  "You read one section of a document and list what it asserts.",
  'Reply with JSON only: {"extract":[{"ref":<the ref given>,"claims":[{"subject","predicate","object","quote"}],"entities":[{"name","type"}]}]}.',
  'A claim is one factual assertion the text makes. "quote" is the supporting text, at most 3 lines, copied verbatim.',
  "Entities are the named things the section is about (people, organisations, systems, documents, terms).",
  "Return empty arrays when the section asserts nothing."
].join("\n");
var KNOWLEDGE_COMPARE_SYSTEM = [
  "You compare two claims.",
  'Reply with JSON only: {"compare":[{"a":<ref a>,"b":<ref b>,"relation":"contradicts"|"agrees"|"unrelated","confidence":<0..1>}]}.'
].join("\n");
async function judgeWith(ask, req) {
  if (req.kind === "compare") {
    const [a, b] = req.items;
    if (!a || !b) return { compare: [], invalid: 1 };
    const out = await ask(KNOWLEDGE_COMPARE_SYSTEM, {
      a: { ref: a.ref, claim: a.text.slice(0, MAX_JUDGE_TEXT) },
      b: { ref: b.ref, claim: b.text.slice(0, MAX_JUDGE_TEXT) }
    });
    const v = validateCompare(out, a.ref, b.ref);
    return {
      compare: v.relation ? [{ a: a.ref, b: b.ref, relation: v.relation, confidence: v.confidence }] : [],
      invalid: v.invalid
    };
  }
  const result = { extract: [], invalid: 0 };
  for (const item of req.items) {
    const out = await ask(KNOWLEDGE_EXTRACT_SYSTEM, { ref: item.ref, text: item.text.slice(0, MAX_JUDGE_TEXT) });
    const v = validateExtract(out, item.ref);
    result.invalid += v.invalid;
    result.extract.push({ ref: item.ref, claims: v.claims, entities: v.entities });
  }
  return result;
}

// ../packages/agent-tools/src/knowledge/measuredWith.ts
import {
  comparable,
  EXTRACTOR_VERSION
} from "@seanhogg/builderforce-memory/knowledge";
var TYPESCRIPT_VERSION = TYPESCRIPT_PIN.slice(TYPESCRIPT_PIN.lastIndexOf("@") + 1);

// ../packages/agent-tools/src/knowledge/humanFact.ts
import {
  factRef,
  pathOfRef as pathOfRef2,
  sha256Hex as sha256Hex3
} from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/documents/documentDoc.ts
import { isDocumentPath as isDocumentPath2, mediaTypeOfPath as mediaTypeOfPath3 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/index/persistence.ts
import { loadKnowledgeIndex, sha256Hex as sha256Hex4 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/replicaQueue.ts
import { splitSourceRef as splitSourceRef2 } from "@seanhogg/builderforce-memory/knowledge";
import { factLeafKey, fileLeafKey, relationLeafKey } from "@seanhogg/builderforce-memory/knowledge/pack";

// ../packages/agent-tools/src/knowledge/replicatedStore.ts
import { factDigest, relationDigest } from "@seanhogg/builderforce-memory/knowledge/pack";

// ../packages/agent-tools/src/knowledge/replicaPump.ts
import { MAX_PART_BYTES, splitParts } from "@seanhogg/builderforce-memory/knowledge/pack";

// ../packages/agent-tools/src/knowledge/replicaPack.ts
import { srcRef as srcRef9 } from "@seanhogg/builderforce-memory/knowledge";
import {
  bucketOf,
  diffEntries,
  encodePack,
  jsonBytesOf,
  parseRelationLeafKey,
  rootLeaves,
  ZERO_DIGEST,
  fileLeafKey as fileLeafKey2
} from "@seanhogg/builderforce-memory/knowledge/pack";
var DEFAULT_MAX_DECODED = 16 * 1024 * 1024;
var EMPTY_PACK = { rootId: "", baseGeneration: 0, targetDigest: ZERO_DIGEST };
var EMPTY_EXTRACTED_BYTES = jsonBytesOf({ ...EMPTY_PACK, extracted: [] });

// ../packages/agent-tools/src/knowledge/replicaGenerationCheck.ts
var GENERATION_CHECK_INTERVAL_MS = 10 * 6e4;

// ../packages/agent-tools/src/knowledge/replicaReconcile.ts
import { differingBuckets, leafDelta, manifestTree, rootLeaves as rootLeaves2 } from "@seanhogg/builderforce-memory/knowledge/pack";
var EMPTY_ROOT = manifestTree([]).root;

// ../packages/agent-tools/src/knowledge/replicaPump.ts
var MAX_ANALYSIS_BYTES = 2 * 1024 * 1024;
var MAX_SYNC_PACK_BYTES = 24 * 1024 * 1024;

// ../packages/agent-tools/src/knowledge/replicaFirstSync.ts
import { filesManifestKey as filesManifestKey2, srcRef as srcRef10 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/claimSimilarity.ts
import { factKeyOf } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/portablePack.ts
import {
  canonicalJson as canonicalJson4,
  compareStr as compareStr12,
  factRef as factRef2,
  pathOfRef as pathOfRef3
} from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/packGraph.ts
import {
  compareStr as compareStr13,
  filesManifestKey as filesManifestKey3,
  localSnapshotStore,
  toCards
} from "@seanhogg/builderforce-memory/knowledge";
import { InMemoryIngestManifest } from "@seanhogg/builderforce-memory/ingest";

// ../packages/agent-tools/src/knowledge/codeGraphFindings.ts
import { partitionOf } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/knowledge/pinpointMatch.ts
import { srcRef as srcRef11 } from "@seanhogg/builderforce-memory/knowledge";
var MAX_PINPOINT_IMAGE_BYTES = 8 * 1024 * 1024;
var MAX_DATA_URL_CHARS = Math.ceil(MAX_PINPOINT_IMAGE_BYTES * 4 / 3) + 64;
var PINPOINT_VISION_SYSTEM = [
  "You read a screenshot of a software product.",
  'Reply with JSON only: {"description": one line saying what the screen shows and, if it looks stuck or broken, how,',
  '"texts": the exact visible strings (labels, headings, buttons, status text, error messages), at most 12, verbatim}.'
].join(" ");

// ../packages/agent-tools/src/knowledge/replicaLock.ts
var LOCK_REFRESH_MS = 3e4;
var LOCK_STALE_MS = 12e4;
var LOCK_FRESH_MS = LOCK_STALE_MS - LOCK_REFRESH_MS;

// ../packages/agent-tools/src/toolSearch.ts
var STOP_WORDS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "is",
  "are",
  "was",
  "be",
  "by",
  "with",
  "from",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "as",
  "at",
  "me",
  "my",
  "i",
  "we",
  "you",
  "your",
  "please",
  "can",
  "could",
  "would",
  "should",
  "do",
  "does",
  "did",
  "get",
  "show",
  "give",
  "make",
  "now",
  "all",
  "any",
  "how",
  "what",
  "which",
  "who",
  "when"
]);
function lexicalTokens(text) {
  return text.toLowerCase().split(/[^a-z0-9一-鿿]+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}
function lexicalStem(word) {
  if (word.length > 3 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}
function lexicalStems(text) {
  return new Set(lexicalTokens(text).map(lexicalStem));
}
var LEXICAL_WEIGHTS = { name: 10, description: 1, body: 0.25 };
function lexicalScore(queryStems, fields) {
  let score2 = 0;
  for (const field2 of fields) {
    for (const s of lexicalStems(field2.text)) if (queryStems.has(s)) score2 += field2.weight;
  }
  return score2;
}
function rankLexically(items, query, fieldsOf, limit) {
  const queryStems = lexicalStems(query);
  if (queryStems.size === 0 || limit <= 0) return [];
  return items.map((item, index) => ({ item, index, score: lexicalScore(queryStems, fieldsOf(item)) })).filter((e) => e.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map((e) => e.item);
}
function toolSchemaFields(tool) {
  return [
    { text: tool.function.name.replace(/^builtin_/, ""), weight: LEXICAL_WEIGHTS.name },
    { text: tool.function.description ?? "", weight: LEXICAL_WEIGHTS.description }
  ];
}
function searchToolSchemas(catalog, query, limit) {
  return rankLexically(catalog, query, toolSchemaFields, limit);
}
var TOOL_SEARCH_TOOL = "tool_search";
var TOOL_SEARCH_SCHEMA = {
  type: "function",
  function: {
    name: TOOL_SEARCH_TOOL,
    description: "Only a core set of tools is loaded. When you need a capability that is not in your tool list (project tasks, OKRs, specs, incidents, knowledge base, marketing, executions, \u2026) call this with a few keywords. Returns the best-matching tools with their full schemas; they stay callable for the rest of the run.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: 'Keywords for the capability, e.g. "create task" or "update key result".' },
        limit: { type: "number", description: "Max tools to return (default 8, max 15)." }
      },
      required: ["query"]
    }
  }
};

// ../packages/agent-tools/src/delta/adapters/dependencyCruiser.ts
import { hashText as hashText7 } from "@seanhogg/builderforce-memory/ingest";
import { composeAnchor } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/delta/adapters/gitleaks.ts
import { composeAnchor as composeAnchor2 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/delta/adapters/jscpd.ts
import { anchorWithSnippet, composeAnchor as composeAnchor3 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/delta/adapters/knip.ts
import { identityOfIssue, normalizeAnalysis as normalizeAnalysis2 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/delta/adapters/osv.ts
import { composeAnchor as composeAnchor4 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/agent-tools/src/delta/adapters/sarifTools.ts
import { anchorWithSnippet as anchorWithSnippet2, composeAnchor as composeAnchor5 } from "@seanhogg/builderforce-memory/knowledge";

// ../packages/sarif/src/emit.ts
var SARIF_BASELINE_STATES = ["new", "unchanged", "updated", "absent"];

// ../packages/sarif/src/parse.ts
var BASELINE = new Set(SARIF_BASELINE_STATES);

// ../packages/agent-tools/src/delta/adapters/sarifTools.ts
var SEMGREP_TOOL = "semgrep";
var CODEQL_TOOL = "codeql";
var SARIF_KINDS = { [SEMGREP_TOOL]: "semgrep-finding", [CODEQL_TOOL]: "codeql-finding" };

// ../packages/agent-tools/src/delta/adapters/l3Cache.ts
import { sha256Hex as sha256Hex5 } from "@seanhogg/builderforce-memory/retrieval";

// ../packages/agent-tools/src/delta/adapters/typescript.ts
import { anchorWithSnippet as anchorWithSnippet3, composeAnchor as composeAnchor6 } from "@seanhogg/builderforce-memory/knowledge";
var TYPESCRIPT_VERSION2 = TYPESCRIPT_PIN.slice(TYPESCRIPT_PIN.lastIndexOf("@") + 1);

// ../packages/agent-tools/src/delta/dynamic/host.ts
var DYNAMIC_STEP_CAP_MS = 30 * 6e4;

// ../packages/agent-tools/src/specs/gapRegister.ts
var REGISTER_HEADING = /^##\s+Consolidated Gap Register\b/i;
var FENCE = /^\s*(```|~~~)/;
var TAG = /\[([^\]\s][^\]]*)\]/g;
var LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
var MAX_SLUG = 80;
function specSlug(text, fallback = "gap") {
  const slug = text.toLowerCase().replace(/[`*]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, MAX_SLUG).replace(/-+$/, "") || fallback;
}
function stageOf(heading) {
  const word = heading.replace(/^#+\s*/, "").match(/[A-Za-z][A-Za-z0-9]*/);
  return word ? word[0].toLowerCase() : "unknown";
}
function tagsIn(text) {
  return [...text.matchAll(TAG)].map((m) => m[1].trim()).filter(Boolean);
}
function decodeAnchor(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
function specLinksIn(text) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const m of text.matchAll(LINK)) {
    const href = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) continue;
    const hash = href.indexOf("#");
    const path = (hash >= 0 ? href.slice(0, hash) : href).replace(/^\.\//, "");
    if (!/\.md$/i.test(path)) continue;
    const anchor = hash >= 0 ? decodeAnchor(href.slice(hash + 1)) || null : null;
    const key = `${path}#${anchor ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: path, anchor });
  }
  return out;
}
function toEntry(open) {
  const bold = open.head.match(/^\*\*(.+?)\*\*(.*)$/);
  let summarySource;
  let bodyHead;
  if (bold) {
    summarySource = bold[1];
    bodyHead = bold[2];
  } else {
    const sentence = open.head.match(/^(.+?[.!?])(\s+.*)?$/);
    summarySource = sentence ? sentence[1] : open.head;
    bodyHead = sentence?.[2] ?? "";
  }
  const leadTags = [];
  let summary = summarySource.trim();
  for (let m = summary.match(/^\[([^\]]+)\]\s*/); m; m = summary.match(/^\[([^\]]+)\]\s*/)) {
    leadTags.push(m[1].trim());
    summary = summary.slice(m[0].length);
  }
  summary = summary.replace(/[\s,.;:]+$/, "").trim();
  const body = [bodyHead.trim(), ...open.rest].join("\n").trim();
  const all = `${open.head}
${open.rest.join("\n")}`;
  const blocker = all.match(/\*Blocker:\s*(.+?)\*(?=\s|$)/im);
  return {
    stage: open.stage,
    group: open.group,
    tags: [.../* @__PURE__ */ new Set([...leadTags, ...open.groupTags])],
    summary,
    body,
    blocker: blocker ? blocker[1].replace(/[.\s]+$/, "") : null,
    specLinks: specLinksIn(all),
    line: open.line
  };
}
function parseGapRegister(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => REGISTER_HEADING.test(l));
  if (start < 0) return [];
  const entries = [];
  let stage = null;
  let group2 = null;
  let groupTags = [];
  let open = null;
  let afterBlank = false;
  let inFence = false;
  const close = () => {
    if (open) entries.push(toEntry(open));
    open = null;
  };
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.test(line);
    if (fence) inFence = !inFence;
    if (fence || inFence) {
      if (open) open.rest.push(line);
      continue;
    }
    if (/^##\s/.test(line)) {
      close();
      stage = stageOf(line);
      group2 = null;
      groupTags = [];
      continue;
    }
    if (/^###\s/.test(line)) {
      close();
      const text = line.replace(/^###\s+/, "");
      groupTags = tagsIn(text.match(/`[^`]*`/g)?.join(" ") ?? "");
      group2 = text.replace(/`\[[^\]]*\]`/g, "").replace(/\s+/g, " ").trim() || null;
      continue;
    }
    if (/^#{4,}\s/.test(line) || /^(-{3,}|\*{3,})\s*$/.test(line)) {
      close();
      continue;
    }
    if (line.trim() === "") {
      afterBlank = true;
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.*)$/);
    if (bullet && stage) {
      close();
      open = { line: i + 1, head: bullet[1].trim(), rest: [], stage, group: group2, groupTags };
      afterBlank = false;
      continue;
    }
    if (open && (/^\s/.test(line) || !afterBlank)) {
      open.rest.push(line.trim());
    } else {
      close();
    }
    afterBlank = false;
  }
  close();
  const used = /* @__PURE__ */ new Map();
  return entries.filter((e) => e.summary !== "").map((e) => {
    const base = `${e.stage}/${specSlug(e.summary)}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return { id: n === 1 ? base : `${base}-${n}`, ...e };
  });
}

// ../packages/agent-tools/src/specs/nearDuplicateTitle.ts
var FILLER = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "be",
  "as",
  "at",
  "by",
  "it",
  "this",
  "that",
  "from",
  "we",
  "i",
  "our",
  "its",
  "should",
  "must",
  "need",
  "needs",
  "needed",
  "when",
  "then",
  "so",
  "but",
  "if",
  "via",
  "into",
  "onto",
  "per",
  "up",
  "out",
  "over",
  "do",
  "does",
  "not",
  "no"
]);
function stem(word) {
  const cut = (suffix, replacement = "") => {
    if (!word.endsWith(suffix) || word.length - suffix.length + replacement.length < 3) return null;
    return word.slice(0, -suffix.length) + replacement;
  };
  const stemmed = cut("ies", "y") ?? cut("ing") ?? cut("ed") ?? cut("es") ?? cut("s") ?? word;
  return /([bdfglmnprt])\1$/.test(stemmed) ? stemmed.slice(0, -1) : stemmed;
}
function titleTokens(title) {
  const words2 = (title.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 2 && !FILLER.has(w)).map(stem);
  return new Set(words2);
}
var MIN_JACCARD = 0.8;
var MIN_CONTAINED_TOKENS = 3;
var MAX_CONTAINMENT_SURPLUS = 2;
function normalizeTitle(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}
function areNearDuplicateTokens(a, b) {
  if (a.size === 0 || b.size === 0) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const token of small) if (big.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  if (union > 0 && shared / union >= MIN_JACCARD) return true;
  return shared === small.size && small.size >= MIN_CONTAINED_TOKENS && big.size - small.size <= MAX_CONTAINMENT_SURPLUS;
}

// ../packages/agent-tools/src/specs/specOpenItems.ts
var FENCE2 = /^\s*(```|~~~)/;
var HEADING = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+\s*)?$/;
var TABLE_ROW = /^\s*\|.*\|\s*$/;
var TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
var CHECKLIST = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
var MAX_BLOCKER = 300;
var ITEM_TOKEN = String.raw`(?:§\s?\d+[a-z]?(?:\.\d+[a-z]?)*|[A-Z][A-Z0-9]*-\d+[A-Za-z0-9]*(?:\.\d+)*|[A-Z]{1,3}\d+(?:\.\d+)*[a-z]?)`;
var WHOLE_TOKEN = new RegExp(`^${ITEM_TOKEN}$`);
var LEADING_TOKEN = new RegExp(`^(${ITEM_TOKEN})(?=$|[\\s:.,;)\\]*_\`\u2014\u2013]|-\\s)`);
var LONG_TOKEN = /^(?:§|[A-Z][A-Z0-9]*-\d)/;
var SEPARATED_TOKEN = new RegExp(`^${ITEM_TOKEN}[*_\`\\]]*(?=$|\\s*[:\u2014\u2013)]|\\s+-\\s|\\.(?:\\s|$))`);
function isSpecItemToken(id) {
  return WHOLE_TOKEN.test(id.trim());
}
function plain(text) {
  return text.replace(/\*\*|__|~~/g, "").replace(/\s+/g, " ").trim();
}
function leadingToken(text, separated = false) {
  const head = text.replace(/^[\s*_`~[(]+/, "");
  const m = head.match(LEADING_TOKEN);
  if (!m) return null;
  if (separated && !LONG_TOKEN.test(m[1]) && !SEPARATED_TOKEN.test(head)) return null;
  return m[1].replace(/\s+/g, "");
}
var NEGATED_BLOCKED = /\b(?:no longer blocked|not blocked|unblocked)\b/gi;
var LEADING_STATUS = [
  [/^(?:no longer blocked|not blocked|unblocked)\b/i, "incomplete"],
  [/^(?:[🚫⛔]|blocked\b)/iu, "blocked"],
  [/^(?:[❌✗✖⬜🔲🟡🟠⚠⏳🚧]|(?:incomplete|not (?:started|done|ported|complete|completed|implemented|shipped|yet)|partial(?:ly)?|in[ -]progress|wip|to ?do|open|remaining|pending|missing|planned|outstanding)\b)/iu, "incomplete"],
  [/^(?:[✅✔☑🟢]|(?:complete|completed|done|shipped|resolved|closed|finished|verified)\b)/iu, "complete"]
];
function mentionsBlocked(text) {
  const affirmed = text.replace(NEGATED_BLOCKED, " ");
  return /[🚫⛔]/u.test(affirmed) || /\bblocked\b/i.test(affirmed);
}
function blockerAfter(text) {
  const affirmed = text.replace(NEGATED_BLOCKED, " ");
  const at2 = affirmed.search(/[🚫⛔]|\bblocked\b/iu);
  const rest = at2 < 0 ? affirmed : affirmed.slice(at2);
  return rest.replace(/^(?:[🚫⛔]️?\s*)?(?:blocked\b)?\s*(?:[—–:-]|on\b|by\b)?\s*/iu, "").trim();
}
function blockedStatus(text) {
  const rest = blockerAfter(text);
  return rest ? { status: "blocked", blocker: rest.slice(0, MAX_BLOCKER) } : { status: "blocked" };
}
function classifySpecStatus(raw) {
  const text = plain(raw);
  const head = text.replace(/^[\s*_`~[(]+/, "");
  const leading = LEADING_STATUS.find(([pattern]) => pattern.test(head));
  if (leading) return leading[1] === "blocked" ? blockedStatus(head) : { status: leading[1] };
  if (mentionsBlocked(text)) return blockedStatus(text);
  if (/[❌✗✖⬜🔲🟡🟠⚠⏳🚧]/u.test(text)) return { status: "incomplete" };
  if (/\b(incomplete|not started|not done|not ported|to ?do|open|partial(ly)?|in[ -]progress|wip|pending|missing|planned|outstanding|remaining)\b/i.test(text)) return { status: "incomplete" };
  if (/[✅✔☑🟢]/u.test(text) || /\b(complete|completed|done|shipped|resolved|closed|finished|verified)\b/i.test(text)) return { status: "complete" };
  return { status: "unknown" };
}
function statedBlocker(text) {
  const m = plain(text).match(/\bBlocker\b(?:\s*\([^)]*\))?\s*:\s*(.+?)\*?$/i);
  return m ? m[1].trim().slice(0, MAX_BLOCKER) : null;
}
function cellsOf(row) {
  const body = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return body.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}
function statusTableColumns(header) {
  const names = header.map((h) => plain(h).replace(/`/g, "").toLowerCase());
  const status = names.findIndex((n) => /\b(status|state)\b/.test(n));
  if (status < 0) return null;
  const id = names.findIndex((n, i) => i !== status && /^(id|#|ref|key|no\.?|item id|row)$/.test(n));
  const title = names.findIndex((n, i) => i !== status && i !== id && /\b(feature|task|item|title|name|requirement|work|deliverable|gap|description|summary|capability)\b/.test(n));
  if (id < 0 && title < 0) return null;
  return { id, title, status };
}
function parseSpecOpenItems(markdown) {
  const lines = markdown.split(/\r?\n/);
  const raw = [];
  const gapLines = /* @__PURE__ */ new Set();
  for (const gap of parseGapRegister(markdown)) {
    gapLines.add(gap.line);
    raw.push({
      token: leadingToken(gap.summary, true) ?? gap.id,
      title: gap.summary,
      status: "incomplete",
      section: [gap.stage, gap.group].filter(Boolean).join(" \u203A "),
      line: gap.line,
      ...gap.blocker ? { blocker: gap.blocker } : {}
    });
  }
  let section = "";
  let inFence = false;
  let inGap = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE2.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(HEADING);
    if (heading) {
      section = plain(heading[1]).replace(/`/g, "");
      inGap = false;
      continue;
    }
    if (gapLines.has(i + 1)) {
      inGap = true;
      continue;
    }
    if (/^\S/.test(line)) inGap = false;
    if (TABLE_ROW.test(line) && TABLE_SEPARATOR.test(lines[i + 1] ?? "")) {
      const columns = statusTableColumns(cellsOf(line));
      let j = i + 2;
      for (; j < lines.length && TABLE_ROW.test(lines[j]); j++) {
        if (!columns) continue;
        const cells = cellsOf(lines[j]);
        if (cells.every((c) => c === "")) continue;
        const idCell = columns.id >= 0 ? plain(cells[columns.id] ?? "").replace(/`/g, "") : "";
        const titleCell = plain(cells[columns.title >= 0 ? columns.title : columns.id] ?? "");
        const title = titleCell || idCell;
        if (!title) continue;
        const { status, blocker } = classifySpecStatus(cells[columns.status] ?? "");
        const stated = cells.map(statedBlocker).find((b) => b != null) ?? null;
        const token = columns.id >= 0 ? leadingToken(idCell) ?? (idCell && idCell.length <= 40 && !/\s/.test(idCell) ? idCell : null) : leadingToken(titleCell);
        const why = stated ?? blocker;
        raw.push({ token, title, status, section, line: j + 1, ...why && status === "blocked" ? { blocker: why } : {} });
      }
      i = j - 1;
      continue;
    }
    const check = line.match(CHECKLIST);
    if (check && !inGap) {
      const text = plain(check[2]);
      const stated = statedBlocker(text);
      const done = check[1].toLowerCase() === "x";
      const blocked = !done && (stated != null || mentionsBlocked(text));
      raw.push({
        token: leadingToken(text, true),
        title: text,
        status: done ? "complete" : blocked ? "blocked" : "incomplete",
        section,
        line: i + 1,
        ...blocked && stated ? { blocker: stated } : {}
      });
    }
  }
  raw.sort((a, b) => a.line - b.line);
  const out = [];
  const byToken = /* @__PURE__ */ new Map();
  const usedSlugs = /* @__PURE__ */ new Map();
  for (const { token, ...item } of raw) {
    if (token) {
      const first = byToken.get(token);
      if (first) mergeRepeat(first, item);
      else {
        const entry = { id: token, ...item };
        byToken.set(token, entry);
        out.push(entry);
      }
      continue;
    }
    const base = specSlug(item.title, "item");
    const n = (usedSlugs.get(base) ?? 0) + 1;
    usedSlugs.set(base, n);
    out.push({ id: n === 1 ? base : `${base}-${n}`, ...item });
  }
  return out;
}
var OPENNESS = { blocked: 3, incomplete: 2, unknown: 1, complete: 0 };
function mergeRepeat(first, repeat) {
  if (OPENNESS[repeat.status] > OPENNESS[first.status]) first.status = repeat.status;
  if (repeat.title.length > first.title.length) first.title = repeat.title;
  if (!first.blocker && repeat.blocker) first.blocker = repeat.blocker;
}
function specItemsOwingTickets(items) {
  return items.filter((i) => i.status === "incomplete" || i.status === "blocked");
}

// ../packages/agent-tools/src/specs/ticketCoverage.ts
var DEAD_STATUSES = /* @__PURE__ */ new Set(["cancelled", "canceled", "archived", "deleted", "wont_do", "won't do", "duplicate"]);
var CODE_CHANGE_TITLE = /^code change \(\d+ files?\)(?: from .+)?$/i;
function codeChangeTicketTitle(fileCount, source) {
  const base = `Code change (${fileCount} file${fileCount === 1 ? "" : "s"})`;
  return source ? `${base} from ${source}` : base;
}
function isCodeChangeBackstopTitle(title) {
  return CODE_CHANGE_TITLE.test(title.trim());
}
var escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function isMatchableSpecItemId(id) {
  return isSpecItemToken(id) || /^[a-z]+\/[a-z0-9-]+$/.test(id);
}
var SHORT_TOKEN = /^[A-Z]{1,3}\d+(?:\.\d+)*[a-z]?$/;
function idPattern(id) {
  return new RegExp(`(?<![A-Za-z0-9\xA7/.-])${escapeRegExp(id)}(?![A-Za-z0-9]|[.-][A-Za-z0-9])`, SHORT_TOKEN.test(id) ? "" : "i");
}
function specTicketCoverage(openItems, tickets) {
  const live2 = tickets.filter((t) => !t.isBackstop && !isCodeChangeBackstopTitle(t.title) && !DEAD_STATUSES.has(t.status.trim().toLowerCase())).map((t) => ({ id: t.id, text: `${t.title}
${t.description ?? ""}`, normalized: normalizeTitle(t.title), tokens: titleTokens(t.title) }));
  const covered = [];
  const missing = [];
  for (const item of specItemsOwingTickets(openItems)) {
    const byId = isMatchableSpecItemId(item.id) ? idPattern(item.id) : null;
    const normalized = normalizeTitle(item.title);
    const tokens = titleTokens(item.title);
    const ticketIds = [...new Set(live2.filter((t) => byId?.test(t.text) || t.normalized === normalized || areNearDuplicateTokens(tokens, t.tokens)).map((t) => t.id))];
    if (ticketIds.length) covered.push({ itemId: item.id, ticketIds });
    else missing.push(item);
  }
  return { covered, missing };
}

// ../packages/run-guards/src/readOnlyShell.ts
var READ_ONLY_PROGRAMS = /* @__PURE__ */ new Set([
  "cat",
  "head",
  "tail",
  "wc",
  "ls",
  "dir",
  "pwd",
  "echo",
  "printf",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "tree",
  "stat",
  "file",
  "du",
  "df",
  "which",
  "where",
  "type",
  "sort",
  "uniq",
  "cut",
  "tr",
  "jq",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "date",
  "true",
  "false",
  "test",
  "[",
  "diff",
  "cmp",
  "comm",
  "nl",
  "column",
  "less",
  "more",
  "sed",
  "cd",
  "read",
  "whoami",
  "hostname",
  "uname",
  "node",
  "npm",
  "pnpm",
  "yarn",
  "python",
  "python3"
]);
var INFO_ONLY_PROGRAMS = /* @__PURE__ */ new Set(["node", "npm", "pnpm", "yarn", "python", "python3"]);
var INFO_FLAGS = /* @__PURE__ */ new Set(["--version", "-v", "-V", "version", "--help", "-h"]);
var READ_ONLY_GIT = /* @__PURE__ */ new Set([
  "status",
  "log",
  "show",
  "diff",
  "rev-list",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "ls-remote",
  "cat-file",
  "merge-base",
  "for-each-ref",
  "describe",
  "blame",
  "shortlog",
  "grep",
  "name-rev",
  "count-objects",
  "whatchanged",
  "cherry",
  "show-ref",
  "show-branch",
  "range-diff",
  "var",
  "check-ignore",
  "check-attr"
]);
function substitutions(segment) {
  const out = [];
  let i = segment.indexOf("$(");
  while (i >= 0) {
    let depth = 1;
    let j = i + 2;
    for (; j < segment.length && depth > 0; j += 1) {
      if (segment[j] === "(") depth += 1;
      else if (segment[j] === ")") depth -= 1;
    }
    out.push(segment.slice(i + 2, j - 1));
    i = segment.indexOf("$(", j);
  }
  return out;
}
function writesViaRedirect(segment) {
  const unquoted = segment.replace(/"[^"]*"|'[^']*'/g, '""');
  const re = /(\d*)>>?\s*(&\d+|\S+)?/g;
  let m = re.exec(unquoted);
  while (m) {
    const target = m[2] ?? "";
    if (!/^(&\d+|\/dev\/null|nul|NUL|\$null)$/.test(target)) return true;
    m = re.exec(unquoted);
  }
  return false;
}
function gitIsReadOnly(args) {
  const { sub, rest } = gitSubcommand(args);
  if (!sub) return true;
  if (READ_ONLY_GIT.has(sub)) return true;
  const flags = new Set(rest.filter((a) => a.startsWith("-")));
  const positional = rest.filter((a) => !a.startsWith("-"));
  switch (sub) {
    case "branch": {
      const writes = ["-d", "-D", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy", "-f", "--force", "-u", "--set-upstream-to", "--unset-upstream", "--edit-description"];
      if (writes.some((f) => flags.has(f) || [...flags].some((x) => x.startsWith(`${f}=`)))) return false;
      if (flags.has("--list") || flags.has("-l")) return true;
      const valued = /* @__PURE__ */ new Set(["--format", "--sort", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at"]);
      for (let k = 0; k < rest.length; k += 1) {
        const word = rest[k] ?? "";
        if (word.startsWith("-")) {
          if (valued.has(word)) k += 1;
          continue;
        }
        return false;
      }
      return true;
    }
    case "tag":
      return positional.length === 0 || flags.has("-l") || flags.has("--list");
    case "remote":
      return positional.length === 0 || ["show", "get-url"].includes(positional[0] ?? "");
    case "stash":
    case "notes":
    case "worktree":
      return ["list", "show"].includes(positional[0] ?? "");
    case "reflog":
      return positional.length === 0 || positional[0] === "show";
    case "config":
      return ["--get", "--get-all", "--get-regexp", "--list", "-l"].some((f) => flags.has(f));
    case "symbolic-ref":
      return positional.length <= 1 && !flags.has("-d") && !flags.has("--delete");
    default:
      return false;
  }
}
function segmentIsReadOnly(segment, depth) {
  if (depth > 4) return false;
  for (const body of substitutions(segment)) {
    if (!commandIsReadOnly(body, depth + 1)) return false;
  }
  const flat = segment.replace(/\$\((?:[^()]|\([^()]*\))*\)/g, "X");
  if (writesViaRedirect(flat)) return false;
  const [program, ...args] = commandWords(shellTokens(flat));
  if (program === void 0) return true;
  if (program === "for" || program === "case") return true;
  if (program === "git") return gitIsReadOnly(args);
  if (!READ_ONLY_PROGRAMS.has(program)) return false;
  if (INFO_ONLY_PROGRAMS.has(program)) return args.length > 0 && args.every((a) => INFO_FLAGS.has(a));
  if (program === "sed") return !args.some((a) => a === "-i" || a.startsWith("-i") || a === "--in-place" || a.startsWith("--in-place="));
  if (program === "find") return !args.some((a) => ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fls"].includes(a));
  if (program === "sort") return !args.some((a) => a === "-o" || a.startsWith("--output"));
  return true;
}
function commandIsReadOnly(command, depth) {
  if (/`/.test(command)) return false;
  const segments = splitShellSegments(command);
  if (!segments || segments.length === 0) return false;
  return segments.every((s) => segmentIsReadOnly(s, depth));
}
function isReadOnlyShellCommand(command) {
  const trimmed = command.trim();
  if (!trimmed) return false;
  return commandIsReadOnly(trimmed, 0);
}
function isReadOnlyShellCall(tool, args) {
  if (tool !== "run_command" || !args || typeof args !== "object") return false;
  const record5 = args;
  const command = typeof record5.command === "string" ? record5.command : typeof record5.cmd === "string" ? record5.cmd : "";
  return isReadOnlyShellCommand(command);
}

// ../packages/run-guards/src/visitTally.ts
var REVISIT_NUDGE_AT = 3;
var REVISIT_HARD_AT = 5;
var MAX_REMEMBERED_ARGS = 8;
var VisitTally = class {
  visits;
  constructor(state) {
    this.visits = new Map((state ?? []).map(([k, v]) => [k, { ...v, priorArgs: [...v.priorArgs] }]));
  }
  /**
   * Record one visit to `key` made with `args`. Returns a SNAPSHOT of the resulting
   * visit, so the caller cannot hold — or reset — the live tally. The "something ran
   * that could have changed this" pass is spent by the read it excuses.
   */
  record(key, args) {
    let argText;
    try {
      argText = JSON.stringify(args ?? {});
    } catch {
      argText = String(args ?? "");
    }
    const existing = this.visits.get(key);
    if (!existing) {
      const fresh = { count: 1, priorArgs: [argText], mayHaveChanged: false };
      this.visits.set(key, fresh);
      return { ...fresh, priorArgs: [...fresh.priorArgs] };
    }
    existing.count += 1;
    if (!existing.priorArgs.includes(argText) && existing.priorArgs.length < MAX_REMEMBERED_ARGS) {
      existing.priorArgs.push(argText);
    }
    const visit = { ...existing, priorArgs: [...existing.priorArgs] };
    existing.mayHaveChanged = false;
    return visit;
  }
  /** Forget every visit whose key matches. */
  forget(match) {
    for (const key of [...this.visits.keys()]) if (match(key)) this.visits.delete(key);
  }
  /** Something with an unknown blast radius ran: excuse the NEXT read of every target. */
  markAllMayHaveChanged() {
    for (const visit of this.visits.values()) visit.mayHaveChanged = true;
  }
  snapshot() {
    return [...this.visits.entries()].map(([k, v]) => [k, { ...v, priorArgs: [...v.priorArgs] }]);
  }
};
function revisitAdvisory(tool, target, visit) {
  if (visit.count < REVISIT_NUDGE_AT) return null;
  if (visit.mayHaveChanged) return null;
  const shape = visit.priorArgs.length > 1 ? ` The argument sets you have already used on it: ${visit.priorArgs.map((a) => `\`${a}\``).join(", ")}.` : "";
  if (visit.count >= REVISIT_HARD_AT) {
    return `STOP RE-READING. This is call ${visit.count} of \`${tool}\` against ${target} in this run, and the previous ${visit.count - 1} results are all still above you in this conversation.${shape} Re-reading it again will return content you already have and will not move the task forward \u2014 this pattern is how a run exhausts its tool budget without producing a single change. Do ONE of these now: (a) if you still need more of the file, continue from the \`offset\` the last result's note gave you and page forward in order \u2014 never re-open a window you already have; (b) otherwise stop reading and make the edit, or state plainly what is blocking you. Do not issue another partial read of this target.`;
  }
  return `You have now read ${target} ${visit.count} times in this run with \`${tool}\`, and every earlier result is still above you in this conversation.${shape} If you are looking for something you have not found, another window over the same lines is unlikely to surface it \u2014 page forward from the \`offset\` the last result's note gave you, or search for the specific symbol with search_code. If you already have what you need, act on it rather than re-reading.`;
}
function withAdvisory(result, advisory) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const existing = result.note;
    const note = typeof existing === "string" && existing ? `${existing}

${advisory}` : advisory;
    return { ...result, note };
  }
  return { result, note: advisory };
}

// ../packages/run-guards/src/fingerprint.ts
function callFingerprint(tool, args) {
  let text;
  try {
    text = stableStringify(args ?? {});
  } catch {
    text = String(args ?? "");
  }
  return `${tool}:${text}`;
}
function contentHash3(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${text.length.toString(36)}.${h.toString(36)}`;
}
function pathArgOf(args) {
  return callPathOf(args);
}

// ../packages/run-guards/src/failureTally.ts
var FAILURE_NUDGE_AT = 2;
var FAILURE_HARD_AT = 3;
var FailureTally = class {
  failures;
  constructor(state) {
    this.failures = new Map(state ?? []);
  }
  /** Record a FAILED call. Returns how many times this exact call has now failed, including this one. */
  record(tool, args) {
    const key = callFingerprint(tool, args);
    const attempts = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, attempts);
    return attempts;
  }
  /** This exact call SUCCEEDED: its earlier failures were transient after all. */
  clear(tool, args) {
    this.failures.delete(callFingerprint(tool, args));
  }
  /** Forget every recorded failure (the run changed course). */
  reset() {
    this.failures.clear();
  }
  snapshot() {
    return [...this.failures.entries()];
  }
};
function failureReason(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return void 0;
  const error = result.error;
  return typeof error === "string" && error.trim() ? error.trim().slice(0, 400) : void 0;
}
function repeatedFailureAdvisory(tool, attempts, reason) {
  if (attempts < FAILURE_NUDGE_AT) return null;
  const got = reason ? ` Both times it answered: "${reason}".` : "";
  if (attempts >= FAILURE_HARD_AT) {
    const said = reason ? ` It has answered "${reason}" every time.` : "";
    return `STOP CALLING \`${tool}\` WITH THESE ARGUMENTS. This is failure ${attempts} of the identical call in this run.${said} The arguments are the problem, not the timing \u2014 repeating them will fail again and will spend the rest of this run's tool budget. Do ONE of these now: (a) re-read the error above and change the argument it names (a failing tool usually says exactly what to pass instead \u2014 a scope, a path, an id \u2014 so pass it); (b) reach the same goal with a different tool; (c) stop and tell the user plainly what is blocking you and what you need from them. Do not issue this call again.`;
  }
  return `\`${tool}\` has now failed ${attempts} times in this run with these exact arguments.${got} Another identical attempt will not behave differently \u2014 this is not a flake. Read the error above and change what it names (most failures state the argument to pass instead), use a different tool to reach the same goal, or say plainly what is blocking you. Do not simply repeat the call.`;
}

// ../packages/run-guards/src/streak.ts
var BACK_TO_BACK_AT = 3;

// ../packages/run-guards/src/checkCommand.ts
var WRAPPERS = /* @__PURE__ */ new Set(["pnpm", "npm", "npx", "yarn", "bun", "bunx"]);
var WRAPPER_VERBS = /* @__PURE__ */ new Set(["exec", "run", "dlx", "x", "run-script"]);
var VALUE_FLAGS = /* @__PURE__ */ new Set(["--filter", "-F", "-C", "--dir", "--prefix", "-w", "--workspace", "--cwd"]);
var RUNNERS = /* @__PURE__ */ new Set(["tsc", "tsgo", "vitest", "jest", "pytest", "mocha", "eslint", "biome", "ruff", "mypy", "playwright"]);
var CHECK_SCRIPT = /^(test|tests|lint|typecheck|type-check|check)(:[\w.-]+)?$/i;
var SUBCOMMAND_RUNNERS = { cargo: /* @__PURE__ */ new Set(["test", "check", "clippy"]), go: /* @__PURE__ */ new Set(["test", "vet"]) };
var VCS_BOOKKEEPING = /* @__PURE__ */ new Set(["add", "commit", "status", "diff", "log", "push", "show", "fetch"]);
function shellCommandOf(args) {
  if (!args || typeof args !== "object") return "";
  const a = args;
  return typeof a.command === "string" ? a.command : typeof a.cmd === "string" ? a.cmd : "";
}
function tokensOf(segment) {
  return segment.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/^["']|["']$/g, ""));
}
function executableTokensOf(command) {
  const segments = command.split(/&&|\|\||;/).map(tokensOf).filter((t2) => t2.length > 0 && t2[0] !== "cd" && t2[0] !== "pushd");
  let t = segments[0] ?? [];
  let i = 0;
  while (i < t.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]) || t[i] === "env")) i += 1;
  t = t.slice(i);
  if (t.length > 0 && WRAPPERS.has(t[0])) {
    let j = 1;
    for (; ; ) {
      const tok = t[j];
      if (tok === void 0) break;
      if (VALUE_FLAGS.has(tok)) j += 2;
      else if (tok.startsWith("-")) j += 1;
      else if (WRAPPER_VERBS.has(tok)) j += 1;
      else break;
    }
    t = t.slice(j);
  }
  return t.map((tok, k) => k === 0 ? tok.split(/[\\/]/).pop() ?? tok : tok);
}
function runsCheck(command) {
  const [exe, sub] = executableTokensOf(command);
  if (!exe) return false;
  if (RUNNERS.has(exe) || CHECK_SCRIPT.test(exe)) return true;
  const subs = SUBCOMMAND_RUNNERS[exe];
  return !!subs && !!sub && subs.has(sub);
}
var SUITE_SCRIPT = /^(test|tests|lint|typecheck|type-check|check)$/i;
var SUITE_RUNNERS = /* @__PURE__ */ new Set(["vitest", "jest", "pytest", "mocha", "playwright"]);
var RATCHET_SCRIPT = /^check-[\w.-]*ratchet[\w.-]*\.(?:m|c)?[jt]s$/i;
function untilPipe(tokens) {
  const end = tokens.findIndex((t) => t === "|" || /^\d*>/.test(t) || t.startsWith("<"));
  return end < 0 ? [...tokens] : tokens.slice(0, end);
}
function fullSuiteKey(command) {
  const [exe, ...rest] = untilPipe(executableTokensOf(command));
  if (!exe) return null;
  const positional = rest.filter((tok) => !tok.startsWith("-"));
  const script = positional.length === 1 ? positional[0].split(/[\\/]/).pop() ?? "" : "";
  const sweeps = SUITE_SCRIPT.test(exe) && positional.length === 0 || SUITE_RUNNERS.has(exe) && positional.every((tok) => tok === "run") || (exe === "node" || exe === "tsx") && RATCHET_SCRIPT.test(script) && !rest.includes("--update");
  return sweeps ? untilPipe(tokensOf(command)).join(" ") : null;
}
function isVcsBookkeeping(command) {
  const [exe, sub] = executableTokensOf(command);
  return exe === "git" && !!sub && VCS_BOOKKEEPING.has(sub);
}

// ../packages/run-guards/src/waitCeiling.ts
var MAX_WAIT_TURNS = 12;
var WaitCeiling = class {
  turns;
  digest;
  constructor(state = {}) {
    this.turns = state.waitTurns ?? 0;
    this.digest = state.waitDigest;
  }
  /** One wait-only turn (or wait call) with no ground progress, waiting on `digest`. Returns whether it is still exempt from idling. */
  waited(digest) {
    this.turns += 1;
    this.digest = digest;
    return this.turns <= MAX_WAIT_TURNS;
  }
  /** Ground progress, or a call that is not a wait: the count starts over. */
  reset() {
    this.turns = 0;
    this.digest = void 0;
  }
  snapshot() {
    return this.turns > 0 ? { waitTurns: this.turns, ...this.digest !== void 0 ? { waitDigest: this.digest } : {} } : {};
  }
};

// ../packages/run-guards/src/noProgress.ts
var NO_PROGRESS_TURNS = 4;
var CHURN_TURNS = 12;
var REGROUND_TURNS = 8;
var MAX_SEEN = 500;
var TEST_PATH = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$/i;
function isCheckCallDefault(tool, args) {
  if (tool === "run_checks" || tool === "run_tests") return true;
  if (tool !== "run_command") return false;
  return runsCheck(shellCommandOf(args));
}
function isTestPath(path) {
  return TEST_PATH.test(path.split("\\").join("/"));
}
var JOB_POLL_TOOLS = /* @__PURE__ */ new Set(["command_status", "command_stop"]);
var MAX_CHECK_JOBS = 16;
function recordOf(result) {
  return result && typeof result === "object" && !Array.isArray(result) ? result : null;
}
function startedJobOf(result) {
  const r = recordOf(result);
  if (!r || r.background !== true || r.status !== "running" || typeof r.id !== "string" || !r.id.trim()) return null;
  return r.id.trim();
}
function finishedJob2(result) {
  const status = recordOf(result)?.status;
  return typeof status === "string" && status !== "running";
}
function checkPassed(ok, result, poll) {
  if (!ok) return false;
  const r = recordOf(result);
  if (typeof r?.exitCode === "number" && r.exitCode !== 0) return false;
  return !poll || r?.status === "exited";
}
function resultDigest(result) {
  let text;
  try {
    text = JSON.stringify(result ?? null) ?? "";
  } catch {
    text = String(result);
  }
  return contentHash3(text.slice(0, 8e3));
}
var NoProgressTracker = class {
  seen;
  changes;
  idleTurns;
  lastCheck;
  checkJobs;
  groundThisTurn = false;
  churnThisTurn = false;
  /** This turn's calls, and the digests of the still-running waits among them: a turn made ONLY of waits is not idle. */
  callsThisTurn = 0;
  waitsThisTurn = [];
  /** The ceiling on waiting on an unchanged state (`waitCeiling.ts`). */
  waits;
  churnTurns;
  lastGround = false;
  lastIdle = false;
  turn = 0;
  lastSeenAt;
  targetOf;
  isCheckCall;
  isPlatformProgress;
  constructor(state, ports = {}) {
    this.seen = new Set(state?.seen ?? []);
    this.changes = new Set(state?.changes ?? []);
    this.idleTurns = state?.idleTurns ?? 0;
    this.churnTurns = state?.churnTurns ?? 0;
    this.lastCheck = state?.lastCheck;
    this.checkJobs = (state?.checkJobs ?? []).slice(-MAX_CHECK_JOBS);
    this.turn = 0;
    this.lastSeenAt = new Map(Object.entries(state?.lastSeenAt ?? {}));
    this.targetOf = ports.targetOf ?? ((_tool, args) => pathArgOf(args));
    this.isCheckCall = ports.isCheckCall ?? isCheckCallDefault;
    this.isPlatformProgress = ports.isPlatformProgress;
    this.waits = new WaitCeiling(state);
  }
  /**
   * One call of the current turn ran. `wrote` = it changed content (a file edit, or a
   * mutating command that names no file). Returns
   * whether the call was a check whose result CHANGED — a failing check that answers
   * differently each time is the run fixing things, not repeating a failure.
   */
  observe(tool, args, outcome) {
    const delegated = outcome.delegatedPaths ?? [];
    this.callsThisTurn += 1;
    if (outcome.ok && outcome.waitingOn) this.waitsThisTurn.push(outcome.waitingOn);
    const targets = [...new Set([this.targetOf(tool, args), ...changedPathsOf(args), ...delegated].filter((p) => !!p))];
    for (const path of targets) {
      if (!this.seen.has(path)) {
        this.seen.add(path);
        if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value);
        this.groundThisTurn = true;
      } else {
        const last = this.lastSeenAt.get(path);
        if (last === void 0 || this.turn - last >= REGROUND_TURNS) this.groundThisTurn = true;
      }
      this.lastSeenAt.set(path, this.turn);
    }
    if (outcome.ok && targets.length === 0 && this.isPlatformProgress?.(tool, args)) this.groundThisTurn = true;
    if (outcome.ok && outcome.delegationReported) this.groundThisTurn = true;
    if (outcome.ok && (outcome.wrote || delegated.length > 0)) {
      if (targets.some(isTestPath)) this.groundThisTurn = true;
      const fingerprint = contentHash3(callFingerprint(tool, args));
      if (!this.changes.has(fingerprint)) {
        this.changes.add(fingerprint);
        if (this.changes.size > MAX_SEEN) this.changes.delete(this.changes.values().next().value);
        this.churnThisTurn = true;
      }
    }
    const poll = this.isCheckJobPoll(tool, args);
    if (!poll && !this.isCheckCall(tool, args)) return { checkChanged: false };
    const job = startedJobOf(outcome.result);
    if (!poll && job) {
      this.rememberJob(job);
      return { checkChanged: false, check: "pending" };
    }
    if (poll && !finishedJob2(outcome.result)) return { checkChanged: false, check: "pending" };
    const check = checkPassed(outcome.ok, outcome.result, poll) && (poll || !isReadOnlyShellCall(tool, args)) ? "passed" : "failed";
    const digest = resultDigest(outcome.result);
    if (digest === this.lastCheck) return { checkChanged: false, check };
    this.groundThisTurn = true;
    this.lastCheck = digest;
    return { checkChanged: true, check };
  }
  /**
   * A child's report that reached the run OUTSIDE a call (injected as a message): the files
   * it changed are paths the run reached, and a report that moved the work is ground — the
   * same reading a `wait_agents` result gets.
   */
  noteChildReport(changedPaths2, moved) {
    for (const path of changedPaths2) {
      if (!this.seen.has(path)) {
        this.seen.add(path);
        if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value);
      }
      this.lastSeenAt.set(path, this.turn);
    }
    if (moved || changedPaths2.length > 0) this.groundThisTurn = true;
  }
  /** A poll of a background job a check command started ({@link JOB_POLL_TOOLS}). */
  isCheckJobPoll(tool, args) {
    if (!JOB_POLL_TOOLS.has(tool) || !args || typeof args !== "object") return false;
    const id = args.id;
    return typeof id === "string" && this.checkJobs.includes(id.trim());
  }
  rememberJob(id) {
    this.checkJobs = [...this.checkJobs.filter((j) => j !== id), id].slice(-MAX_CHECK_JOBS);
  }
  /** The turn's calls all ran. Returns the idle-turn streak after it. */
  endTurn() {
    let progressed = this.groundThisTurn;
    if (this.groundThisTurn) this.churnTurns = 0;
    else if (this.churnThisTurn) {
      this.churnTurns += 1;
      progressed = this.churnTurns <= CHURN_TURNS;
    }
    const allWaiting = this.callsThisTurn > 0 && this.waitsThisTurn.length === this.callsThisTurn;
    if (allWaiting && !this.groundThisTurn) {
      if (this.waits.waited([...this.waitsThisTurn].sort().join("|"))) progressed = true;
    } else if (this.callsThisTurn > 0 || this.groundThisTurn) this.waits.reset();
    this.lastGround = this.groundThisTurn;
    this.lastIdle = !progressed;
    this.idleTurns = progressed ? 0 : this.idleTurns + 1;
    this.groundThisTurn = false;
    this.churnThisTurn = false;
    this.callsThisTurn = 0;
    this.waitsThisTurn = [];
    this.turn += 1;
    return this.idleTurns;
  }
  /** Whether the turn {@link endTurn} last closed made GROUND progress (not churn alone). */
  get lastTurnGround() {
    return this.lastGround;
  }
  /** Whether the turn {@link endTurn} last closed made NO progress at all (neither
   *  ground nor churn) — the pure-idle turn the B4 batching nudge targets. */
  get lastTurnIdle() {
    return this.lastIdle;
  }
  /** Start the window over (the run was steered, escalated or resumed by a human). */
  reset() {
    this.idleTurns = 0;
    this.groundThisTurn = false;
    this.churnThisTurn = false;
    this.callsThisTurn = 0;
    this.waitsThisTurn = [];
  }
  snapshot() {
    return {
      seen: [...this.seen],
      idleTurns: this.idleTurns,
      ...this.lastSeenAt.size ? { lastSeenAt: Object.fromEntries(this.lastSeenAt) } : {},
      ...this.changes.size ? { changes: [...this.changes] } : {},
      ...this.churnTurns ? { churnTurns: this.churnTurns } : {},
      ...this.lastCheck ? { lastCheck: this.lastCheck } : {},
      ...this.checkJobs.length ? { checkJobs: [...this.checkJobs] } : {},
      ...this.waits.snapshot()
    };
  }
};

// ../packages/run-guards/src/delegatedChanges.ts
var DELEGATION_TOOLS = /* @__PURE__ */ new Set(["spawn_agent", SPAWN_AGENTS_TOOL, SUBAGENT_CONTROL_TOOL_NAMES.wait, "hand_off"]);
function isDelegationTool(tool) {
  return DELEGATION_TOOLS.has(tool);
}
var WAIT_POLL_TOOLS = /* @__PURE__ */ new Set([SUBAGENT_CONTROL_TOOL_NAMES.wait, ...JOB_POLL_TOOLS]);
function isWaitPollTool(tool) {
  return WAIT_POLL_TOOLS.has(tool);
}
function recordOf2(result) {
  return result && typeof result === "object" && !Array.isArray(result) ? result : null;
}
function waitDigestOf(tool, result) {
  if (!isWaitPollTool(tool)) return null;
  const r = recordOf2(result);
  if (!r) return null;
  if (Array.isArray(r.running) && r.running.length > 0) {
    return `${tool}:${r.running.map((h) => String(h)).sort().join(",")}`;
  }
  if (r.status === "running") return `${tool}:${typeof r.id === "string" ? r.id : ""}:running`;
  return null;
}
function pathsOf(files) {
  if (!Array.isArray(files)) return [];
  const paths = files.filter((f) => typeof f === "string").map((f) => f.trim()).filter((f) => f.length > 0);
  return [...new Set(paths)];
}
function delegatedChangedPathsOf(tool, result) {
  return isDelegationTool(tool) ? pathsOf(recordOf2(result)?.changedFiles) : [];
}
function reportMovedWork(report3) {
  const r = recordOf2(report3);
  return !!r && (r.state === "done" || pathsOf(r.changedFiles).length > 0);
}
function delegationReportedOf(tool, result) {
  if (!isDelegationTool(tool)) return false;
  const reports = recordOf2(result)?.reports;
  return Array.isArray(reports) && reports.some(reportMovedWork);
}
function childReportProgressOf(report3) {
  return { changedPaths: pathsOf(report3.changedFiles), moved: reportMovedWork(report3) };
}

// ../packages/run-guards/src/verifiedWork.ts
var VerifiedWork = class {
  wrote;
  verified;
  offered;
  constructor(state = {}) {
    this.wrote = state.wrote === true;
    this.verified = this.wrote && state.verified === true;
    this.offered = state.finishOffered === true;
  }
  /** A successful write (a file change, or a mutating command that is not a check). */
  noteWrite() {
    this.wrote = true;
    this.verified = false;
    this.offered = false;
  }
  /** A `finish` was offered. Until the run writes again, it is not offered twice. */
  noteFinishOffered() {
    this.offered = true;
  }
  /** A `finish` was already offered since the last write. */
  get finishOffered() {
    return this.offered;
  }
  /** A check answered. Only a check after a write verifies anything. */
  noteCheck(passed) {
    if (this.wrote) this.verified = passed;
  }
  /** The run's change is made and a check passed after its last write. */
  get isVerified() {
    return this.wrote && this.verified;
  }
  snapshot() {
    return {
      ...this.wrote ? { wrote: true } : {},
      ...this.isVerified ? { verified: true } : {},
      ...this.offered ? { finishOffered: true } : {}
    };
  }
};

// ../packages/run-guards/src/reverifyTracker.ts
var MAX_REVERIFY_PATHS = 200;
function addBounded(set, path) {
  set.delete(path);
  set.add(path);
  while (set.size > MAX_REVERIFY_PATHS) {
    const oldest = set.values().next().value;
    if (oldest === void 0) break;
    set.delete(oldest);
  }
}
function restoreBounded(paths) {
  return new Set((paths ?? []).slice(-MAX_REVERIFY_PATHS));
}
var ReverifyTracker = class {
  writtenPaths;
  readBackSinceWrite;
  /** Read-only targets seen this turn, to tell an all-written re-read turn from real work. */
  readsThisTurn = 0;
  /** Whether every read this turn was a repeat read-back of an unchanged written path. */
  allRepeatReadBacks = true;
  constructor(state = {}) {
    this.writtenPaths = restoreBounded(state.writtenPaths);
    this.readBackSinceWrite = restoreBounded(state.readBackSinceWrite);
  }
  /** A call that may have changed ANY file wrote: no read-back is a look at unchanged bytes. */
  wroteAnything() {
    this.readBackSinceWrite.clear();
  }
  /** `path` was written: its next read-back inspects the edit again. */
  wrote(path) {
    addBounded(this.writtenPaths, path);
    this.readBackSinceWrite.delete(path);
  }
  /** A successful read-only call visited `target`. */
  read(target) {
    this.readsThisTurn += 1;
    if (this.writtenPaths.has(target)) {
      if (!this.readBackSinceWrite.has(target)) this.allRepeatReadBacks = false;
      addBounded(this.readBackSinceWrite, target);
    } else {
      this.allRepeatReadBacks = false;
    }
  }
  /** The turn ended: how many reads it made when ALL were repeat read-backs (else 0). Starts the next turn. */
  endTurn() {
    const count2 = this.readsThisTurn > 0 && this.allRepeatReadBacks ? this.readsThisTurn : 0;
    this.readsThisTurn = 0;
    this.allRepeatReadBacks = true;
    return count2;
  }
  snapshot() {
    return {
      ...this.writtenPaths.size ? { writtenPaths: [...this.writtenPaths] } : {},
      ...this.readBackSinceWrite.size ? { readBackSinceWrite: [...this.readBackSinceWrite] } : {}
    };
  }
};

// ../packages/run-guards/src/suiteRepeat.ts
function targetedReverifyNote(command) {
  return `You have now run the full suite \`${command}\` more than once. Do not re-run the whole suite to confirm a fix: re-run ONLY the checks that failed (the specific guard script, test file or package typecheck), and leave the full sweep to CI.`;
}
var SuiteRepeat = class {
  run;
  shownSuites;
  pending;
  constructor(state = {}) {
    this.run = restoreBounded(state.run);
    this.shownSuites = restoreBounded(state.shown);
    this.pending = state.pending;
  }
  /** A shell command ran. */
  ranCommand(command) {
    const key = fullSuiteKey(command);
    if (!key) return;
    if (this.run.has(key) && !this.shownSuites.has(key)) this.pending ??= key;
    addBounded(this.run, key);
  }
  /**
   * The owed advisory ("" when none), marked shown — never again for that suite. The detector calls this only where
   * the note becomes the turn's returned action; a turn that ends in a trip or another advisory leaves it owed.
   */
  take() {
    const key = this.pending;
    if (!key) return "";
    addBounded(this.shownSuites, key);
    this.pending = void 0;
    return targetedReverifyNote(key);
  }
  snapshot() {
    return {
      ...this.run.size ? { run: [...this.run] } : {},
      ...this.shownSuites.size ? { shown: [...this.shownSuites] } : {},
      ...this.pending ? { pending: this.pending } : {}
    };
  }
  /** The detector's snapshot field: `{ suites }`, or nothing when empty. */
  snapshotField() {
    const s = this.snapshot();
    return Object.keys(s).length > 0 ? { suites: s } : {};
  }
};

// ../packages/run-guards/src/multiRead.ts
function singleReadsOf(tool, args) {
  if (tool !== "read_file" || !args || typeof args !== "object" || Array.isArray(args)) return null;
  const { paths, ...rest } = args;
  if (!Array.isArray(paths) || typeof rest.path === "string" && rest.path !== "") return null;
  const named = paths.filter((p) => typeof p === "string" && p.trim() !== "").slice(0, READ_FILE_MAX_PATHS);
  if (named.length === 0) return null;
  return named.map((path) => ({ ...rest, path }));
}
function perFileResults(result) {
  return result && Array.isArray(result.files) ? result.files : null;
}

// ../packages/run-guards/src/readCoverage.ts
var PATH_ARG_KEYS = /* @__PURE__ */ new Set(["path", "scope", "repo", "file", "filePath", "dir"]);
function normalizePathArg(value) {
  const p = value.split("\\").join("/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  return p === "." ? "" : p;
}
function canonicalReadArgs(tool, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    if (value == null) continue;
    if (typeof value === "string") {
      const trimmed = PATH_ARG_KEYS.has(key) ? normalizePathArg(value.trim()) : value.trim();
      if (trimmed) out[key] = trimmed;
      continue;
    }
    out[key] = value;
  }
  if (tool === "read_file" && (out.offset === 1 || out.offset === 0)) delete out.offset;
  return out;
}
var TREE_WIDE_READ_TOOLS = /* @__PURE__ */ new Set(["search_code", "find_symbol", "list_files", "semantic_search", "repo_map", "local_research"]);
function resultObject(result) {
  if (result && typeof result === "object" && !Array.isArray(result)) return result;
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
function isUnderDir(p, dir) {
  if (!dir) return true;
  const path = normalizePathArg(p);
  return path === dir || path.startsWith(`${dir}/`);
}
function asPositiveInt(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
function requestedReadWindow(args) {
  const start = asPositiveInt(args.offset, 1);
  const limit = asPositiveInt(args.limit, READ_DEFAULT_LINE_LIMIT);
  return { start, end: start + limit - 1 };
}
function servedReadWindow(result) {
  const data = resultObject(result);
  if (!data || data.ok === false) return null;
  const start = asPositiveInt(data.offset, 1);
  const content = typeof data.content === "string" ? data.content : "";
  const returned = content === "" ? 0 : content.split("\n").length;
  if (returned <= 0) return null;
  let end = start + returned - 1;
  if (data.truncated !== true && typeof data.totalLines === "number" && data.totalLines >= start) {
    end = Math.max(end, Math.floor(data.totalLines));
  }
  return { start, end };
}
function spanContains(outer, inner) {
  return inner.start >= outer.start && inner.end <= outer.end;
}
function clipRequestedToEof(want, covering) {
  const data = resultObject(covering);
  if (!data || data.truncated === true || typeof data.totalLines !== "number" || data.totalLines < 1) return want;
  return { start: want.start, end: Math.min(want.end, Math.floor(data.totalLines)) };
}
function servedCopy(cached) {
  return cached.served !== void 0 ? cached.served : cached.result;
}
var ReadCoverage = class _ReadCoverage {
  constructor(traits) {
    this.traits = traits;
  }
  traits;
  visits = new VisitTally();
  /** Successful reads by `${tool}:${canonical args}` — the exact-repeat guard. */
  exact = /* @__PURE__ */ new Map();
  static exactKey(tool, args) {
    return `${tool}:${stableStringify(canonicalReadArgs(tool, args))}`;
  }
  /** Was this visit ABOUT `target` — the target itself, or a question asked of it? */
  visitedScopeIs(visited, target) {
    return visited === target || (visited?.startsWith(`${target}${this.traits.questionSeparator}`) ?? false);
  }
  /** Has this exact read already SUCCEEDED this run, with nothing since that could have changed its answer? */
  isRepeat(tool, args) {
    return this.exact.has(_ReadCoverage.exactKey(tool, args));
  }
  /** Keep what a SUCCESSFUL read returned, with the message that carried it. A no-op for
   *  a read that was never recorded (a failure has nothing to replay). */
  cacheResult(tool, args, cached) {
    const singles = singleReadsOf(tool, args);
    if (singles) {
      const results = perFileResults(resultObject(cached.result));
      const served = cached.served !== void 0 ? perFileResults(resultObject(cached.served)) : null;
      if (!results) return;
      singles.forEach((single, i) => {
        const entry = resultObject(results[i]);
        if (!entry || entry.ok === false) {
          this.exact.delete(_ReadCoverage.exactKey(tool, single));
          return;
        }
        const one = { result: results[i], anchor: cached.anchor };
        if (served && served[i] !== void 0) one.served = served[i];
        this.cacheResult(tool, single, one);
      });
      return;
    }
    const read = this.exact.get(_ReadCoverage.exactKey(tool, args));
    if (read) read.cached = cached;
  }
  /** The cached result of an exact earlier read, or null when none is held. */
  cachedResult(tool, args) {
    return this.exact.get(_ReadCoverage.exactKey(tool, args))?.cached ?? null;
  }
  /**
   * Record a SUCCESSFUL read. Arms the exact-repeat guard for it, and returns the
   * resulting target visit — or null when the call names no target.
   */
  record(tool, args) {
    const singles = singleReadsOf(tool, args);
    if (singles) {
      let worst = null;
      for (const single of singles) {
        const visit = this.record(tool, single);
        if (visit && (!worst || visit.count > worst.count)) worst = visit;
      }
      return worst;
    }
    const target = this.traits.visitTarget(args) ?? null;
    this.exact.set(_ReadCoverage.exactKey(tool, args), { tool, args: canonicalReadArgs(tool, args), target });
    if (!target) return null;
    return this.visits.record(`${tool}:${target}`, args);
  }
  /**
   * A non-read call has run. Forget exactly the reads it could have changed — no more,
   * no less — for every guard:
   *
   * - An unscoped mutation (shell, merge, undo) forgets every cached ANSWER, and marks
   *   every target so its NEXT read is excused — but keeps the visit COUNT: the tally
   *   counts the model's behaviour, which a build in between does not change.
   * - A file write/edit/delete forgets its own target across every tool that reads it,
   *   plus every tree-wide answer; nothing about other files.
   * - A local tool that PUBLISHES work forgets the platform reads and the repo-state
   *   reads, and keeps the file reads.
   * - The remaining local tools change nothing a read observes.
   * - Anything else is a platform / MCP call: it forgets target-less platform reads.
   */
  invalidate(tool, args) {
    const t = this.traits;
    if (t.isUnscopedMutation(tool, args)) {
      this.exact.clear();
      this.visits.markAllMayHaveChanged();
      return;
    }
    if (t.isCodeChangeTool(tool)) {
      const target = t.activityTarget(args);
      if (!target) return;
      this.visits.forget((key) => this.visitedScopeIs(key.slice(key.indexOf(":") + 1), target));
      for (const [key, read] of [...this.exact.entries()]) {
        if (this.visitedScopeIs(read.target, target) || TREE_WIDE_READ_TOOLS.has(read.tool)) this.exact.delete(key);
      }
      return;
    }
    if (t.isLocalWorkspaceTool(tool) && !t.isRepoPublishTool(tool)) return;
    for (const [key, read] of [...this.exact.entries()]) {
      if (!t.isLocalWorkspaceTool(read.tool) || t.isRepoStateReadTool(read.tool)) this.exact.delete(key);
    }
  }
  /**
   * Answer a `read_file` whose window is already inside an earlier successful window of
   * the SAME file. Null for a jump to lines the earlier read did not return, and for a
   * page that extends past a truncated window — those still need the disk.
   */
  coveredRead(tool, args) {
    if (tool !== "read_file") return null;
    const wanted = canonicalReadArgs(tool, args);
    const path = typeof wanted.path === "string" ? wanted.path : "";
    if (!path) return null;
    if (typeof wanted.key === "string") return null;
    const want = requestedReadWindow(wanted);
    for (const read of this.exact.values()) {
      if (read.tool !== "read_file" || !read.cached) continue;
      if (typeof read.args.key === "string") continue;
      const earlierPath = typeof read.args.path === "string" ? read.args.path : "";
      if (earlierPath !== path) continue;
      const served = servedCopy(read.cached);
      const got = servedReadWindow(served);
      if (!got) continue;
      const clipped = clipRequestedToEof(want, served);
      if (clipped.start > clipped.end) continue;
      if (!spanContains(got, clipped)) continue;
      return {
        start: clipped.start,
        end: clipped.end,
        cached: read.cached,
        note: `Lines ${clipped.start}\u2013${clipped.end} of this file were already returned by an earlier read_file (lines ${got.start}\u2013${got.end}). Reuse that result; if you need later lines, page forward with offset ${got.end + 1}. Do not re-open a window you already have.`
      };
    }
    return null;
  }
  /**
   * Answer a `search_code` from a WIDER complete search already held (same query, an
   * ancestor scope), filtered to the narrower `path`. A derived 0 is never returned — a
   * parent's 0 may be a false negative, and the tool treats `truncated:false` as proof
   * of absence — so the narrower search must actually run.
   */
  derivedSearch(tool, args) {
    if (tool !== "search_code") return null;
    const wanted = canonicalReadArgs(tool, args);
    const scope = typeof wanted.path === "string" ? wanted.path : "";
    if (!scope) return null;
    const { path: _scope, ...rest } = wanted;
    const others = stableStringify(rest);
    for (const read of this.exact.values()) {
      if (read.tool !== "search_code" || !read.cached) continue;
      const { path: earlierPath, ...earlierRest } = read.args;
      const earlier = typeof earlierPath === "string" ? earlierPath : "";
      if (earlier === scope || !isUnderDir(scope, earlier)) continue;
      if (stableStringify(earlierRest) !== others) continue;
      const result = resultObject(read.cached.result);
      if (!result || result.ok !== true || result.truncated === true || !Array.isArray(result.matches)) continue;
      const matches = result.matches.filter(
        (m) => typeof m.path === "string" && isUnderDir(m.path, scope)
      );
      if (matches.length === 0) continue;
      return {
        ok: true,
        query: wanted.query,
        total: matches.length,
        truncated: false,
        matches,
        note: `Answered from this run's earlier complete search for the same query${earlier ? ` under "${earlier}"` : " over the whole tree"}, filtered to "${scope}" \u2014 not re-run.`
      };
    }
    return null;
  }
};

// ../packages/run-guards/src/shellFileRead.ts
var SHELL_META = /[|;&<>`$*?(){}\[\]\\\n\r!~]/;
function words(text) {
  const unquoted = text.replace(/"[^"]*"|'[^']*'/g, "");
  if (SHELL_META.test(unquoted) || /["']/.test(unquoted)) return null;
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}
function workspacePath(raw) {
  const p = raw.trim().split("\\").join("/");
  if (!p || p.startsWith("/") || p.startsWith("-") || p.includes(":")) return null;
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.length === 0 || parts.some((s) => s === "..")) return null;
  return parts.join("/");
}
var positiveInt2 = (s) => s !== void 0 && /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : void 0;
function printedLines(argv) {
  const [program, ...args] = argv;
  if (program === "cat" && args.length === 1) return { file: args[0], from: 1 };
  if (program === "head" || program === "tail") {
    let n;
    let file;
    if (args.length === 1) [file] = args;
    else if (args.length === 2 && /^-\d+$/.test(args[0])) [n, file] = [args[0].slice(1), args[1]];
    else if (args.length === 2 && /^-n\+?\d+$/.test(args[0])) [n, file] = [args[0].slice(2), args[1]];
    else if (args.length === 2 && /^--lines=\+?\d+$/.test(args[0])) [n, file] = [args[0].slice(8), args[1]];
    else if (args.length === 3 && args[0] === "-n") [n, file] = [args[1], args[2]];
    else return null;
    if (!file) return null;
    if (n === void 0) n = "10";
    if (program === "head") {
      const count3 = positiveInt2(n);
      return count3 ? { file, from: 1, count: count3 } : null;
    }
    if (n.startsWith("+")) {
      const from = positiveInt2(n.slice(1));
      return from ? { file, from } : null;
    }
    const count2 = positiveInt2(n);
    return count2 ? { file, count: count2 } : null;
  }
  if (program === "sed" && args.length === 3 && args[0] === "-n") {
    const m = /^(\d+)(?:,(\d+))?\s*p$/.exec(args[1].trim());
    const from = positiveInt2(m?.[1]);
    const to = m && m[2] !== void 0 ? positiveInt2(m[2]) : from;
    if (!from || !to || to < from) return null;
    return { file: args[2], from, count: to - from + 1 };
  }
  return null;
}
function parseShellFileRead(command) {
  let rest = command.trim();
  let dir = "";
  const cd = /^cd\s+("[^"]+"|'[^']+'|[^\s;&|<>`$"']+)\s*&&\s*/.exec(rest);
  if (cd) {
    const folder = workspacePath(cd[1].replace(/^["']|["']$/g, ""));
    if (!folder) return null;
    dir = folder;
    rest = rest.slice(cd[0].length);
  }
  const argv = words(rest);
  if (!argv || argv.length === 0) return null;
  const printed = printedLines(argv);
  if (!printed) return null;
  const file = workspacePath(printed.file);
  if (!file) return null;
  const { file: _file, ...lines } = printed;
  return { path: dir ? `${dir}/${file}` : file, ...lines };
}
function shellReadAsFileRead(command, stdout) {
  const read = parseShellFileRead(command);
  if (!read) return null;
  const body = stdout.replace(/\r?\n$/, "");
  if (!body) return null;
  const printed = body.split("\n").length;
  const whole = (from) => ({ ok: true, path: read.path, content: body, offset: from, totalLines: from + printed - 1, truncated: false });
  if (read.from === void 0) {
    return read.count !== void 0 && printed < read.count ? { args: { path: read.path }, result: whole(1) } : null;
  }
  if (read.count === void 0) {
    return { args: read.from > 1 ? { path: read.path, offset: read.from } : { path: read.path }, result: whole(read.from) };
  }
  if (printed > read.count) return null;
  const args = { path: read.path, offset: read.from, limit: read.count };
  if (printed < read.count) return { args, result: whole(read.from) };
  return { args, result: { ok: true, path: read.path, content: body, offset: read.from, truncated: true } };
}

// ../packages/run-guards/src/mutatingShell.ts
var FILE_WRITERS = /* @__PURE__ */ new Set([
  "rm",
  "rmdir",
  "mv",
  "cp",
  "tee",
  "touch",
  "ln",
  "truncate",
  "unlink",
  "install",
  "patch",
  // cmd.exe
  "del",
  "erase",
  "move",
  "copy",
  "ren",
  "rename",
  "rd",
  // PowerShell
  "remove-item",
  "move-item",
  "copy-item",
  "new-item",
  "set-content",
  "add-content",
  "out-file",
  "rename-item",
  "clear-content"
]);
var GIT_WRITERS = /* @__PURE__ */ new Set([
  "commit",
  "checkout",
  "switch",
  "reset",
  "restore",
  "push",
  "pull",
  "rebase",
  "merge",
  "apply",
  "am",
  "cherry-pick",
  "revert",
  "clean",
  "rm",
  "mv",
  "stash"
]);
var INLINE_FLAGS = {
  node: ["-e", "--eval", "-p", "--print"],
  python: ["-c"],
  python3: ["-c"],
  py: ["-c"]
};
var WRITE_API = /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|rmSync|rmdirSync|unlink(?:Sync)?|rename(?:Sync)?|mkdirSync|copyFile(?:Sync)?|cpSync|createWriteStream|truncate(?:Sync)?|write_text|write_bytes|os\.remove|os\.unlink|os\.rename|shutil\.\w+)\b|\bopen\([^)]*,\s*['"][wax]\+?b?['"]/;
var REGENERATING = /^--(?:update|fix|write|updateSnapshot|update-snapshots?)(?:=.*)?$/;
function gitWrites(args) {
  const { sub, rest } = gitSubcommand(args);
  if (!sub || !GIT_WRITERS.has(sub)) return false;
  return !(sub === "stash" && ["list", "show"].includes(rest.find((a) => !a.startsWith("-")) ?? ""));
}
function segmentWrites(segment, depth) {
  if (depth > 4) return false;
  if (substitutions(segment).some((body) => commandWrites(body, depth + 1))) return true;
  const flat = segment.replace(/\$\((?:[^()]|\([^()]*\))*\)/g, "X");
  if (writesViaRedirect(flat)) return true;
  const [rawProgram, ...args] = commandWords(shellTokens(flat));
  if (rawProgram === void 0) return false;
  const program = (rawProgram.split(/[\\/]/).pop() ?? rawProgram).toLowerCase().replace(/\.exe$/, "");
  if (FILE_WRITERS.has(program)) return true;
  if (program === "git") return gitWrites(args);
  if (program === "sed" && args.some((a) => a.startsWith("-i") || a.startsWith("--in-place"))) return true;
  if (program === "perl" && args.some((a) => /^-[a-z]*i/.test(a))) return true;
  if (args.some((a) => REGENERATING.test(a))) return true;
  if (args.includes("-u") && runsCheck(flat)) return true;
  const inline = INLINE_FLAGS[program];
  if (inline && args.some((a) => inline.includes(a)) && WRITE_API.test(flat)) return true;
  return false;
}
function commandWrites(command, depth) {
  const segments = splitShellSegments(command);
  if (!segments) return segmentWrites(command, depth);
  return segments.some((s) => segmentWrites(s, depth));
}
function isMutatingShellCommand(command) {
  const trimmed = command.trim();
  return trimmed !== "" && commandWrites(trimmed, 0);
}
function isMutatingShellCall(tool, args) {
  return tool === "run_command" && isMutatingShellCommand(shellCommandOf(args));
}

// ../packages/run-guards/src/shellPrint.ts
function cleanPrint(args, out) {
  if (!args || typeof args !== "object" || !out || typeof out !== "object" || Array.isArray(out)) return null;
  const a = args;
  const r = out;
  if (r.ok === false || r.compressed === true || r.exitCode !== void 0 && r.exitCode !== 0) return null;
  const stdout = typeof r.stdout === "string" ? r.stdout : typeof r.output === "string" ? r.output : null;
  const raw = typeof a.command === "string" ? a.command : typeof a.cmd === "string" ? a.cmd : "";
  if (stdout === null || !raw.trim()) return null;
  const cwd = [r.cwd, a.cwd].map((v) => typeof v === "string" ? v.trim() : "").find(Boolean) ?? "";
  return { command: cwd ? `cd ${JSON.stringify(cwd)} && ${raw}` : raw, stdout };
}
function shellPrintAsRead(tool, args, out, servedWhole) {
  if (!servedWhole || !isReadOnlyShellCall(tool, args)) return null;
  const print = cleanPrint(args, out);
  return print ? shellReadAsFileRead(print.command, print.stdout) : null;
}
function recordShellFileRead(coverage, tool, args, out, servedWhole, anchor) {
  const read = shellPrintAsRead(tool, args, out, servedWhole);
  if (!read) return false;
  coverage.record("read_file", read.args);
  coverage.cacheResult("read_file", read.args, { result: read.result, anchor });
  return true;
}

// ../packages/run-guards/src/writeLedger.ts
function contentWriteOf(tool, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const { path, content } = args;
  if (typeof path !== "string" || !path.trim() || typeof content !== "string") return null;
  return { path: path.trim(), fingerprint: callFingerprint(tool, args) };
}
var WriteLedger = class {
  written = /* @__PURE__ */ new Map();
  /** Is this call a full-content write identical to the last one that landed on its
   *  path, with nothing touching that path since? */
  isRepeat(tool, args) {
    const write = contentWriteOf(tool, args);
    return !!write && this.written.get(write.path) === write.fingerprint;
  }
  /**
   * A non-read call ran. A successful full-content write is remembered; anything else
   * that names a path forgets that path; `unscoped` forgets everything. A FAILED write
   * forgets its path — the file's state is unknown.
   */
  record(tool, args, options) {
    if (options.unscoped) {
      this.written.clear();
      return;
    }
    const write = options.ok ? contentWriteOf(tool, args) : null;
    if (write) {
      this.written.set(write.path, write.fingerprint);
      return;
    }
    const path = pathArgOf(args);
    if (path) this.written.delete(path);
    for (const changed of changedPathsOf(args)) this.written.delete(changed);
  }
};
function repeatedWriteNote(tool, path) {
  return `Not re-run: this exact \`${tool}\` of "${path}" already succeeded earlier in this run and nothing has changed the file since, so it already holds this content \u2014 writing it again cannot change anything. If something still looks broken, the cause is not that the write failed: re-read the error (it may predate your write), look elsewhere for the cause, or tell the user what you see.`;
}

// ../packages/run-guards/src/editRevert.ts
var MAX_HISTORY_PER_PATH = 16;
var MAX_PATHS2 = 200;
function signatureOf(change) {
  if ("content" in change) return { path: change.path, sig: `w:${contentHash3(change.content)}` };
  const f = contentHash3(change.from);
  const t = contentHash3(change.to);
  return { path: change.path, sig: `e:${f}>${t}`, inverse: `e:${t}>${f}` };
}
var EditRevertTracker = class {
  history;
  constructor(state) {
    this.history = new Map((state ?? []).map(([p, h]) => [p, [...h]]));
  }
  /**
   * Record a call that ran. Each successful content change (a batch carries several, in
   * order) is appended to its path's history; the first that restores earlier content is
   * returned as the revert. A failed call, or a deletion (`deleted: true`), forgets every
   * path it names — their content is unknown (a batch is atomic: none of it applied).
   */
  record(tool, args, outcome) {
    if (outcome.deleted) {
      const path = pathArgOf(args);
      if (path) this.history.delete(path);
      return null;
    }
    const changes = callChangesOf(args);
    if (!outcome.ok) {
      for (const change of changes) this.history.delete(change.path);
      return null;
    }
    let revert = null;
    for (const change of changes) {
      const found = this.recordChange(tool, signatureOf(change));
      revert ??= found;
    }
    return revert;
  }
  recordChange(tool, change) {
    const past = this.history.get(change.path) ?? [];
    let revert = null;
    if (change.sig.startsWith("w:")) {
      const earlier = past.lastIndexOf(change.sig);
      if (earlier >= 0 && earlier < past.length - 1) revert = { path: change.path, tool, restores: "write" };
    } else if (change.inverse) {
      const lastWrite = past.map((s) => s.startsWith("w:")).lastIndexOf(true);
      if (past.slice(lastWrite + 1).includes(change.inverse)) revert = { path: change.path, tool, restores: "inverse_edit" };
    }
    const next = [...past, change.sig].slice(-MAX_HISTORY_PER_PATH);
    this.history.delete(change.path);
    this.history.set(change.path, next);
    if (this.history.size > MAX_PATHS2) this.history.delete(this.history.keys().next().value);
    return revert;
  }
  /** An unscoped mutation (shell, checkout) ran: no path's content is known any more. */
  reset() {
    this.history.clear();
  }
  snapshot() {
    return [...this.history.entries()].map(([p, h]) => [p, [...h]]);
  }
};

// ../packages/run-guards/src/readinessClaim.ts
var UNKEPT_READY_AT = 2;
var UNKEPT_STEER_AT = 1;
var READY_PATTERNS = [
  // "Now I have everything I need", "I've got all the context", "we now have enough"
  /\b(?:i|we)(?:'ve| have)?\s+(?:now\s+)?(?:have|got)\s+(?:got\s+)?(?:everything|all\s+(?:the\s+)?(?:context|information|info|details|i\s+need|we\s+need)|enough)\b/,
  // "I've got all the component contracts", "we have all of the pieces" (run #70776)
  /\b(?:i|we)(?:'ve| have)?\s+(?:now\s+)?(?:have|got)\s+all\s+(?:of\s+)?(?:the\s+)?(?:[\w/-]+\s+){0,3}(?:contracts|pieces|interfaces|signatures)\b/,
  // "Now I have the full picture", "I have a complete understanding", "I have a thorough map" (run #70776)
  /\b(?:now\s+)?(?:i|we)(?:'ve|\s+have)?\s+(?:now\s+)?(?:have\s+|got\s+)?(?:a|the)\s+(?:clear|complete|full|good|solid|whole|thorough)\s+(?:picture|understanding|view|overview|grasp|map)\b/,
  // "Analysis is over; time to build." (run #70776)
  /\b(?:analysis|investigation|exploration|research)\s+(?:is|'s)\s+(?:over|done|complete|finished)\b/,
  // "Now I understand the camera registry pattern" (run #70776) — never "I don't understand"
  /\b(?:now\s+(?:i|we)|(?:i|we)\s+now)\s+(?:fully\s+|clearly\s+)?understand\b/,
  // "Implementing now", "now implementing" (run #70776)
  /^\s*(?:(?:implementing|building|coding)(?:\s+(?:it|this|that))?\s+now|now\s+(?:implementing|building|coding))\b/,
  // "one final check, then I write", "one more file before I implement"
  /\bone\s+(?:last|final|more)\s+(?:check|look|read|thing|file)\b[^.!?\n]*\b(?:then|before)\b[^.!?\n]*\b(?:write|implement|edit|make|apply|update|change|fix|code)\b/,
  // "now I'll write", "let me now implement", "time to make the change" — never "make sure"
  /\b(?:now\s+(?:i'll|i\s+will|let\s+me|let's)|(?:i'll|i\s+will|let\s+me|let's)\s+now|time\s+to)\s+(?:write|implement|build|code|make(?!\s+(?:sure|certain))|apply|edit|update(?!\s+(?:my|our)\s+(?:understanding|notes|picture))|create|fix|start\s+(?:writing|implementing|coding|the\s+(?:edit|change|implementation)))\b/,
  /\blet\s+me\s+(?:write|make|apply)\s+the\s+(?:update|change|changes|edit|edits|fix|implementation)\s+now\b/
];
var NEGATION = /\b(?:don't|do\s+not|doesn't|haven't|have\s+not|isn't|is\s+not|not\s+yet|not\s+(?:time|ready)|still\s+need|need\s+(?:more|to\s+(?:read|check|look|see|find|understand))|before\s+(?:i|we)\s+have|until\s+(?:i|we)\s+have|once|unless|when\s+(?:i|we)\s+have|if\s+(?:i|we)\s+(?:have|had)|(?:if|when|after|until|before)\s+(?:the|my|our)\s+(?:\w+\s+){1,2}(?:is|are|'s))\b/;
function ownWords(text) {
  return text.replace(/```[\s\S]*?(?:```|$)/g, " ").replace(/`[^`\n]*`/g, " ").replace(/^\s*>.*$/gm, " ").replace(/"[^"\n]*"|“[^”\n]*”/g, " ").replace(/[’‘]/g, "'");
}
function sentenceClaims(sentence) {
  if (sentence.trimEnd().endsWith("?")) return false;
  return READY_PATTERNS.some((p) => {
    const m = p.exec(sentence);
    return !!m && !NEGATION.test(sentence.slice(0, m.index + m[0].length));
  });
}
function claimsReady(text) {
  if (!text) return false;
  return ownWords(text).toLowerCase().split(/(?<=[.!?])\s+|\n+/).some(sentenceClaims);
}
var DELIVERABLE_PROMISE = /\b(?:next,?\s+|now,?\s+|then,?\s+)?(?:i'll|i\s+will|i\s+am\s+going\s+to|i'm\s+going\s+to|i\s+am\s+about\s+to|i'm\s+about\s+to|let\s+me|let's)\s+(?:now\s+|next\s+|then\s+|go\s+ahead\s+and\s+)?(?:write|draft|produce|compose|prepare|put\s+together|assemble|deliver|create|implement|build)\b/;
var OFFER2 = /\b(?:if\s+you|would\s+you\s+like|do\s+you\s+want|want\s+me\s+to|shall\s+i|should\s+i)\b/;
var ANNOUNCEMENT_MAX_SENTENCES = 2;
var ANNOUNCEMENT_MAX_CHARS = 400;
var LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/;
var DEFERRED = /\b(?:follow[- ]?up|later|afterwards|in\s+(?:a|the)\s+(?:separate|next|future|another|subsequent)\s+(?:pr|pull\s+request|ticket|issue|change|commit|task|step)|next\s+(?:pr|pull\s+request|ticket|sprint|iteration)|future\s+(?:pr|work|change))\b/;
function announcesDeliverable(text) {
  if (!text || !text.trim()) return false;
  const prose = ownWords(text).toLowerCase().split(/\n+/).filter((line) => !LIST_ITEM.test(line)).join("\n").trim();
  if (!prose || prose.length > ANNOUNCEMENT_MAX_CHARS) return false;
  const sentences = prose.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > ANNOUNCEMENT_MAX_SENTENCES) return false;
  return sentences.some((sentence) => {
    if (sentence.endsWith("?") || OFFER2.test(sentence) || DEFERRED.test(sentence)) return false;
    if (sentenceClaims(sentence)) return true;
    const m = DELIVERABLE_PROMISE.exec(sentence);
    return !!m && !NEGATION.test(sentence.slice(0, m.index + m[0].length));
  });
}
var ANNOUNCED_DELIVERABLE_STEER = `Your last reply announced the deliverable ("I have enough to write\u2026", "Next I'll write\u2026") and then ended the turn without producing it. Produce it NOW, in this reply: write the report or answer itself in full, or make the tool call that creates it. Do not announce it again and do not describe what you are about to do.`;
var UnkeptClaimTracker = class {
  unkept;
  claimed = false;
  acted = false;
  called = false;
  constructor(state) {
    this.unkept = state?.unkept ?? 0;
  }
  /** The current turn's own text. */
  noteText(text) {
    if (claimsReady(text)) this.claimed = true;
  }
  /** One call of the current turn. `readOnly` = it only read. */
  observe(readOnly) {
    this.called = true;
    if (!readOnly) this.acted = true;
  }
  /** The turn's calls all ran. Returns the unkept-claim count after it. A turn with no
   *  calls is a final answer (or a narrated call, which the stall recovery owns). */
  endTurn() {
    if (this.acted) this.unkept = 0;
    else if (this.claimed && this.called) this.unkept += 1;
    this.claimed = false;
    this.acted = false;
    this.called = false;
    return this.unkept;
  }
  /** Start over (a trip, a steer, a human). */
  reset() {
    this.unkept = 0;
  }
  snapshot() {
    return { unkept: this.unkept };
  }
};

// ../packages/run-guards/src/readinessAdvisory.ts
var READINESS_ADVISORY_NOTE = "You said you have what you need. Make the edit now; read only files you will change.";
var ReadinessAdvisory = class {
  note;
  fired;
  constructor(state) {
    this.note = state?.note ?? "";
    this.fired = state?.fired ?? false;
  }
  /**
   * `unkeptTotal` — every unkept claim this run, from the detector's trip-invariant
   * counter (never reset by a trip). The advisory fires exactly once per run: the first
   * time the total reaches {@link UNKEPT_STEER_AT}; a reset streak cannot re-trigger it
   * because `fired` persists in the JSON snapshot. Returns the pending note ("" when
   * none or already consumed by {@link endTurn}).
   */
  observe(unkeptTotal) {
    if (!this.fired && unkeptTotal >= UNKEPT_STEER_AT) {
      this.fired = true;
      this.note = READINESS_ADVISORY_NOTE;
    }
    return this.note;
  }
  /** The pending note has now been shown for its one turn — consume it (the one-shot
   *  `fired` flag is NOT cleared, so it never re-fires). */
  endTurn() {
    this.note = "";
  }
  snapshot() {
    return { note: this.note, ...this.fired ? { fired: true } : {} };
  }
};

// ../packages/run-guards/src/batching.ts
var SERIAL_SINGLE_CALLS_AT = 2;

// ../packages/run-guards/src/batchingNudge.ts
var BATCHING_NUDGE_NOTE = "You have made one read-only call per turn for several turns. When the calls are independent, batch them into one: use the `edit_file` `edits` array for several edits, or one `run_command` that runs the checks together.";
var BatchingNudge = class {
  streak;
  fired;
  constructor(state) {
    this.streak = state?.streak ?? 0;
    this.fired = state?.fired ?? false;
  }
  /**
   * `turnCalls` — every call of the turn that just ended, with whether each was
   * read-only. Exactly one read-only call (and no other call) extends the streak;
   * anything else — a write, two or more calls, or zero calls — resets it, because
   * that turn was real work, not serial reading. When the streak reaches
   * {@link SERIAL_SINGLE_CALLS_AT} and the note has not fired this run yet, the note
   * is produced (once — `fired` persists in the JSON snapshot, so a resume never
   * re-fires it). Returns the pending note ("" when none).
   */
  observe(turnCalls) {
    const singleReadOnly = turnCalls.length === 1 && turnCalls[0]?.readOnly === true;
    this.streak = singleReadOnly ? this.streak + 1 : 0;
    if (!this.fired && this.streak >= SERIAL_SINGLE_CALLS_AT) {
      this.fired = true;
      return BATCHING_NUDGE_NOTE;
    }
    return "";
  }
  snapshot() {
    return { streak: this.streak, ...this.fired ? { fired: true } : {} };
  }
};
function turnCallsOf(calls, isReadOnly) {
  return calls.map((c) => ({ readOnly: isReadOnly?.(c.tool, c.args) === true }));
}

// ../packages/run-guards/src/readOnlyStreak.ts
var READ_ONLY_STREAK_TURNS = 6;
var READ_ONLY_STREAK_CALLS = 18;
var ReadOnlyStreak = class {
  turns;
  calls;
  turnCalls = 0;
  neutralCalls = 0;
  acted = false;
  constructor(state) {
    this.turns = state?.turns ?? 0;
    this.calls = state?.calls ?? 0;
  }
  /** One call of the current turn. `readOnly` = it only read. */
  observe(readOnly) {
    this.turnCalls += 1;
    if (!readOnly) this.acted = true;
  }
  /** One call of the current turn that is neither a read nor an act — a wait on work still
   *  running elsewhere. A turn of only such calls leaves the streak as it was. */
  observeNeutral() {
    this.neutralCalls += 1;
  }
  /** The turn's calls all ran. Returns the streak after it. */
  endTurn() {
    const onlyWaits = !this.acted && this.turnCalls === 0 && this.neutralCalls > 0;
    if (!onlyWaits && (this.acted || this.turnCalls === 0)) {
      this.turns = 0;
      this.calls = 0;
    } else if (!onlyWaits) {
      this.turns += 1;
      this.calls += this.turnCalls;
    }
    this.turnCalls = 0;
    this.neutralCalls = 0;
    this.acted = false;
    return { turns: this.turns, calls: this.calls };
  }
  /** Start over (a trip, a steer, a human). */
  reset() {
    this.turns = 0;
    this.calls = 0;
  }
  snapshot() {
    return { turns: this.turns, calls: this.calls };
  }
};

// ../packages/run-guards/src/progressDetector.ts
var LADDER_RESET_TURNS = 8;
var FINISHABLE_SIGNALS = /* @__PURE__ */ new Set(["no_progress", "reverifying", "read_only_streak", "unkept_ready"]);
var SIGNAL_RANK = {
  edit_revert: 0,
  repeated_failure: 1,
  circling_read: 2,
  reverifying: 3,
  unkept_ready: 4,
  read_only_streak: 5,
  no_progress: 6
};
function succeeded3(result) {
  if (result.isError) return false;
  const d = result.data;
  return !(d && typeof d === "object" && d.ok === false);
}
function visitTargetOf(args) {
  const path = pathArgOf(args);
  if (!args || typeof args !== "object") return path;
  const a = args;
  const question = [a.query, a.pattern, a.symbol, a.name].find((v) => typeof v === "string" && v.trim() !== "");
  if (path && question) return `${path} \u220B ${question.trim()}`;
  return path ?? question?.trim() ?? null;
}
var ProgressDetector = class {
  // a repeated full-suite sweep (`suiteRepeat.ts`)
  constructor(state = {}, ports = {}) {
    this.ports = ports;
    this.visits = new VisitTally(state.visits);
    this.failures = new FailureTally(state.failures);
    this.edits = new EditRevertTracker(state.edits);
    this.progress = new NoProgressTracker(state.progress, ports);
    this.claims = new UnkeptClaimTracker(state.claims);
    this.readOnlyStreak = new ReadOnlyStreak(state.readOnlyStreak);
    this.trips = state.trips ?? 0;
    this.tripsBySignal = { ...state.tripsBySignal ?? {} };
    this.unkeptTurns = state.unkeptTurns ?? 0;
    this.quietTurns = state.quietTurns ?? 0;
    this.steer = state.steer;
    this.readiness = new ReadinessAdvisory(state.advisory);
    this.batching = new BatchingNudge(state.batching);
    this.reverify = new ReverifyTracker(state);
    this.turnCalls = [];
    this.work = new VerifiedWork(state.work);
    this.suites = new SuiteRepeat(state.suites);
  }
  ports;
  visits;
  failures;
  edits;
  progress;
  claims;
  readOnlyStreak;
  trips;
  tripsBySignal;
  unkeptTurns;
  quietTurns;
  steer;
  /** B1: the readiness advisory — one note at the FIRST unkept claim, never a trip. */
  readiness;
  /** B4: the batching nudge — one note after SERIAL_SINGLE_CALLS_AT single-readonly
   *  turns, never a trip and never touching UNKEPT_READY_AT or any other signal. */
  batching;
  turnSignal = null;
  /** `reverifying`: written paths and their read-backs (persisted, bounded). */
  reverify;
  /** Every call of the current turn, for the B4 batching nudge's read-only count. */
  turnCalls;
  /** Made a change and saw a check pass after it — turns an idle-shaped trip into `finish`. */
  work;
  suites;
  raise(signal) {
    if (!this.turnSignal || SIGNAL_RANK[signal.kind] < SIGNAL_RANK[this.turnSignal.kind]) this.turnSignal = signal;
  }
  /** The current turn's own text — what it said before its calls (a readiness claim?). */
  noteTurnText(text) {
    this.claims.noteText(text);
  }
  /** One call of the current turn ran. */
  observe(tool, args, result) {
    if (this.ports.isBookkeeping?.(tool)) {
      this.readOnlyStreak.observeNeutral();
      return;
    }
    this.turnCalls.push({ tool, args, result });
    const ok = succeeded3(result);
    const waitDigest = ok ? waitDigestOf(tool, result.data) : null;
    if (waitDigest === null) {
      const readOnly = this.ports.isReadOnly?.(tool, args) === true;
      this.claims.observe(readOnly);
      this.readOnlyStreak.observe(readOnly);
    } else this.readOnlyStreak.observeNeutral();
    const unscoped = (this.ports.isUnscopedMutation ?? ((t) => t === "run_command"))(tool, args);
    if (tool === "run_command") this.suites.ranCommand(shellCommandOf(args));
    const changed = changedPathsOf(args);
    const wrote = ok && (changed.length > 0 || unscoped && this.ports.isReadOnly?.(tool, args) !== true);
    const isDelete = (this.ports.isDelete ?? ((t) => t === "delete_file"))(tool);
    if (unscoped) {
      this.visits.markAllMayHaveChanged();
      this.edits.reset();
      if (wrote) this.reverify.wroteAnything();
    } else if (isDelete) {
      this.edits.record(tool, args, { ok, deleted: ok });
      this.forgetVisitsOf(pathArgOf(args));
    } else if (changed.length > 0) {
      const revert = this.edits.record(tool, args, { ok });
      if (revert) this.raise({ kind: "edit_revert", tool, target: revert.path });
      if (ok) {
        for (const path of changed) {
          this.forgetVisitsOf(path);
          this.reverify.wrote(path);
        }
      }
    } else if (ok && this.ports.isReadOnly?.(tool, args)) {
      const target = visitTargetOf(args);
      if (target) {
        this.reverify.read(target);
        const visit = this.visits.record(`${tool}:${target}`, args);
        if (visit.count >= REVISIT_HARD_AT && !visit.mayHaveChanged) this.raise({ kind: "circling_read", tool, target, count: visit.count });
      }
    }
    const delegated = ok ? delegatedChangedPathsOf(tool, result.data) : [];
    this.creditDelegatedWrites(delegated);
    const reported = ok && delegationReportedOf(tool, result.data);
    const { checkChanged, check } = this.progress.observe(tool, args, {
      ok,
      wrote,
      result: result.data,
      ...delegated.length > 0 ? { delegatedPaths: delegated } : {},
      ...reported ? { delegationReported: true } : {},
      ...waitDigest !== null ? { waitingOn: waitDigest } : {}
    });
    const bookkeeping2 = tool === "run_command" && isVcsBookkeeping(shellCommandOf(args));
    const workWrite = wrote && !isReadOnlyShellCall(tool, args) && !bookkeeping2 || ok && isDelete;
    if (workWrite && check === void 0) this.work.noteWrite();
    if (check === "passed" || check === "failed") this.work.noteCheck(check === "passed");
    if (ok || checkChanged) this.failures.clear(tool, args);
    else {
      const attempts = this.failures.record(tool, args);
      const reason = failureReason(result.data);
      if (attempts >= FAILURE_HARD_AT) this.raise({ kind: "repeated_failure", tool, count: attempts, ...reason ? { reason } : {} });
    }
  }
  /** Files a delegation's children changed are the run's own writes: visits, read-backs and verified work alike. */
  creditDelegatedWrites(paths) {
    for (const path of paths) {
      this.forgetVisitsOf(path);
      this.reverify.wrote(path);
    }
    if (paths.length > 0) this.work.noteWrite();
  }
  /**
   * A child's report that reached the run OUTSIDE a call — the host injected it as a message
   * (`childReportText`), the default path. Read like a `wait_agents` result: its files are the
   * run's writes, and a finished report is progress (chat #157440).
   */
  observeChildReport(report3) {
    const { changedPaths: changedPaths2, moved } = childReportProgressOf(report3);
    this.creditDelegatedWrites(changedPaths2);
    this.progress.noteChildReport(changedPaths2, moved);
  }
  forgetVisitsOf(path) {
    if (!path) return;
    this.visits.forget((key) => {
      const target = key.slice(key.indexOf(":") + 1);
      return target === path || target.startsWith(`${path} \u220B `);
    });
  }
  /** Every call of the turn ran. The trip this turn caused, if any — or, earlier and
   *  cheaper (B1), the readiness advisory on the FIRST unkept claim (never a trip). */
  endTurn() {
    const turnCalls = this.turnCalls;
    this.turnCalls = [];
    const batchNote = this.batching.observe(turnCallsOf(turnCalls, this.ports.isReadOnly));
    this.steer = void 0;
    const idle = this.progress.endTurn();
    const rereads = this.reverify.endTurn();
    if (!this.turnSignal && rereads > 0 && !this.progress.lastTurnGround && idle > 0) {
      this.raise({ kind: "reverifying", count: rereads });
    }
    const unkeptBefore = this.claims.snapshot().unkept;
    const unkept = this.claims.endTurn();
    if (unkept > unkeptBefore) this.unkeptTurns += 1;
    if (unkept >= UNKEPT_READY_AT) this.raise({ kind: "unkept_ready", count: unkept });
    const streak = this.readOnlyStreak.endTurn();
    if (this.ports.expectsChange?.() === true && (streak.turns >= READ_ONLY_STREAK_TURNS || streak.calls >= READ_ONLY_STREAK_CALLS)) {
      this.raise({ kind: "read_only_streak", count: streak.calls });
    }
    if (!this.turnSignal && idle >= NO_PROGRESS_TURNS) this.raise({ kind: "no_progress", count: idle });
    const signal = this.turnSignal;
    this.turnSignal = null;
    if (!signal) {
      this.readiness.endTurn();
      const advisoryNote = this.readiness.observe(this.unkeptTurns);
      if (advisoryNote) return { kind: "advisory", note: advisoryNote };
      const suiteNote = this.suites.take();
      if (suiteNote) return { kind: "advisory", note: suiteNote };
      if (batchNote && this.progress.lastTurnIdle) return { kind: "advisory", note: batchNote };
      if (this.progress.lastTurnGround) this.quietTurns += 1;
      else if (idle > 0) this.quietTurns = 0;
      if (this.quietTurns >= LADDER_RESET_TURNS) {
        this.trips = 0;
        this.quietTurns = 0;
      }
      return null;
    }
    this.quietTurns = 0;
    this.trips += 1;
    this.tripsBySignal[signal.kind] = (this.tripsBySignal[signal.kind] ?? 0) + 1;
    this.progress.reset();
    this.claims.reset();
    this.readOnlyStreak.reset();
    this.visits.forget(() => true);
    this.failures.reset();
    if (this.work.isVerified && FINISHABLE_SIGNALS.has(signal.kind)) {
      if (this.trips === 1) {
        const note2 = progressVerifiedSteerNote(signal);
        this.steer = note2;
        return { kind: "steer", trip: this.trips, signal, note: note2 };
      }
      if (!this.work.finishOffered) {
        this.work.noteFinishOffered();
        const note2 = progressFinishNote(signal);
        this.steer = note2;
        return { kind: "finish", trip: this.trips, signal, note: note2, verified: true };
      }
    }
    if (this.trips <= 2) {
      const note2 = progressSteerNote(signal, this.trips);
      this.steer = note2;
      return { kind: this.trips === 1 ? "steer" : "escalate", trip: this.trips, signal, note: note2 };
    }
    const verified = this.work.isVerified && FINISHABLE_SIGNALS.has(signal.kind);
    const note = verified ? progressFinishNote(signal) : progressStalledFinishNote(signal);
    this.steer = note;
    return { kind: "finish", trip: this.trips, signal, note, verified };
  }
  /** A host that could not escalate shows the steer instead (or clears it once a finish brief carries it). */
  setSteer(note) {
    this.steer = note;
  }
  /** The note the current turn's request carries ("" when none). */
  steerNote() {
    return this.steer ?? "";
  }
  get tripCount() {
    return this.trips;
  }
  snapshot() {
    return {
      visits: this.visits.snapshot(),
      failures: this.failures.snapshot(),
      edits: this.edits.snapshot(),
      progress: this.progress.snapshot(),
      ...this.claims.snapshot().unkept ? { claims: this.claims.snapshot() } : {},
      ...this.readOnlyStreak.snapshot().turns ? { readOnlyStreak: this.readOnlyStreak.snapshot() } : {},
      ...this.trips ? { trips: this.trips } : {},
      ...Object.keys(this.tripsBySignal).length ? { tripsBySignal: { ...this.tripsBySignal } } : {},
      ...this.unkeptTurns ? { unkeptTurns: this.unkeptTurns } : {},
      ...this.quietTurns ? { quietTurns: this.quietTurns } : {},
      ...this.steer ? { steer: this.steer } : {},
      // `fired` persists on its own: a consumed one-off advisory must not re-fire on resume.
      ...(() => {
        const a = this.readiness.snapshot();
        return a.note || a.fired ? { advisory: a } : {};
      })(),
      ...(() => {
        const b = this.batching.snapshot();
        return b.streak || b.fired ? { batching: b } : {};
      })(),
      ...this.reverify.snapshot(),
      ...(() => {
        const w = this.work.snapshot();
        return w.wrote ? { work: w } : {};
      })(),
      ...this.suites.snapshotField()
    };
  }
  /** The run's change is made and a check passed after its last write. */
  get workVerified() {
    return this.work.isVerified;
  }
};
function progressVerifiedSteerNote(signal) {
  return `Progress check (first warning): your last change is made and a check passed after it, but ${signal.kind === "no_progress" ? `the last ${signal.count ?? NO_PROGRESS_TURNS} turns changed nothing` : "the last turns changed nothing"}. If the request is fully done, write the final report now \u2014 what you changed, how it was verified, anything left open \u2014 and make no more tool calls. Otherwise make the next change the request still needs.`;
}
function progressFinishNote(signal) {
  const what = signal.kind === "no_progress" ? `the last ${signal.count ?? NO_PROGRESS_TURNS} turns changed nothing` : signal.kind === "reverifying" ? "this turn only re-checked work you already verified" : "the last turns only looked around";
  return `Progress check: your change is made and a check passed after your last edit \u2014 ${what}. The work is done. Write the final report NOW: what you changed (files), how it was verified, what is NOT done, and the single concrete blocker for each open item. Make no more tool calls, and do not ask the user whether to continue.`;
}
function stalledDiagnosis(signal) {
  switch (signal.kind) {
    case "edit_revert":
    case "repeated_failure":
    case "circling_read":
      return progressAdvice(signal);
    case "reverifying":
      return "the last turns only re-checked files you already wrote instead of reporting.";
    case "unkept_ready":
      return `you said ${signal.count} times that you had what you needed, then only read.`;
    case "read_only_streak":
      return `you made ${signal.count} read-only calls in a row without changing anything.`;
    case "no_progress":
      return `the last ${signal.count ?? NO_PROGRESS_TURNS} turns touched no new file and changed nothing about the tests.`;
  }
}
function progressSteerNote(signal, trip, movedUp = true) {
  const head = `Progress check (${trip === 1 ? "first warning" : movedUp ? "second warning \u2014 the run has been moved to a stronger model" : "second warning"}): `;
  return `${head}${progressAdvice(signal)}`;
}
function progressAdvice(signal) {
  switch (signal.kind) {
    case "edit_revert":
      return `your last change to ${signal.target} put the file back the way it was earlier in this run. You are oscillating between two versions instead of converging. Decide which version is right from the requirement and the evidence you already have, make that change once, and move on.`;
    case "repeated_failure":
      return `\`${signal.tool}\` has failed ${signal.count} times with identical arguments${signal.reason ? ` ("${signal.reason}")` : ""}. Change the argument the error names, use a different tool, or finish and state what is blocking you.`;
    case "circling_read":
      return `you have read ${signal.target} ${signal.count} times and nothing changed it in between. Everything you read is still above you. Act on it \u2014 make the edit \u2014 or page forward to lines you have not seen.`;
    case "reverifying":
      return `this turn only re-checked ${signal.count === 1 ? "a file" : `${signal.count} files`} you already wrote and verified. Re-running the same type-check, build or read on ground you shipped does not make it more correct \u2014 it burns budget. The work is done: report the result and stop, or move on to the next task. Only re-verify when something actually changed the code.`;
    case "unkept_ready":
      return `you have said ${signal.count} times that you have what you need \u2014 or that you are about to write \u2014 and then only read. Act on it now: make the change, spawn or hand off the work, or ask about what genuinely blocks you. Reading more is not the next step.`;
    case "read_only_streak":
      return `you have made ${signal.count} read-only calls in a row without changing anything. Everything you read is still in your context. If the task is a change, make the first concrete edit NOW with what you already have \u2014 do not read another file first. If it is analysis only, write the answer now.`;
    case "no_progress":
      return `the last ${signal.count} turns touched no new file and changed nothing about the tests. Re-read the task, pick the next concrete step that changes code or runs a check, and do it now \u2014 or finish and explain what is blocking you.`;
  }
}
function progressStalledFinishNote(signal) {
  return `Progress check (final): ${stalledDiagnosis(signal)} This is the third warning, so the run ends now. Write the final report NOW and make no more tool calls: what you changed (files), how it was verified (or that it was not), what is NOT done, and the single concrete blocker for each open item. Do not claim unverified work is done, and do not ask the user whether to continue.`;
}

// ../packages/run-guards/src/progressTrace.ts
function advisorySourceOf(note) {
  return note === BATCHING_NUDGE_NOTE ? "batching" : "readiness";
}
function progressTraceStep(action, override = {}) {
  if (action.kind === "advisory") {
    const source = advisorySourceOf(action.note);
    return {
      label: "loop.progress_advisory",
      args: { advisory: source },
      result: `progress advisory (${source}): a one-off note on the next turn, not a trip`
    };
  }
  const outcome = override.outcome ?? action.kind;
  const finish = outcome !== "finish" ? "" : action.kind === "finish" && action.verified ? " (the change is made and verified \u2014 the run writes its final report, no more tool calls)" : " (the run is not converging \u2014 it ends on an honest report of what is done and what blocks the rest, no more tool calls)";
  return {
    label: "loop.progress_check",
    args: override.detail ?? { trip: action.trip, signal: action.signal.kind, action: action.kind },
    result: `progress check ${action.trip}: ${action.signal.kind} \u2192 ${outcome}${finish}`
  };
}

// ../packages/run-guards/src/inRunVerify.ts
var PUBLISH_TOOLS = /* @__PURE__ */ new Set(["git_commit", "git_push", "open_pull_request"]);
var IN_RUN_VERIFY_SCRIPT_NAMES = ["typecheck", "type-check", "test"];
var DURABLE_IN_RUN_VERIFY_NOTE = "Durable/Worker has no shell. Typecheck/test are skipped in-run; CI on the pull request is the source of truth. Never claim those checks passed.";
var SANDBOX_IN_RUN_VERIFY_NOTE = "After code changes, run these via the sandbox shell (`run_command`) before finish. Do not invent SSH.";
function firstDeclaredScript(scripts, names) {
  if (!scripts) return null;
  for (const name of names) {
    const body = scripts[name];
    if (typeof body === "string" && body.trim()) return name;
  }
  return null;
}
function packageVerifyCommands(scripts, runner = "npm") {
  const cmds = [];
  const typecheck = firstDeclaredScript(scripts, ["typecheck", "type-check"]);
  if (typecheck) cmds.push(`${runner} run ${typecheck}`);
  const test = firstDeclaredScript(scripts, ["test"]);
  if (test) cmds.push(`${runner} run ${test}`);
  return cmds;
}
function planInRunVerify(input) {
  if (input.surface === "durable") {
    return {
      kind: "skipped",
      surface: "durable",
      reason: "no_shell",
      commands: [],
      scriptNames: IN_RUN_VERIFY_SCRIPT_NAMES,
      note: DURABLE_IN_RUN_VERIFY_NOTE
    };
  }
  const commands = packageVerifyCommands(input.packageScripts, input.runner);
  return {
    kind: "run",
    surface: input.surface,
    reason: null,
    commands,
    scriptNames: IN_RUN_VERIFY_SCRIPT_NAMES,
    note: commands.length > 0 ? SANDBOX_IN_RUN_VERIFY_NOTE : "No typecheck/test scripts in package.json; skip package verify (CI on the PR still applies)."
  };
}
function wroteCode(writtenPaths) {
  if (!writtenPaths) return false;
  return "size" in writtenPaths ? writtenPaths.size > 0 : writtenPaths.length > 0;
}
function inRunVerifyOutcome(input) {
  const plan = planInRunVerify(input);
  if (plan.kind === "skipped") {
    return {
      surface: "durable",
      kind: "skipped",
      reason: "no_shell",
      commands: [],
      failedCommands: [],
      mayFinish: true,
      note: plan.note
    };
  }
  if (!wroteCode(input.writtenPaths)) {
    return {
      surface: plan.surface,
      kind: "skipped",
      reason: "nothing_written",
      commands: plan.commands,
      failedCommands: [],
      mayFinish: true,
      note: "No code written this run; in-run typecheck/test is not required."
    };
  }
  if (plan.commands.length === 0) {
    return {
      surface: plan.surface,
      kind: "skipped",
      reason: "no_scripts",
      commands: [],
      failedCommands: [],
      mayFinish: true,
      note: plan.note
    };
  }
  if (input.results == null) {
    return {
      surface: plan.surface,
      kind: "pending",
      reason: "not_yet_run",
      commands: plan.commands,
      failedCommands: [],
      mayFinish: false,
      note: `${SANDBOX_IN_RUN_VERIFY_NOTE} Planned: ${plan.commands.join(" && ")}.`
    };
  }
  const byCommand = new Map(input.results.map((r) => [r.command, r.exitCode]));
  const failedCommands = plan.commands.filter((c) => (byCommand.get(c) ?? 1) !== 0);
  if (failedCommands.length > 0) {
    return {
      surface: plan.surface,
      kind: "ran",
      reason: "verify_failed",
      commands: plan.commands,
      failedCommands,
      mayFinish: false,
      note: `In-run verify failed: ${failedCommands.join(", ")}. Fix before finish.`
    };
  }
  return {
    surface: plan.surface,
    kind: "ran",
    reason: "verify_passed",
    commands: plan.commands,
    failedCommands: [],
    mayFinish: true,
    note: `In-run verify passed: ${plan.commands.join(" && ")}.`
  };
}

// ../packages/run-guards/src/stopIntent.ts
function normalizeStopText(text) {
  return text.trim().toLowerCase();
}
var BARE_VERBS = /* @__PURE__ */ new Set(["stop", "halt", "abort", "esc", "/stop"]);
var OBJECT_VERBS = /* @__PURE__ */ new Set(["cancel"]);
var LEADS = /* @__PURE__ */ new Set(["please", "ok", "okay", "hey", "now"]);
var TAIL = /* @__PURE__ */ new Set([
  "now",
  "right",
  "immediately",
  "asap",
  "please",
  "it",
  "this",
  "that",
  "everything",
  "all",
  "the",
  "run",
  "task",
  "job",
  "work",
  "working",
  "executing",
  "execution",
  "running",
  "agent",
  "current",
  "stop",
  "halt",
  "abort",
  "here"
]);
var CANCEL_OBJECTS = /* @__PURE__ */ new Set(["run", "task", "job", "execution", "it", "this", "that", "everything", "all", "work"]);
var MAX_WORDS = 6;
function stopIntent(text) {
  if (!text) return false;
  const words2 = normalizeStopText(text).replace(/[.!…]+$/u, "").split(/[\s,]+/).map((w) => w.replace(/^[!.]+|[!.]+$/g, "")).filter(Boolean);
  if (words2.length === 0 || words2.length > MAX_WORDS) return false;
  let i = 0;
  while (i < words2.length - 1 && LEADS.has(words2[i])) i++;
  const verb = words2[i];
  const tail = words2.slice(i + 1);
  if (!tail.every((w) => TAIL.has(w))) return false;
  if (BARE_VERBS.has(verb)) return true;
  return OBJECT_VERBS.has(verb) && tail.some((w) => CANCEL_OBJECTS.has(w));
}

// ../packages/run-guards/src/readsWithoutSpawn.ts
var READS_BEFORE_DELEGATION_NUDGE = 4;
var ReadsWithoutSpawn = class {
  state;
  constructor(state) {
    this.state = state ? { ...state } : { reads: 0, spawned: false, nudged: false };
  }
  /** Record one dispatched call. Returns the reads-without-spawn count after it. */
  record(kind) {
    if (kind === "spawn") this.state.spawned = true;
    else if (kind === "read" && !this.state.spawned) this.state.reads += 1;
    return this.state.reads;
  }
  /** The threshold is reached, nothing was spawned, and the nudge has not fired yet. */
  due(threshold = READS_BEFORE_DELEGATION_NUDGE) {
    return !this.state.spawned && !this.state.nudged && this.state.reads >= threshold;
  }
  /** The nudge was given; {@link due} stays false for the rest of the run. */
  markNudged() {
    this.state.nudged = true;
  }
  snapshot() {
    return { ...this.state };
  }
};

// ../packages/run-guards/src/evidence/ledger.ts
var MAX_CHECK_FINDINGS = 20;
var MAX_CHECK_OUTPUT_TAIL = 2048;
function normalizeEvidencePath(path) {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}
function createEvidenceLedger(resume) {
  const entries = /* @__PURE__ */ new Map();
  if (resume) {
    for (const ev of resume) {
      entries.set(normalizeEvidencePath(ev.path), {
        latestHash: ev.contentHash,
        byHash: /* @__PURE__ */ new Map([[ev.contentHash, [...ev.checks]]])
      });
    }
  }
  const entryFor = (path) => {
    const key = normalizeEvidencePath(path);
    let e = entries.get(key);
    if (!e) {
      e = { latestHash: null, byHash: /* @__PURE__ */ new Map() };
      entries.set(key, e);
    }
    return e;
  };
  return {
    noteWrite(path) {
      const e = entryFor(path);
      e.latestHash = null;
      e.byHash.clear();
    },
    record(path, contentHash4, check) {
      const e = entryFor(path);
      if (e.latestHash !== null && e.latestHash !== contentHash4) return;
      e.latestHash = contentHash4;
      const capped = {
        ...check,
        findings: check.findings.slice(0, MAX_CHECK_FINDINGS),
        ...check.outputTail ? { outputTail: check.outputTail.slice(-MAX_CHECK_OUTPUT_TAIL) } : {}
      };
      const list2 = e.byHash.get(contentHash4);
      if (list2) list2.push(capped);
      else e.byHash.set(contentHash4, [capped]);
    },
    for(path, contentHash4) {
      const e = entries.get(normalizeEvidencePath(path));
      if (!e || e.latestHash !== contentHash4) return [];
      return e.byHash.get(contentHash4) ?? [];
    },
    current(path) {
      const key = normalizeEvidencePath(path);
      const e = entries.get(key);
      if (!e || e.latestHash === null) return null;
      return { path: key, contentHash: e.latestHash, checks: e.byHash.get(e.latestHash) ?? [] };
    },
    snapshot() {
      const out = [];
      for (const [key, e] of entries) {
        if (e.latestHash === null) continue;
        out.push({ path: key, contentHash: e.latestHash, checks: e.byHash.get(e.latestHash) ?? [] });
      }
      return out;
    }
  };
}

// ../packages/run-guards/src/evidence/gitCommandPattern.ts
function gitCommandPattern(verbs) {
  return new RegExp(`\\bgit\\s+(?:-[Cc]\\s+\\S+\\s+|-\\S+\\s+|--\\S+(?:=\\S+)?\\s+)*(?:${verbs})\\b`, "i");
}

// ../packages/run-guards/src/evidence/gates.ts
var DEFAULT_EVIDENCE_POLICY = {
  required: {
    ".ts": ["diagnostics", "typecheck", "test"],
    ".tsx": ["diagnostics", "typecheck", "test"],
    ".mts": ["diagnostics", "typecheck", "test"],
    ".cts": ["diagnostics", "typecheck", "test"],
    ".js": ["typecheck", "test"],
    ".jsx": ["typecheck", "test"],
    ".mjs": ["typecheck", "test"],
    ".cjs": ["typecheck", "test"]
  },
  newSourceNeedsTest: true,
  newSourceTestExempt: [
    // Barrels / re-export entry points.
    "(^|/)index\\.[cm]?[jt]sx?$",
    // Type-only modules and declarations.
    "(^|/)types\\.[cm]?tsx?$",
    "\\.d\\.[cm]?ts$",
    // Tool / build configuration.
    "\\.config\\.[cm]?[jt]s$",
    // Node scripts.
    "\\.[cm]js$",
    // Label / copy catalogs.
    "(^|/)labels?/",
    "(^|/)[^/]*(labels?|catalog)(\\.[^/]*)?\\.[cm]?[jt]sx?$",
    // Fixtures and test helpers.
    "(^|/)(__fixtures__|fixtures?|__mocks__|test-?utils|test-?helpers|testing)/",
    "\\.(fixtures?|mocks?|helpers?)\\.[cm]?[jt]sx?$",
    "(^|/)(test|spec)[-_.]?(helpers?|utils?|setup)\\.[cm]?[jt]sx?$",
    "(^|/)(setupTests|vitest\\.setup|jest\\.setup)\\.[cm]?[jt]sx?$"
  ],
  newSourceTestCoverage: ["stem", "directory", "import"],
  checkTimeoutMs: 12e4
};
function basenameOf(path) {
  const normalized = normalizeEvidencePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
function extOf(path) {
  const base = basenameOf(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}
function stemOf(path) {
  const base = basenameOf(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
var SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
function isSourceFile(path) {
  return SOURCE_EXTENSIONS.has(extOf(path));
}
function dirOf2(path) {
  const normalized = normalizeEvidencePath(path);
  const slash2 = normalized.lastIndexOf("/");
  return slash2 >= 0 ? normalized.slice(0, slash2) : "";
}
function moduleKey(path) {
  return normalizeEvidencePath(path).replace(/\.[cm]?[jt]sx?$/i, "");
}
function isExemptFromTestRule(path, policy) {
  const normalized = normalizeEvidencePath(path);
  return (policy.newSourceTestExempt ?? []).some((source) => new RegExp(source, "i").test(normalized));
}
function needsTest(file, policy) {
  return !!policy.newSourceNeedsTest && file.isNew && isSourceFile(file.absPath) && !isTestPath(file.absPath) && !isExemptFromTestRule(file.absPath, policy);
}
function covers(test, file, policy) {
  const coverage = policy.newSourceTestCoverage ?? ["stem"];
  if (coverage.includes("stem") && basenameOf(test.absPath).startsWith(stemOf(file.absPath) + ".")) return true;
  if (coverage.includes("directory")) {
    const dir = dirOf2(file.absPath);
    if (dirOf2(test.absPath) === dir) return true;
    const dirName = dir.slice(dir.lastIndexOf("/") + 1);
    if (dirName && dirOf2(test.absPath) === dirOf2(dir) && basenameOf(test.absPath).startsWith(dirName + ".")) return true;
  }
  if (coverage.includes("import") && test.imports?.length) {
    const target = moduleKey(file.absPath);
    if (test.imports.some((i) => moduleKey(i) === target)) return true;
  }
  return false;
}
function isErrorFinding(finding4) {
  const tokens = finding4.trim().split(/\s+/);
  return (tokens[1] ?? "").toLowerCase() === "error";
}
function pass() {
  return { ok: true, unavailable: [] };
}
function refuse(reason) {
  return { ok: false, reason };
}
function fileIsUnchecked(file, policy) {
  if (file.deleted) return true;
  if ((policy.required[extOf(file.absPath)] ?? []).length > 0) return false;
  return !needsTest(file, policy);
}
function firstFindings(check, max = 3) {
  const shown = check.findings.slice(0, max);
  const more = check.findings.length > max ? ` (+${check.findings.length - max} more)` : "";
  return shown.length ? shown.join("; ") + more : "(no findings recorded)";
}
function checkFailureReason(path, check, detail) {
  const tail = check.outputTail?.trim();
  return `git_push refused: ${path} failed ${check.kind} "${check.name}"${detail}. First findings: ${firstFindings(check)}.` + (tail ? ` Output (tail): ${tail.replace(/\s+/g, " ").trim().slice(0, 400)}.` : "") + ` Fix the failure and push again \u2014 the host runs the checks.`;
}
function outgoingGate(files, ledger, policy) {
  const unavailable2 = [];
  for (const file of files) {
    if (file.deleted) continue;
    const checks = ledger.for(file.absPath, file.hash);
    const required = file.unavailable ? [] : policy.required[extOf(file.absPath)] ?? [];
    if (file.unavailable) unavailable2.push(`${file.absPath}: ${file.unavailable}`);
    for (const kind of required) {
      const records = checks.filter((c) => c.kind === kind);
      if (records.length === 0) {
        unavailable2.push(`${file.absPath}: ${kind} (no record \u2014 verifier unavailable)`);
        continue;
      }
      const record5 = records.reduce((a, b) => b.at >= a.at ? b : a);
      if (record5.outcome === "fail") {
        const detail = record5.exitCode != null ? ` (exit ${record5.exitCode})` : "";
        return refuse(checkFailureReason(file.absPath, record5, detail));
      }
      if (record5.outcome === "unavailable") {
        unavailable2.push(`${file.absPath}: ${record5.name} (${kind}) unavailable`);
      }
      if (kind === "diagnostics") {
        if (record5.findings.some(isErrorFinding)) return refuse(checkFailureReason(file.absPath, record5, " (LSP error)"));
      }
    }
    if (needsTest(file, policy)) {
      const stem2 = stemOf(file.absPath);
      const hasTest = files.some((t) => t !== file && !t.deleted && isTestPath(t.absPath) && covers(t, file, policy));
      if (!hasTest) {
        return refuse(
          `git_push refused: ${file.absPath} is new and has no test in this push. Add ${stem2}.test.ts covering it, commit, and push again \u2014 the host runs the checks.`
        );
      }
    }
  }
  return unavailable2.length ? { ok: true, unavailable: unavailable2 } : pass();
}
var MAX_BLOCKING_REVIEW_ROUNDS = 3;
function findingKey(finding4) {
  return finding4.toLowerCase().replace(/\s+/g, " ").trim();
}
function findingLocation(finding4) {
  const m = /([\w./\\-]+\.\w+):(\d+)/.exec(finding4);
  return m ? `${m[1].replace(/\\/g, "/").toLowerCase()}:${m[2]}` : null;
}
function findingMatchesPrior(finding4, prior) {
  const key = findingKey(finding4);
  if (!key) return false;
  const loc = findingLocation(finding4);
  return prior.some((p) => {
    const pk = findingKey(p);
    if (!pk) return false;
    if (key === pk) return true;
    const shorter = Math.min(key.length, pk.length);
    if (shorter >= 24 && (key.includes(pk) || pk.includes(key))) return true;
    const pl = findingLocation(p);
    return loc !== null && pl === loc;
  });
}
function priorsNamed(indices, priorBlocking) {
  if (!indices) return [];
  const still = [];
  const seen = /* @__PURE__ */ new Set();
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 1 || i > priorBlocking.length || seen.has(i)) continue;
    seen.add(i);
    const prior = priorBlocking[i - 1];
    if (prior) still.push(prior);
  }
  return still;
}
function applyReviewRoundCap(verdict, priorBlocking, round) {
  if (round < MAX_BLOCKING_REVIEW_ROUNDS || verdict.findings.length === 0) return verdict;
  const named = verdict.unresolvedPrior;
  const still = named ? priorsNamed(named, priorBlocking) : verdict.findings.filter((f) => findingMatchesPrior(f, priorBlocking));
  const blockingKeys = new Set(still.map(findingKey));
  const moved = verdict.findings.filter((f) => !blockingKeys.has(findingKey(f)));
  if (moved.length === 0 && still.length === verdict.findings.length && !named) return verdict;
  return {
    ...verdict,
    verdict: still.length > 0 ? "changes_requested" : "approved",
    findings: still,
    advisories: [...verdict.advisories ?? [], ...moved]
  };
}
function reviewGate(review, authorModels, currentDiffHash) {
  if (!review) {
    return refuse(
      "git_push refused: no independent review. The push gate requires one review sub-run by a model that did not author the change (PRD 45 OD-1); record it with the reviewer port, then push again."
    );
  }
  if (authorModels.includes(review.reviewerModel)) {
    return refuse(
      `git_push refused: reviewer ${review.reviewerModel} is one of the author models (${authorModels.join(", ")}). Run the review on a different model and push again.`
    );
  }
  if (review.diffHash !== currentDiffHash) {
    return refuse(
      "git_push refused: the diff changed after the review was recorded. Re-run the review on the current diff and push again."
    );
  }
  if (review.verdict === "changes_requested" && review.findings.length > 0) {
    const listed = review.findings.map((f, i) => `${i + 1}. ${f}`).join("; ");
    return refuse(
      `git_push refused: reviewer ${review.reviewerModel} requested changes. Findings: ${listed}. Address them and push again.`
    );
  }
  return pass();
}
function shellPublishHint(command) {
  if (!gitCommandPattern("commit|push").test(command)) return null;
  return "That shell command publishes. Use the git_commit / git_push tools instead: git_push runs the evidence gates and the independent review before the push leaves the machine.";
}

// ../packages/run-guards/src/scratchScript.ts
var SCRATCH_SCRIPT = /^_[^/\\]*\.(?:cjs|mjs)$/i;
var SCRATCH_DIR_SEGMENT = "builderforce-scratch";
function isScratchScriptPath(file) {
  const parts = file.split(/[/\\]/);
  if (parts.includes(SCRATCH_DIR_SEGMENT)) return true;
  return SCRATCH_SCRIPT.test(parts.pop() ?? "");
}

// ../packages/run-guards/src/shipPolicy.ts
var SHIP_MODES = ["leave_uncommitted", "commit", "commit_push", "pull_request"];
var DEFAULT_SHIP_POLICY = Object.freeze({
  mode: "commit",
  merge: "never",
  review: "none",
  source: "default"
});
function isShipMode(value) {
  return typeof value === "string" && SHIP_MODES.includes(value);
}
function shipPolicyOf(mode, source) {
  return { mode, merge: "never", review: "none", source };
}
var REPO_PUBLISH_TOOLS = /* @__PURE__ */ new Set([...PUBLISH_TOOLS, "git_cleanup_merged"]);
var TOOL_VERBS = {
  git_commit: "commit",
  git_push: "push",
  open_pull_request: "pull_request",
  git_cleanup_merged: "cleanup"
};
var RAW_COMMIT = gitCommandPattern("commit");
var RAW_PUSH = gitCommandPattern("push");
var ghPr = (sub) => new RegExp(`\\bgh\\s+(?:-{1,2}[\\w-]+(?:[=\\s]+[^-\\s]\\S*)?\\s+)*pr\\s+(?:${sub})\\b`, "i");
var RAW_PR_CREATE = ghPr("create|new");
var RAW_PR_MERGE = ghPr("merge");
var RAW_API_MERGE = /\b(?:gh\s+api|curl|wget)\b[^;&|\n]*?\/?(?:pulls|merge_requests)\/\d+\/merge\b/i;
function publishVerbOf(tool, args) {
  if (REPO_PUBLISH_TOOLS.has(tool)) return TOOL_VERBS[tool] ?? null;
  if (tool !== "run_command") return null;
  const command = shellCommandOf(args);
  if (!command) return null;
  if (RAW_PR_MERGE.test(command) || RAW_API_MERGE.test(command)) return "merge";
  if (RAW_PR_CREATE.test(command)) return "pull_request";
  if (RAW_PUSH.test(command)) return "push";
  if (RAW_COMMIT.test(command)) return "commit";
  return null;
}
var BASE_BRANCH = /^(?:main|master)$/i;
var RAW_PUSH_TAIL = /\bgit\s+(?:-[Cc]\s+\S+\s+|-\S+\s+|--\S+(?:=\S+)?\s+)*push\b([^;&|\n]*)/i;
var PUSH_VALUE_FLAGS = /* @__PURE__ */ new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
var CURRENT_BRANCH = /^(?:HEAD|@)$/;
var SHELL_WRAP = /^(?:\$\(|[\s"'`([{])+|[\s"'`)\]};]+$/g;
function pushOperands(tail) {
  const tokens = tail.trim().split(/\s+/).map((t) => t.replace(SHELL_WRAP, "")).filter(Boolean);
  const operands = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("-")) {
      if (PUSH_VALUE_FLAGS.has(t)) i++;
      continue;
    }
    operands.push(t);
  }
  return operands;
}
function pushesBaseBranch(tool, args) {
  if (tool === "git_push") return args?.allowBaseBranch === true;
  if (tool !== "run_command") return false;
  const tail = RAW_PUSH_TAIL.exec(shellCommandOf(args))?.[1];
  if (tail === void 0) return false;
  const refspecs = pushOperands(tail).slice(1);
  if (refspecs.length === 0) return true;
  return refspecs.some((spec2) => {
    const s = spec2.replace(/^\+/, "");
    if (/[$`]/.test(s)) return true;
    const colon = s.indexOf(":");
    if (colon < 0 && CURRENT_BRANCH.test(s)) return true;
    const dst = colon < 0 ? s : s.slice(colon + 1);
    return BASE_BRANCH.test(dst.replace(/^refs\/heads\//, ""));
  });
}
function shipSourceLabel(p) {
  switch (p.source) {
    case "project_settings":
      return "the project's settings";
    case "chat_hold":
      return p.hold ? `this chat's publish hold (set by user message #${p.hold.messageNumber}: "${p.hold.text.slice(0, 200)}")` : "this chat's publish hold";
    case "subagent":
      return "the sub-agent rule (the owner run ships once, after verifying the fan-out)";
    case "person_grant":
      return "a person's merge grant for this run";
    case "default":
      return "the default \u2014 the project's ship policy is unset";
  }
}
var MODE_SENTENCE = {
  leave_uncommitted: "leave every change uncommitted",
  commit: "commit locally, never push or open a pull request",
  commit_push: "commit and push the base branch, never open a pull request",
  pull_request: "push a branch and open a pull request, never push the base branch or merge"
};
function modeSentence(p, host) {
  if (host === "cloud" && p.mode === "pull_request") {
    return "your changes on the run branch become a pull request when the run ends, never push or merge the base branch";
  }
  return MODE_SENTENCE[p.mode];
}
var INSTEAD = {
  leave_uncommitted: "Leave the changes uncommitted and finish with the list of changed paths and what still needs validation.",
  commit: "Keep the commit local and report its hash; do not push.",
  commit_push: "Commit and push the base branch instead; do not open a pull request.",
  pull_request: "Commit on a branch, push that branch and open_pull_request instead."
};
var CLOUD_INSTEAD = "Keep your changes on the run branch and finish the run: the platform opens the pull request when it ends.";
var NEVER_MERGE = "A run never merges a pull request: the project's merge sweep merges it by the project's settings (merge authority, merge timing, sign-off).";
function publishAllowed(p, tool, args, host = "editor") {
  const verb = publishVerbOf(tool, args);
  if (!verb) return { ok: true };
  let refused;
  if (verb === "merge") refused = true;
  else if (host === "cloud" && tool === "run_command" && (verb === "push" || verb === "pull_request")) refused = true;
  else switch (p.mode) {
    case "leave_uncommitted":
      refused = true;
      break;
    case "commit":
      refused = verb !== "commit";
      break;
    case "commit_push":
      refused = verb === "pull_request";
      break;
    case "pull_request":
      refused = (verb === "push" || verb === "cleanup") && pushesBaseBranch(tool, args);
      break;
  }
  if (!refused) return { ok: true };
  const what = verb === "pull_request" ? "pull request" : verb === "merge" ? "merge" : verb;
  const instead = verb === "merge" ? NEVER_MERGE : host === "cloud" ? CLOUD_INSTEAD : INSTEAD[p.mode];
  return {
    ok: false,
    error: `Ship policy refused this ${what}: the policy is \`${p.mode}\` (${modeSentence(p, host)}), set by ${shipSourceLabel(p)}. ${instead} Do not ask the person to change it mid-run; state the policy in your final report.`
  };
}
function narrowByHold(p, hold) {
  if (!hold) return p;
  if (p.source === "subagent") return p;
  return { mode: "leave_uncommitted", merge: "never", review: p.review, source: "chat_hold", hold: { messageNumber: hold.messageNumber, text: hold.text } };
}
function finalReportLine(p) {
  const named = p.source === "default" ? ` Then add: "The project's ship policy is unset \u2014 set it (leave_uncommitted, commit, commit_push or pull_request) in the project's settings, or ask me to set it."` : "";
  return `FINAL REPORT \u2014 state the policy you shipped under, as "Ship policy: ${p.mode} (${shipSourceLabel(p)})".${named}`;
}
var NEVER_ASK = "This is a standing rule, not a question: never ask the person whether to commit, push or open a pull request (not in prose, not with ask_user), and never ask them to approve a publish \u2014 the policy IS their approval.";
var REVIEW_CHECKLIST = 'against what the ticket and the user asked for: bugs, leftover debug code, edits unrelated to the task, missing tests or localisation. If you find a problem, FIX it and review again. Do NOT record builtin_reviews_record with verdict "complete" yourself: the author never records its own completion review \u2014 the independent review the ship gate runs over your diff records it.';
var SELF_REVIEW = `SELF-REVIEW \u2014 read your own diff with \`git_diff\` ${REVIEW_CHECKLIST}`;
var CLOUD_SELF_REVIEW = `SELF-REVIEW \u2014 re-read every file you changed ${REVIEW_CHECKLIST}`;
function mergeSentence(p) {
  if (p.source === "person_grant") {
    return "A person authorized merging this pull request into main: the platform merges it once the security scan and CI pass. Never merge or push the base branch yourself.";
  }
  const merge = p.merge === "never" ? "A human merges it." : p.merge === "on_green" ? "The project's merge sweep merges it once CI is green." : "The project's merge sweep merges it once it is opened.";
  const review = p.review === "required" ? " An independent review or sign-off must be recorded before it merges." : "";
  return `${merge}${review}`;
}
function shipStep(p, host) {
  if (host === "cloud") {
    return `SHIP \u2014 your changes on the run branch are the deliverable; when the run ends the platform opens the pull request. Never push or merge the base branch, and do not try to open the pull request yourself \u2014 ${mergeSentence(p)}`;
  }
  const paths = "exactly the `paths` you changed (never a catch-all: the tree may hold the human's own work)";
  switch (p.mode) {
    case "commit":
      return `SHIP \u2014 \`git_commit\` with allowBaseBranch:true and ${paths}. Do NOT push and do not open a pull request: the policy keeps the commit local.`;
    case "commit_push":
      return `SHIP \u2014 \`git_commit\` with allowBaseBranch:true and ${paths}, then \`git_push\` with allowBaseBranch:true. Do not open a pull request.`;
    case "pull_request":
      return `SHIP \u2014 \`git_commit\` on a \`branch\` with ${paths}, \`git_push\` that branch (never allowBaseBranch), then \`open_pull_request\`. Never push the base branch and never merge \u2014 ${mergeSentence(p)}`;
    case "leave_uncommitted":
      return "";
  }
}
function selfReview(host) {
  return host === "cloud" ? CLOUD_SELF_REVIEW : SELF_REVIEW;
}
function closeStep(p, trackingTicket, host) {
  if (host === "cloud") {
    return "CLOSE \u2014 finish the run with a summary of what you changed and how you verified it. The ticket closes when the pull request merges; do not move it to done yourself. Move any OTHER linked ticket this change fully delivers with builtin_tasks_update.";
  }
  const others = "Move any OTHER linked ticket this change fully delivers with builtin_tasks_update.";
  switch (p.mode) {
    case "commit":
      return `CLOSE \u2014 report the commit hash. The ticket tracking this change (${trackingTicket}) stays in review until the commit is pushed. ${others}`;
    case "commit_push":
      return `CLOSE \u2014 the push reports the branch it landed on. Once it lands on the base branch with nothing left to push, the in_review ticket tracking this change (${trackingTicket}) moves to done automatically. Never defer the close-out to a later run or ask the user to continue for it. ${others} Report the commit hash and the push result.`;
    case "pull_request":
      return `CLOSE \u2014 report the pull request. The ticket tracking this change (${trackingTicket}) closes when the PR merges. ${others}`;
    case "leave_uncommitted":
      return "";
  }
}
function shipDirective(p, context = {}) {
  const host = context.host ?? "editor";
  const head = `SHIP POLICY \u2014 ${modeSentence(p, host)} (\`${p.mode}\`, set by ${shipSourceLabel(p)}). ${NEVER_ASK}`;
  if (p.mode === "leave_uncommitted") {
    const who = p.source === "subagent" ? " You are a sub-agent: your owner verifies the whole fan-out and ships it once, so report the paths you changed and how you verified them." : "";
    return `${head}
Do NOT run git_commit, git_push, open_pull_request or git_cleanup_merged, and do not publish through a raw \`git commit\` / \`git push\` / \`gh pr create\` shell command \u2014 the tool gate refuses them.${who}
1. VERIFY \u2014 ${VERIFY_STEP}
2. LEAVE IT \u2014 finish your turn with the list of changed paths and what still needs validation, so the person can review.
3. ${finalReportLine(p)}`;
  }
  const trackingTicket = context.chatId != null ? `builtin_chats_list_tickets with chatId=${context.chatId} lists it` : "the one builtin_tickets_from_delta returned for it";
  return `${head} When your turn changes code, finish it in this order:
1. VERIFY \u2014 ${VERIFY_STEP}
2. ${selfReview(host)}
3. ${shipStep(p, host)}
4. ${closeStep(p, trackingTicket, host)}
5. ${finalReportLine(p)}
` + (host === "cloud" ? "If a check fails or a call is refused, report the exact error \u2014 never claim a change is verified or shipped when it is not." : "If a commit, push or pull request is refused or fails, report the exact error \u2014 never claim a change shipped when it did not.");
}
function shipNudge(p, host = "editor") {
  if (p.mode === "leave_uncommitted") return null;
  if (host === "cloud") {
    return `You changed code in this run and ended the turn without finishing it. The ship policy is \`${p.mode}\` (set by ${shipSourceLabel(p)}) \u2014 finish it now, without asking: verify it, re-read every file you changed, then finish the run with a summary \u2014 the platform opens the pull request when the run ends; never push or merge the base branch. If you genuinely cannot finish \u2014 the change is incomplete, or verification fails and you cannot fix it \u2014 say so plainly at the TOP of your answer and name exactly what is left.`;
  }
  const ship = p.mode === "commit" ? "`git_commit` (allowBaseBranch:true, exactly the paths you changed) \u2014 do not push" : p.mode === "commit_push" ? "`git_commit` (allowBaseBranch:true, exactly the paths you changed) and `git_push` (allowBaseBranch:true)" : "`git_commit` on a `branch` (exactly the paths you changed), `git_push` that branch and `open_pull_request`";
  return `You changed code in this run and ended the turn without shipping it. The ship policy is \`${p.mode}\` (set by ${shipSourceLabel(p)}) \u2014 finish it now, without asking: verify it \u2014 ${VERIFY_STEP} Then self-review your diff with \`git_diff\`, then ${ship}. If you genuinely cannot ship \u2014 the change is unfinished, or verification fails and you cannot fix it \u2014 say so plainly at the TOP of your answer and name exactly what is left.`;
}

// src/finishReason.ts
var TRUNCATED_REASONS = /* @__PURE__ */ new Set(["length", "max_tokens", "maxtokens", "model_length", "output_limit"]);
var MALFORMED_TOOL_CALL_REASONS = /* @__PURE__ */ new Set(["malformed_function_call", "malformed_tool_call", "invalid_tool_call"]);
var normalise2 = (finishReason) => (finishReason ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
function turnInterruption(finishReason) {
  const reason = normalise2(finishReason);
  if (!reason) return null;
  if (TRUNCATED_REASONS.has(reason)) return "truncated";
  if (MALFORMED_TOOL_CALL_REASONS.has(reason)) return "malformed-tool-call";
  return null;
}
function isTruncatedTurn(finishReason) {
  return turnInterruption(finishReason) === "truncated";
}
function isMalformedToolCall(finishReason) {
  return turnInterruption(finishReason) === "malformed-tool-call";
}

// src/ticketToolVocabulary.ts
var SERVER_TICKET_CREATE_TOOL = "builtin_tasks_create";
var SERVER_TICKET_LINK_TOOL = "builtin_chats_link_ticket";
var LOCAL_TICKET_CREATE_TOOL = "ticket-create";
var LOCAL_TICKET_CREATE_LABEL = /ticket[-_.]create/i;
var TICKET_WRITE_TOOL = new RegExp(
  `(tasks|objectives|key_results|initiatives|portfolios|specs|roadmap)[._]create|chats[._]link_ticket|tickets[._]from_delta|${LOCAL_TICKET_CREATE_LABEL.source}`,
  "i"
);
function isTicketWriteTool(label) {
  return TICKET_WRITE_TOOL.test(label);
}
var SERVER = Object.freeze({
  createTool: SERVER_TICKET_CREATE_TOOL,
  local: false,
  kanbanScoping: true,
  createName: SERVER_TICKET_CREATE_TOOL
});
var SERVER_TICKET_TOOLS = SERVER;
function ticketToolVocabulary(toolNames) {
  if (!toolNames) return SERVER;
  const names = new Set(toolNames);
  if (names.has(LOCAL_TICKET_CREATE_TOOL)) {
    return Object.freeze({
      createTool: LOCAL_TICKET_CREATE_TOOL,
      local: true,
      kanbanScoping: false,
      createName: LOCAL_TICKET_CREATE_TOOL
    });
  }
  if (names.has(SERVER_TICKET_CREATE_TOOL)) return SERVER;
  return Object.freeze({ ...SERVER, createTool: void 0 });
}
function isLocalTicketCreateLabel(label) {
  return LOCAL_TICKET_CREATE_LABEL.test(label);
}
var SERVER_TICKET_MOVE_TOOL = "builtin_tasks_update";
var LOCAL_TICKET_MOVE_TOOL = "ticket-move";
var TICKET_FROM_DELTA_TOOL = "builtin_tickets_from_delta";
function ticketStatusMove(ref, status, vocabulary) {
  const text = typeof ref === "string" ? ref.trim() : null;
  const parsed = parseEntityRef(text ?? ref);
  if (parsed && "local" in parsed) return { tool: LOCAL_TICKET_MOVE_TOOL, args: { id: parsed.local, status } };
  if (parsed && "sync" in parsed) {
    return vocabulary.local ? { tool: LOCAL_TICKET_MOVE_TOOL, args: { id: syncIdText(parsed.sync), status } } : { tool: SERVER_TICKET_MOVE_TOOL, args: { id: parsed.sync, status } };
  }
  if (parsed) return null;
  return vocabulary.local && text ? { tool: LOCAL_TICKET_MOVE_TOOL, args: { id: text, status } } : null;
}

// src/toolResultRecord.ts
function toolResultRecord(result) {
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return result && typeof result === "object" ? result : null;
}
function entityIdsOf(result) {
  const record5 = toolResultRecord(result);
  if (!record5) return { localId: null, syncId: null };
  const idRef = parseEntityRef(record5.id);
  const syncId = parseSyncId(record5.syncId) ?? parseSyncId(record5.taskId) ?? (idRef && "sync" in idRef ? idRef.sync : null);
  const localId = isLocalId(record5.localId) ? record5.localId : idRef && "local" in idRef ? idRef.local : null;
  return { localId, syncId };
}

// src/chatWorkLinking.ts
var TICKET_RECORDING_TOOLS = /* @__PURE__ */ new Set([
  TICKET_FROM_DELTA_TOOL,
  "builtin_chats_link_ticket",
  "builtin_reviews_record",
  // The editor's device-local create: it IS the recording — it links its chat LOCALLY in
  // the create's own transaction, and the link syncs to the account with the ticket.
  LOCAL_TICKET_CREATE_TOOL
]);
var CHAT_STAMPED_CREATE_TOOLS = /* @__PURE__ */ new Set([
  "builtin_tasks_create",
  "builtin_objectives_create",
  "builtin_specs_create",
  "builtin_portfolios_create",
  "builtin_initiatives_create",
  // Team ceremonies: a retro or estimation session set up FROM a conversation is that
  // conversation's outcome, so it links like any other item the agent creates.
  "builtin_retro_create",
  "builtin_poker_create_session"
]);
function stampRunChat(toolName, args, serverChatId) {
  if (!CHAT_STAMPED_CREATE_TOOLS.has(toolName)) return;
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const bag = args;
  if (serverChatId != null) bag.chatId = serverChatId;
  else delete bag.chatId;
}
function createLinkedToChat(toolName, result) {
  if (!CHAT_STAMPED_CREATE_TOOLS.has(toolName)) return false;
  let row = result;
  if (typeof row === "string") {
    try {
      row = JSON.parse(row);
    } catch {
      return false;
    }
  }
  if (!row || typeof row !== "object") return false;
  const link = row.chatLink;
  return !!link && typeof link === "object" && link.linked === true;
}
function isTicketRecordingTool(name) {
  return TICKET_RECORDING_TOOLS.has(name);
}
var READ_ONLY_PLATFORM_SUFFIXES = [
  "_list",
  "_get",
  "_search",
  "_recall",
  "_read",
  "_assignees",
  "_audit",
  "_trace",
  "_tree",
  "_rollup",
  "_runs",
  "_graph",
  "_triggers",
  "_metrics",
  "_usage",
  "_query",
  "_health",
  "_models",
  "_providers",
  "_proposals",
  "_ticket_lineage",
  "_get_messages",
  "_run_targets",
  "_activity_calendar",
  "_check_key",
  "_browse_public",
  "_tool_audit",
  "_task_file_changes",
  "_list_active",
  "_list_agents",
  "_list_all",
  "_list_for_task",
  "_list_mine",
  "_list_recent",
  "_list_tickets",
  "_list_sessions",
  "_list_users",
  "_list_templates",
  "_list_purchased",
  "_list_directories",
  "_list_error_groups",
  "_list_pull_requests",
  "_get_session",
  "_get_stats",
  "_get_user",
  "_get_config",
  "_get_access",
  "_get_error_group",
  // The BOARD-SURVEY reads. All three are `mutates: false` and all three are expensive —
  // `tickets.pending_changes` compares every ticket branch against its base, and the
  // stall census walks every non-terminal ticket. Their absence here is what let VS Code
  // chat #115 (2026-09-20) call `builtin_tickets_pending_changes` twice with BYTE-
  // IDENTICAL arguments, six seconds and 19 KB apiece, for an answer already in its
  // context. Safe to dedupe only because a `git_push` / `open_pull_request` now forgets
  // platform reads (see `REPO_PUBLISH_TOOLS`) — these read branch state, so a run that
  // pushes between two surveys must see the second one for real.
  "_pending_changes",
  "_stalled_tickets",
  "_census"
];
function isReadOnlyPlatformTool(name) {
  if (!name.startsWith("builtin_")) return false;
  return READ_ONLY_PLATFORM_SUFFIXES.some((s) => name.endsWith(s));
}
function isMutatingPlatformTool(name) {
  return name.startsWith("builtin_") && !isReadOnlyPlatformTool(name);
}
var NOT_STARTED_TASK_STATUSES = /* @__PURE__ */ new Set(["backlog", "todo", "ready"]);
function linkedTicketsToAdvance(listResult) {
  return refsOf(selectLinkedTasks(listResult, inLane(NOT_STARTED_TASK_STATUSES)));
}
var inLane = (statuses) => (status) => statuses.has(status);
var refsOf = (rows) => rows.map(({ kind, ref }) => ({ kind, ref }));
function listedRows(listResult) {
  let rows = listResult;
  if (typeof rows === "string") {
    try {
      rows = JSON.parse(rows);
    } catch {
      return [];
    }
  }
  if (rows && typeof rows === "object" && !Array.isArray(rows)) rows = rows.tickets;
  return Array.isArray(rows) ? rows : [];
}
function selectLinkedTasks(listResult, keep) {
  const out = [];
  for (const r of listedRows(listResult)) {
    if (!r || typeof r !== "object") continue;
    const row = r;
    if (typeof row.kind !== "string" || !TASK_TABLE_KINDS.has(row.kind)) continue;
    if (row.exists === false) continue;
    const { syncId } = entityIdsOf({ syncId: row.syncId, id: row.ref });
    if (syncId == null) continue;
    const ref = syncIdText(syncId);
    if (typeof row.status !== "string") continue;
    const status = row.status.toLowerCase();
    if (!keep(status)) continue;
    const title = typeof row.label === "string" ? row.label : typeof row.title === "string" ? row.title : "";
    out.push({ kind: row.kind, ref, status, title });
  }
  return out;
}
var ALLOWED_OPEN_END_STATUSES = /* @__PURE__ */ new Set(["blocked", "in_review"]);
function linkedTaskRows(listResult) {
  return selectLinkedTasks(listResult, () => true);
}
function linkedTicketsStillOpen(listResult) {
  return selectLinkedTasks(listResult, isOpenLinkedStatus);
}
var CHAT_TICKET_LIST_TOOL = "builtin_chats_list_tickets";
function canListChatTickets(tools) {
  return tools === void 0 || declaresChatTicketListing(tools);
}
function declaresChatTicketListing(tools) {
  return (tools ?? []).some((t) => t.function.name === CHAT_TICKET_LIST_TOOL);
}
function linkedTicketsToAdvanceFor(listResult, owned) {
  const underOpenEpic = linkedTicketsStillOpen(listResult).some((t) => t.kind === "epic");
  return linkedTicketsToAdvance(listResult).filter((t) => !underOpenEpic || owned.has(t.ref));
}
function isOpenLinkedStatus(status) {
  const lane = status.toLowerCase();
  return !isClosedTaskStatus(lane) && !ALLOWED_OPEN_END_STATUSES.has(lane);
}
var SHIPPABLE_TASK_STATUSES = /* @__PURE__ */ new Set(["in_review"]);
function linkedTicketsToComplete(listResult) {
  return refsOf(selectLinkedTasks(listResult, inLane(SHIPPABLE_TASK_STATUSES)));
}
var REVIEWED_TASK_STATUSES = /* @__PURE__ */ new Set(["in_progress", "in_review"]);
function linkedTicketsReviewedComplete(listResult, reviewedTaskIds) {
  const reviewed = new Set(reviewedTaskIds.map(String));
  return refsOf(selectLinkedTasks(listResult, inLane(REVIEWED_TASK_STATUSES)).filter((ticket) => reviewed.has(ticket.ref)));
}
function codeChangeFile(args) {
  if (args && typeof args === "object" && "path" in args) {
    const p = args.path;
    if (typeof p === "string" && p.trim()) return p;
  }
  return null;
}
function codeChangeFiles(args) {
  const files = [];
  const top = codeChangeFile(args);
  if (top) files.push(top);
  const edits = args && typeof args === "object" ? args.edits : void 0;
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      const p = codeChangeFile(edit);
      if (p && !files.includes(p)) files.push(p);
    }
  }
  return files;
}
function chatWorkObligationTools(chatId, tickets = SERVER_TICKET_TOOLS) {
  const linked = chatId != null;
  if (tickets.local) {
    return [LOCAL_TICKET_CREATE_TOOL, LOCAL_TICKET_MOVE_TOOL, SERVER_TICKET_MOVE_TOOL, TICKET_FROM_DELTA_TOOL, ...linked ? [CHAT_TICKET_LIST_TOOL] : []];
  }
  return [tickets.createName, SERVER_TICKET_MOVE_TOOL, TICKET_FROM_DELTA_TOOL, ...linked ? [CHAT_TICKET_LIST_TOOL] : []];
}
function chatWorkLinkingDirective(chatId, tickets = SERVER_TICKET_TOOLS) {
  const linked = chatId != null;
  const createBullet = tickets.local ? `\u2022 When your investigation concludes that something needs to be DONE \u2014 a bug to fix, a missing capability, a follow-up, or a gap you identified \u2014 do not merely describe it. Create the work item with ${tickets.createName} (projectId, title, description, taskType "task", "epic", or "gap"; file an epic first, then its tasks with parentTicketId=<the epic's returned id>; or the matching builtin_*_create for an objective, spec, or roadmap item). It is saved on this device, syncs to the account in the background and is linked to this chat automatically \u2014 do NOT call builtin_chats_link_ticket, and do not create tickets with builtin_tasks_create. The id it returns is a LOCAL id: use it with the ticket-* tools.
` : `\u2022 When your investigation concludes that something needs to be DONE \u2014 a bug to fix, a missing capability, a follow-up, or a gap you identified \u2014 do not merely describe it. First use builtin_tasks_assignees to select the ticket's accountable Coordinator/Manager, then create the work item (${tickets.createName} with exactly one assignee and taskType "task", "epic", or "gap"; or the matching builtin_*_create for an objective, spec, or roadmap item)${linked ? `. It is linked to this chat automatically \u2014 do not call ${SERVER_TICKET_LINK_TOOL} for an item you just created` : ""}. The ticket assignee COORDINATES delivery; do not assume that person/agent performs every specialist contribution.
`;
  const scopingBullet = tickets.kanbanScoping ? `\u2022 Every created ticket must be resource-scoped before you report success: inspect its template manifest with builtin_kanban_participants; infer all additional roles required by its description and acceptance criteria; add each with builtin_kanban_assess_resource; then call builtin_kanban_accountability and explicitly report any unstaffed resource gaps. For an epic or multi-role ticket, call builtin_kanban_materialize_work_items so each required resource has an assigned child work item. Call builtin_kanban_coordinate when work should begin now. Never treat 0 required roles / 0 sign-offs as complete.
` : `\u2022 A ticket filed with ${tickets.createName} is on this device first. The builtin_kanban_* resource-scoping tools address the account's tickets, so use them on a ticket only once it has synced (they answer plainly when it has not); file the work first and scope, staff and coordinate it afterwards.
`;
  const statusTool = tickets.local ? `ticket-move (id=<its local id>, status="in_progress") for a ticket filed here, or builtin_tasks_update (id=<the ticket's ref>, status="in_progress") for one that exists only on the account` : `builtin_tasks_update (id=<the ticket's ref>, status="in_progress")`;
  return (linked ? `You are working inside Brain chat #${chatId}. Tie the work of this conversation back to it:
` : `This conversation lives only on this machine \u2014 it has no platform chat to link work to, so never pass a chatId and do not call builtin_chats_link_ticket or builtin_chats_list_tickets. Still make the work visible on the board:
`) + createBullet + scopingBullet + (linked ? `\u2022 When your turn ADDS or CHANGES code, record it with ${TICKET_FROM_DELTA_TOOL} (chatId=${chatId}, the current projectId, the files you touched, kind improvement|fix|bug, modality "ide"). If builtin_chats_list_tickets shows a ticket already tracking this work, pass its numeric ref as taskId so the delta attaches to it instead of creating a duplicate; otherwise the delta creates a linked ticket that completes when it ships.
` : `\u2022 When your turn ADDS or CHANGES code, record it with ${TICKET_FROM_DELTA_TOOL} (the current projectId, the files you touched, kind improvement|fix|bug, modality "ide"; no chatId). If a ticket you already know of tracks this work, pass its numeric ref as taskId so the delta attaches to it instead of creating a duplicate.
`) + `\u2022 Keep the board honest about STATUS. The MOMENT you start actively working an existing ${linked ? "linked " : ""}task/epic/gap \u2014 investigating its fix, editing code for it, or driving it \u2014 move it out of the backlog with ${statusTool}. When the work is finished: if this session can commit and push (it has git_commit and git_push), self-review it and ship it as the SHIP POLICY contract says (it names when the ticket moves to "done"); otherwise advance it to "in_review" for someone who can (or "done" if it needs no review). Never leave a ticket you are actively working sitting in backlog.` + (linked ? `
\u2022 When an open EPIC is linked to this chat, its remaining work belongs under it: record a code change for it with ${TICKET_FROM_DELTA_TOOL} passing parentTaskId=<the epic's numeric ref> (so a newly minted ticket is filed under the epic), and file a child task with ${tickets.createName} (${tickets.local ? "parentTicketId" : "parentTaskId"}=<the epic's ref>) for each remaining slice of the epic that has no ticket yet.` : "") + (linked ? `
\u2022 Call builtin_chats_list_tickets (chatId=${chatId}) to see what is already linked \u2014 both to AVOID creating a duplicate and to know which linked tickets need their status advanced. Never end a turn having identified actionable work or changed code without it being a ticket linked to this chat whose status reflects the work you did.` : `
\u2022 Never end a turn having identified actionable work or changed code without it being a ticket whose status reflects the work you did.`);
}

// ../packages/agent-run/src/policy/tools/toolVocabulary.ts
var EQUIVALENCE_CLASSES = [
  // The work item itself. `ticket` is the product's word and `task` is the catalog's;
  // this one class is what makes every `tasks.*` tool reachable from a ticket question.
  ["task", "ticket", "issue", "story", "backlog", "todo"],
  // The board and its geography.
  ["kanban", "board", "lane", "swimlane", "column", "card"],
  // Source control.
  ["repo", "repository", "codebase", "git"],
  ["branch", "commit", "merge", "rebase"],
  ["pr", "pull", "pullrequest"],
  // People. `member` is the catalog's word; the rest are what users type.
  ["member", "teammate", "colleague", "people", "person", "staff"],
  // Conversations.
  ["chat", "conversation", "thread"],
  // Delivery planning. `epic` stays OUT of the objective class on purpose — objectives/
  // OKRs and epics are different entities with different tools.
  ["epic", "feature"],
  ["objective", "okr", "keyresult"],
  // Runs.
  ["execution", "run", "dispatch"]
];
var SYNONYMS = (() => {
  const map = /* @__PURE__ */ new Map();
  for (const group2 of EQUIVALENCE_CLASSES) {
    for (const term of group2) {
      const existing = map.get(term) ?? [];
      for (const other of group2) if (!existing.includes(other)) existing.push(other);
      map.set(term, existing);
    }
  }
  return map;
})();
function synonymsFor(stem2) {
  return SYNONYMS.get(stem2) ?? [];
}
function expandWithSynonyms(stems) {
  const expanded = /* @__PURE__ */ new Set();
  for (const stem2 of stems) {
    for (const synonym of synonymsFor(stem2)) {
      if (!stems.has(synonym)) expanded.add(synonym);
    }
  }
  return expanded;
}

// ../packages/agent-run/src/policy/tools/selectTools.ts
var DEFAULT_TOOL_LIMIT = 64;
var PINNED_OVERFLOW = 16;
var NAME_HIT = LEXICAL_WEIGHTS.name;
var NAME_SYNONYM_HIT = 7;
var DESCRIPTION_HIT = LEXICAL_WEIGHTS.description;
function scoreTool(toolName, description, stems, synonyms) {
  let score2 = 0;
  for (const token of lexicalStems(toolName)) {
    if (stems.has(token)) score2 += NAME_HIT;
    else if (synonyms.has(token)) score2 += NAME_SYNONYM_HIT;
  }
  for (const token of lexicalStems(description)) {
    if (stems.has(token)) score2 += DESCRIPTION_HIT;
    else if (synonyms.has(token)) score2 += Math.ceil(DESCRIPTION_HIT / 2);
  }
  return score2;
}
function selectToolsForTurn(tools, options = {}) {
  const catalog = tools ?? [];
  const available = catalog.length;
  if (available === 0) return { tools: [], trimmed: false, available: 0 };
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_TOOL_LIMIT));
  if (available <= limit) {
    return { tools: [...catalog], trimmed: false, available };
  }
  const byName = /* @__PURE__ */ new Map();
  for (const tool of catalog) {
    const name = tool.function?.name;
    if (name && !byName.has(name)) byName.set(name, tool);
  }
  const query = (options.query ?? "").toLowerCase();
  const stems = lexicalStems(query);
  const synonyms = expandWithSynonyms(stems);
  const wanted = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (tool) => {
    const name = tool?.function?.name;
    if (!tool || !name || seen.has(name)) return;
    seen.add(name);
    wanted.push(tool);
  };
  if (options.capRequired) {
    const required = new Set(options.required ?? []);
    for (const tool of catalog) {
      if (wanted.length >= limit) break;
      if (required.has(tool.function?.name ?? "")) push(tool);
    }
  } else {
    for (const name of options.required ?? []) push(byName.get(name));
  }
  const roomAfterRequired = Math.max(0, limit - wanted.length);
  const rest = catalog.filter((t) => t.function?.name && !seen.has(t.function.name));
  const ranked2 = options.rank ? options.rank(rest, options.query ?? "") : [...rest].map((tool) => ({
    tool,
    score: scoreTool(tool.function?.name ?? "", tool.function?.description ?? "", stems, synonyms)
  })).filter((entry) => options.backfill !== false || entry.score > 0).sort((a, b) => b.score - a.score || (a.tool.function?.name ?? "").localeCompare(b.tool.function?.name ?? "")).map((entry) => entry.tool);
  for (const tool of ranked2.slice(0, roomAfterRequired)) push(tool);
  const inFixed = new Set(wanted.map((t) => t.function?.name));
  if (options.backfill !== false) {
    for (const tool of catalog) {
      const name = tool.function?.name;
      if (name && !inFixed.has(name) && wanted.length < limit) push(tool);
    }
  }
  const fixed = [];
  const fixedNames = new Set(wanted.map((t) => t.function?.name));
  for (const tool of catalog) {
    const name = tool.function?.name;
    if (name && fixedNames.has(name)) fixed.push(tool);
  }
  const overflowCap = limit + PINNED_OVERFLOW;
  const pinnedOut = [];
  for (const name of options.pinned ?? []) {
    if (pinnedOut.length >= Math.max(0, overflowCap - fixed.length)) break;
    const tool = byName.get(name);
    const toolName = tool?.function?.name;
    if (!tool || !toolName || fixedNames.has(toolName)) continue;
    if (pinnedOut.some((t) => t.function?.name === toolName)) continue;
    pinnedOut.push(tool);
  }
  return { tools: [...fixed, ...pinnedOut], trimmed: true, available };
}

// ../packages/tool-output-policy/src/textCut.ts
function keepTail(text, max) {
  if (text.length <= max) return text;
  return text.slice(text.length - max);
}
var DEFAULT_TRUNCATION_SUFFIX = "\n\n\u26A0\uFE0F [Content truncated \u2014 original was too large for the model's context window. The content above is a partial view. If you need more, request specific sections or use offset/limit parameters to read smaller chunks.]";
function cutHead(text, maxChars, opts = {}) {
  if (text.length <= maxChars) return text;
  const suffix = opts.suffix ?? DEFAULT_TRUNCATION_SUFFIX;
  const snap = opts.snap ?? 0.8;
  const keep = Math.max(opts.minKeep ?? 0, maxChars - suffix.length);
  if (keep <= 0) return opts.emptyNotice ?? suffix.trim();
  let cutPoint = keep;
  const lastNewline = text.lastIndexOf("\n", keep);
  if (lastNewline > keep * snap) cutPoint = lastNewline;
  return text.slice(0, cutPoint) + suffix;
}
var MARKER_RESERVE = 160;
function countLines(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
function cutHeadTail(text, maxChars, opts = {}) {
  if (text.length <= maxChars) return text;
  const budget = maxChars - MARKER_RESERVE;
  if (budget <= 0) return keepTail(text, Math.max(0, maxChars));
  const headShare = Math.min(1, Math.max(0, opts.headShare ?? 0.25));
  const headBudget = Math.floor(budget * headShare);
  const tailBudget = budget - headBudget;
  let headEnd = headBudget;
  const nl = text.lastIndexOf("\n", headBudget);
  if (nl > headBudget * 0.8) headEnd = nl;
  let tailStart = text.length - tailBudget;
  const nextNl = text.indexOf("\n", tailStart);
  if (nextNl >= 0 && nextNl - tailStart < tailBudget * 0.2) tailStart = nextNl + 1;
  const head = text.slice(0, headEnd);
  const tail = text.slice(tailStart);
  const elided = text.slice(headEnd, tailStart);
  const marker = `
\u2026[${elided.length.toLocaleString("en-US")} chars (${countLines(elided).toLocaleString("en-US")} lines) elided \u2014 showing the first ${head.length.toLocaleString("en-US")} and the last ${tail.length.toLocaleString("en-US")} of ${text.length.toLocaleString("en-US")} chars]\u2026
`;
  return `${head}${marker}${tail}`;
}
var defaultMiddleMarker = (omitted) => `
\u2026(${omitted.toLocaleString("en-US")} chars omitted from the middle)\u2026
`;
var isHighSurrogate = (c) => c >= 55296 && c <= 56319;
var isLowSurrogate = (c) => c >= 56320 && c <= 57343;
function safePrefix(s, n) {
  let end = Math.max(0, Math.min(n, s.length));
  if (end > 0 && end < s.length && isHighSurrogate(s.charCodeAt(end - 1))) end -= 1;
  return s.slice(0, end);
}
function safeSuffix(s, n) {
  if (n <= 0) return "";
  let start = Math.max(0, s.length - n);
  if (start > 0 && isLowSurrogate(s.charCodeAt(start))) start += 1;
  return s.slice(start);
}
function truncateMiddle(text, max, opts = {}) {
  if (text.length <= max) return text;
  const { marker = defaultMiddleMarker, symmetric = false } = opts;
  const markerFor = typeof marker === "string" ? () => marker : marker;
  const room = Math.max(0, max - markerFor(text.length).length);
  if (room === 0) return safePrefix(text, max);
  const tailShare = Math.floor(room / 2);
  const head = safePrefix(text, symmetric ? tailShare : room - tailShare);
  const tail = safeSuffix(text, tailShare);
  return `${head}${markerFor(text.length - head.length - tail.length)}${tail}`;
}

// ../packages/tool-output-policy/src/caps.ts
var DEFAULT_TOOL_OUTPUT_CHARS = 6e3;
var TOOL_OUTPUT_CAPS = {
  read_file: 16e3,
  run_command: 2e4,
  exec: 2e4,
  bash: 2e4,
  git_status: 2e4,
  git_diff: 2e4,
  git_history: 2e4,
  git_sync_latest: 2e4,
  git_undo: 2e4,
  git_redo: 2e4,
  // Up to four children's reports in one result, each capped by agent-tools'
  // `SUBAGENT_REPORT_CHARS`. A research child's report IS its deliverable: under the 6K
  // default a wait on four left the owner ~1.5K of each, and it re-spawned researchers
  // to recover what was cut (VS Code chat #6). Four full reports plus each one's header
  // and cut marker; `subagentReportBudget.test.ts` (brain-embedded) holds the two together.
  wait_agents: 34e3,
  // The Creation Canvas's reads. A board snapshot is the whole board as JSON and a real
  // board runs to tens of KB; under the 6K default the model was handed a sliver of it and
  // asked the user to re-select objects that were already there. A build file is paged
  // like `read_file` (see {@link PAGED_READ_TOOLS}).
  canvas_read_snapshot: 64e3,
  canvas_read_object: 32e3,
  canvas_read_build_file: 16e3
};
var INDEX_RESULT_CHARS = 24e3;
var TASK_INDEX_FORMAT = "id|status|type|parent|title";
var INDEX_FORMATS = /* @__PURE__ */ new Set([TASK_INDEX_FORMAT]);
var INDEX_RESULT_TOOLS = /* @__PURE__ */ new Set(["tasks.list", "builtin_tasks_list"]);
function isIndexResult(tool, out) {
  if (!INDEX_RESULT_TOOLS.has(tool)) return false;
  if (!out || typeof out !== "object" || Array.isArray(out)) return false;
  const r = out;
  return typeof r.format === "string" && INDEX_FORMATS.has(r.format) && typeof r.lines === "string";
}
function resultTableCap(tool, out, caps = TOOL_OUTPUT_CAPS) {
  return isIndexResult(tool, out) ? Math.max(DEFAULT_TOOL_OUTPUT_CHARS, INDEX_RESULT_CHARS) : toolOutputCap(tool, caps);
}
var READ_FILE_TOOL = "read_file";
var PAGED_READ_TOOLS = {
  // `read_file`'s `offset` applies to each path of a `paths[]` read (agent-tools core-tools).
  [READ_FILE_TOOL]: { search: "search_code", perPathOffset: true },
  // The canvas's `offset` is honoured for a SINGLE path only.
  canvas_read_build_file: { search: "canvas_search_build_files", perPathOffset: false }
};
function isPagedReadTool(tool) {
  return Object.prototype.hasOwnProperty.call(PAGED_READ_TOOLS, tool);
}
function pagedReadSearchTool(tool) {
  return PAGED_READ_TOOLS[tool]?.search ?? "search_code";
}
function pagedReadOffsetsPerPath(tool) {
  return PAGED_READ_TOOLS[tool]?.perPathOffset ?? true;
}
var SHELL_TOOLS = /* @__PURE__ */ new Set(["run_command", "exec", "bash", "shell", "process"]);
var HARD_MAX_TOOL_RESULT_CHARS = 4e5;
var TOOL_RESULT_WINDOW_SHARE = 0.3;
var TOOL_RESULT_CHARS_PER_TOKEN = 4;
function toolOutputCap(tool, caps = TOOL_OUTPUT_CAPS) {
  return caps[tool] ?? DEFAULT_TOOL_OUTPUT_CHARS;
}
function windowToolResultCap(contextWindowTokens) {
  const maxTokens = Math.floor(contextWindowTokens * TOOL_RESULT_WINDOW_SHARE);
  return Math.min(maxTokens * TOOL_RESULT_CHARS_PER_TOKEN, HARD_MAX_TOOL_RESULT_CHARS);
}
var READ_FILE_MAX_CHARS = 64e3;
function windowedCap(tool, tableCap, contextWindowTokens) {
  if (typeof contextWindowTokens !== "number" || !Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) return tableCap;
  const share = windowToolResultCap(contextWindowTokens);
  if (isPagedReadTool(tool)) return Math.min(READ_FILE_MAX_CHARS, Math.max(tableCap, share));
  return Math.min(tableCap, share);
}
function isShellTool(tool) {
  return SHELL_TOOLS.has(tool);
}

// ../packages/tool-output-policy/src/shellSummary.ts
var DEFAULT_TAIL_LINES = 40;
var MAX_DIFF_LINES = 24;
var ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
function stripAnsi(text) {
  return text.replace(ANSI, "");
}
var RUNNER_SIGNATURES = [
  ["vitest", /\bvitest\b|^\s*(?:Test Files|Tests)\s+\d+\s+(?:failed|passed)|^\s*[❯›]\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?/m],
  ["jest", /^\s*(?:PASS|FAIL)\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?|^Test Suites:\s+\d+/m],
  ["pytest", /=+ test session starts =+|^(?:FAILED|ERROR) \S+::|=+ .*\b(?:passed|failed)\b.* in [\d.]+s =+/m],
  ["cargo", /^\s*(?:Compiling|Finished|Running) .*|^test result: (?:ok|FAILED)\.|^error(?:\[E\d+\])?: /m],
  ["tsc", /\berror TS\d+:/],
  ["go", /^(?:---|===) (?:FAIL|RUN|PASS):|^(?:ok|FAIL)\s+\S+\s+[\d.]+s/m]
];
function detectRunner(text) {
  for (const [runner, re] of RUNNER_SIGNATURES) if (re.test(text)) return runner;
  return "unknown";
}
var NOISE = [
  /^\s*[✓√✔]\s/,
  /^\s*PASS\s/,
  /^\s*PASSED\b/,
  /\bPASSED\s*(?:\[\s*\d+%\])?$/,
  /^test .* \.\.\. ok$/,
  /^ok\s+\S+\s+[\d.]+s/,
  /^=== RUN\s/,
  /^--- PASS:/,
  /^\s*Compiling\s/,
  /^\s*Downloaded?\s/,
  /^\s*$/
];
var ERROR_LINE = [
  /\berror\b|\bERROR\b|\bError\b/,
  /\bFAIL(?:ED|URE)?\b|\bfailed\b/,
  /^\s*[✗×✕❌]\s/,
  /\bpanic(?:ked)?\b|^Traceback \(most recent call last\)/,
  /\bAssertion(?:Error)?\b|\bassert(?:ion)?\b/,
  /^E\s{2,}/,
  // pytest assertion detail
  /^\s*●\s/,
  // jest failing test header
  /\berror TS\d+:/,
  /^\s*-->\s.+:\d+:\d+$/
  // cargo error location
];
var DIFF_HEADER = /^\s*(?:[-+]\s*Expected|[-+]\s*Received|Expected:|Received:|expected:|actual:|Difference:|- expected|\+ actual|assert .* ==)/;
var DIFF_BODY = /^\s*[-+](?!-)|^\s{2,}\S/;
var FAILING_TEST = [
  /^\s*(?:FAIL|×|✕|✗)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?(?:\s+>\s+.+?)?)(?:\s+\d+ms)?$/,
  // vitest/jest file (+ test path)
  /^\s*●\s+(.+?)\s*$/,
  // jest
  /^\s*[×✕✗]\s+(.+?)(?:\s+\d+ms)?$/,
  // vitest/jest test line
  /^FAILED\s+(\S+::\S+)/,
  // pytest
  /^test\s+(\S+)\s+\.\.\.\s+FAILED$/,
  // cargo
  /^---\s+FAIL:\s+(\S+)/
  // go
];
function isNoise(line) {
  return NOISE.some((re) => re.test(line));
}
function isErrorLine(line) {
  return ERROR_LINE.some((re) => re.test(line));
}
function failingTestName(line) {
  for (const re of FAILING_TEST) {
    const m = re.exec(line);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}
function summarizeShellOutput(raw, opts) {
  const tailLines = opts.tailLines ?? DEFAULT_TAIL_LINES;
  if (raw.length <= opts.maxChars) {
    return { text: raw, runner: detectRunner(raw), failingTests: [], droppedNoise: 0 };
  }
  const text = stripAnsi(raw).replace(/\r\n?/g, "\n");
  const runner = detectRunner(text);
  const lines = text.split("\n");
  const tailFrom = Math.max(0, lines.length - tailLines);
  const tail = lines.slice(tailFrom);
  const failing = [];
  const seenFailing = /* @__PURE__ */ new Set();
  const kept = [];
  const seenKept = /* @__PURE__ */ new Set();
  let droppedNoise = 0;
  let diffLeft = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const name = failingTestName(line);
    if (name && !seenFailing.has(name)) {
      seenFailing.add(name);
      failing.push(name);
    }
    if (i >= tailFrom) continue;
    if (DIFF_HEADER.test(line)) {
      diffLeft = MAX_DIFF_LINES;
      kept.push(line);
      continue;
    }
    if (diffLeft > 0) {
      if (DIFF_BODY.test(line) && !isNoise(line)) {
        kept.push(line);
        diffLeft--;
        continue;
      }
      diffLeft = 0;
    }
    if (isNoise(line)) {
      droppedNoise++;
      continue;
    }
    if (isErrorLine(line)) {
      const key = line.trim();
      if (seenKept.has(key)) continue;
      seenKept.add(key);
      kept.push(line);
    }
  }
  const header = `[output summarised${runner === "unknown" ? "" : ` (${runner})`}: ${lines.length.toLocaleString("en-US")} lines / ${raw.length.toLocaleString("en-US")} chars \u2192 failing tests, error lines, assertion diffs and the last ${tail.length} lines; ${droppedNoise.toLocaleString("en-US")} passing/progress lines dropped. Re-run a narrower command (one test file, grep) for more.]`;
  const failingBlock = failing.length > 0 ? `Failing tests (${failing.length}):
${failing.slice(0, 50).map((n) => `  - ${n}`).join("\n")}${failing.length > 50 ? `
  \u2026 +${failing.length - 50} more` : ""}` : "";
  const tailBlock = `--- last ${tail.length} lines ---
${tail.join("\n")}`;
  const fixed = [header, failingBlock, tailBlock].filter(Boolean).join("\n\n");
  const room = opts.maxChars - fixed.length - 40;
  let errorsBlock = "";
  if (kept.length > 0 && room > 200) {
    const body = `--- errors (${kept.length} lines) ---
${kept.join("\n")}`;
    errorsBlock = body.length <= room ? body : cutHead(body, room, { suffix: "\n\u2026[more error lines elided]" });
  }
  const assembled = [header, failingBlock, errorsBlock, tailBlock].filter(Boolean).join("\n\n");
  const fitted = assembled.length <= opts.maxChars ? assembled : cutHeadTail(assembled, opts.maxChars, { headShare: 0.5 });
  return { text: fitted, runner, failingTests: failing, droppedNoise };
}

// ../packages/tool-output-policy/src/jsonProjection.ts
var STEPS = [
  { depth: 4, arrayItems: 10, stringChars: 400 },
  { depth: 3, arrayItems: 5, stringChars: 200 },
  { depth: 2, arrayItems: 3, stringChars: 120 },
  { depth: 2, arrayItems: 1, stringChars: 80 },
  { depth: 1, arrayItems: 1, stringChars: 60 }
];
function describe2(value) {
  if (Array.isArray(value)) return `[array: ${value.length} items]`;
  if (value && typeof value === "object") return `{object: ${Object.keys(value).length} keys}`;
  return String(value);
}
function projectValue(value, step, depth) {
  if (typeof value === "string") {
    return value.length > step.stringChars ? `${value.slice(0, step.stringChars)}\u2026(+${value.length - step.stringChars} chars)` : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= step.depth) return describe2(value);
  if (Array.isArray(value)) {
    const head = value.slice(0, step.arrayItems).map((v) => projectValue(v, step, depth + 1));
    if (value.length > step.arrayItems) head.push(`\u2026(+${value.length - step.arrayItems} more of ${value.length} items)`);
    return head;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = projectValue(v, step, depth + 1);
  return out;
}
function projectJson(value, maxChars) {
  let last = { value: void 0, json: "", fits: false };
  for (const step of STEPS) {
    const projected = projectValue(value, step, 0);
    const json = JSON.stringify(projected);
    last = { value: projected, json, fits: json.length <= maxChars };
    if (last.fits) return last;
  }
  return last;
}

// ../packages/tool-output-policy/src/readFileWindow.ts
var READ_FILE_RESULT_CHARS = TOOL_OUTPUT_CAPS.read_file ?? 16e3;
function isReadFileResult(out) {
  return !!out && typeof out === "object" && !Array.isArray(out) && out.ok !== false && typeof out.content === "string";
}
function windowReadFile(out, opts = {}) {
  const maxChars = opts.maxChars ?? READ_FILE_RESULT_CHARS;
  const tool = opts.tool ?? "read_file";
  const withNote2 = (result) => opts.advisory && opts.attachAdvisory ? opts.attachAdvisory(result, opts.advisory) : result;
  const done = (served2, truncated) => ({ value: withNote2(served2), served: served2, truncated });
  const lines = out.content.split("\n");
  const offset = typeof out.offset === "number" && out.offset > 0 ? Math.floor(out.offset) : 1;
  const totalLines = typeof out.totalLines === "number" && out.totalLines > 0 ? Math.floor(out.totalLines) : offset + lines.length - 1;
  const alreadyPartial = out.truncated === true;
  const served = (kept, note) => {
    const lastLine = offset + kept.length - 1;
    return { ...out, content: kept.join("\n"), offset, totalLines, truncated: lastLine < totalLines || alreadyPartial, note };
  };
  const build = (kept, note) => withNote2(served(kept, note));
  const fits = (value) => JSON.stringify(value).length <= maxChars;
  if (fits(withNote2({ ...out }))) return done({ ...out }, false);
  const how = (next) => opts.alone !== void 0 ? `call ${tool} again with ONLY the path ${JSON.stringify(opts.alone)} (offset applies to a single file) and offset ${next}` : `call ${tool} again with offset ${next}`;
  const continuation = (lastLine) => `Showing lines ${offset}\u2013${lastLine} of ${totalLines}. This surface returns at most ~${maxChars.toLocaleString("en-US")} chars per read, so a large file arrives in several windows \u2014 ${how(lastLine + 1)} to continue from exactly where this one stopped. Do not re-request lines you already have.`;
  let lo = 1;
  let hi = lines.length;
  let best = 0;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    if (fits(build(lines.slice(0, mid), continuation(offset + mid - 1)))) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best === 0) {
    const first = lines[0] ?? "";
    const room = maxChars - 600;
    const head = room >= 200 ? first.slice(0, room) : "";
    const more = lines.length > 1 ? ` The lines AFTER it continue at offset ${offset + 1}: ${how(offset + 1)}.` : "";
    const note = head ? `Line ${offset} of ${totalLines} is longer than the ~${maxChars.toLocaleString("en-US")}-char read budget; the first ${head.length.toLocaleString("en-US")} of its ${first.length.toLocaleString("en-US")} chars are shown. Paging by offset cannot reach the rest of this line \u2014 use ${pagedReadSearchTool(tool)} for the specific symbol instead.${more}` : `Skipped: this file's share of the read budget (~${Math.max(0, maxChars).toLocaleString("en-US")} chars) is too small for even its first line (${first.length.toLocaleString("en-US")} chars). Read it ${opts.alone !== void 0 ? "on its own" : "again with a larger budget"}: ${how(offset)}, or use ${pagedReadSearchTool(tool)} for the specific symbol.`;
    return done({ ...out, content: head, offset, totalLines, truncated: true, note }, true);
  }
  return done(served(lines.slice(0, best), continuation(offset + best - 1)), true);
}
function isReadFilesResult(out) {
  return !!out && typeof out === "object" && !Array.isArray(out) && out.ok !== false && Array.isArray(out.files);
}
function windowReadFiles(out, opts = {}) {
  const maxChars = opts.maxChars ?? READ_FILE_RESULT_CHARS;
  const files = out.files;
  const overhead = JSON.stringify({ ...out, files: [] }).length + files.length + (opts.advisory ? opts.advisory.length + 16 : 0);
  const order = files.map((f, i) => ({ i, size: JSON.stringify(f ?? null).length })).sort((a, b) => a.size - b.size);
  const servedFiles = files.slice();
  let remaining2 = Math.max(0, maxChars - overhead);
  let truncated = false;
  order.forEach(({ i, size }, n) => {
    const file = files[i];
    const alone = !pagedReadOffsetsPerPath(opts.tool ?? "read_file") && isReadFileResult(file) && typeof file.path === "string" ? file.path : void 0;
    const share = Math.floor(remaining2 / (order.length - n));
    if (isReadFileResult(file) && size > share) {
      const windowed = windowReadFile(file, { ...opts.tool ? { tool: opts.tool } : {}, ...alone ? { alone } : {}, maxChars: share });
      servedFiles[i] = windowed.served;
      truncated = truncated || windowed.truncated;
    }
    remaining2 -= JSON.stringify(servedFiles[i] ?? null).length;
  });
  const served = { ...out, files: servedFiles };
  const value = opts.advisory && opts.attachAdvisory ? opts.attachAdvisory(served, opts.advisory) : served;
  return { value, served, truncated };
}
function sliceReadFile(out, start, end) {
  const lines = out.content.split("\n");
  const first = typeof out.offset === "number" && out.offset > 0 ? Math.floor(out.offset) : 1;
  const from = Math.max(first, Math.floor(start));
  const kept = lines.slice(from - first, Math.max(from - first, Math.floor(end) - first + 1));
  const lastLine = from + kept.length - 1;
  const totalLines = typeof out.totalLines === "number" && out.totalLines > 0 ? Math.floor(out.totalLines) : void 0;
  const truncated = totalLines !== void 0 ? lastLine < totalLines : out.truncated === true;
  const { note: _coveringNote, ...rest } = out;
  return {
    ...rest,
    content: kept.join("\n"),
    offset: from,
    ...totalLines !== void 0 ? { totalLines } : {},
    truncated,
    ...truncated ? { note: `Showing lines ${from}\u2013${lastLine}${totalLines !== void 0 ? ` of ${totalLines}` : ""}. To continue, call read_file again with offset ${lastLine + 1}.` } : {}
  };
}

// ../packages/tool-output-policy/src/policy.ts
var LOG_FIELDS = ["output", "stdout", "stderr"];
function isLogLike(text, tool) {
  return tool !== void 0 && isShellTool(tool) || detectRunner(text) !== "unknown";
}
function fitToolText(text, maxChars, opts = {}) {
  if (text.length <= maxChars) return text;
  if (opts.summarize && isLogLike(text, opts.tool)) return summarizeShellOutput(text, { maxChars }).text;
  return (opts.fallback ?? cutHeadTail)(text, maxChars);
}
function attach(value, opts) {
  return opts.advisory && opts.attachAdvisory ? opts.attachAdvisory(value, opts.advisory) : value;
}
function capFor(tool, out, opts) {
  if (opts.maxChars !== void 0) return opts.maxChars;
  const tableCap = isIndexResult(tool, out) ? resultTableCap(tool, out, opts.caps) : !opts.summarize && !isPagedReadTool(tool) ? DEFAULT_TOOL_OUTPUT_CHARS : toolOutputCap(tool, opts.caps);
  return windowedCap(tool, tableCap, opts.contextWindowTokens);
}
function pageIndexResult(out, fits) {
  const all = out.lines ? out.lines.split("\n") : [];
  const offset = typeof out.offset === "number" ? out.offset : 0;
  const pageOf = (n) => {
    const envelope = { ...out };
    delete envelope.lines;
    delete envelope.nextOffset;
    return { ...envelope, returned: n, truncated: true, nextOffset: offset + n, lines: all.slice(0, n).join("\n") };
  };
  let lo = 0;
  let hi = all.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(pageOf(mid))) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 && fits(pageOf(lo)) ? pageOf(lo) : null;
}
function shrinkLogFields(tool, out, cap2, overhead) {
  const fields = LOG_FIELDS.filter((f) => typeof out[f] === "string" && out[f].length > 0);
  if (fields.length === 0) return null;
  const logChars = fields.reduce((n, f) => n + out[f].length, 0);
  const rest = JSON.stringify({ ...out, ...Object.fromEntries(fields.map((f) => [f, ""])) }).length;
  const escapedLog = fields.reduce((n, f) => n + JSON.stringify(out[f]).length - 2, 0);
  const inflation = logChars > 0 ? escapedLog / logChars : 1;
  const budget = Math.floor((cap2 - rest - overhead) / inflation);
  if (budget < 500) return null;
  const shrunk = { ...out };
  for (const f of fields) {
    const text = out[f];
    const share = Math.max(200, Math.floor(budget * (text.length / logChars)));
    shrunk[f] = fitToolText(text, share, { tool, summarize: true });
  }
  return shrunk;
}
function truncatedResultNote(originalChars, maxChars) {
  if (maxChars < 600) return "Truncated: NOT the whole result \u2014 do not treat it as complete.";
  return `Truncated: the full result was ${originalChars.toLocaleString("en-US")} chars and this surface returns at most ~${maxChars.toLocaleString("en-US")}. \`output\` is only a cut of it, NOT the whole \u2014 never treat it as complete or write it back as if it were. Re-call with a narrower query, id or filter to see the rest.`;
}
function shapeToolResult(tool, out, opts = {}) {
  const bytes = JSON.stringify(out ?? null).length;
  if (isPagedReadTool(tool) && (isReadFileResult(out) || isReadFilesResult(out))) {
    const maxChars = opts.maxChars ?? windowedCap(tool, toolOutputCap(tool), opts.contextWindowTokens);
    const windowOpts = { tool, maxChars, advisory: opts.advisory, attachAdvisory: opts.attachAdvisory };
    const windowed = isReadFileResult(out) ? windowReadFile(out, windowOpts) : windowReadFiles(out, windowOpts);
    return { content: JSON.stringify(windowed.value), bytes, truncated: windowed.truncated, served: windowed.served };
  }
  const cap2 = capFor(tool, out, opts);
  const full = JSON.stringify(attach(out ?? null, opts));
  if (full.length <= cap2) return { content: full, bytes, truncated: false };
  const advisoryChars = opts.advisory ? opts.advisory.length + 16 : 0;
  if (isIndexResult(tool, out)) {
    const paged = pageIndexResult(out, (shaped) => JSON.stringify(attach(shaped, opts)).length <= cap2);
    if (paged) return { content: JSON.stringify(attach(paged, opts)), bytes, truncated: true };
  }
  if (opts.summarize) {
    if (typeof out === "string") {
      const inflation = out.length > 0 ? (bytes - 2) / out.length : 1;
      const shaped = fitToolText(out, Math.max(500, Math.floor((cap2 - advisoryChars - 32) / Math.max(1, inflation))), { tool, summarize: true });
      const content2 = JSON.stringify(attach(shaped, opts));
      if (content2.length <= cap2) return { content: content2, bytes, truncated: true };
    } else if (out && typeof out === "object" && !Array.isArray(out)) {
      const shrunk = shrinkLogFields(tool, out, cap2, advisoryChars + 64);
      if (shrunk) {
        const content2 = JSON.stringify(attach(shrunk, opts));
        if (content2.length <= cap2) return { content: content2, bytes, truncated: true };
      }
    }
    const marker2 = `
[projected to fit the ~${cap2.toLocaleString("en-US")}-char tool-result budget (original ${bytes.toLocaleString("en-US")} chars): every top-level key is kept; arrays show their first items with a count of the rest and long strings are clipped. Re-call with a narrower filter, limit or id to see specific items.]`;
    const projection = projectJson(out ?? null, cap2 - marker2.length - advisoryChars);
    if (projection.fits) {
      return { content: `${projection.json}${marker2}${opts.advisory ? `
${opts.advisory}` : ""}`, bytes, truncated: true };
    }
  }
  const itemNote = Array.isArray(out) ? ` The full result had ${out.length} items; re-call this tool with a narrower filter (e.g. status, projectId, or limit) to see specific ones.` : " The full result was large; re-call with a narrower query if you need the elided fields.";
  const head = JSON.stringify(out ?? null).slice(0, cap2);
  const marker = `\u2026[truncated ${bytes - cap2} of ${bytes} chars to protect the context window.${itemNote}]`;
  const content = `${head}
${marker}${opts.advisory ? `
${opts.advisory}` : ""}`;
  return { content, bytes, truncated: true };
}

// ../packages/agent-run/src/contractModel.ts
var ModelTransportError = class extends Error {
  status;
  /** Whether the model policy may route around this failure. A containment stop is never routable. */
  routable;
  constructor(message, status, opts = {}) {
    super(message);
    this.name = "ModelTransportError";
    this.status = status;
    this.routable = opts.routable ?? (status !== void 0 && status >= 400);
  }
};

// ../packages/agent-run/src/contract.ts
var RUN_CANCELLED_REASON = "cancelled";

// ../packages/agent-run/src/surface.ts
function isTransportFailure(err) {
  const failure = err?.failure;
  return err instanceof Error && !!failure && typeof failure === "object" && failure.type === "transport_failed";
}

// ../packages/agent-run/src/tapEvents.ts
function tapEvents(sink, tap) {
  return {
    emit: async (event, meta) => {
      tap.before?.(event, meta);
      await sink?.emit(event, meta);
      await tap.after?.(event, sink);
    },
    ...sink?.outcome ? { outcome: (row) => sink.outcome?.(row) } : {},
    ...sink?.workflow ? { workflow: (metric) => sink.workflow?.(metric) } : {}
  };
}

// ../packages/agent-run/src/conformanceTask.ts
var CONFORMANCE_TRACE = [
  "run.started",
  "model.preflight",
  "turn.started",
  "context.tools",
  "model.completed:fake-model",
  "tool.dispatched:list_files:ok",
  "turn.finished",
  "turn.started",
  "model.completed:fake-model",
  "run.finished:finished"
];
var CONFORMANCE_ENTRY_TRACE = [
  CONFORMANCE_TRACE[0],
  "run.routed",
  ...CONFORMANCE_TRACE.slice(1)
];

// ../packages/agent-run/src/telemetry/workflowMetrics.ts
var WORKFLOW_STAGES = ["surface", "start", "route", "work", "opening", "compose", "kernel", "dispatch", "spawn", "ledger", "finish", "settle", "grade", "outcome"];
var WORKFLOW_OPERATIONS = {
  model_request: "kernel",
  model_synthesis: "kernel",
  context_pack: "opening",
  governance_check: "dispatch",
  guard_check: "dispatch",
  platform_preflight: "dispatch",
  approval_wait: "dispatch",
  human_wait: "dispatch",
  store_save: "settle",
  memory_consolidate: "settle",
  memory_commit: "settle",
  host_settle: "settle",
  close_out: "finish"
};
function workflowScope(input, step = 0) {
  return { runId: input.task.runId, entryPoint: input.policy?.entryPoint ?? "unknown", step };
}
var sequence = 0;
function report(sink, metric) {
  try {
    void Promise.resolve(sink?.workflow?.(metric)).catch(() => {
    });
  } catch {
  }
}
function beginWorkflowStage(sink, scope, stage, now = Date.now) {
  if (!sink?.workflow) return (_status, _counters) => {
  };
  const startedAt = now();
  const metric = { schemaVersion: 1, id: `${startedAt}:${++sequence}`, ...scope, stage, status: "running", startedAt };
  report(sink, metric);
  let ended = false;
  return (status = "completed", counters) => {
    if (ended) return;
    ended = true;
    const endedAt = now();
    report(sink, { ...metric, status, endedAt, durationMs: Math.max(0, endedAt - startedAt), ...counters ? { counters } : {} });
  };
}
function finishMeasurement(done, value, verdict, counters) {
  try {
    done(verdict?.(value) ?? "completed", counters?.(value));
  } catch {
    done("completed");
  }
}
async function measureWorkflow(sink, scope, stage, action, verdict, signal, counters) {
  if (!sink?.workflow) return action();
  const done = beginWorkflowStage(sink, scope, stage);
  try {
    const value = await action();
    finishMeasurement(done, value, signal?.aborted ? () => "cancelled" : verdict, counters);
    return value;
  } catch (error) {
    done(signal?.aborted ? "cancelled" : "failed");
    throw error;
  }
}
function measureWorkflowSync(sink, scope, stage, action, counters, verdict) {
  if (!sink?.workflow) return action();
  const done = beginWorkflowStage(sink, scope, stage);
  try {
    const value = action();
    finishMeasurement(done, value, verdict, counters);
    return value;
  } catch (error) {
    done("failed");
    throw error;
  }
}
function workflowMetricOf(value) {
  if (!value || typeof value !== "object") return null;
  const m = value;
  if (m.schemaVersion !== 1 || typeof m.id !== "string" || !m.id || m.id.length > 200 || !WORKFLOW_STAGES.includes(m.stage) || !["running", "completed", "failed", "blocked", "cancelled"].includes(m.status) || typeof m.entryPoint !== "string" || !Number.isInteger(m.step) || m.step < 0 || !Number.isFinite(m.startedAt) || m.runId !== void 0 && typeof m.runId !== "string") return null;
  if (m.operation !== void 0 && (!Object.hasOwn(WORKFLOW_OPERATIONS, m.operation) || WORKFLOW_OPERATIONS[m.operation] !== m.stage)) return null;
  if (m.status !== "running" && (!Number.isFinite(m.endedAt) || !Number.isFinite(m.durationMs) || m.durationMs < 0)) return null;
  const counters = m.counters && typeof m.counters === "object" ? Object.fromEntries(Object.entries(m.counters).filter(([key, value2]) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) && typeof value2 === "number" && Number.isFinite(value2)).slice(0, 32)) : void 0;
  return {
    schemaVersion: 1,
    id: m.id,
    stage: m.stage,
    status: m.status,
    step: m.step,
    entryPoint: m.entryPoint,
    startedAt: m.startedAt,
    ...m.runId !== void 0 ? { runId: m.runId } : {},
    ...m.operation !== void 0 ? { operation: m.operation } : {},
    ...m.status !== "running" ? { endedAt: m.endedAt, durationMs: m.durationMs } : {},
    ...counters ? { counters } : {}
  };
}
function summarizeWorkflow(metrics) {
  const attempts = /* @__PURE__ */ new Map();
  for (const metric of metrics) {
    const key = `${metric.runId ?? ""}:${metric.entryPoint}:${metric.id}`;
    const prior = attempts.get(key);
    if (!prior || prior.status === "running") attempts.set(key, metric);
  }
  const summarize = (observed) => {
    const durations = observed.flatMap((m) => m.durationMs === void 0 ? [] : [m.durationMs]);
    const count2 = (status) => observed.filter((m) => m.status === status).length;
    const latest = observed.reduce((a, b) => !a || b.startedAt >= a.startedAt ? b : a, void 0);
    return {
      status: !observed.length ? "not_observed" : count2("running") ? "incomplete" : latest.status,
      attempts: observed.length,
      completed: count2("completed"),
      failed: count2("failed"),
      blocked: count2("blocked"),
      cancelled: count2("cancelled"),
      running: count2("running"),
      totalMs: durations.length ? durations.reduce((sum, ms) => sum + ms, 0) : null,
      maxMs: durations.length ? Math.max(...durations) : null,
      ...latest?.counters ? { latestCounters: latest.counters } : {}
    };
  };
  const stages2 = WORKFLOW_STAGES.map((stage) => {
    const observed = [...attempts.values()].filter((m) => m.stage === stage);
    const primary = summarize(observed.filter((m) => !m.operation));
    const operations = [...new Set(observed.flatMap((m) => m.operation ? [m.operation] : []))].map((operation) => ({ operation, ...summarize(observed.filter((m) => m.operation === operation)) }));
    return { stage, ...primary, ...!primary.attempts && operations.length ? { status: "partial" } : {}, ...operations.length ? { operations } : {} };
  });
  return { schemaVersion: 1, observedStages: stages2.filter((s) => s.attempts > 0 || s.operations?.length).length, totalStages: stages2.length, runIds: [...new Set(metrics.flatMap((m) => m.runId ? [m.runId] : []))], stages: stages2 };
}

// ../packages/agent-run/src/policy/compaction/history.ts
import {
  buildWorkingTranscript,
  foldWorkingTranscript,
  HISTORY_TOKEN_BUDGET,
  transcriptTokens
} from "@seanhogg/builderforce-memory/working";
var foldLimits = { summaryMs: 15e3 };
function compactionSavedTokens(full, working, historyBudgetTokens = HISTORY_TOKEN_BUDGET) {
  return Math.max(0, Math.min(transcriptTokens(full), historyBudgetTokens) - transcriptTokens(working));
}
function linkedAbort(parent) {
  const own2 = new AbortController();
  const onParent = () => own2.abort();
  if (parent?.aborted) own2.abort();
  else parent?.addEventListener("abort", onParent, { once: true });
  return { signal: own2.signal, abort: () => own2.abort(), release: () => parent?.removeEventListener("abort", onParent) };
}
async function summaryWithin(ms, summarize, parent, onLate, onError) {
  const link = linkedAbort(parent);
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve("late"), ms);
  });
  try {
    const out = await Promise.race([
      summarize(link.signal).catch((reason) => {
        onError?.(reason);
        return null;
      }),
      late
    ]);
    if (out !== "late") return out;
    link.abort();
    onLate();
    return null;
  } finally {
    clearTimeout(timer);
    link.release();
  }
}
function sameRows(a, b) {
  if (a.length !== b.length) return false;
  return a.every((row, i) => {
    const other = b[i];
    return row.role === other.role && row.content === other.content && row.toolCallId === other.toolCallId && (row.toolCalls ?? []).map((call) => call.id).join() === (other.toolCalls ?? []).map((call) => call.id).join();
  });
}
function createHistoryCompactionHook(ports) {
  let timedOut = false;
  return {
    async compact(ctx) {
      let folded = false;
      const working = await buildWorkingTranscript(
        ports.state,
        ports.systemPrompt,
        (messages) => {
          if (timedOut) return Promise.resolve(null);
          ports.activity(ctx.step);
          const limit = foldLimits.summaryMs;
          return summaryWithin(
            limit,
            (signal) => ports.summarize(messages, signal),
            ports.signal ?? ctx.signal,
            () => {
              timedOut = true;
              ports.timeout(ctx.step, limit, messages.length);
            },
            (reason) => ports.error(ctx.step, messages.length, reason)
          );
        },
        (fold) => {
          folded = true;
          ports.recordFold(fold);
        }
      );
      ports.savedTokens(ports.state.compactMemo ? compactionSavedTokens([{ role: "system", content: ports.systemPrompt }, ...ports.state.transcript], working) : 0);
      const rows = foldWorkingTranscript(working).map((row) => ports.toRunMessage(row));
      if (sameRows(ctx.messages, rows)) return void 0;
      return { messages: rows, dropped: Math.max(0, ctx.messages.length - rows.length), ...folded ? {} : { reused: true } };
    }
  };
}

// ../packages/cost-levers/src/index.ts
var COST_LEVERS = [
  { id: "a2_run_budget", requirement: "A2", rollout: 100, summary: "Token + USD run budget, shown to the loop" },
  { id: "a3_progress_detector", requirement: "A3", rollout: 100, summary: "Repeat-read / edit-revert / no-progress steer" },
  { id: "b1_stable_prefix", requirement: "B1", rollout: 100, summary: "Volatile blocks after the cache breakpoint" },
  { id: "b2_semantic_cache", requirement: "B2", rollout: 10, summary: "Scoped semantic cache on tool-free chat" },
  { id: "b3_single_flight", requirement: "B3", rollout: 100, summary: "Coalesce identical in-flight requests" },
  { id: "b4_agent_answer_replay", requirement: "B4", rollout: 10, summary: "Memory answer replay for agent sub-questions" },
  { id: "c2_observation_masking", requirement: "C2", rollout: 10, summary: "Mask tool outputs older than N turns" },
  { id: "c3_task_state", requirement: "C3", rollout: 10, summary: "Structured task state kept through compaction" },
  { id: "c4_adaptive_context", requirement: "C4", rollout: 10, summary: "Start retrieval small, widen on low confidence" },
  { id: "c5_cloud_repo_map", requirement: "C5", rollout: 10, summary: "Graph-ranked repo map on cloud runs" },
  { id: "c6_rerank", requirement: "C6", rollout: 10, summary: "Cross-encoder rerank after hybrid retrieval" },
  { id: "c7_tool_output_policy", requirement: "C7", rollout: 100, summary: "One shared tool-output budget + failure summaries" },
  // 10 like every lever that changes what the model sees; it runs only where the local
  // engine's health probe reports a loaded compressor, so it never triggers a download.
  { id: "c8_token_compression", requirement: "C8", rollout: 10, summary: "LLMLingua-2 token compression of large context" },
  { id: "c10_outline_first_reads", requirement: "B2", rollout: 100, summary: "Large-file first read returns outline + first 40 lines" },
  { id: "c9_price_tier_budget", requirement: "C9", rollout: 100, summary: "Compaction budget under long-context price tiers" },
  { id: "d1_verifier_cascade", requirement: "D1", rollout: 10, summary: "Weak model first, verifier, escalate one tier" },
  { id: "d2_difficulty_router", requirement: "D2", rollout: 10, summary: "Predict weak-model failure, skip the wasted attempt" },
  { id: "d3_routing_exploration", requirement: "D3", rollout: 100, summary: "Thompson exploration + decay in learned routing" },
  { id: "d4_role_reasoning", requirement: "D4", rollout: 10, summary: "Reasoning effort by role" },
  { id: "d5_output_caps", requirement: "D5", rollout: 100, summary: "Diff edits + per-role max_tokens" },
  { id: "d6_batch_api", requirement: "D6", rollout: 100, summary: "Provider batch APIs for deferred background work" },
  { id: "d7_deterministic_handlers", requirement: "D7", rollout: 100, summary: "Deterministic handlers + post-edit checks" },
  { id: "d8_parallel_tool_calls", requirement: "D8", rollout: 100, summary: "Batch independent tool calls in one turn" },
  { id: "e1_skill_ranking", requirement: "E1", rollout: 100, summary: "Inject only the most relevant approved skills" },
  { id: "e2_specialists", requirement: "E2", rollout: 10, summary: "Admitted small specialist models for narrow jobs" },
  // Always on (operator, 2026-10-23): recall dual-reads the paid 1536 column for rows the
  // 1024 backfill has not reached yet, so it never had to wait for the backfill.
  { id: "e3_free_embeddings", requirement: "E3", rollout: 100, summary: "Free Workers AI embeddings for memory" },
  { id: "e5_verified_local_label", requirement: "E5", rollout: 100, summary: "Hybrid local label = passed the verifier" }
];
var BY_ID = new Map(COST_LEVERS.map((l) => [l.id, l]));
function costLeverSpec(id) {
  const spec2 = BY_ID.get(id);
  if (!spec2) throw new Error(`unknown cost lever: ${id}`);
  return spec2;
}
function costLeverEnvKey(id) {
  return `COST_LEVER_${id.toUpperCase()}`;
}
function costLeverBucket(id, tenantId) {
  const s = `${id}:${tenantId}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 100;
}
function readEnv(env, key) {
  const v = env?.[key];
  return v === void 0 || v === null ? void 0 : String(v).trim().toLowerCase();
}
function costLeverRollout(env, id) {
  const raw = readEnv(env, costLeverEnvKey(id));
  if (raw !== void 0 && raw !== "") {
    if (raw === "on" || raw === "1" || raw === "true") return 100;
    if (raw === "off" || raw === "0" || raw === "false") return 0;
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  }
  const all = readEnv(env, "COST_LEVERS_ALL");
  if (all === "off" || all === "0" || all === "false") return 0;
  return costLeverSpec(id).rollout;
}
function isCostLeverOn(env, id, tenantId) {
  const rollout = costLeverRollout(env, id);
  if (rollout >= 100) return true;
  if (rollout <= 0) return false;
  if (tenantId === null || tenantId === void 0 || tenantId === "") return false;
  return costLeverBucket(id, tenantId) < rollout;
}

// ../packages/agent-run/src/policy/compaction/pack.ts
import {
  packHandoff,
  handoffBudget,
  defaultEstimateTokens,
  messageTokens,
  tokensOf as tokensOf2,
  isVolatileTail,
  isVolatileContent,
  volatileTail,
  VOLATILE_TAIL_TAG
} from "@seanhogg/builderforce-memory/handoff";

// ../packages/agent-run/src/policy/compaction/compact.ts
var C9_TIER_LEVER = "c9_price_tier_budget";
function taskRowIndex(rows) {
  const marked = rows.findIndex((m) => m.task === true);
  return marked >= 0 ? marked : rows.findIndex((m) => m.role === "user" && m.custom !== true);
}
var CLOUD_COMPACT_DEFAULTS = {
  maxTokens: 4e4,
  reserveOutputTokens: DEFAULT_HANDOFF_RESERVE_TOKENS,
  timeoutMs: 3e4
};
var estimateTokens = defaultEstimateTokens;
function toolsTokensOf(tools) {
  if (tools == null) return 0;
  if (Array.isArray(tools) && tools.length === 0) return 0;
  return estimateTokens(JSON.stringify(tools) ?? "");
}
function messagesTokens(messages) {
  return tokensOf2(messages, estimateTokens);
}
var elisionNote = (chars) => ` \u2026[${chars} chars elided to fit the context budget]`;
var ELIDE_CAPS = [4e3, 1e3, 200];
function elideToFit(messages, budget) {
  const out = [...messages];
  let latestUser = -1;
  for (let i = out.length - 1; i >= 0; i--) if (out[i]?.role === "user") {
    latestUser = i;
    break;
  }
  const candidates = (toolsOnly) => out.map((m, i) => ({ m, i })).filter(({ m, i }) => i !== latestUser && m.role !== "system" && typeof m.content === "string" && (toolsOnly ? m.role === "tool" : m.role !== "tool")).sort((a, b) => b.m.content.length - a.m.content.length || a.i - b.i).map(({ i }) => i);
  let total = messagesTokens(out);
  for (const toolsOnly of [true, false]) {
    for (const cap2 of ELIDE_CAPS) {
      for (const i of candidates(toolsOnly)) {
        if (total <= budget) return out;
        const msg = out[i];
        const content = msg.content;
        if (content.length <= cap2) continue;
        const next = { ...msg, content: content.slice(0, cap2) + elisionNote(content.length - cap2) };
        total += messagesTokens([next]) - messagesTokens([msg]);
        out[i] = next;
      }
    }
  }
  return out;
}
var OBSERVATION_MASK_TURNS = 6;
var MASK_PREFIX = "[masked tool output";
var MIN_MASK_CHARS = 400;
function maskOldObservations(messages, turns = OBSERVATION_MASK_TURNS) {
  const assistants = messages.reduce((n, m) => n + (m.role === "assistant" ? 1 : 0), 0);
  const boundary2 = Math.floor(assistants / turns) * turns - turns;
  if (turns <= 0 || boundary2 <= 0) return { messages, masked: 0 };
  const calls = /* @__PURE__ */ new Map();
  let ordinal = 0;
  let masked = 0;
  const out = messages.map((m) => {
    if (m.role === "assistant") {
      ordinal += 1;
      for (const tc of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
        if (tc.id) calls.set(tc.id, { name: tc.function?.name ?? "tool", args: tc.function?.arguments ?? "" });
      }
      return m;
    }
    if (m.role !== "tool" || ordinal > boundary2 || typeof m.content !== "string") return m;
    const content = m.content;
    if (content.length < MIN_MASK_CHARS || content.startsWith(MASK_PREFIX)) return m;
    const call = calls.get(typeof m.tool_call_id === "string" ? m.tool_call_id : "");
    const args = (call?.args ?? "").replace(/\s+/g, " ").slice(0, 120);
    masked += 1;
    return { ...m, content: `${MASK_PREFIX}: ${call?.name ?? "tool"}(${args}) \u2014 ${content.length} chars; re-run the tool to see it again]` };
  });
  return masked > 0 ? { messages: out, masked } : { messages, masked: 0 };
}
function renderForSummary(middle) {
  const PER_MSG = 1500;
  const TOTAL = 3e4;
  const parts = [];
  let total = 0;
  for (const m of middle) {
    const role = typeof m.role === "string" ? m.role : "unknown";
    let body = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    if (Array.isArray(m.tool_calls)) body += ` [called: ${m.tool_calls.map((t) => t.function?.name ?? "?").join(", ")}]`;
    const line = `${role}: ${body.slice(0, PER_MSG)}`;
    if (total + line.length > TOTAL) break;
    parts.push(line);
    total += line.length;
  }
  return parts.join("\n");
}
function compactionBudget(opts) {
  const tierCap = opts.targetModel && opts.env !== void 0 && isCostLeverOn(opts.env, "c9_price_tier_budget", opts.tenantId);
  const boundary2 = tierCap && opts.targetModel ? priceTierBoundary(opts.targetModel) : opts.priceTierBoundary;
  return handoffTokenBudget({
    costCapTokens: opts.maxTokens,
    contextWindow: opts.contextWindow ?? (opts.targetModel ? opts.window?.(opts.targetModel) : void 0),
    reserveOutputTokens: opts.reserveOutputTokens,
    ...boundary2 !== void 0 ? { priceTierBoundary: boundary2 } : {}
  }) ?? opts.maxTokens;
}
async function compactMessages(messages, opts = CLOUD_COMPACT_DEFAULTS, summarize) {
  const toolsTokens = toolsTokensOf(opts.tools);
  const beforeTokens = messagesTokens(messages) + toolsTokens;
  const budget = compactionBudget(opts);
  const untouched = () => ({ messages: [...messages], compacted: false, summarized: false, beforeTokens, afterTokens: beforeTokens, droppedMessages: 0 });
  const mask = opts.maskObservationsAfterTurns ? maskOldObservations(messages, opts.maskObservationsAfterTurns) : { messages, masked: 0 };
  const source = mask.messages;
  const maskedTokens = mask.masked > 0 ? messagesTokens(source) + toolsTokens : beforeTokens;
  if (source.length === 0 || maskedTokens <= budget) {
    return mask.masked > 0 ? { messages: [...source], compacted: true, summarized: false, beforeTokens, afterTokens: maskedTokens, droppedMessages: 0, maskedObservations: mask.masked } : untouched();
  }
  const briefIdx = opts.pinTaskBrief ? taskRowIndex(source) : -1;
  const brief = briefIdx >= 0 ? source[briefIdx] : void 0;
  const pack = await packHandoff({
    messages: source,
    ...brief ? { pinned: (_m, i) => i === briefIdx } : {},
    targetContextTokens: budget,
    reserveOutputTokens: 0,
    toolsTokens,
    estimateTokens,
    ...summarize ? {
      summarize: async (dropped) => {
        const summary = await summarize(renderForSummary(dropped), { tenantId: opts.tenantId }).catch(() => null);
        return summary && summary.trim() ? `[Compressed memory of ${dropped.length} earlier step(s) \u2014 the task and recent steps are retained verbatim]
${summary.trim()}` : "";
      }
    } : {},
    ...opts.recall ? { recall: opts.recall } : {},
    ...opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}
  });
  const packed = pack.dropped > 0 ? pack.messages : [...source];
  const messageBudget = Math.max(0, budget - toolsTokens);
  const out = !pack.fits || messagesTokens(packed) > messageBudget ? elideToFit(packed, messageBudget) : packed;
  const elided = out.some((m, i) => m !== packed[i]);
  if (pack.dropped === 0 && !elided && mask.masked === 0) return untouched();
  return {
    messages: out,
    compacted: true,
    summarized: pack.summarized && pack.dropped > 0,
    beforeTokens,
    afterTokens: messagesTokens(out) + toolsTokens,
    droppedMessages: pack.dropped,
    ...mask.masked > 0 ? { maskedObservations: mask.masked } : {}
  };
}
var COMPACTION_SUMMARY_SYSTEM = "You compress an in-progress coding agent transcript into a concise memory. Preserve, as terse bullet points: files read/edited and the key facts learned from them, decisions made, commands/checks run and their outcomes, and anything still TODO. Drop chatter and raw file dumps. Output ONLY the memory, no preamble.";
function compactionSummaryRequest(conversationText) {
  return {
    messages: [
      { role: "system", content: COMPACTION_SUMMARY_SYSTEM },
      { role: "user", content: conversationText }
    ],
    max_tokens: 700
  };
}

// ../packages/agent-run/src/policy/stall/ladder.ts
function spentOf(state) {
  return { ...state.stall?.rungs ?? {} };
}
function save(state, patch) {
  const total = (state.stall?.recoveriesTotal ?? 0) + (patch.spent ?? 0);
  state.stall = {
    ...state.stall ?? { recoveriesUsed: 0 },
    ...patch.rungs ? { rungs: patch.rungs } : {},
    ...patch.said ? { said: patch.said } : {},
    ...total > 0 ? { recoveriesTotal: total } : {}
  };
}
function resetRungs(state, keep = []) {
  const spent = state.stall?.rungs;
  if (!spent || Object.keys(spent).length === 0) return;
  save(state, { rungs: Object.fromEntries(Object.entries(spent).filter(([id]) => keep.includes(id))) });
}
function handOffToProven(ctx, ledger, failed3, unavailable2 = false) {
  const next = reduceRunPolicy(ctx.state.model, { type: "stalled", ...failed3 ? { resolvedModel: failed3 } : {}, ...unavailable2 ? { primaryUnavailable: true } : {} });
  ctx.state.model = next;
  if (next.outcome.kind !== "failed_over") return void 0;
  resetRungs(ctx.state, ledger?.sticky);
  ledger?.handedOff?.(failed3, next.outcome.to);
  return next.outcome.to;
}
function restatement(ctx, rung, attempt, nudgeRole, quoteEmpty) {
  const rows = [];
  const said = ctx.content?.trim() ? ctx.content : "";
  if (rung.quote && (said || quoteEmpty)) rows.push({ role: "assistant", content: said || (ctx.content ?? "") });
  rows.push({ role: nudgeRole, content: rung.restate[attempt - 1] ?? "" });
  const notes = ctx.state.stall?.said ?? [];
  if (rung.once && !notes.includes(rung.id)) {
    rows.push({ role: "system", content: rung.once });
    save(ctx.state, { said: [...notes, rung.id] });
  }
  return rows;
}
function deliveryTurn(ctx) {
  return {
    content: ctx.judged ?? ctx.content ?? "",
    ...ctx.served?.interruption ? { interruption: ctx.served.interruption } : {},
    ...ctx.served?.model ? { model: ctx.served.model } : {}
  };
}
function walkLadder(ctx, ledger) {
  const rungs = ledger.rungs(deliveryTurn(ctx));
  if (isPromise(rungs)) throw new Error("This ledger answers its rungs with a promise: walk it with walkLadderAsync.");
  return walkRungs(ctx, ledger, rungs);
}
async function walkLadderAsync(ctx, ledger) {
  return walkRungs(ctx, ledger, await ledger.rungs(deliveryTurn(ctx)));
}
function isPromise(value) {
  return typeof value?.then === "function";
}
function walkRungs(ctx, ledger, rungs) {
  for (const rung of rungs) {
    rung.reached?.();
    if (!rung.applies) continue;
    const counters = spentOf(ctx.state);
    const used = counters[rung.id] ?? 0;
    const max = rung.restate.length;
    const restate = () => {
      counters[rung.id] = used + 1;
      save(ctx.state, { rungs: counters, spent: 1 });
      rung.onRestate?.(used + 1);
      if (rung.entersVerify && !ctx.policy.skipVerifyStage && ctx.state.model.phase !== "verify") ctx.state.model = reduceRunPolicy(ctx.state.model, { type: "verify_started" });
      return { action: "steer", rows: restatement(ctx, rung, used + 1, ledger.stall?.nudgeAs ?? "system", ledger.stall?.quoteEmpty === true) };
    };
    if (used < Math.min(rung.free ?? 1, max)) return restate();
    if (rung.handoff) {
      const to = handOffToProven(ctx, ledger, ctx.served?.model);
      if (to) {
        save(ctx.state, { spent: 1 });
        return { action: "escalate", rows: [{ role: "system", content: rung.handoff(to) }] };
      }
    }
    if (used < max) return restate();
    if (rung.spent === "fall") continue;
    if (rung.spent === "fail") return { action: "fail", note: rung.id };
    return { action: "settle", note: rung.spent.settle };
  }
  return void 0;
}

// ../packages/agent-run/src/policy/model/failure.ts
function recoverProviderFailure(ctx, failure, failedModel, message) {
  const ledger = ctx.ports.delivery;
  const wording = ledger?.providerFailure;
  const to = handOffToProven(ctx, ledger, failedModel, true);
  if (to) return { kind: "retry", ...wording?.handoff ? { note: wording.handoff(to) } : {} };
  const next = reduceRunPolicy(ctx.state.model, failure);
  ctx.state.model = next;
  if (next.outcome.kind === "retry_turn") {
    wording?.rerouted?.({ ...failedModel ? { model: failedModel } : {}, message, step: ctx.step, outcome: next.outcome });
    return { kind: "retry", ...wording?.reroute ? { note: wording.reroute } : {} };
  }
  wording?.abandoned?.({ ...failedModel ? { model: failedModel } : {}, message });
  return { kind: "fail" };
}

// ../packages/agent-run/src/policy/compaction/reserve.ts
var compactReserveTokens = handoffReserveTokens;
var DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR = 2e4;
function ensureCompactionReserveTokens(params) {
  const minReserveTokens = params.minReserveTokens ?? DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR;
  const current = params.settingsManager.getCompactionReserveTokens();
  if (current >= minReserveTokens) {
    return { didOverride: false, reserveTokens: current };
  }
  params.settingsManager.applyOverrides({
    compaction: { reserveTokens: minReserveTokens }
  });
  return { didOverride: true, reserveTokens: minReserveTokens };
}
function resolveCompactionReserveTokensFloor(cfg) {
  const raw = cfg?.agents?.defaults?.compaction?.reserveTokensFloor;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  return DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR;
}
function compactionReserve(maxTokens, cfg) {
  let reserveTokens = compactReserveTokens(maxTokens);
  return ensureCompactionReserveTokens({
    settingsManager: {
      getCompactionReserveTokens: () => reserveTokens,
      applyOverrides: (o) => {
        reserveTokens = o.compaction.reserveTokens;
      }
    },
    minReserveTokens: resolveCompactionReserveTokensFloor(cfg)
  }).reserveTokens;
}
function servingModel(ctx) {
  return ctx.state.model?.model ?? ctx.policy.pinnedModel ?? "";
}
function replyReserve(ctx) {
  if (!ctx.policy.modelHandoff) return ctx.policy.budgets.reserveTokens ?? compactionReserve(void 0);
  const window = ctx.ports.model.window?.(servingModel(ctx));
  const floor = DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR;
  return window && window > 0 ? Math.max(1, Math.min(floor, Math.floor(window / 4))) : floor;
}
function replyAsk(ctx) {
  const reserve = replyReserve(ctx);
  return reserve < DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR ? reserve : void 0;
}

// ../packages/agent-run/src/policy/model/downgradeRule.ts
function planModelWarning(model, book2 = snapshotPriceBook()) {
  if (!model || model === "default") return null;
  const price = listPriceOf(book2, model);
  const tier2 = price ? resolveModelTier({ price }) : void 0;
  return tier2 && isAgenticTier(tier2) === false ? { model, tier: tier2 } : null;
}
function downgradeDecision(input) {
  const { asked, served } = input;
  if (!served || served === "default") return null;
  if (asked !== void 0) return served === asked ? null : { kind: "failover" };
  const byo = input.byo.trim();
  const flash = !byo && input.planPhase ? planModelWarning(served, input.book) : null;
  if (!byo && !flash) return null;
  if (input.seen) return null;
  return byo ? { kind: "byo" } : { kind: "plan_tier", tier: flash.tier };
}

// ../packages/agent-run/src/policy/model/preflight.ts
function classifyPreflight(input) {
  const notices = [];
  let refreshExpired = false;
  if (input.byoSelected) {
    for (const [provider, reason] of Object.entries(input.unresolvedReasons)) {
      if (!reason) continue;
      if (reason === "expired") {
        if (input.unresolvedAfterRefresh) {
          notices.push(`${provider}: credential ${input.unresolvedAfterRefresh} \u2014 reconnect it in Settings \u25B8 Integrations.`);
        } else {
          refreshExpired = true;
        }
      } else {
        notices.push(`${provider}: credential ${reason} \u2014 reconnect it in Settings \u25B8 Integrations.`);
      }
    }
  }
  if (input.planModelAgentic === false) {
    notices.push("plan phase would land on a Flash-class model \u2014 routing around it for the run's quality.");
  }
  return { notices, refreshExpired };
}
function reasonsOf(entries) {
  const out = {};
  for (const entry of entries) {
    const [provider = "", reason = ""] = entry.split(":").map((part) => part.trim());
    if (provider) out[provider] = reason || "not_connected";
  }
  return out;
}
function modelPreflightEvent(step, result, planModel) {
  const plan = planModelWarning(planModel);
  const { notices } = classifyPreflight({
    byoSelected: true,
    unresolvedReasons: reasonsOf(result?.byoUnresolved ?? []),
    ...plan ? { planModelAgentic: false } : {},
    unresolvedAfterRefresh: "expired"
  });
  if (notices.length > 0 && result?.fallback && (result.byoUnresolved.length ?? 0) > 0) {
    notices.push(`This run will use ${result.fallback} instead.`);
  }
  const status = notices.length > 0 ? "degraded" : (result?.refreshed?.length ?? 0) > 0 ? "refreshed" : "ok";
  return { kind: "model.preflight", step, status, notices };
}
function preflightVerdict(event, result) {
  if (event.status !== "degraded") return event.status;
  const reasons = (result?.byoUnresolved ?? []).join(",");
  return `degraded:${reasons || "plan_flash"}`;
}
function recordModelPreflight(ctx, recorded) {
  const result = { byoUnresolved: [...recorded.byoUnresolved] };
  const event = { ...modelPreflightEvent(ctx.step, result, recorded.planModel), notices: [] };
  ctx.state.preflight = preflightVerdict(event, result);
  return event;
}
async function runModelPreflight(ctx) {
  const model = ctx.state.model.model ?? ctx.policy.pinnedModel;
  let result;
  try {
    result = await ctx.ports.model.preflight?.(model);
  } catch {
    result = void 0;
  }
  const event = modelPreflightEvent(ctx.step, result, ctx.state.writtenPaths.length === 0 ? model : void 0);
  ctx.state.preflight = preflightVerdict(event, result);
  return event;
}
function recordWeaker(ctx, served) {
  const recorded = ctx.state.degradedBy ?? [];
  if (!recorded.includes(served)) ctx.state.degradedBy = [...recorded, served];
}
function modelDowngrade(ctx, requested, served, book2 = snapshotPriceBook()) {
  const asked = requested && requested !== "default" ? requested : void 0;
  const degraded = ctx.state.preflight?.startsWith("degraded:") ? ctx.state.preflight.slice("degraded:".length) : "";
  const decision = downgradeDecision({
    asked,
    served,
    byo: degraded && degraded !== "plan_flash" ? degraded : "",
    planPhase: ctx.state.writtenPaths.length === 0,
    seen: !!served && (ctx.state.downgrades ?? []).includes(served)
  });
  if (!decision || !served) return void 0;
  if (decision.kind === "failover") {
    if (isWeakerModel(asked, served, book2)) recordWeaker(ctx, served);
    return { kind: "llm.model_downgrade", step: ctx.step, requestedModel: asked, model: served, reason: "failover" };
  }
  ctx.state.downgrades = [...ctx.state.downgrades ?? [], served];
  return { kind: "llm.model_downgrade", step: ctx.step, requestedModel: "default", model: served, reason: decision.kind === "byo" ? `byo_unresolved:${degraded}` : `plan_tier:${decision.tier}` };
}

// ../packages/agent-run/src/policy/model/index.ts
var RUN_PHASES = /* @__PURE__ */ new Set(["plan", "code", "verify"]);
function policyRole(delegatedRole) {
  const role = typeof delegatedRole === "string" ? delegatedRole.trim() : "";
  if (role === "verify") return { startPhase: "verify", fixedRole: "verify" };
  if (RUN_PHASES.has(role)) return { startPhase: role };
  if (isModelRole(role)) return { startPhase: "code", fixedRole: role };
  return { startPhase: "code" };
}
var DECLINING_MODEL_PREFIXES = ["evermind/"];
function startOptions(pick, delegatedRole, phaseModels) {
  const reviewModel = reviewPhaseModel(phaseModels) ?? null;
  return {
    pinnedModel: pick.model,
    strictPin: pick.strict,
    pinReleasable: true,
    lockAfterFirstSuccess: true,
    decliningModelPrefixes: DECLINING_MODEL_PREFIXES,
    ...policyRole(delegatedRole),
    ...phaseModels ? { phaseModels } : {},
    reviewModel
  };
}
function initialModelRunState(input) {
  return {
    policy: initialRunPolicy({
      ...startOptions(input.pick, input.delegatedRole, input.phaseModels),
      ...input.startPhase ? { startPhase: input.startPhase } : {}
    }),
    stallRecoveries: input.stallRecoveries ?? 0,
    ...input.forceToolChoice ? { forceToolChoice: input.forceToolChoice } : {},
    preflightNotices: [...input.preflightNotices ?? []]
  };
}
function requestForTurn(state, hasTools) {
  return { ...turnRouting(state.policy, hasTools), ...state.forceToolChoice ? { toolChoice: state.forceToolChoice } : {} };
}
function routeAroundFailure(state, request, failure) {
  const policy = reduceRunPolicy(state.policy, {
    type: "transport_failed",
    kind: failure.kind,
    ...failure.status !== void 0 ? { status: failure.status } : {},
    ...request.model ? { model: request.model } : {}
  });
  const next = { ...state, policy };
  return policy.outcome.kind === "retry_turn" ? { state: next, retry: requestForTurn(next, true) } : { state: next, retry: null };
}
function retryOutcome(state) {
  return state.policy.outcome.kind === "retry_turn" ? state.policy.outcome : null;
}
function recordSuccess(state, served) {
  const policy = reduceRunPolicy(state.policy, {
    type: "turn_succeeded",
    ...served.model ? { model: served.model } : {},
    ...served.acted ? { acted: true } : {},
    ...served.durationMs !== void 0 ? { durationMs: served.durationMs } : {}
  });
  return { ...state, policy, forceToolChoice: void 0 };
}
function turnRouting(state, hasTools) {
  return nextTurn(state, { hasTools });
}
var modelHook = {
  resolve(ctx) {
    const routing = turnRouting(ctx.state.model, ctx.tools.length > 0 || ctx.finalTurn === true);
    const maxTokens = ctx.policy.modelHandoff ? replyAsk(ctx) : cappedMaxTokens(routing.role, void 0);
    return {
      role: routing.role,
      strict: routing.strict,
      excludeModels: routing.excludeModels,
      ...routing.model ? { model: routing.model } : {},
      ...maxTokens !== void 0 ? { maxTokens } : {}
    };
  },
  turnFields(ctx) {
    const ask = nextTurn(ctx.state.model, { hasTools: ctx.tools.length > 0 || ctx.finalTurn === true });
    return {
      role: ask.role,
      phase: ctx.state.model.phase,
      ...ask.strict ? { strict: true } : {},
      ...ask.excludeModels.length > 0 ? { excludeModels: ask.excludeModels } : {},
      // A stall recovery's one-shot forced tool call, spent by the next request.
      ...ctx.state.forceToolChoice ? { toolChoice: ctx.state.forceToolChoice } : {}
    };
  },
  preflight: runModelPreflight,
  downgrade: modelDowngrade,
  recoverFailure: recoverProviderFailure
};
function createModelHook(options = {}) {
  const recorded = options.recordedPreflight;
  return recorded ? { ...modelHook, preflight: (ctx) => recordModelPreflight(ctx, recorded) } : modelHook;
}

// ../packages/agent-run/src/runContext.ts
function policyContext(input, state, view, step, turn) {
  return {
    task: input.task,
    policy: input.policy,
    state,
    ports: input.ports,
    step,
    turn,
    messages: view.messages,
    tools: view.tools,
    signal: input.signal
  };
}
function applyCompaction(state, view, result, step) {
  view.messages.splice(0, view.messages.length, ...result.messages);
  state.messages = view.messages;
  if (result.noteOnly) return;
  if (result.reused) return;
  state.compaction = {
    compactions: state.compaction.compactions + 1,
    lastCompactedStep: step,
    ...result.reserveTokens !== void 0 ? { reserveTokens: result.reserveTokens } : {},
    droppedMessages: result.dropped
  };
}
function currentView(transcript, offered) {
  return { messages: transcript, tools: offered };
}
function toPolicyCall(call) {
  return { id: call.id, name: call.name, args: call.args };
}
function appendRows(input, transcript, ...rows) {
  for (const row of rows) {
    transcript.push(row);
    announceRow(input, row);
  }
}
function announceRow(input, row) {
  try {
    input.ports.store.appended?.(row);
  } catch {
  }
  return row;
}
async function emit(events, event, meta) {
  try {
    await events.emit(event, meta);
  } catch {
  }
}

// ../packages/agent-run/src/turnTail.ts
var measured = /* @__PURE__ */ new WeakMap();
function measureTurnTail(state, request) {
  const last = request.at(-1);
  measured.set(state, last !== void 0 && isVolatileTail(last) ? messageTokens(last, defaultEstimateTokens) : 0);
  return request;
}
function turnTailTokens(state) {
  return measured.get(state) ?? 0;
}

// ../packages/agent-run/src/policy/compaction/handoff.ts
import { defaultEstimateTokens as defaultEstimateTokens2, elisionMarker, handoffLine, isVolatileTail as isVolatileTail2, messageTokens as messageTokens2, packHandoff as packHandoff2, tokensOf as tokensOf3 } from "@seanhogg/builderforce-memory/handoff";
function packTargetTokens(contextWindow, boundary2, reserve) {
  const budget = handoffTokenBudget({ contextWindow, reserveOutputTokens: reserve, priceTierBoundary: boundary2 });
  return budget === void 0 ? contextWindow : Math.min(contextWindow, budget + reserve);
}
async function packForModelHandoff(input, access) {
  const back = /* @__PURE__ */ new Map();
  const system = { role: "system", content: input.systemPrompt };
  const mapped = input.messages.map((row) => {
    const view = access.toHandoff(row);
    back.set(view, row);
    return view;
  });
  const all = [system, ...mapped];
  const beforeTokens = tokensOf3(all, defaultEstimateTokens2);
  const reserve = handoffReserveTokens(input.maxTokens);
  const pack = await packHandoff2({
    messages: all,
    targetContextTokens: packTargetTokens(input.contextWindow, input.priceTierBoundary, reserve),
    reserveOutputTokens: reserve,
    toolsTokens: toolSchemaTokens(input.tools, defaultEstimateTokens2) + (input.extraTokens ?? 0),
    from: input.from,
    to: input.to,
    ...input.pinned ? { pinned: (view) => {
      const row = back.get(view);
      return row !== void 0 && input.pinned(row);
    } } : {}
  });
  if (pack.dropped === 0) return { messages: [...input.messages], dropped: 0, noted: false, fits: pack.fits, beforeTokens, afterTokens: beforeTokens };
  const messages = [];
  let noted = false;
  for (const view of pack.messages) {
    if (view === system) continue;
    const original = back.get(view);
    if (original) {
      messages.push(original);
      continue;
    }
    messages.push(access.summary(typeof view.content === "string" ? view.content : JSON.stringify(view.content), view.role));
    noted = true;
  }
  return { messages, dropped: pack.dropped, noted, fits: pack.fits, beforeTokens, afterTokens: pack.estimatedTokens };
}
var WIDEST_DROPPED = 99999;
function noteText(from, to, dropped) {
  const line = handoffLine(from, to);
  return line ? `${line}
${dropped > 0 ? elisionMarker(dropped) : "Nothing was dropped."}` : "";
}
function handoffNoteTokens(from, to) {
  const text = noteText(from, to, WIDEST_DROPPED);
  return text ? messageTokens2({ role: "user", content: text }, defaultEstimateTokens2) : 0;
}
function withHandoffNote(rows, from, to, dropped, access) {
  const text = noteText(from, to, dropped);
  if (!text) return [...rows];
  const views = rows.map((row) => access.toHandoff(row));
  let at2 = -1;
  for (let i = views.length - 1; i >= 0; i -= 1) {
    if (views[i].role === "user" && !isVolatileTail2(views[i])) {
      at2 = i;
      break;
    }
  }
  if (at2 < 0) return [...rows, access.summary(text, "user")];
  const role = at2 === 0 || views[at2 - 1].role === "assistant" ? "user" : "assistant";
  return [...rows.slice(0, at2), access.summary(text, role), ...rows.slice(at2)];
}

// ../packages/agent-run/src/policy/compaction/rows.ts
function toPackRow(m) {
  const row = { role: m.role, content: m.content };
  if (m.task) row.task = true;
  if (m.parts && m.parts.length > 0) row.parts = m.parts;
  if (m.meta) row.meta = m.meta;
  if (m.toolCalls && m.toolCalls.length > 0) {
    row.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments }
    }));
  }
  if (m.toolCallId != null) row.tool_call_id = m.toolCallId;
  return row;
}
function toRunRow(m) {
  const src = m;
  const toolCalls = Array.isArray(src.tool_calls) ? src.tool_calls.map((tc) => ({
    id: tc.id ?? "",
    name: tc.function?.name ?? "",
    arguments: tc.function?.arguments ?? ""
  })) : void 0;
  const out = {
    role: src.role,
    content: typeof src.content === "string" ? src.content : JSON.stringify(src.content ?? "")
  };
  if (toolCalls && toolCalls.length > 0) out.toolCalls = toolCalls;
  if (src.tool_call_id != null) out.toolCallId = src.tool_call_id;
  if (src.task === true) out.task = true;
  if (Array.isArray(src.parts) && src.parts.length > 0) out.parts = src.parts;
  if (src.meta) out.meta = src.meta;
  return out;
}
var IMAGE_CHAR_ESTIMATE = 8e3;
var IMAGE_STAND_IN = "#".repeat(IMAGE_CHAR_ESTIMATE);
function toHandoffView(m) {
  const view = toPackRow(m);
  const role = m.custom ? "assistant" : view.role;
  const blocks = (m.parts ?? []).filter((p) => p.type === "thinking" || p.type === "image").map((p) => p.type === "image" ? { type: "image", estimate: IMAGE_STAND_IN } : p);
  if (blocks.length === 0) return role === view.role ? view : { ...view, role };
  return { ...view, role, content: [...m.content ? [{ type: "text", text: m.content }] : [], ...blocks] };
}
function runRowHandoff() {
  return { toHandoff: toHandoffView, summary: (text, role) => ({ role, content: text }) };
}

// ../packages/agent-run/src/policy/compaction/modelHandOff.ts
async function handOff(ctx) {
  const to = servingModel(ctx);
  const from = ctx.state.preparedFor;
  ctx.state.preparedFor = to || void 0;
  if (!from || !to || from === to) return void 0;
  const lead = ctx.messages.findIndex((m) => m.role !== "system");
  const split = lead < 0 ? ctx.messages.length : lead;
  const system = ctx.messages.slice(0, split);
  const access = runRowHandoff();
  const contextWindow = ctx.ports.model.window?.(to);
  if (!contextWindow) return { messages: [...system, ...withHandoffNote(ctx.messages.slice(split), from, to, 0, access)], dropped: 0, noteOnly: true, summarized: false };
  const reserve = replyReserve(ctx);
  const task = ctx.messages[taskRowIndex(ctx.messages)];
  const packed = await packForModelHandoff(
    {
      messages: ctx.messages.slice(split),
      systemPrompt: system.map((m) => m.content).join("\n\n"),
      tools: ctx.tools.map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })),
      from,
      to,
      contextWindow,
      maxTokens: reserve,
      // The request also carries its volatile tail (about what the last one did) and the note.
      extraTokens: turnTailTokens(ctx.state) + handoffNoteTokens(from, to),
      pinned: (row) => row === task || row.person === true,
      ...ctx.policy.levers.includes(C9_TIER_LEVER) ? { priceTierBoundary: priceTierBoundary(to) } : {}
    },
    access
  );
  if (!packed.fits) {
    await emit(ctx.ports.events, {
      kind: "model.preflight",
      step: ctx.step,
      status: "degraded",
      notices: [`The context cannot be made to fit ${to} (${contextWindow} tokens): the system prompt and the request that must stay whole already need about ${packed.afterTokens}.`]
    });
  }
  return {
    messages: [...system, ...packed.noted ? packed.messages : withHandoffNote(packed.messages, from, to, packed.dropped, access)],
    dropped: packed.dropped,
    ...packed.dropped === 0 ? { noteOnly: true } : {},
    reserveTokens: reserve,
    beforeTokens: packed.beforeTokens,
    afterTokens: packed.afterTokens,
    summarized: false
  };
}

// ../packages/agent-run/src/policy/compaction/index.ts
var C2_MASK_LEVER = "c2_observation_masking";
var RECALL_LIMIT = 8;
function leverOn(ctx, id) {
  return ctx.policy.levers.includes(id);
}
function transportSummarizer(ctx) {
  return async (conversationText) => {
    const request = compactionSummaryRequest(conversationText);
    try {
      const model = ctx.ports.model;
      const routing = ctx.state.model ? turnRouting(ctx.state.model, false) : void 0;
      const asked = {
        messages: request.messages,
        maxTokens: request.max_tokens,
        ...routing?.model ? { model: routing.model, strict: routing.strict } : {},
        ...routing && routing.excludeModels.length > 0 ? { excludeModels: routing.excludeModels } : {}
      };
      const completion = model.summarize ? await model.summarize(asked, ctx.signal) : await model.complete(asked, ctx.signal);
      const text = completion.content?.trim();
      return text ? text : null;
    } catch {
      return null;
    }
  };
}
function capabilityRecall(ctx) {
  const memory = ctx.ports.capabilities?.memory;
  if (!memory) return void 0;
  return async (query, budgetChars) => {
    const result = await memory.recall(query, RECALL_LIMIT);
    if (!result.ok || !result.entries?.length) return "";
    return result.entries.map((e) => `- ${e.key}: ${e.content}`).join("\n").slice(0, budgetChars);
  };
}
function compactionOptions(ctx, opts = {}) {
  const model = servingModel(ctx);
  const window = ctx.ports.model.window?.(model);
  const recall = opts.recall ?? capabilityRecall(ctx);
  const reserve = replyReserve(ctx);
  return {
    ...CLOUD_COMPACT_DEFAULTS,
    maxTokens: opts.maxTokens ?? ctx.policy.budgets.tokens ?? CLOUD_COMPACT_DEFAULTS.maxTokens,
    contextWindow: window,
    priceTierBoundary: leverOn(ctx, C9_TIER_LEVER) ? opts.priceTierBoundary ?? priceTierBoundary(model) : void 0,
    reserveOutputTokens: reserve,
    tools: ctx.tools,
    ...leverOn(ctx, C2_MASK_LEVER) ? { maskObservationsAfterTurns: OBSERVATION_MASK_TURNS } : {},
    summarize: opts.summarize ?? transportSummarizer(ctx),
    ...recall ? { recall } : {},
    pinTaskBrief: opts.pinTaskBrief ?? true,
    timeoutMs: CLOUD_COMPACT_DEFAULTS.timeoutMs
  };
}
function foldOf(before, after) {
  const members = new Set(before);
  const noteAt = after.findIndex((m) => !members.has(m) && m.role !== "tool" && !m.tool_calls && typeof m.content === "string");
  if (noteAt < 0) return void 0;
  let tail = 0;
  while (tail < after.length - 1 - noteAt && tail < before.length && after[after.length - 1 - tail] === before[before.length - 1 - tail]) tail += 1;
  for (let i = noteAt + 1; i < after.length - tail; i += 1) if (!members.has(after[i])) return void 0;
  const lead = before.findIndex((m) => m.role !== "system");
  const covered = before.length - tail - (lead < 0 ? 0 : lead);
  return covered > 0 ? { note: after[noteAt].content, covered } : void 0;
}
function createCompactionHook(hookOptions = {}) {
  if (hookOptions.history) return createHistoryCompactionHook(hookOptions.history);
  return {
    async compact(ctx) {
      if (ctx.policy.modelHandoff) return handOff(ctx);
      const options = compactionOptions(ctx, hookOptions);
      const rows = ctx.messages.map(toPackRow);
      const result = await compactMessages(rows, options, options.summarize);
      if (!result.compacted) return void 0;
      const fold = result.droppedMessages > 0 ? foldOf(rows, result.messages) : void 0;
      return {
        messages: result.messages.map(toRunRow),
        dropped: result.droppedMessages,
        reserveTokens: options.reserveOutputTokens,
        beforeTokens: result.beforeTokens,
        afterTokens: result.afterTokens,
        summarized: result.summarized,
        ...result.maskedObservations ? { masked: result.maskedObservations } : {},
        ...fold ? { note: fold.note, covered: fold.covered } : {}
      };
    }
  };
}
var compactionHook = createCompactionHook();

// ../packages/agent-run/src/policy/stall/index.ts
function currentModel(ctx) {
  return ctx.state.model?.model ?? void 0;
}
function budgetOf(ctx) {
  const slot = ctx.state.stall;
  const model = currentModel(ctx);
  if (slot && typeof slot.recoveriesUsed === "number" && (slot.model === model || ctx.ports?.delivery?.stall?.runWideBudget)) return { ...slot };
  return model !== void 0 ? { model, recoveriesUsed: 0 } : { recoveriesUsed: 0 };
}
function saveBudget(ctx, budget, spent = 0) {
  const model = currentModel(ctx);
  const total = (ctx.state.stall?.recoveriesTotal ?? 0) + spent;
  const kept = { ...ctx.state.stall };
  delete kept.model;
  delete kept.recoveriesTotal;
  ctx.state.stall = {
    ...kept,
    ...model !== void 0 ? { model } : {},
    recoveriesUsed: budget.recoveriesUsed,
    ...total > 0 ? { recoveriesTotal: total } : {}
  };
}
var FORCED_SYNTHESIS_PROMPT = "Now write your reply to the team AS the agent: plain prose, first person, no tool calls. Summarise what you found or did.";
function failureStreakSynthesisPrompt(streak) {
  return `This turn was stopped because your last ${streak} tool calls all failed. Do NOT call any more tools. Answer the user now, in prose, using what you have already gathered \u2014 say what you completed, quote what the failing calls answered, and state plainly what is blocking you and what you need (a different argument, a permission, a decision) so the next turn can succeed.`;
}
var stallHook = {
  recover(ctx) {
    const delivery = ctx.ports?.delivery;
    if (delivery) {
      const first = narratesFirst(delivery) ? narrationRecover(ctx, "nudge") : void 0;
      if (first) return first;
      const owed = ctx.finishing ? void 0 : walkLadder(ctx, delivery);
      if (owed || delivery.owns?.narration) return owed;
    }
    return narrationRecover(ctx) ?? deliverableRecover(ctx);
  },
  /** {@link recover} for a ledger whose rungs need a promise to say which hold; the kernel calls this one. */
  async recoverAsync(ctx) {
    const delivery = ctx.ports?.delivery;
    if (delivery) {
      const first = narratesFirst(delivery) ? narrationRecover(ctx, "nudge") : void 0;
      if (first) return first;
      const owed = ctx.finishing ? void 0 : await walkLadderAsync(ctx, delivery);
      if (owed || delivery.owns?.narration) return owed;
    }
    return narrationRecover(ctx) ?? deliverableRecover(ctx);
  },
  /**
   * The settled answer, shaped the way every source shapes it: a reply stuck on one
   * block posts that block once (`trimRepetitionLoop`, `brain/agentReplyLoop.ts`), and a
   * prose question with options becomes the canonical ```ask-user block the surfaces
   * render as a choice (`liftProseAskUser`).
   */
  settle(ctx, text) {
    const delivery = ctx.ports?.delivery;
    if (delivery?.owns?.settle && delivery.accept) return delivery.accept(text);
    return liftProseAskUser(trimRepetitionLoop(text.trim()));
  },
  /** A turn that called a tool is never a stall: the current model's budget starts full again. */
  acted(ctx) {
    if (ctx.state.stall && ctx.state.stall.recoveriesUsed > 0) saveBudget(ctx, { recoveriesUsed: 0 });
  },
  /**
   * The forced no-tools final synthesis: a run that ended without speaking (every turn
   * only called tools, a budget ran out, a breaker tripped) gets ONE bounded extra call
   * with this prompt and no tools, so the agent always answers (`brain/agentReplyLoop.ts`).
   */
  synthesis(ctx, why) {
    if (ctx.ports?.delivery?.stall?.failureSynthesis) return why?.failureStreak !== void 0 ? failureStreakSynthesisPrompt(why.failureStreak) : null;
    if (ctx.ports?.delivery?.owns?.synthesis) return null;
    return ctx.task.agentName ? FORCED_SYNTHESIS_PROMPT.replace("AS the agent", `AS ${ctx.task.agentName}`) : FORCED_SYNTHESIS_PROMPT;
  }
};
var ANNOUNCED_DELIVERABLE_ID = "announced_deliverable";
function deliverableRecover(ctx) {
  const text = ctx.judged ?? (typeof ctx.content === "string" ? ctx.content : "");
  const said = ctx.state.stall?.said ?? [];
  if (said.includes(ANNOUNCED_DELIVERABLE_ID) || !announcesDeliverable(text)) return void 0;
  ctx.state.stall = { ...ctx.state.stall ?? { recoveriesUsed: 0 }, said: [...said, ANNOUNCED_DELIVERABLE_ID] };
  return { action: "steer", note: ANNOUNCED_DELIVERABLE_STEER, detail: { model: ctx.state.model.model ?? null, shape: "announced-deliverable" } };
}
function narratesFirst(delivery) {
  return delivery.stall?.narrationFirst === true && !delivery.owns?.narration;
}
function narrationRecover(ctx, only) {
  const text = ctx.judged ?? (typeof ctx.content === "string" ? ctx.content : "");
  const toolNames = (ctx.tools ?? []).map((t) => t.function?.name ?? "").filter(Boolean);
  const style = ctx.ports?.delivery?.stall;
  const held = ctx.state.model.model && ctx.state.model.model !== "default" ? ctx.state.model.model : void 0;
  const served = ctx.served?.model && ctx.served.model !== "default" ? ctx.served.model : void 0;
  const resolvedModel = served ?? held;
  const budget = budgetOf(ctx);
  const { policy, step } = resolveStallStep(
    ctx.state.model,
    {
      text,
      toolCallCount: 0,
      availableToolNames: toolNames,
      // Whether the user asked for a change decides what handing the work back means.
      requestText: ctx.task.request ?? ctx.task.prompt,
      ...resolvedModel ? { resolvedModel } : {}
    },
    budget.recoveriesUsed,
    // The failover source rides the run policy's proven/tried set; the transport names
    // the models a failover may land on (the tenant's connected flagships, the coding
    // pool). Without one the default never returns the model that just failed, never
    // more than MAX_MODEL_FAILOVERS deep.
    {
      surface: ctx.ports.model?.fallbackSurface?.() ?? void 0,
      // A host whose successor is a function of what was already tried (an operator's declared chain) names it here; it wins over the surface.
      ...ctx.ports.model?.pickFallback ? { pick: (tried) => ctx.ports.model.pickFallback(tried) } : {}
    }
  );
  if (only === "nudge" && step.kind !== "nudge") return void 0;
  switch (step.kind) {
    case "none":
      return void 0;
    case "nudge": {
      budget.recoveriesUsed = step.recoveriesUsed;
      saveBudget(ctx, budget, 1);
      if (step.toolChoice) ctx.state.forceToolChoice = step.toolChoice;
      return { action: "steer", note: step.nudge, detail: { model: ctx.state.model.model ?? null, attempt: step.recoveriesUsed, shape: step.shape ?? null, ...style?.menu ? { advertisedTools: toolNames.length } : {} } };
    }
    case "failover": {
      budget.recoveriesUsed = step.recoveriesUsed;
      saveBudget(ctx, budget, 1);
      ctx.state.model = policy;
      if (step.toolChoice) ctx.state.forceToolChoice = step.toolChoice;
      return {
        action: "escalate",
        note: style?.failoverNudgeOnly ? step.nudge : `${step.notice}

${step.nudge}`,
        detail: { from: step.from ?? null, to: step.to, attempt: step.attempt, of: step.of, shape: step.shape ?? null, notice: step.notice }
      };
    }
    case "exhausted": {
      saveBudget(ctx, budget);
      return {
        action: "pause",
        note: step.notice,
        detail: { model: resolvedModel ?? ctx.state.model.model ?? null, tried: step.tried, shape: step.shape ?? null, ...style?.menu ? { attempts: budget.recoveriesUsed, advertisedTools: toolNames.length } : {} }
      };
    }
  }
}

// ../packages/agent-run/src/policy/steering/runSteering.ts
var inboxes = /* @__PURE__ */ new Map();
var interrupting = /* @__PURE__ */ new Set();
var interruptListeners = /* @__PURE__ */ new Map();
function newSteerKey() {
  return `steer:${crypto.randomUUID()}`;
}
function queueRunSteering(runKey, text, opts) {
  const trimmed = text.trim();
  if (!trimmed) return void 0;
  const eventKey = opts?.eventKey ?? (opts?.persist ? newSteerKey() : void 0);
  const message = { text: trimmed, attachments: opts?.attachments, ...opts?.fromPerson ? { fromPerson: true } : {}, ...opts?.persist ? { persist: true } : {}, ...opts?.saved ? { saved: true } : {}, ...eventKey ? { eventKey } : {}, ...opts?.childReport ? { childReport: opts.childReport } : {} };
  const queue = inboxes.get(runKey) ?? [];
  queue.push(message);
  inboxes.set(runKey, queue);
  if (!opts?.interrupt) return message;
  interrupting.add(runKey);
  for (const listener of [...interruptListeners.get(runKey) ?? []]) listener();
  return message;
}
function requeueRunSteering(runKey, messages) {
  if (messages.length === 0) return;
  inboxes.set(runKey, [...messages, ...inboxes.get(runKey) ?? []]);
}
function childWorkRefs(messages) {
  return [...new Set(messages.flatMap(({ childReport }) => childReport?.ticket ? [childReport.ticket] : []))];
}
function drainRunSteering(runKey) {
  interrupting.delete(runKey);
  const queue = inboxes.get(runKey);
  if (!queue?.length) return [];
  inboxes.delete(runKey);
  return queue;
}
function hasRunInterrupt(runKey) {
  return interrupting.has(runKey);
}
function onRunInterrupt(runKey, listener) {
  const set = interruptListeners.get(runKey) ?? /* @__PURE__ */ new Set();
  set.add(listener);
  interruptListeners.set(runKey, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) interruptListeners.delete(runKey);
  };
}
function runSteeringSource(runKey) {
  return {
    drain: () => {
      const interrupt = hasRunInterrupt(runKey);
      return drainRunSteering(runKey).map((m) => ({
        text: m.text,
        ...m.attachments !== void 0 ? { attachments: m.attachments } : {},
        ...interrupt ? { interrupt: true } : {}
      }));
    },
    hasInterrupt: () => hasRunInterrupt(runKey),
    onInterrupt: (listener) => onRunInterrupt(runKey, listener)
  };
}

// ../packages/agent-run/src/policy/steering/steerInterrupt.ts
function runInterruptWatch(runKey) {
  return { hasInterrupt: () => hasRunInterrupt(runKey), onInterrupt: (listener) => onRunInterrupt(runKey, listener) };
}
var INTERRUPTED_BY_STEER = "Interrupted by the user's new message: the command did not run to completion (it was stopped, or it had not started when the message arrived). Read the message that follows and do what it asks; re-run the command only if it still applies.";
var STOPPED_BY_USER = "Stopped by the user: the command was killed before it finished.";
var WAIT_INTERRUPTED_BY_STEER = "Wait interrupted by the user's new message: the background job is STILL RUNNING. Read the message that follows and do what it asks; check the job later with command_status, or stop it with command_stop.";
var SKIPPED_BY_STEER = "Not run: the user sent a new message while this turn was running. Read it and decide what to do next.";
function argsOf2(args) {
  return args && typeof args === "object" && !Array.isArray(args) ? args : {};
}
function isWaitCall(name, a) {
  if (name === "run_command") return a.background !== true && a.yieldMs != null;
  return name === "command_status" && typeof a.waitMs === "number" && a.waitMs > 0;
}
function isInterruptibleCall(name, args) {
  const a = argsOf2(args);
  if (isWaitCall(name, a)) return true;
  return name === "run_command" && a.background !== true;
}
function interruptedResult(out) {
  const base = out && typeof out === "object" && !Array.isArray(out) ? out : out === void 0 ? {} : { output: out };
  return { ...base, ok: false, aborted: true, interrupted: true, error: INTERRUPTED_BY_STEER };
}
function notStartedResult() {
  return { ...interruptedResult(void 0), skipped: true };
}
function stoppedResult(out) {
  const base = out && typeof out === "object" && !Array.isArray(out) ? out : out === void 0 ? {} : { output: out };
  return { ...base, ok: false, aborted: true, stopped: true, error: STOPPED_BY_USER };
}
function waitInterruptedResult(out) {
  const base = out && typeof out === "object" && !Array.isArray(out) ? out : { output: out };
  return { ...base, interrupted: true, note: WAIT_INTERRUPTED_BY_STEER };
}
function cameBackAborted(out) {
  return !!out && typeof out === "object" && out.aborted === true;
}
async function runToolWithWatch(runTool2, watch, runSignal, name, args, surfaceInterruptible) {
  if (!isInterruptibleCall(name, args) && !surfaceInterruptible?.(name, argsOf2(args))) return runTool2(name, args);
  if (watch.hasInterrupt()) return notStartedResult();
  const wait = isWaitCall(name, argsOf2(args));
  const step = new AbortController();
  let interrupted = false;
  const onStop = () => step.abort();
  if (runSignal?.aborted) step.abort();
  runSignal?.addEventListener("abort", onStop, { once: true });
  const off = watch.onInterrupt(() => {
    interrupted = true;
    step.abort();
  });
  try {
    const out = await runTool2(name, args, step.signal);
    if (!interrupted) return out;
    const restated = () => out.stopped === true ? out : interruptedResult(out);
    if (wait) return cameBackAborted(out) ? restated() : waitInterruptedResult(out);
    return cameBackAborted(out) ? restated() : out;
  } finally {
    off();
    runSignal?.removeEventListener("abort", onStop);
  }
}
function runToolInterruptibly(runTool2, runKey, runSignal, name, args) {
  return runToolWithWatch(runTool2, runInterruptWatch(runKey), runSignal, name, args);
}
function steerSkip(watch) {
  if (!watch.hasInterrupt()) return void 0;
  return { skipRemaining: { data: { ok: false, skipped: true, error: SKIPPED_BY_STEER }, isError: false } };
}

// ../packages/agent-run/src/policy/steering/index.ts
function steerInput(raw) {
  return typeof raw === "string" ? { text: raw } : raw;
}
function portInterruptWatch(source) {
  return {
    hasInterrupt: () => source?.hasInterrupt?.() ?? false,
    onInterrupt: (listener) => source?.onInterrupt?.(listener) ?? (() => void 0)
  };
}
function isStopSteer(steered) {
  return steered.some((text) => stopIntent(text));
}
var steeringHook = {
  inject(_ctx, steered) {
    if (steered.length === 0) return void 0;
    return steered.map((text) => ({ role: "user", content: text }));
  }
};

// ../packages/agent-run/src/policy/ask/index.ts
var askHook = {
  async answer(ctx, question, options) {
    if (!ctx.ports.human || typeof ctx.ports.human.ask !== "function") {
      return { kind: "paused" };
    }
    return measureWorkflow(
      ctx.ports.events,
      { ...workflowScope(ctx, ctx.step), operation: "human_wait" },
      "dispatch",
      () => ctx.ports.human.ask(question, options),
      (reply) => reply.kind === "paused" ? "blocked" : "completed",
      ctx.signal
    );
  }
};

// ../packages/agent-run/src/policy/guards/readOnly.ts
function isReadOnlyCloudTool(name) {
  const canonical = resolveToolAlias(name);
  return toolSideEffect(canonical) === "read" && !CONTROL_TOOL_NAMES.includes(canonical) && canonical !== "wait_agents";
}

// ../packages/agent-run/src/policy/subagents/delegationRequest.ts
var SPAWN_TOOLS = /* @__PURE__ */ new Set(["spawn_agent", "spawn_agents"]);
var SUBAGENT_NOUN = String.raw`(?:sub[- ]?agents?|(?:parallel|concurrent)\s+(?:agents?|workers?))`;
var ASKS_FOR_SUBAGENTS = new RegExp(
  String.raw`\b(?:use|using|with|via|through|delegate(?:\s+(?:it|this|them|the\s+\w+))?\s+to|run|launch|start|dispatch|employ)\s+` + String.raw`(?:(?:the|some|a|few|several|multiple|more|\d+)\s+){0,2}` + SUBAGENT_NOUN + String.raw`\b` + String.raw`|\bspawn(?:_agents?|\s+(?:agents?|workers?|children|sub[- ]?agents?))\b` + String.raw`|\bfan[- ]?out\s+(?:the|these|this|it|them|across|over|to)\b`,
  "i"
);
var DECLINES_SUBAGENTS = /\b(?:no|without|don'?t\s+use|do\s+not\s+use|never\s+use|skip(?:\s+the)?)\s+(?:any\s+)?sub[- ]?agents?\b/i;
function asksForSubagents(text) {
  const t = text ?? "";
  return ASKS_FOR_SUBAGENTS.test(t) && !DECLINES_SUBAGENTS.test(t);
}
function canSpawnHere(toolNames) {
  return toolNames.some((n) => SPAWN_TOOLS.has(n));
}
function isSpawnTool(name) {
  return SPAWN_TOOLS.has(name);
}
function attemptedDelegation(events) {
  return events.some((e) => e.category === "tool" && SPAWN_TOOLS.has(e.label));
}
function leftDelegationUndone(input) {
  return canSpawnHere(input.toolNames) && asksForSubagents(input.requestText) && !attemptedDelegation(input.events);
}
function undelegatedRequestNudge(toolNames) {
  const fanOut = toolNames.includes("spawn_agents");
  const call = fanOut ? 'Call spawn_agents NOW: one workstream per open ticket whose files do not overlap \u2014 ticket=<id>, a complete standalone task brief, role "code". Each child is a clone of you and makes its change itself. It takes up to 4 per call and returns at once \u2014 the children run in the background, so start the next batch right away if there are more. Use spawn_agent for a slice that must run alone.' : 'Call spawn_agent NOW, one slice at a time, with a complete standalone task brief and role "code". The child is a clone of you and makes its change itself.';
  return `The user asked for this work to be done by SUB-AGENTS, and none has been started. Do not ask how to proceed \u2014 the user already said. A sub-agent here is a LOCAL child run on this machine: it needs no cloud dispatch, no ticket assignment and no Developer on the roster. The workspace execution kill-switch and every \`autoRun: execution_disabled\` verdict stop CLOUD runs only \u2014 they do not apply to it. as_agent is optional: with no fitting teammate, OMIT it \u2014 the spawn tools staff the role on this project themselves (a capable teammate, or a Developer hired into the workspace and project, with the ticket assigned) and the child runs AS that agent. ${call} ${delegationShape(fanOut ? "spawn_agents" : "spawn_agent")} Keep working while they run; when their reports are in (they arrive on their own, or call wait_agents), verify their changes and report what each child delivered, per ticket.`;
}
function delegationShape(spawnTool) {
  return `The shape of this run: you read only the document the request names and the chat state already in your context \u2014 no source files. Research (reading code, searching, tracing callers) goes to children: ${spawnTool} with role "explore", one per question, each brief stating the question, the files or folders to start from, what is already known and ruled out, and the answer's shape (paths with line numbers, short excerpts, a word cap). When they report, write the deliverable the request names (the document or plan edit) yourself in that same turn \u2014 filing tickets is not the deliverable.`;
}
function earlyDelegationNudge(toolNames, reads) {
  return `STOP READING AND DELEGATE. This run has made ${reads} read calls and started no sub-agent. ${undelegatedRequestNudge(toolNames)}`;
}

// ../packages/learned-routing/src/actionTypes.ts
var ACTION_TYPES = [
  "sql",
  "frontend_ui",
  "backend_api",
  "refactor",
  "bugfix",
  "tests",
  "docs",
  "devops_ci",
  "data_migration",
  "analysis",
  "provisioning",
  "decision",
  "other"
];
var DEFAULT_ACTION_TYPE = "other";
var ACTION_TYPE_SET = new Set(ACTION_TYPES);

// ../packages/learned-routing/src/exploration.ts
import { betaMoments, normalDraw } from "@seanhogg/builderforce-memory/stats";

// ../packages/learned-routing/src/recencyDecay.ts
var ROUTING_HALF_LIFE_DAYS = 30;
var DECAYED_WINDOW_DAYS = 4 * ROUTING_HALF_LIFE_DAYS;
var DAY_MS2 = 24 * 60 * 60 * 1e3;

// ../packages/learned-routing/src/runOutcomeTelemetry.ts
var ALL_ENTRY_POINTS = ["vscode", "web", "rovr", "canvas", "on-prem", "cloud"];
var CLIENT_ENTRY_POINTS = ALL_ENTRY_POINTS.filter(
  (entryPoint2) => entryPoint2 !== "cloud"
);
var MODEL_PREFLIGHT_MAX = 32;
var PROGRESS_SIGNALS_MAX = 8;
var SIGNAL_NAME_MAX = 32;
var COUNT_MAX = 1e7;
var PARENT_RUN_ID_MAX = 128;
var COUNTERS = [
  "toolCalls",
  "toolErrors",
  "tokens",
  "cacheReadTokens",
  "compactions",
  "stallRecoveries",
  "escalations",
  "coveredReadStubs",
  "shellFileReads",
  "repoErrors",
  "contextPackTokens",
  "unkeptReadyClaims"
];
function count(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= COUNT_MAX ? v : void 0;
}
function entryPoint(v) {
  return typeof v === "string" && CLIENT_ENTRY_POINTS.includes(v) ? v : void 0;
}
function verify(v) {
  return v === "passed" || v === "failed" || v === "not-run" ? v : void 0;
}
function modelPreflight(v) {
  if (typeof v !== "string") return void 0;
  const s = v.trim();
  if (s !== "ok" && s !== "refreshed" && !s.startsWith("degraded")) return void 0;
  return s.slice(0, MODEL_PREFLIGHT_MAX);
}
function parentRunId(v) {
  if (typeof v !== "string") return void 0;
  const s = v.trim();
  return s.length > 0 && s.length <= PARENT_RUN_ID_MAX && /^[\w:.\-]+$/.test(s) ? s : void 0;
}
function progressTrips(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return void 0;
  const entries = Object.entries(v);
  if (entries.length > PROGRESS_SIGNALS_MAX) return void 0;
  const out = {};
  for (const [signal, n] of entries) {
    const c = count(n);
    if (!/^[a-z_]+$/.test(signal) || signal.length > SIGNAL_NAME_MAX || c === void 0) return void 0;
    out[signal] = c;
  }
  return out;
}
function wireCost(row) {
  const cost = row.cost;
  return typeof cost === "number" && Number.isInteger(cost) && cost >= 0 && cost <= COUNT_MAX ? { costMc: cost } : {};
}
function parseRunOutcomeTelemetry(b) {
  const out = {};
  const ep = entryPoint(b.entryPoint);
  if (ep) out.entryPoint = ep;
  for (const key of COUNTERS) {
    const c = count(b[key]);
    if (c !== void 0) out[key] = c;
  }
  const v = verify(b.verify);
  if (v) out.verify = v;
  if (b.firstSpawnTurn === null) out.firstSpawnTurn = null;
  else {
    const turn = count(b.firstSpawnTurn);
    if (turn !== void 0) out.firstSpawnTurn = turn;
  }
  const preflight = modelPreflight(b.modelPreflight);
  if (preflight) out.modelPreflight = preflight;
  const trips = progressTrips(b.progressTrips);
  if (trips) out.progressTrips = trips;
  const parent = parentRunId(b.parentRunId);
  if (parent) out.parentRunId = parent;
  return out;
}

// ../packages/learned-routing/src/rateLimitFailure.ts
var AVAILABILITY = /\b429\b|\b529\b|rate.?limit|too many requests|over ?capacity|capacity limit|overloaded|resource has been exhausted|\bin cooldown\b|cooldown or unavailable/i;
var GRPC_RESOURCE_EXHAUSTED = /\bRESOURCE_EXHAUSTED\b/;
var AVAILABILITY_STATUSES = /* @__PURE__ */ new Set([429, 529]);
var TENANT_BUDGET_CODES = [
  "agent_host_token_limit_exceeded",
  "plan_token_limit_exceeded",
  "plan_monthly_token_limit_exceeded",
  "member_spend_cap_exceeded",
  "premium_daily_cap_exceeded",
  "image_credit_limit_exceeded",
  "video_credit_limit_exceeded",
  "claw_token_limit_exceeded"
];
var BUDGET_CODE = new RegExp(`\\b(?:${TENANT_BUDGET_CODES.join("|")})\\b`);
var BUDGET_WORDING = new RegExp(
  [
    /(?:plan|daily|monthly|agenthost)\b[^.]{0,30}\btoken limit reached/,
    /generation limit reached/,
    /allowance reached/,
    /spend cap reached/,
    /premium-model budget exhausted/
  ].map((re) => re.source).join("|"),
  "i"
);
function isTenantBudgetFailure(message) {
  return !!message && (BUDGET_CODE.test(message) || BUDGET_WORDING.test(message));
}
function isRateLimitFailure(message, status) {
  if (isTenantBudgetFailure(message)) return false;
  return status != null && AVAILABILITY_STATUSES.has(status) || !!message && (AVAILABILITY.test(message) || GRPC_RESOURCE_EXHAUSTED.test(message));
}

// ../packages/agent-run/src/policy/subagents/child.ts
var CHILD_SPAWN_REFUSAL = "Only root runs can spawn sub-agents";
function blocksChildSpawn(dispatch, tool) {
  return (dispatch.source === "subagent" || dispatch.parentRunId !== void 0) && (isSpawnTool(tool) || tool === "sessions_spawn" || tool === "Task");
}

// ../packages/agent-run/src/policy/subagents/index.ts
function toolNamesOf(ctx) {
  return ctx.tools.map((tool) => tool.function?.name).filter((name) => !!name);
}
function delegationCallKind(name) {
  if (isSpawnTool(name)) return "spawn";
  return isReadOnlyCloudTool(name) ? "read" : "other";
}
function readsWithoutSpawnOf(ctx) {
  const counter = new ReadsWithoutSpawn();
  for (const message of ctx.messages) {
    for (const call of message.toolCalls ?? []) counter.record(delegationCallKind(call.name));
  }
  const counted = counter.snapshot();
  const saved = ctx.state.reads.readsWithoutSpawn;
  const spawned = saved.spawned || counted.spawned;
  return { reads: Math.max(saved.reads, counted.reads), spawned, nudged: saved.nudged };
}
function delegationLeftUndone(ctx) {
  return ctx.policy.delegation.requested && canSpawnHere(toolNamesOf(ctx)) && !readsWithoutSpawnOf(ctx).spawned;
}
function delegationNudge(ctx) {
  const counted = readsWithoutSpawnOf(ctx);
  ctx.state.reads = { ...ctx.state.reads, readsWithoutSpawn: counted };
  const counter = new ReadsWithoutSpawn(counted);
  if (!counter.due(ctx.policy.delegation.readsBeforeNudge) || !delegationLeftUndone(ctx)) return null;
  counter.markNudged();
  ctx.state.reads = { ...ctx.state.reads, readsWithoutSpawn: counter.snapshot() };
  return earlyDelegationNudge(toolNamesOf(ctx), counted.reads);
}
function delegationBackstop(ctx) {
  return delegationLeftUndone(ctx) ? undelegatedRequestNudge(toolNamesOf(ctx)) : null;
}
function withDelegationAdvisory(result, nudge) {
  return result && typeof result === "object" && !Array.isArray(result) ? { ...result, advisory: nudge } : { output: result, advisory: nudge };
}
var subagentsHook = {
  backstop: delegationBackstop,
  nudge(ctx, call, result) {
    if (delegationCallKind(call.name) !== "read") return void 0;
    const nudge = delegationNudge(ctx);
    return nudge ? { data: withDelegationAdvisory(result, nudge) } : void 0;
  }
};

// ../packages/agent-run/src/policy/guards/sourcePolicy.ts
var JSON_EXT = /\.json$/i;
var YAML_EXT = /\.ya?ml$/i;
var SOURCE_EXT = /\.[cm]?[jt]sx?$/i;
function isVerifiablePath(path) {
  return JSON_EXT.test(path) || YAML_EXT.test(path) || SOURCE_EXT.test(path);
}
var TS_SOURCE = /\.[cm]?[jt]sx?$/i;
var CONDITIONAL_JSX_CALLBACK = /\b(on[A-Z][A-Za-z0-9_$]*)\s*=\s*\{[^{}]{0,300}\?\s*(?:async\s*)?\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*=>/g;
function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}
function maskNonCode(source) {
  const chars = [...source];
  let state = "code";
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    const next = chars[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") {
        chars[i] = chars[i + 1] = " ";
        state = "line-comment";
        i += 1;
      } else if (c === "/" && next === "*") {
        chars[i] = chars[i + 1] = " ";
        state = "block-comment";
        i += 1;
      } else if (c === "'") {
        chars[i] = " ";
        state = "single";
      } else if (c === '"') {
        chars[i] = " ";
        state = "double";
      } else if (c === "`") {
        chars[i] = " ";
        state = "template";
      }
      continue;
    }
    if (c === "\n" && state === "line-comment") {
      state = "code";
      continue;
    }
    if (c === "\n") continue;
    const escaped = i > 0 && source[i - 1] === "\\";
    if (state === "block-comment" && c === "*" && next === "/") {
      chars[i] = chars[i + 1] = " ";
      state = "code";
      i += 1;
      continue;
    }
    chars[i] = " ";
    if (!escaped && (state === "single" && c === "'" || state === "double" && c === '"' || state === "template" && c === "`")) state = "code";
  }
  return chars.join("");
}
function inspectAgentSource(path, source) {
  if (!TS_SOURCE.test(path)) return [];
  const findings = [];
  for (const match of maskNonCode(source).matchAll(CONDITIONAL_JSX_CALLBACK)) {
    const prop = match[1];
    const parameter = match[2];
    findings.push({
      ruleId: "typescript/explicit-conditional-jsx-callback",
      line: lineAt(source, match.index ?? 0),
      message: `Parameter '${parameter}' in conditional JSX callback '${prop}' needs an explicit type. Prefer a named callback typed from the component prop contract (for example, \`NonNullable<Props['onChange']>\`) so API changes are checked at the boundary.`
    });
  }
  return findings;
}
var YAML_TAB_INDENT = /^\t+ /m;
function yamlFlowUnbalanced(content) {
  let depth = 0;
  for (const ch of content) {
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth -= 1;
    if (depth < 0) return true;
  }
  return depth !== 0;
}
function checkYamlContent(content) {
  if (YAML_TAB_INDENT.test(content)) {
    return "YAML uses tab characters for indentation, which YAML forbids \u2014 use spaces.";
  }
  if (yamlFlowUnbalanced(content)) {
    return "YAML flow collection brackets ([ ] { }) are unbalanced \u2014 the document is malformed.";
  }
  return null;
}
function checkFileContent(path, content) {
  if (!isVerifiablePath(path)) return { kind: "skipped" };
  try {
    if (JSON_EXT.test(path)) {
      JSON.parse(content);
    } else if (YAML_EXT.test(path)) {
      const yamlError = checkYamlContent(content);
      if (yamlError) return { kind: "errors", errors: [{ message: yamlError.slice(0, 240) }] };
    } else {
      const findings = inspectAgentSource(path, content);
      if (findings.length) {
        return { kind: "errors", errors: findings.map((f) => ({ message: f.message, line: f.line, ruleId: f.ruleId })) };
      }
    }
    return { kind: "checked" };
  } catch (e) {
    return { kind: "errors", errors: [{ message: e.message.slice(0, 240) }] };
  }
}
function foldVerifyOutcomes(outcomes) {
  const checked = [];
  const skipped2 = [];
  const errors = [];
  for (const o of outcomes) {
    if (o.kind === "errors") errors.push(...o.errors.map((error) => ({ path: o.path, ...error })));
    else if (o.kind === "checked") checked.push(o.path);
    else skipped2.push(o.path);
  }
  return { ok: errors.length === 0, checked, skipped: skipped2, errors };
}
async function verifyWrittenFiles(read, paths) {
  const list2 = [...paths];
  const outcomes = await Promise.all(
    list2.map(async (path) => {
      if (!isVerifiablePath(path)) return { path, kind: "skipped" };
      const content = await read(path).catch(() => null);
      if (content === null) return { path, kind: "skipped" };
      return { path, ...checkFileContent(path, content) };
    })
  );
  return foldVerifyOutcomes(outcomes);
}

// ../packages/agent-run/src/policy/finish/finishTools.ts
function assertsUnrunVerification(summary) {
  const s = summary.toLowerCase();
  const check = /(type[\s-]?check|typecheck|typescript|\btsc\b|lint|eslint|\btest(s|ing|ed)?\b|\bbuild(s|ing)?\b|compil)/;
  const pass2 = /(pass(es|ed|ing)?|succeed(s|ed)?|success|green|no\s+errors?|error[\s-]?free|will\s+now\s+pass|are\s+resolved|is\s+resolved)/;
  return check.test(s) && pass2.test(s);
}
var DOCUMENT_EXTENSIONS = /* @__PURE__ */ new Set([
  ".md",
  ".mdx",
  ".rst",
  ".adoc",
  ".asciidoc",
  ".txt"
]);
function isDocumentationPath(path) {
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("docs/") || normalized.startsWith("specs/")) return true;
  const file = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot >= 0 && DOCUMENT_EXTENSIONS.has(file.slice(dot));
}
function hasNoCodeDeliverable(writtenPaths) {
  for (const path of writtenPaths) {
    if (!path.trim()) continue;
    if (!isDocumentationPath(path)) return false;
  }
  return true;
}
var MAX_PLACEHOLDER_FINISH_BLOCKS = 2;

// ../packages/agent-run/src/policy/finish/gates.ts
function matchesRequiredReviewSignoff(required, toolName, args, succeeded8) {
  if (!required || !succeeded8 || toolName !== "builtin_kanban_signoff") return false;
  const roleKey = typeof args.roleKey === "string" ? args.roleKey.trim() : "";
  const laneKey = typeof args.laneKey === "string" ? args.laneKey.trim() : void 0;
  return roleKey === required.roleKey && laneKey === required.laneKey;
}
function missingReviewVerdictMessage(required) {
  const lane = required.laneKey ? ` and laneKey='${required.laneKey}'` : "";
  return `Cannot finish this reviewer assignment until you call builtin_kanban_signoff with roleKey='${required.roleKey}'${lane} and an explicit approved or changes_requested verdict. A narrative summary is not acceptance evidence.`;
}
function initialFinishGateState(resume) {
  return {
    noDeliverableBlocked: resume?.noDeliverableBlocked ?? false,
    reviewVerdictRecorded: resume?.reviewVerdictRecorded ?? false,
    placeholderBlocks: resume?.placeholderBlocks ?? 0,
    ciPendingBlocks: resume?.ciPendingBlocks ?? 0,
    ciFailureBlocks: resume?.ciFailureBlocks ?? 0,
    ciVerified: false,
    finishBlockedOnce: false
  };
}
async function evaluateFinishGates(a) {
  const { requiredSignoff, summary, gates } = a;
  let writtenPaths = a.writtenPaths;
  let absorbed;
  a.ports?.beginAttempt?.();
  const blocked = async (reason, block, detail, result) => {
    await a.ports?.onBlocked?.(reason, block, detail, result);
    return { block, reason, ...absorbed ? { writtenPaths: absorbed } : {} };
  };
  if (a.delegated && a.ports?.liveChildren) {
    const childBlock = await a.ports.liveChildren();
    if (childBlock) return { block: childBlock, reason: "children_running" };
    if (a.ports.absorbChildWrites) {
      const merged = new Set(writtenPaths);
      await a.ports.absorbChildWrites(merged);
      if (merged.size !== writtenPaths.length) {
        writtenPaths = [...merged];
        absorbed = writtenPaths;
      }
    }
  }
  const bound = a.ports?.bound !== false;
  const wrote = bound && writtenPaths.length > 0;
  const codeBound = bound && (wrote || a.ports?.read !== void 0 || a.ports?.verify !== void 0);
  const verification = wrote && a.ports?.verify ? await a.ports.verify(writtenPaths) : wrote && a.ports?.read ? await verifyWrittenFiles(a.ports.read, writtenPaths) : null;
  let ci = null;
  let ciPending = false;
  if (a.ports?.pollBranchCi && wrote && verification?.ok !== false) {
    ci = await a.ports.pollBranchCi({ pendingBlocks: gates.ciPendingBlocks, failureBlocks: gates.ciFailureBlocks });
    ciPending = ci.pendingBlocks > gates.ciPendingBlocks;
    gates.ciPendingBlocks = ci.pendingBlocks;
    gates.ciFailureBlocks = ci.failureBlocks;
    gates.ciVerified = ci.ciVerified;
  }
  if (wrote) a.enterVerify();
  if (requiredSignoff && !gates.reviewVerdictRecorded) {
    const block = missingReviewVerdictMessage(requiredSignoff);
    return blocked("review_verdict_missing", block, { ...requiredSignoff }, block);
  }
  if (codeBound && !gates.noDeliverableBlocked && hasNoCodeDeliverable(writtenPaths)) {
    gates.noDeliverableBlocked = true;
    return blocked(
      "no_deliverable",
      "Before finishing: you have not committed any code changes for this task \u2014 only the PRD (or nothing) is on the branch. Re-read the task requirements and verify EACH is actually implemented. If work remains, use search_code/read_file to find the right place and write_file to implement it, then finish. If \u2014 and only if \u2014 this task genuinely requires no code change, call finish again and state explicitly why no change was needed.",
      {},
      "Blocked finish: no code deliverable \u2014 self-review required"
    );
  }
  if (verification && !verification.ok) {
    const block = `Cannot finish \u2014 changed-file validation found ${verification.errors.length} issue(s). Repair every issue, then finish again. This is a shell-free source policy, not a claim that the full project type-check ran.
` + verification.errors.map((e) => `- ${e.path}${e.line ? `:${e.line}` : ""}${e.ruleId ? ` [${e.ruleId}]` : ""}: ${e.message}`).join("\n");
    return blocked("source_quality", block, { errors: verification.errors }, `Blocked finish: ${verification.errors.length} source/config quality issue(s)`);
  }
  if (ci?.block) {
    const recorded = await blocked("branch_ci", ci.block, { pendingBlocks: gates.ciPendingBlocks, failureBlocks: gates.ciFailureBlocks }, ci.block.slice(0, 300));
    return ciPending ? { ...recorded, reason: "branch_ci_pending" } : recorded;
  }
  if (summary && !gates.finishBlockedOnce && !gates.ciVerified && assertsUnrunVerification(summary)) {
    gates.finishBlockedOnce = true;
    return {
      block: "You stated that a build/type-check/lint/test passed or is resolved, but this executor cannot run a local shell and in-run CI did not report success. Call run_checks (it polls branch CI) or finish again with a summary that does NOT claim a check passed.",
      reason: "honesty",
      ...absorbed ? { writtenPaths: absorbed } : {}
    };
  }
  if (wrote && gates.placeholderBlocks < MAX_PLACEHOLDER_FINISH_BLOCKS && a.ports?.scanPlaceholders) {
    const scan = await a.ports.scanPlaceholders(writtenPaths);
    if (scan.flagged.length) {
      gates.placeholderBlocks += 1;
      return blocked(
        "placeholders",
        `Cannot finish \u2014 ${scan.flagged.length} committed file(s) still contain placeholder/stub code instead of a real implementation. Replace each stub with a working implementation that uses the existing infrastructure (search_code for it first), or if a file is dead code that should not ship in this PR, remove it with delete_file. Then call finish again.
` + scan.flagged.map((f) => `- ${f.path}: ${f.markers.join("; ")}`).join("\n"),
        { files: scan.flagged },
        `Blocked finish: ${scan.flagged.map((f) => f.path).join(", ")}`
      );
    }
  }
  if (wrote && a.ports?.recordClaim) {
    const claim = await a.ports.recordClaim(summary || a.output || `Completed changes to ${writtenPaths.join(", ")}`, writtenPaths);
    if (!claim.ok) {
      return {
        block: `Cannot finish \u2014 no structural evidence record supports this completion claim (${claim.error ?? "no evidence"}). Retry the successful write or verification, then finish again.`,
        reason: "claim_evidence",
        ...absorbed ? { writtenPaths: absorbed } : {}
      };
    }
  }
  return absorbed ? { block: null, writtenPaths: absorbed } : { block: null };
}

// ../packages/agent-run/src/policy/verify/runEndMemory.ts
var SHELL_SURFACES = /* @__PURE__ */ new Set(["sandbox", "on-prem"]);
var hasShell = (surface) => SHELL_SURFACES.has(surface);
function runVerifyPhase(input) {
  if (input.surface === "durable" && input.ciVerified) {
    return {
      surface: "durable",
      kind: "ran",
      reason: "verify_passed",
      commands: ["branch-ci"],
      failedCommands: [],
      mayFinish: true,
      note: "Branch CI passed."
    };
  }
  if (!hasShell(input.surface)) {
    return inRunVerifyOutcome({
      surface: "durable",
      writtenPaths: input.writtenPaths ?? [],
      results: input.results ?? null
    });
  }
  return inRunVerifyOutcome({
    surface: input.surface,
    writtenPaths: input.writtenPaths ?? [],
    packageScripts: input.packageScripts ?? null,
    runner: input.runner,
    results: input.results ?? null
  });
}
function describeVerifyOutcome(outcome) {
  if (outcome.kind === "skipped") return `verify skipped (${outcome.reason})`;
  if (outcome.commands.length === 0) return `verify ${outcome.kind}, no commands`;
  const failed3 = outcome.failedCommands.length;
  return `verify ${outcome.kind}: ${outcome.commands.join("; ")}${failed3 > 0 ? ` \u2014 ${failed3} failed` : ""}`;
}
function applyVerifyPhase(state) {
  return reduceRunPolicy(state, { type: "verify_started" });
}

// ../packages/agent-run/src/workPlan.ts
var MAX_OPEN_WORK_HOLDS = 6;
function recordWorkSnapshot(state, source, assigned, evidence) {
  state.workObservations = {
    ...state.workObservations,
    [source]: applyWorkEvidence(planWork(assigned), evidence)
  };
}
function planWork(assigned) {
  const items = /* @__PURE__ */ new Map();
  for (const item of assigned) {
    const id = item.id.trim();
    if (!id) throw new Error("Assigned work requires an id");
    const criteria = [...items.get(id)?.criteria ?? [], ...item.criteria];
    items.set(id, { id, criteria: [...new Set(criteria.map((entry) => entry.trim()).filter(Boolean))] });
  }
  return [...items.values()];
}
function applyWorkEvidence(plan, evidence) {
  const byId = new Map(evidence.filter((item) => ["done", "blocked", "in_review"].includes(item.status) && item.detail.trim()).map((item) => [item.id, item]));
  return plan.map(({ id, criteria }) => {
    const current = byId.get(id);
    return { id, criteria, ...current ? { evidence: current } : {} };
  });
}
function assignedWorkSection(plan) {
  const open = plan.filter((item) => !item.evidence);
  if (!open.length) return "";
  const items = open.slice(0, 15).map(({ id, criteria }) => `- ${JSON.stringify(id)}${criteria.length ? `: ${JSON.stringify(criteria).slice(0, 1500)}` : ""}`);
  if (open.length > items.length) items.push(`- ${open.length - items.length} more assigned items`);
  return items.join("\n");
}
function outstandingWork(plan) {
  const section = assignedWorkSection(plan);
  return section ? `Assigned work still needs evidence. Continue the open items or record the reason each item is blocked or in review.
${section}` : null;
}
function workSupportsRoutingSample(work, completed) {
  return !completed || !work || work.open + work.blocked === 0;
}
function evaluateRun(plan) {
  if (!plan.length) return void 0;
  const score2 = { assigned: plan.length, done: 0, blocked: 0, inReview: 0, open: 0 };
  for (const { evidence } of plan) {
    if (evidence?.status === "done") score2.done++;
    else if (evidence?.status === "blocked") score2.blocked++;
    else if (evidence?.status === "in_review") score2.inReview++;
    else score2.open++;
  }
  return score2;
}
function evaluateRunWork(state) {
  const observed = Object.values(state.workObservations ?? {}).flat();
  return evaluateRun([...new Map([...observed, ...state.work ?? []].map((item) => [item.id, item])).values()]);
}

// ../packages/agent-run/src/policy/finish/index.ts
var lastReasons = /* @__PURE__ */ new WeakMap();
function lastFinishReason(state) {
  return lastReasons.get(state);
}
function workFinishPorts(work) {
  return work.settleAfterRun ? { settleWorkAfterRun: true } : { workEvidence: (ids2) => work.evidence(ids2) };
}
var LINKED_WORK_OPEN = "linked_work_open";
function writtenPathsOf(ctx) {
  return ctx.state.writtenPaths ?? [];
}
function succeeded4(row) {
  if (!row) return false;
  try {
    const data = JSON.parse(row.content);
    return !(data && typeof data === "object" && data.ok === false);
  } catch {
    return row.content.trim().length > 0;
  }
}
function parseArgs(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function signoffRecorded(messages, required) {
  if (!required) return false;
  const results = /* @__PURE__ */ new Map();
  for (const row of messages) if (row.role === "tool" && row.toolCallId) results.set(row.toolCallId, row);
  return messages.some(
    (row) => row.role === "assistant" && (row.toolCalls ?? []).some(
      (call) => matchesRequiredReviewSignoff(required, call.name, parseArgs(call.arguments), succeeded4(results.get(call.id)))
    )
  );
}
function noteSignoff(ctx) {
  if (ctx.state.finish.reviewVerdictRecorded) return true;
  if (!signoffRecorded(ctx.messages, ctx.policy.signoff)) return false;
  ctx.state.finish = { ...ctx.state.finish, reviewVerdictRecorded: true };
  return true;
}
function signoffSettleBlock(ctx) {
  const required = ctx.policy.signoff;
  if (!required || noteSignoff(ctx)) return null;
  return missingReviewVerdictMessage(required);
}
function createFinishHook(ports = {}) {
  const delegated = (ctx) => ports.delegated ?? ctx.task.dispatch.parentRunId !== void 0;
  const unfinishedWork = (state) => ports.settleWorkAfterRun ? null : outstandingWork(state.work ?? []);
  const openWork = async (ctx) => {
    if (ctx.state.work?.length && !ports.settleWorkAfterRun) {
      if (ports.workEvidence) {
        const evidence = await ports.workEvidence(ctx.state.work.map((item) => item.id));
        ctx.state.work = applyWorkEvidence(ctx.state.work, evidence);
      }
      const unresolved = unfinishedWork(ctx.state);
      if (unresolved) {
        const holds = (ctx.state.workHolds ?? 0) + 1;
        ctx.state.workHolds = holds;
        if (holds > MAX_OPEN_WORK_HOLDS) throw new Error(unresolved);
        return unresolved;
      }
    }
    return ports.openWork ? ports.openWork(ctx) : null;
  };
  return {
    settleBlock: signoffSettleBlock,
    unfinishedWork,
    // An owner never ends with children still working — on `finish` (below) or in prose.
    liveChildren: async (ctx) => {
      if (!delegated(ctx) || !ports.liveChildren) return null;
      const block = await ports.liveChildren();
      if (!block && ports.absorbChildWrites) {
        ports.beginAttempt?.();
        const paths = new Set(writtenPathsOf(ctx));
        await ports.absorbChildWrites(paths);
        ctx.state.writtenPaths = [...paths];
      }
      return block;
    },
    // A run never ends while the tickets it owns are open — on `finish` (below, after every other gate) or in prose (the kernel).
    openWork,
    async gate(ctx) {
      noteSignoff(ctx);
      const verdict = await evaluateFinishGates({
        writtenPaths: writtenPathsOf(ctx),
        requiredSignoff: ctx.policy.signoff,
        delegated: delegated(ctx),
        summary: typeof ctx.content === "string" ? ctx.content : "",
        output: "",
        gates: ctx.state.finish,
        enterVerify: () => {
          if (ctx.policy.skipVerifyStage) return;
          ctx.state.model = applyVerifyPhase(ctx.state.model);
        },
        ports
      });
      if (verdict.writtenPaths) ctx.state.writtenPaths = [...verdict.writtenPaths];
      if (verdict.block) {
        ctx.state.finish = { ...ctx.state.finish, finishBlockedOnce: true };
        lastReasons.set(ctx.state, verdict.reason);
        return verdict.block;
      }
      const owed = await openWork(ctx);
      lastReasons.set(ctx.state, owed ? LINKED_WORK_OPEN : verdict.reason);
      return owed;
    }
  };
}
var finishHook = createFinishHook();

// ../packages/agent-run/src/policy/guards/cascade.ts
var CascadeSession = class {
  constructor(on, resume, ports = {}) {
    this.ports = ports;
    this.on = on;
    this.cascade = resume?.cascade ?? initialCascadeState();
    this.actionType = resume?.actionType;
    this.soft = resume?.soft ?? false;
    this.steer = resume?.steer;
    this.priorWeakPassRate = resume?.priorWeakPassRate;
    this.priorRead = resume?.priorRead ?? false;
  }
  ports;
  /** Whether the D1 lever is on. Lever off ⇒ every method is inert. */
  on;
  cascade;
  actionType;
  soft;
  steer;
  steerShown = false;
  priorWeakPassRate;
  priorRead;
  /**
   * The step's features with the tenant's recent weak-pass rate for its action type —
   * the D2 head's prior. Read at most once per run; a failed or empty read leaves the
   * feature unset, which the head reads as 0.5.
   */
  async withPrior(f) {
    if (typeof f.priorWeakPassRate === "number") return f;
    if (!this.priorRead && this.ports.weakPassRate) {
      this.priorRead = true;
      try {
        this.priorWeakPassRate = await this.ports.weakPassRate(this.featuresActionType(f.actionType));
      } catch {
      }
    }
    return typeof this.priorWeakPassRate === "number" ? { ...f, priorWeakPassRate: this.priorWeakPassRate } : f;
  }
  /** The run's action type for D2 features (the first tick's resolution, kept). */
  featuresActionType(fallback) {
    return this.actionType ?? fallback;
  }
  /**
   * The first tick's starting model. A soft seed starts on the WEAKEST tier of the
   * ladder — unless the router predicts the weak attempt would fail, in which case it
   * keeps the seed (the stronger default). A strict pin is left alone.
   */
  async seed(state, a) {
    this.actionType = a.features.actionType;
    this.soft = !a.strict;
    if (!this.on || !this.soft) return state;
    if (this.ports.shouldSkipWeakAttempt && await this.ports.shouldSkipWeakAttempt(await this.withPrior(a.features))) return state;
    const weak = weakestTierModel(a.ladder, state.broken);
    if (!weak || weak === state.model) return state;
    return { ...state, model: weak, pin: weak, locked: false };
  }
  /**
   * Fold a verifier verdict on a unit of work. Returns the run's new policy state (the
   * same object when nothing moved). Every conclusive verdict on a soft run becomes a D2
   * training row through the `recordOutcome` port.
   */
  async verdict(state, kind, verdict, ctx) {
    if (!this.on || !this.soft || verdict.inconclusive) return state;
    const current = ctx.attemptModel && ctx.attemptModel !== "default" ? ctx.attemptModel : state.model;
    if (current) {
      const features = await this.withPrior(ctx.features);
      await this.ports.recordOutcome?.({
        actionType: this.featuresActionType(ctx.features.actionType),
        weakModel: current,
        passed: verdict.passed,
        verifier: verdict.verifier,
        features
      });
    }
    const exclude = [...state.broken, ...state.authorModel && state.phase === "verify" ? [state.authorModel] : []];
    const r = cascadeVerdict(this.cascade, kind, verdict, { current, ladder: ctx.ladder, exclude });
    this.cascade = r.state;
    switch (r.action.kind) {
      case "escalate":
        this.setSteer(r.action.steer);
        return r.action.to ? { ...state, ...reduceRunPolicy(state, { type: "escalated", to: r.action.to }) } : state;
      case "exhausted":
        this.setSteer(r.action.steer);
        return state;
      case "deescalate":
        return { ...state, ...reduceRunPolicy(state, { type: "escalated", to: r.action.to }) };
      default:
        return state;
    }
  }
  /**
   * Move the run one tier up for a reason that is not a verifier's (the progress
   * detector's second trip). Null for a pinned run or when nothing is stronger — the
   * caller pauses instead. Gated by the CALLER's lever, not the cascade's.
   */
  escalate(state, ladder, attemptModel) {
    if (!this.soft) return null;
    const current = attemptModel && attemptModel !== "default" ? attemptModel : state.model;
    const to = nextTierModel(ladder, current, state.broken);
    if (!to) return null;
    this.cascade = { ...this.cascade, escalations: this.cascade.escalations + 1 };
    return { ...state, ...reduceRunPolicy(state, { type: "escalated", to }) };
  }
  /**
   * The reasoning levers for a turn: the caller's (persona / role default), raised one
   * level per open escalation of the current unit. Inert with nothing escalated or no
   * `escalateThinkLevel` port.
   */
  execParams(base) {
    const boost = this.on ? this.cascade.reasoningBoost : 0;
    if (boost <= 0 || !this.ports.escalateThinkLevel) return base;
    let level = base?.thinkLevel ?? this.ports.defaultThinkLevel ?? "medium";
    for (let i = 0; i < boost; i += 1) level = this.ports.escalateThinkLevel(level);
    return { ...base, thinkLevel: level };
  }
  setSteer(note) {
    this.steer = note;
    this.steerShown = false;
  }
  /** The note the current turn's request carries ("" when none). */
  steerNote() {
    if (this.steer) this.steerShown = true;
    return this.steer ?? "";
  }
  /** A turn ended: a steer that has been shown once is done. */
  endTurn() {
    if (this.steerShown) {
      this.steer = void 0;
      this.steerShown = false;
    }
  }
  snapshot() {
    return {
      ...this.on ? { cascade: this.cascade } : {},
      ...this.actionType ? { actionType: this.actionType } : {},
      soft: this.soft,
      ...this.steer ? { steer: this.steer } : {},
      ...typeof this.priorWeakPassRate === "number" ? { priorWeakPassRate: this.priorWeakPassRate } : {},
      ...this.priorRead ? { priorRead: true } : {}
    };
  }
};

// ../packages/agent-run/src/policy/guards/postEdit.ts
var EDIT_TOOLS = /* @__PURE__ */ new Set(["write_file", "edit_file"]);
var NOTE_ERRORS = 5;
function succeeded5(data) {
  return !(data && typeof data === "object" && data.ok === false);
}
function verifyAfterEdit(call, data, opts = {}) {
  if (opts.bound === false || !EDIT_TOOLS.has(call.name) || !succeeded5(data)) return null;
  const path = typeof call.args.path === "string" ? call.args.path.trim() : "";
  if (!path || !isVerifiablePath(path)) return null;
  const content = call.name === "write_file" && typeof call.args.content === "string" ? call.args.content : null;
  if (content !== null) {
    const result = foldVerifyOutcomes([{ path, ...checkFileContent(path, content) }]);
    return result.checked.length || result.errors.length ? result : null;
  }
  const read = opts.read;
  if (!read) return null;
  return (async () => {
    const committed = await read(path).catch(() => null);
    if (committed === null) return null;
    const result = foldVerifyOutcomes([{ path, ...checkFileContent(path, committed) }]);
    return result.checked.length || result.errors.length ? result : null;
  })();
}
function postEditNote(v) {
  const lines = v.errors.slice(0, NOTE_ERRORS).map((e) => `- ${e.path}${e.line ? `:${e.line}` : ""}${e.ruleId ? ` [${e.ruleId}]` : ""}: ${e.message}`);
  const more = v.errors.length > NOTE_ERRORS ? `
- \u2026and ${v.errors.length - NOTE_ERRORS} more` : "";
  return `Post-edit check FAILED (shell-free source/config policy) \u2014 fix this before building on it:
${lines.join("\n")}${more}`;
}
function withPostEditNote(data, v) {
  return v && !v.ok ? withAdvisory(data, postEditNote(v)) : data;
}

// ../packages/agent-run/src/policy/guards/ports.ts
function guardLeversOf(levers) {
  const on = new Set(levers);
  return {
    a3_progress_detector: on.has("a3_progress_detector"),
    d7_deterministic_handlers: on.has("d7_deterministic_handlers"),
    d1_verifier_cascade: on.has("d1_verifier_cascade"),
    d8_parallel_tool_calls: on.has("d8_parallel_tool_calls")
  };
}

// ../packages/agent-run/src/policy/guards/forced/briefs.ts
var PROGRESS_FORCED_LABEL = "loop.progress_forced";
var FINISH_RECORD_TURNS = 3;
function handOffBrief(reason, tool) {
  return `${reason} Call ${tool} NOW. summary = the research for the coders: everything you and any research sub-agents established that the change needs (files, functions, what they do today, decisions, traps). tasks = each one standalone: the files, the change, and how to know it is done. The coding agents start from exactly what you write here; they do not see this conversation.`;
}
function changeBrief(reason, askTool) {
  return `${reason} Make the change now with what you already know \u2014 the edit tools are the only ones offered this turn.` + (askTool ? ` If something genuinely blocks the change, call ${askTool} and say exactly what.` : "");
}
var handOffDueBrief = (tool) => handOffBrief(`ANALYSIS IS OVER. You have spent ${PLAN_TURN_BUDGET} turns analysing without changing anything.`, tool);
var changeDueBrief = (codeTurns, askTool) => changeBrief(`STOP READING. You have spent ${codeTurns} coding turns without changing anything.`, askTool);
var circlingReason = (n) => `YOU ARE CIRCLING. Your last ${n} calls were all answered from this run's read cache \u2014 you already have every one of those results, and re-reading them changes nothing.`;
var FINISH_RECORD_BRIEF = "You are FINISHING: make no more code changes and run nothing. Before your final report, file a ticket for EVERY item the person asked for that is still open (with the ticket tools offered on this turn), and update the status of the tickets you worked on. Then write the final report: what is done, and which ticket tracks each item that is not.";
var FINISH_FINAL_BRIEF = "Write your final report now: what is done, and which ticket tracks each requested item that is still open.";
var DEFERRED_ENDS_PLANNING = "The run kept reading through its progress checks without handing off \u2014 analysis ends here and the coding role makes the change.";
var DEFERRED_ENDS_PLANNING_STEERED = "The run kept reading through its progress checks without handing off \u2014 analysis ends here and the coding role takes the next turn.";

// ../packages/agent-run/src/policy/guards/forced/turns.ts
function report2(env, event) {
  env.ctx.state.model = reduceRunPolicy(env.ctx.state.model, event);
}
function specOf(env, name) {
  return env.ctx.tools.find((t) => t.function.name === name);
}
var budgeted = (env) => env.bind.facts.budgeted();
var askToolIf = (env, allowed) => allowed ? env.opts.askTool : null;
function endPlanning(env, step, why) {
  report2(env, { type: "plan_budget_spent" });
  env.note("loop.plan_budget_spent", { step, planTurns: env.ctx.state.model.planTurns }, why);
}
function changeToolsOf(env, selected, canAsk) {
  const change = new Set(env.ctx.policy.codeChangeTools ?? []);
  const tools = selected.filter((t) => change.has(t.function.name) || canAsk && t.function.name === env.opts.askTool);
  return tools.some((t) => change.has(t.function.name)) ? tools : null;
}
function planBudgetTurn(env, step) {
  const model = env.ctx.state.model;
  if (!handOffDue(model) || !budgeted(env)) return null;
  const handOff2 = specOf(env, env.opts.handOffTool);
  const canAsk = env.bind.facts.canAskUser();
  if (model.handOffForced || !canAsk || !handOff2) {
    endPlanning(env, step, canAsk ? "The forced hand-off turn did not hand off \u2014 analysis ends here and the coding role takes the next turn." : "Analysis budget spent where hand_off cannot be offered \u2014 analysis ends here and the coding role takes the next turn.");
    return null;
  }
  report2(env, { type: "hand_off_forced" });
  env.note("loop.hand_off_due", { step, planTurns: model.planTurns }, `${model.planTurns} analysis turn(s) with no change and no hand-off \u2014 this turn offers hand_off alone and requires the call.`);
  return { tools: [handOff2], toolChoice: "required", brief: handOffDueBrief(env.opts.handOffTool) };
}
function forcedProgressTurn(env, selected, reason, opts = {}) {
  const model = env.ctx.state.model;
  const handOff2 = specOf(env, env.opts.handOffTool);
  if (!opts.changeOnly && handOff2 && offersHandOff(model) && env.bind.facts.canAskUser() && !model.handOffForced) {
    report2(env, { type: "hand_off_forced" });
    return { forced: "hand_off", turn: { tools: [handOff2], toolChoice: "required", brief: handOffBrief(reason, env.opts.handOffTool) } };
  }
  if (env.bind.facts.codeChanged()) return null;
  const canAsk = env.bind.facts.canAskUser() && !opts.noAsk;
  const tools = changeToolsOf(env, selected.filter((t) => t.function.name !== env.opts.handOffTool), canAsk);
  if (!tools) return null;
  if (offersHandOff(model)) {
    if (opts.endsPlanning) endPlanning(env, opts.endsPlanning.step, opts.endsPlanning.why);
    else report2(env, { type: "plan_budget_spent" });
  }
  report2(env, { type: "change_forced" });
  return { forced: "change", turn: { tools, toolChoice: "required", brief: changeBrief(reason, askToolIf(env, canAsk)) } };
}
function changeBudgetTurn(env, step, selected) {
  const budget = env.ctx.policy.skipVerifyStage ? QUICK_CHANGE_TURN_BUDGET : PLAN_TURN_BUDGET;
  const model = env.ctx.state.model;
  if (!changeDue(model, env.bind.facts.progressed(), budget) || !budgeted(env)) return null;
  const canAsk = env.bind.facts.canAskUser();
  const tools = changeToolsOf(env, selected, canAsk);
  if (!tools) return null;
  report2(env, { type: "change_forced" });
  env.note("loop.change_due", { step, codeTurns: model.codeTurns }, `${model.codeTurns} coding turn(s) with no change and no hand-off \u2014 this turn offers the change tools alone and requires a call.`);
  return { tools, toolChoice: "required", brief: changeDueBrief(model.codeTurns, askToolIf(env, canAsk)) };
}
function noProgressTurn(env, step, selected, cache2) {
  if (!budgeted(env) || env.bind.facts.progressed() || env.ctx.state.model.phase === "verify" || !cache2.due()) return null;
  const n = cache2.count;
  const out = forcedProgressTurn(env, selected, circlingReason(n));
  if (!out) return null;
  cache2.consume();
  env.note("loop.no_progress", { step, streak: n, forced: out.forced }, `${n} consecutive call(s) answered from the read cache \u2014 this turn offers ${out.forced === "hand_off" ? "hand_off alone" : "the change tools alone"} and requires a call.`);
  return out.turn;
}

// ../packages/agent-run/src/policy/guards/forced/ladder.ts
var FORCED_MENU = {
  hand_off: "hand_off alone",
  change: "the change tools alone"
};
var ForcedLadder = class {
  constructor(state, steer, bind, opts) {
    this.state = state;
    this.steer = steer;
    this.bind = bind;
    this.opts = opts;
  }
  state;
  steer;
  bind;
  opts;
  /** The run is FINISHING: a finish turn was decided. Never cleared for the rest of the run, so no delivery gate sends its report back for more work. */
  get finishing() {
    return this.state.finishing === true;
  }
  /**
   * A trip an escalation or a finish waits on a later turn's menu for. The detector's second note says the run moved to a
   * stronger model, and a finish's note is its no-tools turn's brief: neither is shown twice, so the steer is cleared.
   */
  hold(action) {
    this.steer(void 0);
    this.state.due = action;
  }
  takeDue() {
    const due = this.state.due ?? null;
    delete this.state.due;
    return due;
  }
  /** 'record' (the obligation tools again), 'final' (no tools — the report), or null when the run is not finishing that way. */
  takeFinishingTurn() {
    if (this.state.recordLeft === void 0) return null;
    if (this.state.recordLeft > 0) {
      this.state.recordLeft -= 1;
      return "record";
    }
    delete this.state.recordLeft;
    return "final";
  }
  /** The obligation tools of the work-linking directive that the catalog holds — never a write or exec tool. */
  obligationTools(ctx) {
    const names = new Set(this.bind.facts.obligationTools());
    return names.size === 0 ? [] : ctx.tools.filter((t) => names.has(t.function.name));
  }
  /** THE one place a finish turn is made: the run is finishing from here on. */
  finishTurn(tools, brief) {
    this.state.finishing = true;
    return { tools, brief, finishing: true, ...tools.length === 0 ? { final: true } : {} };
  }
  finishingTurn(ctx) {
    const finishing = this.takeFinishingTurn();
    if (!finishing) return null;
    this.takeDue();
    const tools = finishing === "record" ? this.obligationTools(ctx) : [];
    return this.finishTurn(tools, tools.length > 0 ? FINISH_RECORD_BRIEF : FINISH_FINAL_BRIEF);
  }
  /**
   * The forced turn an escalation or finish decides, called after selection with this turn's tools. Null for an ordinary
   * turn — and when the trip cannot be forced here, in which case its note opens the turn instead.
   */
  guardTurn(env, step, selected) {
    const due = this.takeDue();
    if (!due) return null;
    if (due.kind === "finish") {
      const deferred = due.verified ? null : this.deferredFinishTurn(env, step, selected, due);
      if (deferred === "steered") return null;
      if (deferred) return deferred;
      const tools = this.obligationTools(env.ctx);
      this.trace(env.note, step, due, "finish", tools.length);
      if (tools.length === 0) return this.finishTurn([], due.note);
      this.state.recordLeft = Math.max(0, this.opts.recordTurns - 1);
      return this.finishTurn(tools, `${due.note}

${FINISH_RECORD_BRIEF}`);
    }
    const advice = `PROGRESS CHECK ${due.trip}: ${progressAdvice(due.signal)}`;
    const out = budgeted(env) ? forcedProgressTurn(env, selected, advice) : null;
    if (!out) {
      this.steer(advice);
      return null;
    }
    this.trace(env.note, step, due, out.forced);
    return out.turn;
  }
  /**
   * A change request that has not changed anything is not ended while the run can still DO the work: once per run, the
   * unverified finish becomes a forced change turn instead — the change tools alone, with NO question tool. A planner's analysis
   * ends there (the coding role takes the turn). When this turn's menu has no change tool to force while still planning,
   * planning ends and the run is steered instead ('steered'), so the NEXT turn selects as `code`. Null: the finish stands.
   */
  deferredFinishTurn(env, step, selected, due) {
    if (!budgeted(env) || this.bind.facts.progressed() || this.state.deferred) return null;
    const advice = `PROGRESS CHECK ${due.trip}: ${progressAdvice(due.signal)}`;
    const planning = offersHandOff(env.ctx.state.model);
    const out = forcedProgressTurn(env, selected, advice, { changeOnly: true, noAsk: true, endsPlanning: { step, why: DEFERRED_ENDS_PLANNING } });
    if (out) {
      this.state.deferred = true;
      this.trace(env.note, step, due, out.forced);
      return out.turn;
    }
    if (!planning) return null;
    endPlanning(env, step, DEFERRED_ENDS_PLANNING_STEERED);
    this.state.deferred = true;
    this.steer(advice);
    return "steered";
  }
  trace(note, step, due, forced, recordTools = 0) {
    const why = due.kind === "finish" && due.verified ? "the change is made and verified" : "the run is not converging";
    const head = `progress check ${due.trip} (${due.signal.kind})`;
    note(
      PROGRESS_FORCED_LABEL,
      { step, trip: due.trip, signal: due.signal.kind, forced, ...recordTools > 0 ? { recordTools } : {} },
      forced !== "finish" ? `${head} \u2014 this turn offers ${FORCED_MENU[forced]} and requires a call.` : recordTools > 0 ? `${head} \u2014 ${why}: this turn offers only the ${recordTools} ticket tool(s) to record what is still open, and the run writes its final report.` : `${head} \u2014 ${why}: this turn offers no tools and the run writes its final report.`
    );
  }
  /** Decide one turn: the policy's selection (the hand-off tool leaves it once planning closes) and the forced turn, when a rule forced one. */
  async decide(env, step, select, cache2) {
    const finishing = this.finishingTurn(env.ctx);
    const handOffTurn = finishing ? null : planBudgetTurn(env, step);
    const ranked2 = await select();
    const selected = offersHandOff(env.ctx.state.model) ? ranked2 : ranked2.filter((t) => t.function.name !== this.opts.handOffTool);
    const turn = finishing ?? handOffTurn ?? changeBudgetTurn(env, step, selected) ?? noProgressTurn(env, step, selected, cache2) ?? this.guardTurn(env, step, selected);
    return { selected, turn };
  }
};
async function ladderTurn(ladder, ctx, env, onEvent) {
  const rows = [];
  const note = (tool, detail, result) => {
    rows.push({ tool, detail, result });
  };
  const { selected, turn } = await ladder.decide({ ctx, bind: ladder.bind, opts: ladder.opts, note }, ctx.step, env.select, env.cache);
  for (const row of rows) await onEvent?.(row, { step: ctx.step });
  return { selected, ...turn ? { menu: menuOf(turn) } : {} };
}
function menuOf(turn) {
  return { tools: turn.tools, ...turn.toolChoice ? { toolChoice: turn.toolChoice } : {}, tail: [turn.brief], ...turn.final ? { final: true } : {} };
}

// ../packages/agent-run/src/policy/guards/index.ts
var QUESTION_TOOL_ROUNDS = 6;
var ANSWER_DUE_NOTE = "Answer the question now using the evidence collected. State what could not be established. Do not call more tools.";
var RunGuards = class {
  constructor(levers, resume, ports = {}, question = false) {
    this.question = question;
    this.levers = levers;
    this.answerTurns = resume?.answerTurns ?? 0;
    this.cascade = new CascadeSession(!!levers.d1_verifier_cascade, resume?.cascade, {
      shouldSkipWeakAttempt: ports.cascade?.shouldSkipWeakAttempt ? (f) => ports.cascade.shouldSkipWeakAttempt({ actionType: f.actionType, priorWeakPassRate: f.priorWeakPassRate }) : void 0,
      weakPassRate: ports.cascade?.weakPassRate,
      escalateThinkLevel: ports.cascade?.escalateThinkLevel,
      defaultThinkLevel: ports.cascade?.defaultThinkLevel,
      recordOutcome: ports.cascade?.recordOutcome ? (row) => ports.cascade.recordOutcome({ ...row, features: row.features }) : void 0
    });
    const bind = ports.progress;
    this.bind = bind;
    this.progress = levers.a3_progress_detector ? new ProgressDetector(resume?.progress, {
      isReadOnly: bind?.isReadOnly ?? ((tool) => isReadOnlyCloudTool(tool)),
      isBookkeeping: isProgressBookkeeping,
      ...bind?.isUnscopedMutation ? { isUnscopedMutation: bind.isUnscopedMutation } : {},
      ...bind?.isPlatformProgress ? { isPlatformProgress: bind.isPlatformProgress } : {},
      ...bind?.expectsChange ? { expectsChange: bind.expectsChange } : {}
    }) : null;
    this.forced = bind?.turns ? new ForcedLadder({ ...resume?.forced }, (note) => this.progress?.setSteer(note), bind, bind.turns) : null;
    this.postEdit = !!levers.d7_deterministic_handlers;
    this.finishDue = resume?.finishDue === true;
    this.resumedFinishing = resume?.forced?.finishing === true;
    this.checksNote = resume?.checksNote ?? "";
    this.escalations = resume?.escalations ?? 0;
  }
  question;
  answerTurns;
  cascade;
  progress;
  /** A surface's forced-turn ladder (`GuardPorts.progress.turns`); null ⇒ A3's trips keep their generic handling. */
  forced;
  bind;
  /** The saved state said the run was finishing (read before any ladder is bound: a resumed tick asks for its tail first). */
  resumedFinishing;
  postEdit;
  levers;
  /** A3's `finish`: the next turn offers no tools — the run's final report. */
  finishDue;
  /** This turn's post-edit verdicts — the D1 code unit's verifier. */
  turnEdits = [];
  /** D7: the sandbox checks' failures from the last turn, for the next turn's tail. */
  checksNote = "";
  /** Moves UP the tier ladder this run (D1's failed verdicts, A3's second trip) — §8.2. */
  escalations;
  /** The volatile-tail sections this turn carries (empty strings drop out). */
  tailSections() {
    return [
      this.finishDue && this.answerTurns >= QUESTION_TOOL_ROUNDS ? ANSWER_DUE_NOTE : "",
      this.finishing || this.resumedFinishing ? "" : this.progress?.steerNote() ?? "",
      this.cascade.steerNote(),
      this.checksNote
    ];
  }
  /** The forced-turn ladder's decision for this step, or nothing when none is bound. */
  forcedTurn(ctx, env, ports) {
    return this.forced ? ladderTurn(this.forced, ctx, env, ports.onEvent) : void 0;
  }
  /** A finish turn was decided: sticky for the rest of the run. */
  get finishing() {
    return this.forced?.finishing === true;
  }
  /** D1: the reasoning levers for a turn, raised while a unit is escalated. */
  reasoning(base) {
    return this.cascade.execParams(base);
  }
  /** D1 + D2: the first tick's starting model (weak-first unless the router says skip). */
  seedModel(state, a) {
    return this.cascade.seed(state, a);
  }
  /** What the guards persist across a step boundary (the contract's `LoopGuardState`). */
  snapshot() {
    return {
      ...this.answerTurns ? { answerTurns: this.answerTurns } : {},
      ...this.progress ? { progress: this.progress.snapshot() } : {},
      // The cascade's seed facts serve A3's escalation too; with both levers off nothing persists.
      ...this.cascade.on || this.progress ? { cascade: this.cascade.snapshot() } : {},
      ...this.finishDue ? { finishDue: true } : {},
      ...this.forced && Object.keys(this.forced.state).length > 0 ? { forced: { ...this.forced.state } } : {},
      ...this.checksNote ? { checksNote: this.checksNote } : {},
      ...this.escalations ? { escalations: this.escalations } : {}
    };
  }
  /** Whether a call only reads (D8): the kernel's `isReadOnly` port. */
  isReadOnly(name) {
    return this.levers.d8_parallel_tool_calls ? isReadOnlyCloudTool(name) : false;
  }
  /**
   * D7: check an edit the moment it lands; only a failure reaches the model, as one
   * note on that tool result. The verdict also feeds the D1 code unit's verifier.
   */
  async checkEdit(call, data, ports) {
    if (!this.postEdit && !this.cascade.on) return data;
    const verdict = await verifyAfterEdit(call, data, { read: ports.read, bound: ports.bound });
    if (!verdict) return data;
    this.turnEdits.push(verdict);
    return this.postEdit ? withPostEditNote(data, verdict) : data;
  }
  /**
   * D1: fold a finish attempt's gate verdict into the cascade; returns the block the
   * kernel reads. The finish hook calls this after its own gates.
   */
  async finish(verdict, step, ports) {
    if (!this.cascade.on) return verdict.block;
    const v = verdict.block ? { passed: false, verifier: `finish_gates:${verdict.reason ?? "blocked"}`, reason: verdict.block, inconclusive: verdict.reason === "branch_ci_pending" || verdict.reason === "children_running" || verdict.reason === LINKED_WORK_OPEN } : { passed: true, verifier: "finish_gates" };
    await this.judge("finish", v, step, ports);
    return verdict.block;
  }
  /** The turn ended: fold the turn's edits into the cascade and trip A3 if stuck. */
  async endTurn(step, ports) {
    this.checksNote = "";
    if (this.question && ++this.answerTurns >= QUESTION_TOOL_ROUNDS) {
      this.finishDue = true;
      await this.record(ports, { tool: "answer_due", detail: { turns: this.answerTurns }, result: ANSWER_DUE_NOTE }, step);
      return;
    }
    if (this.turnEdits.length > 0) {
      const errors = this.turnEdits.flatMap((v) => v.errors);
      this.turnEdits = [];
      const staticVerdict = errors.length ? { passed: false, verifier: "changed_files", reason: errors.slice(0, 5).map((e) => `${e.path}${e.line ? `:${e.line}` : ""} ${e.message}`).join("; ") } : { passed: true, verifier: "changed_files" };
      const checks = ports.checks ? await ports.checks().catch(() => null) : null;
      if (checks?.steer && this.postEdit) this.checksNote = checks.steer;
      const verdict = checks && !checks.passed && staticVerdict.passed ? { passed: false, verifier: checks.verifier, ...checks.reason ? { reason: checks.reason } : {} } : staticVerdict;
      await this.judge("code_edit", verdict, step, ports);
    }
    this.cascade.endTurn();
    for (const report3 of this.bind?.childReports?.() ?? []) this.progress?.observeChildReport(report3);
    const action = this.progress?.endTurn();
    if (action) await this.onTrip(action, ports, step);
  }
  /** Leave a row on the run's timeline. A surface that binds the forced-turn ladder is told the step as well. */
  async record(ports, row, step) {
    if (this.forced) await ports.onEvent?.(row, { step });
    else await ports.onEvent?.(row);
  }
  async judge(kind, verdict, step, ports) {
    const model = ports.model;
    if (!model) return;
    const before = model.get();
    const features = ports.features?.(step, void 0) ?? { actionType: "other" };
    const after = await this.cascade.verdict(before, kind, verdict, {
      ladder: ports.ladder?.() ?? ports.cascade?.ladder ?? { candidates: [], rankOf: () => 1 },
      attemptModel: ports.resolvedModel?.(),
      features: { actionType: this.cascade.featuresActionType(features.actionType ?? "other") }
    });
    if (after === before) return;
    model.set(after);
    if (!verdict.passed) this.escalations += 1;
    await this.record(ports, {
      tool: "model.escalated",
      detail: { step, unit: kind, verifier: verdict.verifier, passed: verdict.passed, from: before.model ?? ports.resolvedModel?.() ?? null, to: after.model ?? null },
      result: verdict.passed ? `${kind} passed \u2014 back to ${after.model}` : `${kind} failed ${verdict.verifier} \u2014 escalated to ${after.model}`
    }, step);
  }
  async onTrip(action, ports, step) {
    let outcome = action.kind;
    if (action.kind !== "advisory" && this.forced) {
      if (action.kind === "escalate" || action.kind === "finish") this.forced.hold(action);
      const s2 = progressTraceStep(action);
      await this.record(ports, { tool: s2.label, detail: s2.args, result: s2.result }, step);
      return;
    }
    if (action.kind === "advisory") {
      this.progress?.setSteer(action.note);
      const s2 = progressTraceStep(action);
      await this.record(ports, { tool: s2.label, detail: s2.args, result: s2.result }, step);
      return;
    }
    if (action.kind === "escalate") {
      const model = ports.model;
      const ladder = ports.ladder?.() ?? ports.cascade?.ladder;
      const next = model && ladder ? this.cascade.escalate(model.get(), ladder, ports.resolvedModel?.()) : null;
      if (next && model) {
        model.set(next);
        this.escalations += 1;
      } else {
        this.progress?.setSteer(progressSteerNote(action.signal, action.trip, false));
        outcome = "steer";
      }
    } else if (action.kind === "finish") {
      this.finishDue = true;
    }
    const s = progressTraceStep(action, {
      outcome,
      detail: { trip: action.trip, signal: action.signal, outcome, model: ports.model?.get().model ?? null }
    });
    await this.record(ports, { tool: s.label, detail: s.args, result: s.result }, step);
  }
  /** A3's `finish`: whether the next turn is the run's final report (no tools). A peek — {@link finalTurnDone} spends it. */
  get finalTurnDue() {
    return this.finishDue;
  }
  /** The final turn was answered: the finish is spent. */
  finalTurnDone() {
    this.finishDue = false;
  }
  /** A3: what the turn said, judged against what its calls did (WS8p). */
  noteTurnText(text) {
    this.progress?.noteTurnText(text);
  }
  /** A3: every dispatched call is observed by the progress detector (when on). */
  observe(call, result, isError) {
    if (result && typeof result === "object" && result.control) return;
    this.progress?.observe(call.name, call.args, { data: result, ...isError ? { isError: true } : {} });
  }
};
var sessions = /* @__PURE__ */ new WeakMap();
function sessionOf(ctx, ports) {
  let s = sessions.get(ctx.state);
  if (!s) {
    const question = !ctx.state.specValidation && hasExplicitQuestionIntent(classifyRequest(ctx.task.request ?? ctx.task.prompt));
    s = new RunGuards(guardLeversOf(ctx.policy.levers), ctx.state.guards, ports, question);
    sessions.set(ctx.state, s);
    ctx.state.guards = s.snapshot();
  }
  return s;
}
function guardsTurnNote(ctx) {
  const s = sessions.get(ctx.state) ?? new RunGuards(guardLeversOf(ctx.policy.levers), ctx.state.guards);
  return s.tailSections().filter((part) => part.trim().length > 0).join("\n\n");
}
function portsOf(ctx, ports) {
  const state = ctx.state;
  const ladder = ports.ladder?.() ?? ports.cascade?.ladder;
  return {
    ...ports,
    ...!ports.model && ladder ? { model: { get: () => state.model, set: (next) => {
      state.model = next;
    } } } : {},
    ...ports.features ? { features: (step) => ports.features(step, state) } : {}
  };
}
function createGuardsHook(surfacePorts = {}) {
  return {
    async observe(ctx, call, result, isError) {
      const ports = portsOf(ctx, surfacePorts);
      const g = sessionOf(ctx, ports);
      const noted = await g.checkEdit(call, result, ports);
      g.observe(call, result, isError);
      ctx.state.guards = g.snapshot();
      return noted !== result ? { data: noted } : void 0;
    },
    async endTurn(ctx, content) {
      const ports = portsOf(ctx, surfacePorts);
      const g = sessionOf(ctx, ports);
      g.noteTurnText(ctx.ports.delivery?.judged?.(content) ?? content);
      await g.endTurn(ctx.step, ports);
      ctx.state.guards = g.snapshot();
    },
    async forcedTurn(ctx, env) {
      const ports = portsOf(ctx, surfacePorts);
      const g = sessionOf(ctx, ports);
      const decided = await g.forcedTurn(ctx, env, ports);
      ctx.state.guards = g.snapshot();
      return decided;
    },
    isFinishing(ctx) {
      return sessionOf(ctx, portsOf(ctx, surfacePorts)).finishing;
    },
    isReadOnly(ctx, name) {
      const ports = portsOf(ctx, surfacePorts);
      return sessionOf(ctx, ports).isReadOnly(name);
    },
    finalTurn(ctx) {
      const ports = portsOf(ctx, surfacePorts);
      return sessionOf(ctx, ports).finalTurnDue;
    },
    finalTurnDone(ctx) {
      const ports = portsOf(ctx, surfacePorts);
      const g = sessionOf(ctx, ports);
      g.finalTurnDone();
      ctx.state.guards = g.snapshot();
    },
    async seed(ctx) {
      const ports = portsOf(ctx, surfacePorts);
      const ladder = ports.ladder?.() ?? ports.cascade?.ladder;
      if (!ladder) return void 0;
      const seeded = await sessionOf(ctx, ports).seedModel(ctx.state.model, {
        strict: ctx.policy.modelStart?.strict === true,
        ladder,
        features: ports.features?.(0) ?? { actionType: "other", role: ctx.policy.role, promptTokens: 0, toolCount: ctx.tools.length, turnIndex: 0 }
      });
      ctx.state.guards = sessionOf(ctx, ports).snapshot();
      return seeded;
    },
    reasoning(ctx) {
      const ports = portsOf(ctx, surfacePorts);
      return sessionOf(ctx, ports).reasoning(void 0);
    },
    async finish(ctx, verdict) {
      const ports = portsOf(ctx, surfacePorts);
      const g = sessionOf(ctx, ports);
      const block = await g.finish(verdict, ctx.step, ports);
      ctx.state.guards = g.snapshot();
      return block;
    }
  };
}
var guardsHook = createGuardsHook();

// ../packages/agent-run/src/policy/verify/sandboxVerify.ts
var MAX_VERIFY_COMMANDS = 3;
var VERIFY_BUDGET_MS = 9 * 6e4;
var MIN_COMMAND_MS = 3e4;
var DID_NOT_FINISH = 124;
async function readPackageScripts(sandbox) {
  const content = await sandbox.read("package.json").catch((error) => {
    sandbox.onError?.("read", error);
    return null;
  });
  if (content === null) return null;
  try {
    const scripts = JSON.parse(content).scripts;
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return null;
    return Object.fromEntries(Object.entries(scripts).filter((e) => typeof e[1] === "string"));
  } catch {
    return null;
  }
}
async function detectRunner2(sandbox) {
  const atRoot = async (name) => {
    const listed = await sandbox.list(name).catch((error) => {
      sandbox.onError?.("list", error);
      return [];
    });
    return (listed ?? []).includes(name);
  };
  if (await atRoot("pnpm-lock.yaml")) return "pnpm";
  if (await atRoot("yarn.lock")) return "yarn";
  return "npm";
}
async function runSandboxVerify(sandbox, shell, now = Date.now) {
  const [packageScripts, runner] = await Promise.all([readPackageScripts(sandbox), detectRunner2(sandbox)]);
  const plan = planInRunVerify({ surface: "sandbox", packageScripts, runner });
  const results = [];
  const deadline = now() + VERIFY_BUDGET_MS;
  for (const command of plan.commands.slice(0, MAX_VERIFY_COMMANDS)) {
    const left = deadline - now();
    if (left < MIN_COMMAND_MS) {
      results.push({ command, exitCode: DID_NOT_FINISH });
      continue;
    }
    const r = await shell.runFor(command, left);
    results.push({ command, exitCode: typeof r.exitCode === "number" ? r.exitCode : 1 });
  }
  return { packageScripts, runner, results };
}

// ../packages/agent-run/src/policy/verify/recordVerifyEvents.ts
function recordVerifyEvents(outcome) {
  return {
    started: { type: "verify_started" },
    completed: {
      tool: "in_run_verify",
      category: "tool",
      detail: {
        surface: outcome.surface,
        kind: outcome.kind,
        ...outcome.reason ? { reason: outcome.reason } : {},
        commands: outcome.commands,
        failedCommands: outcome.failedCommands,
        mayFinish: outcome.mayFinish
      },
      result: describeVerifyOutcome(outcome)
    }
  };
}

// ../packages/agent-run/src/policy/tools/gateToolNames.ts
var TOOL_NAME_SYNONYMS = {
  write: ["write_file", "Write"],
  write_file: ["write", "Write"],
  Write: ["write", "write_file"],
  delete_file: ["write_file", "write", "Write"],
  // A patch is a write and an edit at once: a gate authored on either covers it.
  apply_patch: ["write_file", "write", "Write", "edit_file", "edit", "Edit"],
  // A write gate covers an edit (an edit rewrites a file); an edit gate does not cover a plain write.
  edit: ["edit_file", "Edit", "write", "write_file", "Write"],
  edit_file: ["edit", "Edit", "write", "write_file", "Write"],
  Edit: ["edit", "edit_file", "write", "write_file", "Write"],
  exec: ["run_command", "Bash", "bash"],
  Bash: ["run_command", "exec", "bash"],
  bash: ["run_command", "exec", "Bash"],
  run_command: ["exec", "Bash", "bash"],
  read: ["read_file", "Read"],
  Read: ["read", "read_file"],
  read_file: ["read", "Read"],
  Task: ["spawn_agent", "spawn_agents", "sessions_spawn"],
  spawn_agent: ["Task", "spawn_agents", "sessions_spawn"],
  spawn_agents: ["Task", "spawn_agent", "sessions_spawn"],
  sessions_spawn: ["Task", "spawn_agent", "spawn_agents"],
  Glob: ["list_files", "find", "ls"],
  list_files: ["Glob", "find", "ls"],
  find: ["list_files", "Glob"],
  ls: ["list_files", "Glob"],
  Grep: ["search_code", "grep"],
  search_code: ["Grep", "grep"],
  grep: ["search_code", "Grep"]
};
var ACTION_RULES = [
  // `process` drives a running exec session: writing to it, submitting to it or killing it acts on a command (listing, polling and reading its log do not).
  ...["write", "send-keys", "submit", "paste", "kill", "remove"].map((action) => ({ tool: "process", when: { action }, as: "exec" })),
  { tool: "nodes", when: { action: "run" }, as: "exec" },
  { tool: "nodes", when: { action: "invoke", invokeCommand: { startsWith: "system." } }, as: "exec" }
];
function ruleMatches(rule, args) {
  return Object.entries(rule.when).every(([key, want]) => {
    const have = typeof args?.[key] === "string" ? args[key].trim().toLowerCase() : "";
    return typeof want === "string" ? have === want : have.startsWith(want.startsWith);
  });
}
var SYNONYMS_BY_NAME = new Map(
  Object.entries(TOOL_NAME_SYNONYMS).map(([name, same]) => [normalizeToolName(name), same])
);
function candidateToolNames(toolName, args) {
  const called = normalizeToolName(toolName);
  const families = ACTION_RULES.filter((r) => r.tool === called && ruleMatches(r, args)).map((r) => r.as);
  const names = [toolName.trim(), resolveToolAlias(toolName), ...families].flatMap((n) => [n, ...SYNONYMS_BY_NAME.get(normalizeToolName(n)) ?? []]);
  return [...new Set(names.filter(Boolean))];
}

// ../packages/agent-run/src/policy/verify/nativeChecks.ts
var SCRIPTS = new Set(IN_RUN_VERIFY_SCRIPT_NAMES);
function scriptOf(value) {
  if (typeof value !== "string") return void 0;
  const match = /^(npm|pnpm|yarn)[ \t]+(?:(run)[ \t]+)?([a-z-]+)$/.exec(value.trim());
  if (!match) return void 0;
  const script = match[3];
  if (!script || !SCRIPTS.has(script) || match[1] === "npm" && !match[2] && script !== "test") return void 0;
  return script === "test" ? "test" : "typecheck";
}
function exitCodeOf(value) {
  if (typeof value !== "object" || !value) return void 0;
  const exitCode = value.exitCode;
  return typeof exitCode === "number" && Number.isInteger(exitCode) ? exitCode : void 0;
}
var nativeChecks = {
  observe({ state }, call, result, meta, succeeded8) {
    const family = candidateToolNames(call.name, call.args);
    if (!family.includes("run_command")) {
      if (succeeded8 && family.some((name) => name === "write_file" || name === "spawn_agent")) delete state.nativeChecks;
      return;
    }
    const check = scriptOf(call.args.command);
    const directory = call.args.cwd ?? call.args.workdir;
    const code = exitCodeOf(meta?.details) ?? exitCodeOf(result);
    if (check && code !== void 0 && (succeeded8 || code !== 0) && directory === void 0 && call.args.background !== true) {
      (state.nativeChecks ??= {})[check] = code;
    } else if ((succeeded8 || code !== void 0) && !isReadOnlyShellCall("run_command", call.args)) {
      delete state.nativeChecks;
    }
  },
  recorded({ state }) {
    const results = Object.values(state.nativeChecks ?? {});
    return results.length ? results.every((code) => code === 0) : void 0;
  }
};

// ../packages/agent-run/src/policy/verify/index.ts
async function verifyRunWork(input, ports = {}) {
  const { surface = "durable", shell, sandbox } = ports;
  const { writtenPaths, ciVerified } = input;
  if (input.declaredChecks && shell && sandbox && surface !== "durable" && writtenPaths && [...writtenPaths].length) {
    try {
      const { packageScripts, runner, results } = await runSandboxVerify(sandbox, shell);
      return runVerifyPhase({ surface, writtenPaths, packageScripts, runner, results });
    } catch (error) {
      if (!ports.onShellError) throw error;
      ports.onShellError(error);
    }
  }
  return runVerifyPhase({ surface: "durable", writtenPaths, ciVerified });
}
async function record2(ports, outcome) {
  if (!ports.recordEvents) return;
  const events = recordVerifyEvents(outcome);
  await ports.recordEvents(events.started);
  await ports.recordEvents(events.completed);
}
function writtenPathsOf2(ctx) {
  return ctx.state.writtenPaths ?? [];
}
function createVerifyHook(ports = {}) {
  return {
    ...ports.observeNativeChecks ? nativeChecks : {},
    ...ports.recorded ? { recorded: ports.recorded } : {},
    async verify(ctx) {
      if (ctx.policy.verify === "none") return void 0;
      const writtenPaths = writtenPathsOf2(ctx);
      if (writtenPaths.length === 0) return void 0;
      const outcome = await verifyRunWork({ writtenPaths, declaredChecks: ctx.policy.verify === "declared-checks" }, ports);
      await record2(ports, outcome);
      return { ok: outcome.mayFinish, note: outcome.note, ran: outcome.kind === "ran" };
    }
  };
}
var verifyHook = createVerifyHook();

// ../packages/agent-run/src/policy/tools/taskState.ts
var UPDATE_TASK_STATE_TOOL = "update_task_state";
var TASK_STATE_MAX_TOKENS = 600;
var LIST_FIELDS = ["constraints", "decisions", "filesTouched", "openQuestions"];
var TEXT_FIELDS = ["goal", "nextStep"];
var list = (description) => ({ type: "array", items: { type: "string" }, description });
var UPDATE_TASK_STATE_SCHEMA = {
  type: "function",
  function: {
    name: UPDATE_TASK_STATE_TOOL,
    description: "Record your structured task state: the goal, constraints, decisions made, files touched, open questions and the next step. It is shown to you on every turn and survives context compaction, so keep it current after each meaningful step instead of re-deriving it. Fields you omit keep their previous value. Keep it under ~600 tokens.",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The task goal in one or two sentences." },
        constraints: list("Rules and limits the work must respect."),
        decisions: list("Decisions already made, so they are not revisited."),
        filesTouched: list("Repo paths you changed."),
        openQuestions: list("What is still unknown."),
        nextStep: { type: "string", description: "The very next action." }
      }
    }
  }
};
var LABELS = {
  goal: "Goal",
  constraints: "Constraints",
  decisions: "Decisions",
  filesTouched: "Files touched",
  openQuestions: "Open questions",
  nextStep: "Next step"
};
function renderTaskState(state) {
  if (!state) return "";
  const lines = [];
  for (const key of ["goal", ...LIST_FIELDS, "nextStep"]) {
    const value = state[key];
    if (typeof value === "string" && value.trim()) lines.push(`${LABELS[key]}: ${value.trim()}`);
    else if (Array.isArray(value) && value.length) lines.push(`${LABELS[key]}:
${value.map((v) => `- ${v}`).join("\n")}`);
  }
  return lines.length ? `### Task state
${lines.join("\n")}` : "";
}
function applyTaskStateUpdate(current, args) {
  const next = { ...current ?? {} };
  for (const key of TEXT_FIELDS) {
    if (typeof args[key] === "string") next[key] = args[key].trim();
  }
  for (const key of LIST_FIELDS) {
    const value = args[key];
    if (Array.isArray(value)) next[key] = value.filter((v) => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
  }
  const tokens = defaultEstimateTokens(renderTaskState(next));
  if (tokens > TASK_STATE_MAX_TOKENS) {
    return { ok: false, error: `task state would be ~${tokens} tokens (limit ${TASK_STATE_MAX_TOKENS}) \u2014 summarise it more tightly and retry` };
  }
  return { ok: true, state: next };
}

// ../packages/agent-run/src/policy/memory/knowledge.ts
function knowledgeRecorderFor(memory) {
  return RunKnowledgeRecorder.restore(memory ?? null);
}
function knowledgeState(recorder) {
  const log = recorder;
  return typeof log.snapshot === "function" ? log.snapshot() : recorder;
}
var recorders = /* @__PURE__ */ new WeakMap();
function recorderForState(state) {
  const key = state;
  let recorder = recorders.get(key);
  if (!recorder) {
    recorder = knowledgeRecorderFor(state.memory);
    recorders.set(key, recorder);
  }
  return recorder;
}

// ../packages/agent-run/src/policy/memory/learnedFacts.ts
var MIN_FACT_CHARS = 24;
var MAX_FACTS = 6;
var KEY_PREFIX = "learned:";
var KINDS = /* @__PURE__ */ new Set(["decision", "root_cause", "convention"]);
var MEMORY_COMMIT_SYSTEM = [
  "You extract durable project facts from a finished coding or investigation run.",
  "Return a JSON array and nothing else. Each item is {key, kind, content}.",
  "kind is one of decision, root_cause, convention.",
  "key is a short kebab-case slug that stays stable if the same fact is learned again.",
  "content is one or two sentences a later run can act on, at least a full sentence.",
  "For an investigation, facts are where a behaviour lives, a root cause, or how something works, taken from the Conclusion.",
  "Only emit a fact the evidence (the excerpt, or the Conclusion of a read-only run) actually supports. Do not invent, and do not restate the file list.",
  "Return [] when the run learned nothing durable."
].join(" ");
var MIN_READS_FOR_LEARNING = 3;
var ANSWER_CHARS = 3e3;
function readPaths(input) {
  return [...new Set((input.read ?? []).map((p) => p.trim()).filter(Boolean))];
}
function isInvestigation(input) {
  return readPaths(input).length >= MIN_READS_FOR_LEARNING && (input.answer ?? "").trim().length > 0 && !(input.tools ?? []).some((t) => REMEMBER_FACT_TOOLS.has(t));
}
function changedPaths(input) {
  return [...new Set(input.changed.map((p) => p.trim()).filter(Boolean))];
}
function memoryCommitPrompt(input) {
  const changed = changedPaths(input);
  const asked = (input.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  const tools = [...new Set((input.tools ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, 24);
  const excerpt2 = (input.excerpt ?? "").trim().slice(0, 6e3);
  const read = readPaths(input).slice(0, 40);
  const conclusion = (input.answer ?? "").trim().slice(-ANSWER_CHARS);
  const evidence = excerpt2 ? `Evidence:
${excerpt2}` : conclusion ? "Evidence: the Conclusion above." : "";
  return [
    asked ? `Asked: ${asked}` : "",
    changed.length > 0 ? `Changed files:
${changed.map((p) => `- ${p}`).join("\n")}` : "",
    read.length > 0 ? `Files read:
${read.map((p) => `- ${p}`).join("\n")}` : "",
    tools.length ? `Tools: ${tools.join(", ")}` : "",
    conclusion ? `Conclusion:
${conclusion}` : "",
    evidence || "Evidence: (none recorded \u2014 return [] rather than guess)"
  ].filter(Boolean).join("\n\n");
}
function kebab(raw) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}
function factKey2(raw) {
  const body = kebab(raw.replace(/^learned:/i, "").replace(/^workspace:/i, ""));
  return body ? `${KEY_PREFIX}${body}` : "";
}
function parseLearnedFacts(raw) {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of parsed) {
    if (out.length >= MAX_FACTS) break;
    if (!item || typeof item !== "object") continue;
    const row = item;
    if (typeof row.kind !== "string" || !KINDS.has(row.kind)) continue;
    if (typeof row.key !== "string" || typeof row.content !== "string") continue;
    if (/^workspace:/i.test(row.key.trim())) continue;
    const key = factKey2(row.key);
    const content = row.content.replace(/\s+/g, " ").trim();
    if (!key || content.length < MIN_FACT_CHARS || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, content, kind: row.kind });
  }
  return out;
}
async function commitLearnedFacts(input, deps) {
  const changed = changedPaths(input);
  if (changed.length === 0 && !isInvestigation(input)) return [];
  let raw = "";
  try {
    raw = await deps.complete(memoryCommitPrompt({ ...input, changed }));
  } catch {
    return [];
  }
  const facts = parseLearnedFacts(raw);
  const landed = [];
  for (const fact of facts) {
    try {
      if (await deps.remember(fact.key, fact.content)) landed.push(fact);
    } catch {
    }
  }
  return landed;
}
function learnedFactsRequest(evidence) {
  const changed = [...evidence.activity.created ?? [], ...evidence.activity.edited ?? []];
  return {
    changed,
    ...evidence.activity.read?.length ? { read: evidence.activity.read } : {},
    ...evidence.answer ? { answer: evidence.answer } : {},
    ...evidence.activity.tools ? { tools: evidence.activity.tools } : {},
    ...evidence.excerpt ? { excerpt: evidence.excerpt } : {},
    ...evidence.activity.prompt ? { prompt: evidence.activity.prompt } : {}
  };
}
var learnedFactDeps = null;
async function extractAndWriteLearnedFacts(evidence) {
  const deps = learnedFactDeps;
  if (!deps) return null;
  return commitLearnedFacts(learnedFactsRequest(evidence), deps);
}

// ../packages/agent-run/src/policy/memory/index.ts
var SECTION_BREAK = "\n\n";
function finalAnswerOf(ctx) {
  const rows = ctx.state.messages ?? [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row?.role === "user") return void 0;
    if (row?.role !== "assistant") continue;
    return !row.toolCalls?.length && typeof row.content === "string" && row.content.trim() ? row.content : void 0;
  }
  return void 0;
}
function codeMapOf(ctx) {
  const recorder = recorderForState(ctx.state);
  ctx.state.memory = knowledgeState(recorder);
  const map = recorder.consolidate({ root: ctx.task.workspace?.defaultRepo });
  return map ? { ...map, ...ctx.task.chatId !== void 0 ? { chatId: ctx.task.chatId } : {} } : void 0;
}
var memoryHook = {
  /** Record one dispatched call into the run's memory — successful calls only. */
  observe(ctx, call, result, isError) {
    if (isError || isFailedToolResult(result)) return;
    const recorder = recorderForState(ctx.state);
    recorder.record(call.name, call.args);
    ctx.state.memory = knowledgeState(recorder);
  },
  /**
   * The volatile tail for this turn, or null when there is nothing worth saying: the
   * run's own record (the recorder is restored from `state.memory` once per state object,
   * so a resumed run's brief continues the SAME record a continuous run holds), then the
   * guards' A3 / D1 / D7 notes — the sections `costLoop/volatileTail.ts` assembled, in
   * front of THIS turn only. (The delegation nudge rides the read result that earns it.)
   */
  brief(ctx) {
    const recorder = recorderForState(ctx.state);
    if (!recorder.activity.prompt && ctx.task.prompt) recorder.setPrompt(ctx.task.prompt);
    ctx.state.memory = knowledgeState(recorder);
    const taskState = ctx.policy.levers.includes("c3_task_state") ? renderTaskState(ctx.state.taskState) : "";
    const sections = [recorder.brief() ?? "", taskState, guardsTurnNote(ctx)].filter((part) => part.trim().length > 0);
    return sections.length > 0 ? sections.join(SECTION_BREAK) : null;
  },
  /**
   * The consolidated memory the run produced, written back through `store.commitMemory`.
   * The code map (the `codemap:` write-back fields) is returned for the store; the
   * learned-facts step runs behind the injected `learnedFacts` port when the run
   * changed files, or investigated read-only and left a final answer. A read-only investigation still maps (PRD 35 E8): `consolidate`
   * maps ≥3 files READ as readily as ≥3 changed, so the next run asked about this area
   * starts warm. The map is written on EVERY terminal outcome (a failed or cancelled run
   * still read and changed what it did); the model-extracted learned facts are a judgement
   * of a completed run, so a caller that is settling a failure passes `learn: false`.
   */
  async consolidate(ctx, opts) {
    const map = codeMapOf(ctx);
    const answer = finalAnswerOf(ctx);
    const facts = opts?.learn === false ? null : await extractAndWriteLearnedFacts({
      activity: recorderForState(ctx.state).activity,
      ...answer ? { answer } : {}
    });
    if (map) return map;
    const chat = ctx.task.chatId !== void 0 ? { chatId: ctx.task.chatId } : {};
    return facts !== null && facts.length > 0 ? { facts, ...chat } : void 0;
  }
};

// ../packages/agent-run/src/policy/context/recall.ts
var MAX_RECALL_HINT_CHARS = 600;
function recallQuery(userText, hint) {
  const extra = (hint ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_RECALL_HINT_CHARS);
  if (!extra || !userText.trim()) return userText;
  return `${userText.trim()}

${extra}`;
}
function focusTerms(entry) {
  const path = entry.path;
  const heads = (entry.outline ?? []).map((h) => h.heading).filter(Boolean);
  return [path, ...heads].join(" ");
}
function focusHint(pack) {
  return pack.focus.map(focusTerms).filter(Boolean).join("\n");
}

// ../packages/agent-run/src/policy/context/index.ts
var RECALL_LIMIT2 = 8;
var contextHook = {
  /**
   * The recall lines the run should carry: the entries the surface's memory
   * (`CapabilityProvider.memory.recall`) returns for the prompt plus the focus terms, as
   * `key: content` lines. Nothing when the surface has no memory, the recall fails, or
   * there is no request to ground it on (a hint alone is not a question) — recall is
   * best-effort and never fails a run.
   */
  async recall(ctx) {
    const memory = ctx.ports.capabilities?.memory;
    if (!memory || !ctx.task.prompt.trim()) return void 0;
    let hint = "";
    try {
      hint = focusHint(await ctx.ports.context.pack(ctx.task));
    } catch {
      hint = "";
    }
    const query = recallQuery(ctx.task.prompt, hint);
    try {
      const recalled = await memory.recall(query, RECALL_LIMIT2);
      const lines = (recalled.ok ? recalled.entries ?? [] : []).map((entry) => `${entry.key}: ${entry.content}`);
      return lines.length > 0 ? lines : void 0;
    } catch {
      return void 0;
    }
  }
};

// ../packages/agent-run/src/policy/tools/searchHelpers.ts
var TOOL_SEARCH_MAX = 15;
var TOOL_SEARCH_DEFAULT_LIMIT = 8;
function promptNamedTools(text) {
  const out = /* @__PURE__ */ new Set();
  for (const match of text.toLowerCase().matchAll(/\b[a-z][a-z0-9_]{2,}\b/g)) {
    out.add(match[0]);
  }
  return [...out];
}
function runToolSearch(catalog, advertised, args) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { data: { ok: false, error: "query is required" }, load: [] };
  const limit = Math.max(1, Math.min(TOOL_SEARCH_MAX, typeof args.limit === "number" ? Math.trunc(args.limit) : TOOL_SEARCH_DEFAULT_LIMIT));
  const matches = searchToolSchemas(catalog.filter((t) => !advertised.has(t.function.name)), query, limit);
  return {
    data: {
      ok: true,
      query,
      matches: matches.map((t) => t.function),
      note: matches.length ? "These tools are now loaded and callable for the rest of the run." : "No unloaded tool matched \u2014 try other keywords, or use the tools you already have."
    },
    load: matches.map((t) => t.function.name)
  };
}

// ../packages/agent-run/src/policy/tools/catalog.ts
var ALWAYS_CORE_TOOLS = [
  "read_file",
  "search_code",
  "list_files",
  "edit_file",
  "run_checks",
  "run_command",
  "finish",
  "ask_human",
  "spawn_agent"
];
var ROLE_CORE_TOOLS = {
  explore: ["repo_map", "memory_recall", "workspace_read", "web_search", "web_fetch"],
  code: ["repo_map", "write_file", "delete_file", "update_prd", "memory_recall", "memory_remember", "claim_resource", "release_resource", "workspace_note"],
  verify: ["memory_recall", "workspace_read"],
  plan: ["spawn_agents", "wait_agents", "message_agent", "update_prd", "memory_recall", "memory_remember", "workspace_note", "workspace_read"]
};
function deferredToolRole(role) {
  if (role === "review") return "verify";
  return role === "explore" || role === "verify" || role === "plan" ? role : "code";
}
function coreToolNames(role) {
  return [.../* @__PURE__ */ new Set([...ALWAYS_CORE_TOOLS, ...ROLE_CORE_TOOLS[deferredToolRole(role)]])].slice(0, 20);
}
function hasSymbolsCapability(caps) {
  return caps.has("repo.symbols");
}
function selectCatalog(catalog, role, caps, opts = {}) {
  const byName = /* @__PURE__ */ new Map();
  for (const tool of catalog) {
    const name = tool.function?.name;
    if (name && !byName.has(name)) byName.set(name, tool);
  }
  const core = new Set(coreToolNames(role));
  if (hasSymbolsCapability(caps)) core.add("find_symbol");
  core.add(TOOL_SEARCH_TOOL);
  for (const name of opts.pinned ?? []) core.add(name);
  for (const name of opts.required ?? []) core.add(name);
  for (const name of promptNamedTools(opts.prompt ?? "")) {
    if (byName.has(name)) core.add(name);
  }
  const out = [];
  for (const tool of catalog) {
    const name = tool.function?.name;
    if (name && core.has(name)) {
      out.push(tool);
      core.delete(name);
    }
  }
  if (core.has(TOOL_SEARCH_TOOL)) {
    out.push(TOOL_SEARCH_SCHEMA);
    core.delete(TOOL_SEARCH_TOOL);
  }
  return out;
}

// ../packages/agent-run/src/policy/tools/roleCap.ts
var ROLE_TOOL_LIMIT = { code: 22, verify: 18 };
var ROLE_COMPANION_TOOLS = {
  code: [
    "find_symbol",
    "file_outline",
    "command_status",
    "command_stop",
    "git_status",
    "git_diff",
    "recall_facts",
    "ask_user"
  ],
  verify: [
    "find_symbol",
    "file_outline",
    "command_status",
    "command_stop",
    "git_status",
    "git_diff",
    "git_history",
    "recall_facts",
    "ask_user"
  ]
};
var ROLE_GUARANTEED_TOOLS = [
  "git_commit",
  "git_push",
  "output_filter",
  "wait_agents",
  "hand_off"
];
var ROLE_MATCH_ROOM = { code: 6, verify: 4 };
function isCappedToolRole(role) {
  return role === "code" || role === "verify";
}
function roleToolLimit(role) {
  return isCappedToolRole(role) ? ROLE_TOOL_LIMIT[role] : DEFAULT_TOOL_LIMIT;
}
function roleToolNames(role) {
  return [.../* @__PURE__ */ new Set([...coreToolNames(role), ...ROLE_COMPANION_TOOLS[role], ...ROLE_GUARANTEED_TOOLS])];
}
function roleCappedSelection(role, catalogNames, keep = [], surfaceRequired = []) {
  const present = new Set(catalogNames);
  const required = [.../* @__PURE__ */ new Set([...surfaceRequired, ...roleToolNames(role), ...keep])].filter((n) => present.has(n));
  return { limit: Math.max(ROLE_TOOL_LIMIT[role], required.length + ROLE_MATCH_ROOM[role]), required, backfill: false };
}

// ../packages/agent-run/src/policy/tools/workCore.ts
function workCoreToolNames(role) {
  return [
    .../* @__PURE__ */ new Set([
      ...coreToolNames(role),
      // The companions follow the core row: `verify` and `review` read; every other role codes.
      ...ROLE_COMPANION_TOOLS[deferredToolRole(role) === "verify" ? "verify" : "code"]
    ])
  ];
}
function ensureWorkCoreSet(selected, catalog, opts) {
  if (opts.work === false) return [...selected];
  const core = workCoreToolNames(opts.role ?? "code");
  const byName = /* @__PURE__ */ new Map();
  for (const tool of catalog) {
    const name = tool.function?.name;
    if (name && !byName.has(name)) byName.set(name, tool);
  }
  const have = new Set(selected.map((t) => t.function?.name ?? ""));
  const capacity = opts.capacity ?? Number.POSITIVE_INFINITY;
  const out = [...selected];
  for (const name of core) {
    const tool = byName.get(name);
    if (!tool || have.has(name)) continue;
    if (out.length >= capacity) {
      opts.onDropped?.(name, `work-mode window could not fit the core tool set (${out.length} of ${out.length + 1} advertised)`);
      continue;
    }
    out.push(tool);
    have.add(name);
  }
  return out;
}

// ../packages/agent-run/src/policy/tools/platform.ts
function selectPlatformCatalog(ctx, pinned) {
  const platform = ctx.ports.platform;
  if (!platform?.closed) return void 0;
  const catalog = platform.schemas({ rungs: ctx.state.stall?.rungs ?? {} }).filter((schema) => !blocksChildSpawn(ctx.task.dispatch, schema.function.name));
  const selection = platform.selection;
  const { query } = selection;
  const capped = isCappedToolRole(selection.role) ? roleCappedSelection(selection.role, catalog.map((t) => t.function?.name ?? ""), selection.roleKeep ?? [], selection.required) : void 0;
  const limit = capped?.limit ?? selection.limit;
  const required = capped?.required ?? [...selection.required];
  const selected = selectToolsForTurn(catalog, { query, limit, pinned: selection.pinned ? [...selection.pinned] : pinned, required, ...selection.rank ? { rank: selection.rank } : {}, ...selection.capRequired ? { capRequired: true } : {}, ...capped ? { backfill: false } : {} }).tools;
  return ensureWorkCoreSet(selected, catalog, {
    role: selection.role,
    work: isCappedToolRole(selection.role),
    onDropped: (name, reason) => ctx.ports.events.emit({ kind: "context.tools", step: ctx.state.step ?? 0, advertised: selected.length, catalog: catalog.length, toolsTokens: 0, loaded: [`${name}: ${reason}`] })
  });
}

// ../packages/agent-run/src/policy/tools/toolset.ts
var CHAT_REPLY_SCOPED_TOOLS = [
  "chats.get_messages",
  "chats.list_tickets",
  "chats.link_ticket",
  "chats.unlink_ticket",
  "chats.ticket_lineage",
  "chats.list_agents",
  // Why the LAST run on this chat did not finish — read-only, consulted BEFORE the
  // failed attempt is repeated.
  "chats.diagnostics",
  // What has already RUN on this chat's tickets and who started it.
  "chats.runs",
  // The addressed agent's hands: steer/resume the agent's OWN run on a linked ticket or
  // start a follow-up on the same branch. NOT the unattended executions.post_message.
  "chats.execute_as_agent"
];
function isChatReplyScope(toolScope) {
  return toolScope === "chat-reply";
}

// ../packages/agent-run/src/policy/tools/readCoverage.ts
var DEDUPABLE_READS = /* @__PURE__ */ new Set(["read_file", "list_files", "search_code", "find_symbol", "file_outline"]);
var UNSCOPED_MUTATIONS = /* @__PURE__ */ new Set(["run_command", "git_checkout", "git_merge", "git_rebase", "git_reset", "git_stash", "git_pull", "apply_patch"]);
var CODE_CHANGES = /* @__PURE__ */ new Set(["write_file", "edit_file", "delete_file", "create_file", "move_file"]);
var PUBLISHES = /* @__PURE__ */ new Set(["git_commit", "git_push", "create_pull_request"]);
var REPO_STATE_READS = /* @__PURE__ */ new Set(["git_status", "git_log", "git_branch"]);
var SEPARATOR = " \u220B ";
function pathOf(args) {
  const a = args && typeof args === "object" ? args : {};
  const path = typeof a.path === "string" ? a.path : typeof a.scope === "string" ? a.scope : void 0;
  return path?.trim() || void 0;
}
var AGENT_READ_TRAITS = {
  visitTarget: (args) => {
    const path = pathOf(args) ?? "";
    const query = args && typeof args === "object" ? args.query : void 0;
    return typeof query === "string" && query.trim() ? `${path}${SEPARATOR}${query.trim()}` : path || void 0;
  },
  activityTarget: pathOf,
  questionSeparator: SEPARATOR,
  // A shell command that provably only reads changes no file: it forgets no read.
  isUnscopedMutation: (tool, args) => UNSCOPED_MUTATIONS.has(tool) && !isReadOnlyShellCall(tool, args),
  isCodeChangeTool: (tool) => CODE_CHANGES.has(tool),
  isLocalWorkspaceTool: (tool) => DEDUPABLE_READS.has(tool) || CODE_CHANGES.has(tool) || UNSCOPED_MUTATIONS.has(tool) || tool.startsWith("git_"),
  isRepoPublishTool: (tool) => PUBLISHES.has(tool),
  isRepoStateReadTool: (tool) => REPO_STATE_READS.has(tool)
};
function servedKey(tool, args) {
  return `${tool}\0${JSON.stringify(canonicalReadArgs(tool, args))}`;
}
function parseKey(key) {
  const at2 = key.indexOf("\0");
  if (at2 < 0) return null;
  try {
    return { tool: key.slice(0, at2), args: JSON.parse(key.slice(at2 + 1)) };
  } catch {
    return null;
  }
}
var sessions2 = /* @__PURE__ */ new WeakMap();
function coverageOf(state) {
  let coverage = sessions2.get(state);
  if (coverage) return coverage;
  coverage = new ReadCoverage(AGENT_READ_TRAITS);
  for (const [key, entry] of Object.entries(state.reads.served)) {
    const read = parseKey(key);
    if (!read) continue;
    coverage.record(read.tool, read.args);
    if (entry.cached) coverage.cacheResult(read.tool, read.args, entry.cached);
  }
  sessions2.set(state, coverage);
  return coverage;
}
function stillServed(ctx, anchor) {
  return ctx.messages.some((m) => m.role === "tool" && m.toolCallId === anchor);
}
function coveredReadAnswer(ctx, call) {
  if (!DEDUPABLE_READS.has(call.name)) return void 0;
  const answer = coveredAnswer(ctx, call);
  if (answer) ctx.state.reads = { ...ctx.state.reads, stubCount: (ctx.state.reads.stubCount ?? 0) + 1 };
  return answer;
}
function coveredAnswer(ctx, call) {
  const coverage = coverageOf(ctx.state);
  if (coverage.isRepeat(call.name, call.args)) {
    const cached = coverage.cachedResult(call.name, call.args);
    if (cached && !stillServed(ctx, cached.anchor)) {
      const note = `Replayed from this run's read cache: this exact ${call.name} call succeeded earlier in the run, but its result was compressed out of the working context, so here it is again \u2014 served from memory, not re-read. Act on it now; do not request it again.`;
      return { data: withNote(cached.served ?? cached.result, note) };
    }
    return {
      data: {
        note: `Duplicate ${call.name} call \u2014 identical arguments to an earlier call this run, whose result is already in the conversation above. Reuse that result instead of re-reading; do not repeat it.`
      }
    };
  }
  const covered = coverage.coveredRead(call.name, call.args);
  if (!covered) return void 0;
  coverage.record(call.name, call.args);
  if (covered.cached && !stillServed(ctx, covered.cached.anchor)) {
    const served = covered.cached.served ?? covered.cached.result;
    const requested = isReadFileResult(served) ? sliceReadFile(served, covered.start, covered.end) : served;
    return { data: withNote(requested, covered.note) };
  }
  return { data: { note: covered.note } };
}
function withNote(result, note) {
  return result && typeof result === "object" && !Array.isArray(result) ? { ...result, note } : { output: result, note };
}
function servedSpan(served) {
  if (!isReadFileResult(served)) return { start: 0, end: 0 };
  const start = typeof served.offset === "number" && served.offset > 0 ? Math.floor(served.offset) : 1;
  return { start, end: start + served.content.split("\n").length - 1 };
}
function failed2(result) {
  return !!result && typeof result === "object" && result.ok === false;
}
function cutToCap(result) {
  return !!result && typeof result === "object" && result.truncated === true;
}
function recordShellPrint(ctx, coverage, call, served) {
  const read = shellPrintAsRead(call.name, call.args, served, !cutToCap(served));
  if (!read) return;
  coverage.record("read_file", read.args);
  const cached = { result: read.result, served: read.result, anchor: call.id };
  coverage.cacheResult("read_file", read.args, cached);
  const entry = { ...servedSpan(read.result), cached, note: "" };
  const reads = ctx.state.reads;
  ctx.state.reads = { ...reads, served: { ...reads.served, [servedKey("read_file", read.args)]: entry } };
}
function recordServedRead(ctx, call, served, isError) {
  const coverage = coverageOf(ctx.state);
  const reads = ctx.state.reads;
  if (DEDUPABLE_READS.has(call.name)) {
    if (isError || failed2(served)) return;
    coverage.record(call.name, call.args);
    const cached = { result: served, served, anchor: call.id };
    coverage.cacheResult(call.name, call.args, cached);
    const entry = { ...servedSpan(served), cached, note: "" };
    ctx.state.reads = { ...reads, served: { ...reads.served, [servedKey(call.name, call.args)]: entry } };
    return;
  }
  coverage.invalidate(call.name, call.args);
  const kept = {};
  for (const [key, entry] of Object.entries(reads.served)) {
    const read = parseKey(key);
    if (read && coverage.isRepeat(read.tool, read.args)) kept[key] = entry;
  }
  ctx.state.reads = { ...reads, served: kept };
  if (!isError && !failed2(served)) recordShellPrint(ctx, coverage, call, served);
}

// ../packages/agent-run/src/policy/tools/gates.ts
var INPUT_PATH_TOOLS = /* @__PURE__ */ new Set(["apply_patch"]);
var CONTROL_TOOLS = new Set(CONTROL_TOOL_NAMES);
function policyRefusalMessage(d) {
  if (d.action === "block") {
    return `Policy gate ${d.gateId} blocked this tool call: ${d.reason}`;
  }
  return `Policy gate ${d.gateId} requires human approval before this tool call (${d.reason}). No approver is available on this host (no approval pause), so the call was refused.`;
}
function declaredBy(ports, name) {
  return name ? ports.platform?.declared?.(name) ?? ports.extensions?.declared?.(name) : void 0;
}
function gatesFor(gates, toolName) {
  const all = gates ?? [];
  return CONTROL_TOOLS.has(toolName) ? all.filter((g) => g.tool && g.tool !== "*") : all;
}
function callSideEffect(toolName, args, declared) {
  const cataloged = candidateToolNames(toolName, args).find((n) => toolSideEffect(n) !== void 0);
  return classifyTool(cataloged ?? toolName, declared, args);
}
function resolveSideEffectGates(gates, toolName, args, declared) {
  if (!gates.some((g) => g.sideEffect)) return [...gates];
  const effect = callSideEffect(toolName, args, declared);
  return gates.filter((g) => !g.sideEffect || g.sideEffect === effect).map(({ sideEffect: _class, ...rest }) => rest);
}
function evaluatePolicyGateSeam(gates, toolName, args, workspaceRoot, declared) {
  const paths = toolCallPaths(args);
  const pathArg = paths.length ? paths : void 0;
  const unreadable = INPUT_PATH_TOOLS.has(toolName) && typeof args?.input === "string" && args.input.trim().length > 0 && paths.length === 0;
  const applicable = resolveSideEffectGates(gatesFor(gates, toolName), toolName, args, declared).map((g) => {
    if (!unreadable || !g.paths) return g;
    const { paths: _scope, ...unscoped } = g;
    return unscoped;
  });
  let approval;
  for (const name of candidateToolNames(toolName, args)) {
    const d = evaluatePolicyGate(applicable, name, pathArg, workspaceRoot);
    if (d.action === "block") return d;
    if (d.action === "require-approval") approval = d;
  }
  return approval ?? { action: "allow" };
}
function isToolWithheld(gates, toolName, declared) {
  const blocking = resolveSideEffectGates(gatesFor(gates, toolName), toolName, void 0, declared).filter((g) => g.effect === "block" && !(g.paths && g.paths.length));
  if (blocking.length === 0) return false;
  if (blocking.some((g) => !g.tool || g.tool === "*")) return true;
  const blocked = new Set(blocking.map((g) => normalizeToolName(g.tool ?? "")));
  return candidateToolNames(toolName).some((n) => blocked.has(normalizeToolName(n)));
}
var DO_NOT_RETRY = "Do not ask for this again \u2014 accomplish the task another way, or finish and explain why it cannot proceed.";
function approvalRefusalMessage(refusal, tool, gateId, answer) {
  if (refusal === "timed_out") return `No approver answered "${tool}" in time (governance gate ${gateId}), so it was not run. ${DO_NOT_RETRY}`;
  if (refusal === "stopped") return `The run was stopped before "${tool}" was approved (governance gate ${gateId}), so it was not run.`;
  if (refusal === "unreachable") return `No approver could be reached for "${tool}" (governance gate ${gateId}), so it was not run. ${DO_NOT_RETRY}`;
  return `The approver declined "${tool}" (governance gate ${gateId}).${answer ? ` ${answer}` : ""} ${DO_NOT_RETRY}`;
}
async function refuseApproval(ctx, call, decision, key, error) {
  ctx.state.refusedCalls = { ...ctx.state.refusedCalls ?? {}, [key]: error };
  ctx.ports.refusals?.remember(key, error);
  await emit(ctx.ports.events, { kind: "policy.blocked", step: ctx.step, tool: call.name, gateId: decision.gateId, reason: error });
  return { data: { ok: false, gate: decision.gateId, error }, isError: true };
}
async function gateCall(ctx, call) {
  const gates = ctx.policy.approvalGates;
  if (!gates || gates.length === 0) return void 0;
  const platform = ctx.ports.platform;
  const handledByPolicy = call.name === TOOL_SEARCH_TOOL || call.name === UPDATE_TASK_STATE_TOOL && ctx.policy.levers.includes("c3_task_state");
  if (platform?.closed && platform.governanceAfterRewrite && !handledByPolicy && !ctx.ports.extensions?.handles(call.name)) return void 0;
  const decision = evaluatePolicyGateSeam(gates, call.name, call.args, ctx.task.workspace?.defaultRepo, declaredBy(ctx.ports, call.name));
  if (decision.action === "block") {
    await emit(ctx.ports.events, { kind: "policy.blocked", step: ctx.step, tool: call.name, gateId: decision.gateId, reason: decision.reason });
    return {
      data: { ok: false, gate: decision.gateId, error: `Blocked by governance policy: ${decision.reason}. Do not retry this tool \u2014 accomplish the task another way, or finish and explain why it cannot proceed.` },
      isError: true
    };
  }
  if (decision.action !== "require-approval") return void 0;
  const key = policyGateCallKey(decision.gateId, call.name, call.args);
  if ((ctx.state.approvedCalls ?? []).includes(key)) return void 0;
  const refusedBefore = ctx.state.refusedCalls?.[key] ?? ctx.ports.refusals?.recall(key);
  if (refusedBefore) return { data: { ok: false, gate: decision.gateId, error: refusedBefore }, isError: true };
  const gate = gates.find((g) => g.id === decision.gateId || g.baseGateId === decision.gateId) ?? { id: decision.gateId, effect: "require-approval", reason: decision.reason };
  const question = `Approve the agent's use of "${call.name}"? ${decision.reason}`;
  const human = ctx.ports.human;
  const parkedOn = ctx.state.parkedCalls?.[key];
  const answer = await measureWorkflow(
    ctx.ports.events,
    { ...workflowScope(ctx, ctx.step), operation: "approval_wait" },
    "dispatch",
    () => human.approve ? human.approve(gate, { tool: call.name, args: call.args, reason: decision.reason, ...parkedOn ? { approvalId: parkedOn } : {} }) : human.ask(question),
    (reply) => reply?.kind === "answered" && reply.approved === true ? "completed" : "blocked",
    ctx.signal
  );
  if (!answer) return refuseApproval(ctx, call, decision, key, `${policyRefusalMessage(decision)} ${DO_NOT_RETRY}`);
  if (answer.kind === "answered") {
    if (parkedOn) {
      const { [key]: _settled, ...rest } = ctx.state.parkedCalls ?? {};
      ctx.state.parkedCalls = rest;
    }
    if (answer.approved === true) {
      ctx.state.approvedCalls = [...ctx.state.approvedCalls ?? [], key];
      return void 0;
    }
    return refuseApproval(ctx, call, decision, key, approvalRefusalMessage(answer.refusal ?? "declined", call.name, decision.gateId, answer.answer));
  }
  const approvalId = answer.approvalId ?? parkedOn;
  if (approvalId) ctx.state.parkedCalls = { ...ctx.state.parkedCalls ?? {}, [key]: approvalId };
  else ctx.state.approvedCalls = [...ctx.state.approvedCalls ?? [], key];
  return {
    data: { ok: false, error: `Paused for human approval of "${call.name}" (governance gate ${decision.gateId}).` },
    isError: true,
    // `parked`: the approver's channel already parked the run — the kernel settles `paused`, it never asks a second time.
    control: { kind: "ask_human", question, parked: true, ...approvalId ? { approvalId } : {} }
  };
}

// ../packages/agent-run/src/policy/tools/caps.ts
function resultCapFor(tool, model, servingModel2, data) {
  const window = servingModel2 && typeof model.window === "function" ? model.window(servingModel2) : void 0;
  return windowedCap(tool, resultTableCap(tool, data), window);
}
var ERROR_CHARS = 500;
function failedResult(data) {
  if (!data || typeof data !== "object" || data.ok !== false) return null;
  const error = data.error;
  return typeof error === "string" ? { error: error.slice(0, ERROR_CHARS) } : {};
}
function fittedText(text, failed3, maxChars, originalChars) {
  const note = truncatedResultNote(originalChars, maxChars);
  const head = failed3 ? { ok: false, ...failed3 } : {};
  let body = text;
  for (; ; ) {
    const result = { ...head, truncated: true, note, output: body };
    const over = JSON.stringify(result).length - maxChars;
    if (over <= 0 || body.length === 0) return result;
    body = body.slice(0, Math.max(0, body.length - over - 1));
  }
}
function capToolResult(tool, data, maxChars) {
  const shaped = shapeToolResult(tool, data, { maxChars });
  if (!shaped.truncated) return data;
  const failed3 = failedResult(data);
  let parsed;
  try {
    parsed = JSON.parse(shaped.content);
  } catch {
    return fittedText(shaped.content, failed3, maxChars, shaped.bytes);
  }
  if (failed3 && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return { ...parsed, ok: false };
  }
  return failed3 ? fittedText(shaped.content, failed3, maxChars, shaped.bytes) : parsed;
}

// ../packages/agent-run/src/policy/tools/index.ts
var SIGNOFF_TOOL = "builtin_kanban_signoff";
function selectedTools(ctx, offered) {
  const { policy, task } = ctx;
  const tools = offered.filter((t) => !isToolWithheld(policy.approvalGates, t.function?.name ?? "", declaredBy(ctx.ports, t.function?.name)));
  if (isChatReplyScope(policy.toolScope)) {
    const allowed = new Set(CHAT_REPLY_SCOPED_TOOLS);
    const extension = ctx.ports.extensions;
    return tools.filter((t) => {
      const name = t.function?.name;
      return name ? allowed.has(name) || Boolean(extension?.handles(name)) : false;
    });
  }
  const required = policy.signoff ? [SIGNOFF_TOOL] : [];
  const pinned = [...pinnedNames(ctx), ...required];
  const own2 = selectPlatformCatalog(ctx, pinned);
  if (own2) return own2.filter((t) => !isToolWithheld(policy.approvalGates, t.function?.name ?? "", declaredBy(ctx.ports, t.function?.name)));
  const prompt = [task.persona, task.prompt].filter(Boolean).join("\n");
  const catalog = selectCatalog(tools, policy.role, catalogCaps(ctx), { pinned, required, prompt });
  const selected = selectToolsForTurn(catalog, { query: task.prompt, pinned });
  return policy.levers.includes("c3_task_state") ? [...selected.tools, UPDATE_TASK_STATE_SCHEMA] : selected.tools;
}
function toolSearchAnswer(ctx, call) {
  if (call.name === UPDATE_TASK_STATE_TOOL && ctx.policy.levers.includes("c3_task_state")) {
    const updated = applyTaskStateUpdate(ctx.state.taskState, call.args);
    if (!updated.ok) return { data: { ok: false, error: updated.error } };
    ctx.state.taskState = updated.state;
    return { data: { ok: true, note: "Task state saved \u2014 it is shown to you every turn and kept through compaction." } };
  }
  if (call.name !== TOOL_SEARCH_TOOL) return void 0;
  const advertised = new Set(selectedTools(ctx, ctx.tools).map((t) => t.function.name));
  const found = runToolSearch(ctx.tools, advertised, call.args);
  if (found.load.length > 0) ctx.state.loadedTools = [.../* @__PURE__ */ new Set([...ctx.state.loadedTools ?? [], ...found.load])];
  return { data: found.data };
}
function loadCalledDeferredTool(ctx, call) {
  if (call.name === TOOL_SEARCH_TOOL || call.name === UPDATE_TASK_STATE_TOOL) return;
  if ((ctx.state.loadedTools ?? []).includes(call.name)) return;
  if (!ctx.tools.some((t) => t.function?.name === call.name)) return;
  if (selectedTools(ctx, ctx.tools).some((t) => t.function?.name === call.name)) return;
  ctx.state.loadedTools = [...ctx.state.loadedTools ?? [], call.name];
}
var toolsHook = {
  select: selectedTools,
  beforeDispatch: (ctx, call) => {
    loadCalledDeferredTool(ctx, call);
    return ctx.ports.platform?.readsCovered ? void 0 : coveredReadAnswer(ctx, call);
  },
  meta: toolSearchAnswer,
  observe: (ctx, call, result, isError) => ctx.ports.platform?.readsCovered ? void 0 : recordServedRead(ctx, call, result, isError),
  gate: gateCall
};
function catalogCaps(ctx) {
  return ctx.ports.capabilities?.capabilities ?? /* @__PURE__ */ new Set();
}
function pinnedNames(ctx) {
  const names = new Set(ctx.state.loadedTools ?? []);
  for (const message of ctx.messages) {
    for (const call of message.toolCalls ?? []) if (call.name) names.add(call.name);
  }
  return [...names];
}

// ../packages/agent-run/src/policy/index.ts
function defaultPolicyModules() {
  return {
    compaction: compactionHook,
    stall: stallHook,
    steering: steeringHook,
    ask: askHook,
    subagents: subagentsHook,
    finish: finishHook,
    guards: guardsHook,
    verify: verifyHook,
    memory: memoryHook,
    context: contextHook,
    tools: toolsHook,
    model: modelHook
  };
}
function composePolicyHooks(overrides = {}) {
  const modules = { ...defaultPolicyModules(), ...overrides };
  return {
    compaction: modules.compaction,
    stall: modules.stall,
    steering: modules.steering,
    ask: modules.ask,
    subagents: modules.subagents,
    finish: modules.finish,
    guards: modules.guards,
    verify: modules.verify,
    memory: modules.memory,
    context: modules.context,
    tools: modules.tools,
    model: modules.model
  };
}

// ../packages/agent-run/src/telemetry/costTally.ts
function foldTurnCost(running, turnCostMc) {
  if (running === null || turnCostMc === void 0) return null;
  return (running ?? 0) + turnCostMc;
}
function reportedRunCost(running) {
  return running ?? void 0;
}

// ../packages/agent-run/src/telemetry/runTally.ts
function freshTally() {
  return { toolCalls: 0, toolErrors: 0, tokens: 0, cacheReadTokens: 0, shellFileReads: 0, repoErrors: 0, mutations: 0, costLatch: true };
}
function resumeTally(saved) {
  const tally = { ...freshTally(), ...saved ?? {} };
  const tookTurns = !!saved && (saved.costMc != null || (saved.tokens ?? 0) > 0 || saved.model !== void 0 || (saved.toolCalls ?? 0) > 0);
  if (saved && saved.costLatch !== true && tookTurns) tally.costMc = null;
  return tally;
}
function tallyTurn(tally, model, usage) {
  if (model) tally.model = model;
  tally.costMc = foldTurnCost(tally.costMc, usage?.costMc);
  if (!usage) return;
  tally.tokens += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  tally.cacheReadTokens += usage.cacheReadTokens ?? 0;
}
function tallyCall(tally, step, name, args, data, ok) {
  tally.toolCalls += 1;
  if (!ok) tally.toolErrors += 1;
  if (isSpawnTool(name) && tally.firstSpawnTurn === void 0) tally.firstSpawnTurn = step;
  if (resolveToolAlias(name) === "run_command" && typeof args.command === "string" && parseShellFileRead(args.command)) {
    tally.shellFileReads += 1;
  }
  if (!ok && isNotARepo(errorText(data))) tally.repoErrors += 1;
}
function tallyVerify(tally, ok) {
  tally.verify = ok ? "passed" : "failed";
}
function bumpMutations(tally) {
  tally.mutations += 1;
}
function errorText(data) {
  if (typeof data === "string") return { error: data };
  if (!data || typeof data !== "object") return {};
  const d = data;
  const str5 = (v) => typeof v === "string" ? v : "";
  return { stdout: `${str5(d.stdout)} ${str5(d.stderr)}`, error: str5(d.error) };
}

// ../packages/agent-run/src/runState.ts
function freshState(policy) {
  return {
    messages: [],
    step: 0,
    guards: {},
    finish: initialFinishGateState(void 0),
    model: initialModelState(policy),
    memory: { memory: { created: [], edited: [], deleted: [], read: [], searched: [] }, tools: [] },
    compaction: { compactions: 0 },
    writtenPaths: [],
    askedGates: [],
    reads: freshReads(),
    telemetry: freshTally()
  };
}
function initialModelState(policy) {
  const start = policy.modelStart;
  if (!start) return initialRunPolicy({ pinnedModel: policy.pinnedModel, ...policy.modelOptions ?? {} });
  const model = start.model ?? policy.pinnedModel ?? "";
  if (start.plain) {
    const review = reviewPhaseModel(start.phaseModels);
    return initialRunPolicy({
      pinnedModel: model,
      ...start.strict ? { strictPin: true } : {},
      ...start.startPhase ? { startPhase: start.startPhase } : {},
      ...policy.modelOptions ?? {},
      ...start.phaseModels ? { phaseModels: start.phaseModels, ...review ? { reviewModel: review } : {} } : {}
    });
  }
  return initialModelRunState({
    pick: { model, strict: start.strict ?? false },
    delegatedRole: start.delegatedRole,
    ...start.startPhase && !start.delegatedRole ? { startPhase: start.startPhase } : {},
    ...start.phaseModels ? { phaseModels: start.phaseModels } : {}
  }).policy;
}
function freshReads() {
  return { served: {}, readsWithoutSpawn: { reads: 0, spawned: false, nudged: false } };
}
function resumeState(saved, policy) {
  const fresh = freshState(policy);
  return {
    ...fresh,
    ...saved,
    guards: saved.guards ?? fresh.guards,
    finish: saved.finish ?? fresh.finish,
    model: saved.model ?? fresh.model,
    memory: saved.memory ?? fresh.memory,
    compaction: saved.compaction ?? fresh.compaction,
    writtenPaths: saved.writtenPaths ?? [],
    askedGates: saved.askedGates ?? [],
    reads: saved.reads ?? fresh.reads,
    telemetry: resumeTally(saved.telemetry),
    messages: Array.isArray(saved.messages) ? saved.messages : []
  };
}
function asMessages(raw) {
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row;
    if (r.role !== "system" && r.role !== "user" && r.role !== "assistant" && r.role !== "tool") continue;
    out.push({
      role: r.role,
      content: typeof r.content === "string" ? r.content : "",
      ...Array.isArray(r.toolCalls) ? { toolCalls: r.toolCalls } : {},
      ...typeof r.toolCallId === "string" ? { toolCallId: r.toolCallId } : {},
      ...Array.isArray(r.parts) ? { parts: r.parts } : {},
      ...r.meta && typeof r.meta === "object" ? { meta: r.meta } : {},
      ...r.isError ? { isError: true } : {}
    });
  }
  return out;
}
function rememberWrite(state, call, ok) {
  if (!ok) return;
  if (call.name === "delete_file") {
    const gone = typeof call.args.path === "string" ? call.args.path : void 0;
    if (gone) state.writtenPaths = state.writtenPaths.filter((p) => p !== gone);
    return;
  }
  if (call.name !== "write_file" && call.name !== "edit_file") return;
  const path = typeof call.args.path === "string" ? call.args.path : void 0;
  if (path && !state.writtenPaths.includes(path)) state.writtenPaths = [...state.writtenPaths, path];
}
function newApprovalId(state) {
  return `approval-${state.askedGates.length + 1}`;
}

// ../packages/agent-run/src/runCatalog.ts
var CORE_REGISTRY = buildCoreToolRegistry();
for (const tool of [...SKILL_TOOLS, ...SUBAGENT_TOOLS]) CORE_REGISTRY.register(tool);
var REGISTRIES = /* @__PURE__ */ new WeakMap();
function registryOf(ports) {
  const extra = ports.tools;
  if (!extra || extra.length === 0) return CORE_REGISTRY;
  let registry = REGISTRIES.get(extra);
  if (!registry) {
    registry = buildCoreToolRegistry();
    for (const tool of extra) registry.register(tool);
    REGISTRIES.set(extra, registry);
  }
  return registry;
}
function ownsCall(ports, name) {
  const platform = ports.platform;
  return platform !== void 0 && (platform.closed === true || !registryOf(ports).has(name));
}
function offeredSchemas(ports, progress = { rungs: {} }) {
  const seen = /* @__PURE__ */ new Set();
  const registry = ports.platform?.closed || !ports.capabilities ? [] : registryOf(ports).schemasFor(ports.capabilities);
  return [...registry, ...ports.extensions?.schemas() ?? [], ...ports.platform?.schemas(progress) ?? []].filter((schema) => {
    const name = schema.function?.name;
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

// ../packages/agent-run/src/runRows.ts
var nativeResults = /* @__PURE__ */ new WeakMap();
var killedResults = /* @__PURE__ */ new WeakSet();
function nativeOfTurn(meta) {
  const m = meta && typeof meta === "object" ? meta : void 0;
  return { ...m?.parts ? { parts: m.parts } : {}, ...m?.native ? { meta: m.native } : {} };
}
function toolRow(callId, result, verbatim = false) {
  const native = nativeResults.get(result);
  const stopped = killedResults.has(result);
  return {
    role: "tool",
    toolCallId: callId,
    content: (native || verbatim) && typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? null),
    ...native?.parts && !stopped ? { parts: native.parts } : {},
    ...native?.meta ? { meta: native.meta } : {},
    // A call that did not run because the person steered, or that its signal killed, is answered as a failed one: the row says it
    // did not do its work. The dispatch result itself is not an error, so neither is counted as a failure - and the kernel clears the
    // failure streak on it, as on any call that did not fail (a kill resets the streak to 0).
    ...result.isError || stopped || result.data?.skipped === true ? { isError: true } : {}
  };
}

// ../packages/agent-run/src/policy/model/handoff.ts
function asModelRunState(state) {
  return { policy: state.model, stallRecoveries: 0, preflightNotices: [] };
}
function askOf(req, phase) {
  return {
    ...req.model ? { model: req.model } : {},
    role: req.role,
    phase,
    ...req.strict ? { strict: true } : {},
    ...req.excludeModels.length > 0 ? { excludeModels: req.excludeModels } : {},
    ...req.toolChoice ? { toolChoice: req.toolChoice } : {}
  };
}
function routeAround(state, status) {
  const request = nextTurn(state.model, { hasTools: true });
  const routed = routeAroundFailure(asModelRunState(state), request, { kind: "transport", ...status !== void 0 ? { status } : {} });
  state.model = routed.state.policy;
  const outcome = retryOutcome(routed.state);
  if (!routed.retry || !outcome) return null;
  const released = outcome.released;
  return {
    retry: askOf(routed.retry, state.model.phase),
    from: typeof released === "string" ? released : null,
    released: Boolean(released)
  };
}
function turnSucceeded(state, served) {
  state.model = recordSuccess(asModelRunState(state), {
    ...served.model ? { model: served.model } : {},
    acted: served.acted,
    ...served.durationMs !== void 0 ? { durationMs: served.durationMs } : {}
  }).policy;
  delete state.forceToolChoice;
}

// ../packages/agent-run/src/policy/model/reask.ts
function parsedArgs(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
}
function changesCode(tools, call) {
  return tools.includes(call.name) || isMutatingShellCall(call.name, parsedArgs(call.arguments));
}
function changedCode(policy, completion) {
  const tools = policy.codeChangeTools;
  return !!tools && tools.length > 0 && (completion.toolCalls ?? []).some((call) => changesCode(tools, call));
}
function reaskAsCoder(state, policy, completion, asked) {
  if (asked.role !== "plan" || !changedCode(policy, completion)) return void 0;
  state.model = reduceRunPolicy(state.model, { type: "code_change_attempted" });
  if (state.model.outcome.kind !== "reask_as_coder") return void 0;
  const next = nextTurn(state.model, { hasTools: asked.hasTools });
  const calls = (completion.toolCalls ?? []).map((call) => ({ name: call.name, args: call.arguments }));
  return {
    ask: {
      ...next.model ? { model: next.model } : {},
      role: next.role,
      phase: state.model.phase,
      ...next.strict ? { strict: true } : {},
      ...next.excludeModels.length > 0 ? { excludeModels: next.excludeModels } : {}
    },
    brief: { role: "user", content: coderHandoffBrief(completion.content ?? "", calls) }
  };
}

// ../packages/agent-run/src/turnContext.ts
import { volatileTail as volatileTail2 } from "@seanhogg/builderforce-memory/handoff";
var EMPTY_PACK2 = { focus: [], facts: [], recall: [] };
async function buildContextPack(input, hooks, state, offered) {
  let pack;
  try {
    pack = await input.ports.context.pack(input.task);
  } catch {
    pack = EMPTY_PACK2;
  }
  const built = pack;
  const once = { ...input, ports: { ...input.ports, context: { pack: () => built } } };
  let recalled = void 0;
  try {
    recalled = await hooks.context.recall(policyContext(once, state, { messages: [], tools: offered }, state.step, 0));
  } catch {
    recalled = void 0;
  }
  return recalled && recalled.length > 0 ? { ...pack, recall: [...pack.recall, ...recalled] } : pack;
}
function openingRows(task, gates) {
  const system = [];
  const governance = renderPolicyDirectives(gates);
  const persona = task.persona?.trim() ?? "";
  if (governance && persona !== governance && !persona.startsWith(`${governance}

`)) system.push(governance);
  if (persona) system.push(persona);
  return [
    ...system.length > 0 ? [{ role: "system", content: system.join("\n\n") }] : [],
    ...task.transcript?.length ? task.transcript : [{ role: "user", content: task.prompt }]
  ];
}
function turnContextBlock(pack, brief, sections = []) {
  const lines = [];
  for (const file of pack.focus) {
    if (file.content !== void 0) {
      lines.push(`## ${file.path}`, file.content);
    } else if (file.outline && file.outline.length > 0) {
      lines.push(`## ${file.path} (outline)`);
      for (const entry of file.outline) lines.push(`- ${entry.heading} (line ${entry.line})`);
    }
  }
  if (pack.chat) {
    lines.push(`## chat`, `${pack.chat.tickets.length} linked tickets, ${pack.chat.runs.length} runs`);
  }
  for (const repo of pack.repos ?? []) {
    lines.push(`## repo ${repo.repo}`, `branch ${repo.branch}`, repo.dirty.length > 0 ? `dirty: ${repo.dirty.join(", ")}` : "clean");
  }
  for (const fact of pack.facts) lines.push(`## ${fact.key}`, fact.content);
  if (pack.recall.length > 0) lines.push("## recall", ...pack.recall);
  if (brief && brief.trim()) lines.push("## brief", brief.trim());
  for (const section of sections) if (section.trim()) lines.push(section.trim());
  if (lines.length === 0) return null;
  return lines.join("\n");
}
function withVolatileTail(transcript, pack, brief, sections = []) {
  const tail = volatileTail2([turnContextBlock(pack, brief, sections)]);
  return tail ? [...transcript, tail] : [...transcript];
}

// ../packages/agent-run/src/policy/verify/specValidation.ts
function planSpecValidation(task) {
  const { ask } = classifyRequest(task.request ?? task.prompt);
  if (/^\s*(?:how|why|when|where|what)\b/i.test(ask) || /\b(?:do not|don't|never)\s+(?:validate|verify|revalidate|re-validate)\b/i.test(ask)) return void 0;
  if (!/\b(?:validate|verify|revalidate|re-validate)\b[^!?\r\n]{0,200}\b(?:prd|spec(?:ification)?s?)\b/i.test(ask) && !/(?:^|[\n.!?])\s*(?:please\s+)?(?:prds?|spec(?:ification)?s?)\b[^.!?\r\n]{0,100}\bvalidation\b/i.test(ask)) return void 0;
  const target = /\b[\w-]*(?:prd|spec)[\w.-]*\.md\b/i.exec(ask)?.[0].toLowerCase();
  return target ? { target } : {};
}
function checkCommand(command) {
  if (/[|;&<>\r\n]/.test(command)) return false;
  const [exe, script] = executableTokensOf(command);
  return runsCheck(command) || (exe === "node" || exe === "tsx") && /^\.?[\\/]?scripts[\\/]check-[\w.-]+\.[cm]?[jt]s$/.test(script ?? "");
}
function record3(validation, check, exitCode) {
  const checks = validation.completed ?? [];
  validation.completed = [
    ...checks.filter((item) => item.command !== check.command || item.cwd !== check.cwd),
    { ...check, exitCode }
  ].slice(-24);
}
function readAcceptanceChecks(validation, path, content) {
  if (typeof path !== "string" || typeof content !== "string") return;
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase();
  if (validation.target && name !== validation.target) return;
  if (validation.target) validation.readTarget = true;
  if (validation.required) return;
  const manifest = /(?:^|\n)```builderforce-acceptance[^\S\n]*\r?\n([\s\S]*?)\r?\n```/.exec(content.slice(0, 12e3));
  if (!manifest) return;
  try {
    const rows = JSON.parse(manifest[1]);
    if (!Array.isArray(rows) || rows.length > 24) return;
    const checks = rows.filter((row) => row && typeof row.command === "string" && checkCommand(row.command) && typeof row.cwd === "string" && row.cwd.length <= 300);
    if (checks.length && checks.length === rows.length) {
      validation.required = checks;
      validation.root = /^(.*)[\\/]docs[\\/]specs[\\/]/i.exec(path)?.[1];
    }
  } catch {
  }
}
function missingChecks(state) {
  const validation = state.specValidation;
  const normalize = (path) => path.replace(/\\/g, "/").replace(/^(?:\.\/)+|\/$/g, "");
  return (validation?.required ?? []).filter((required) => !validation?.completed?.some((actual) => {
    if (actual.command.trim().replace(/\s+/g, " ") !== required.command.trim().replace(/\s+/g, " ")) return false;
    const cwd = normalize(actual.cwd ?? ".");
    const directory = normalize(required.cwd ?? ".");
    const root = normalize(validation.root ?? "").split("/").at(-1);
    const rooted = root ? directory === "." ? root : `${root}/${directory}` : "";
    return cwd === directory || rooted !== "" && (cwd === rooted || cwd.endsWith(`/${rooted}`));
  }));
}
function resultRecord(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function observeSpecCheck(state, call, value, details, succeeded8) {
  const validation = state.specValidation;
  if (!validation) return;
  const result = resultRecord(value);
  const meta = resultRecord(details);
  if (call.name === "read_file" && succeeded8) {
    readAcceptanceChecks(validation, result.path ?? call.args.path, result.content);
    return;
  }
  if (result.aborted || result.timedOut) return;
  if (call.name === "run_checks" && result.ran === true && typeof result.ok === "boolean") {
    record3(validation, { command: "run_checks (host static checks / CI)" }, result.ok && succeeded8 ? 0 : 1);
    return;
  }
  const id = typeof result.id === "string" ? result.id : void 0;
  if (call.name === "command_status") {
    const requested = typeof call.args.id === "string" ? call.args.id.trim() : "";
    const pending = validation.pending;
    if (!pending || requested !== id || !Object.hasOwn(pending, requested)) return;
    const check2 = pending[requested];
    const exit2 = result.exitCode;
    if (result.status === "exited" && typeof exit2 === "number" && Number.isInteger(exit2) && (succeeded8 || exit2 !== 0)) {
      record3(validation, check2, exit2);
    }
    if (result.status === "exited" || result.status === "killed" || result.status === "unknown") delete pending[requested];
    return;
  }
  if (call.name !== "run_command") return;
  const command = shellCommandOf(call.args).trim();
  if (!checkCommand(command)) return;
  const cwd = call.args.cwd ?? result.cwd;
  const check = { command, ...typeof cwd === "string" ? { cwd } : {} };
  const exit = result.exitCode ?? meta.exitCode;
  if (typeof exit === "number" && Number.isInteger(exit) && (succeeded8 || exit !== 0)) {
    record3(validation, check, exit);
  } else if (succeeded8 && id && result.status === "running") {
    validation.pending = Object.fromEntries([...Object.entries(validation.pending ?? {}), [id, check]].slice(-24));
  }
}
var INSTRUCTIONS = "For this PRD/spec validation, read its acceptance criteria and execute the named suites and repository guards through authorized tools. Run each check as a separate command in its package directory and wait for its exit result. Map each claim to its observed result. Label each missing or blocked check unverified, report failures, and never turn a source search, a started job, or a static check into a passing runtime test.";
function specValidationSection(state) {
  const validation = state.specValidation;
  if (!validation) return void 0;
  const evidence = validation.completed?.map(({ command, cwd, exitCode }) => `- ${command}${cwd ? ` (cwd: ${cwd})` : ""} exited ${exitCode}`);
  const missing = missingChecks(state);
  return [
    INSTRUCTIONS,
    ...validation.target && !validation.readTarget ? [`Read the named specification ${validation.target} before reporting a verdict.`] : [],
    evidence?.length ? "Completed checks for this run:" : "No executable check has completed in this run.",
    ...evidence ?? [],
    ...missing.length ? ["Declared acceptance checks still unverified:", ...missing.map(({ command, cwd }) => `- ${command} (cwd: ${cwd})`)] : []
  ].join("\n");
}
function missingSpecEvidence(state) {
  const validation = state.specValidation;
  return !!validation && (!validation.completed?.length || !!validation.target && !validation.readTarget || missingChecks(state).length > 0);
}
function specUnverifiedReason(state) {
  const validation = state.specValidation;
  if (validation?.target && !validation.readTarget) return `PRD validation is unverified because ${validation.target} was not read.`;
  const missing = missingChecks(state).length;
  return missing ? `PRD validation is unverified because ${missing} declared acceptance check(s) did not complete.` : "PRD validation is unverified because no executable acceptance check completed.";
}
function specValidationRetry(state) {
  const validation = state.specValidation;
  if (!validation || !missingSpecEvidence(state)) return null;
  const reason = specUnverifiedReason(state);
  if (validation.prompted) return reason;
  validation.prompted = true;
  return `${reason} ${INSTRUCTIONS} If the host cannot execute the checks, explain the blocker.`;
}
function unverifiedSpecCheckCount(state) {
  return missingChecks(state).length;
}

// ../packages/agent-run/src/runTurn.ts
var callKinds = /* @__PURE__ */ new WeakMap();
var observedToolData = /* @__PURE__ */ new WeakMap();
var causes = /* @__PURE__ */ new WeakMap();
function isResumable(input, err) {
  return !(err instanceof ModelTransportError) && input.ports.store.isResumable?.(err) === true;
}
function causeOf(state) {
  return causes.get(state);
}
var SYNTHESIS_MAX_TOKENS = 1e3;
function measureModelRequest(input, step, request, operation = "model_request") {
  return measureWorkflow(
    input.ports.events,
    { ...workflowScope(input, step), operation },
    "kernel",
    () => input.ports.model.complete(request, input.signal),
    void 0,
    input.signal
  );
}
function adoptServedModel(policy, state, served) {
  if (policy.modelStart?.plain) return;
  if (served && served !== "default" && !state.model.strictPin) state.model = { ...state.model, model: served };
}
function withoutToolChoiceIf(drop, fields) {
  if (!drop || !("toolChoice" in fields)) return fields;
  const { toolChoice: _dropped, ...rest } = fields;
  return rest;
}
function askFields(ask) {
  if (!ask) return {};
  return {
    ...ask.role ? { role: ask.role } : {},
    ...ask.phase ? { phase: ask.phase } : {},
    ...ask.toolChoice ? { toolChoice: ask.toolChoice } : {},
    ...ask.strict ? { strict: true } : {},
    ...ask.excludeModels && ask.excludeModels.length > 0 ? { excludeModels: ask.excludeModels } : {}
  };
}
async function completeTurn(input, state, hooks, ctx, offered, transcript, pack, made) {
  const view = currentView(transcript, offered);
  const pctx = policyContext(input, state, view, ctx.step, ctx.stepInCall);
  const selected = made ? made.tools : await hooks.tools.select(pctx, offered);
  const tools = selected ? [...selected] : offered;
  const advertisedSet = tools.map((t) => t.function?.name ?? "").join(",");
  if (state.advertisedSignature !== advertisedSet) {
    state.advertisedSignature = advertisedSet;
    await emit(input.ports.events, { kind: "context.tools", step: ctx.step, advertised: tools.length, catalog: offered.length, toolsTokens: toolsTokensOf(tools), loaded: state.loadedTools ?? [] });
  }
  const mctx = { ...pctx, tools, ...made?.finalBy === "guards" ? { finalTurn: true } : {} };
  const decision = await hooks.model.resolve(mctx);
  const model = decision ? decision.model : input.policy.pinnedModel;
  const brief = await hooks.memory.brief(pctx);
  const work = assignedWorkSection(state.work ?? []);
  const validation = specValidationSection(state);
  const sections = [...input.ports.context.turnSections?.() ?? [], ...work ? [`### Assigned work
${work}`] : [], ...validation ? [validation] : [], ...made?.tail ?? []];
  const fields = hooks.model.turnFields?.(mctx);
  const reasoning = hooks.guards.reasoning?.(pctx);
  const firstAsk = {
    ...decision?.role ? { role: decision.role } : {},
    ...decision?.strict ? { strict: true } : {},
    ...decision?.excludeModels && decision.excludeModels.length > 0 ? { excludeModels: [...decision.excludeModels] } : {},
    ...fields ?? {}
  };
  const progressNote = renderTaskState(state.taskState);
  const requestFor = (askedModel, ask, extra = []) => ({
    messages: measureTurnTail(state, withVolatileTail(extra.length > 0 ? [...transcript, ...extra] : transcript, pack, brief ?? null, sections)),
    ...askedModel ? { model: askedModel, strict: ask?.strict ?? false } : {},
    ...tools.length > 0 ? { tools } : {},
    ...decision?.maxTokens !== void 0 ? { maxTokens: decision.maxTokens } : {},
    // A tool choice means nothing without tools (and a provider may refuse it): a turn advertising none never sends one.
    ...withoutToolChoiceIf(tools.length === 0, askFields(ask)),
    ...tools.length > 0 && made?.toolChoice && !ask?.toolChoice ? { toolChoice: made.toolChoice } : {},
    ...reasoning ? { reasoning } : {},
    ...progressNote ? { progress: progressNote } : {}
  });
  let asked = model;
  let completion;
  let startedAt = Date.now();
  try {
    completion = await measureModelRequest(input, ctx.step, requestFor(model, firstAsk));
  } catch (err) {
    if (input.signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    if (isResumable(input, err)) causes.set(state, err);
    if (isTransportFailure(err) && hooks.model.recoverFailure) {
      const route = hooks.model.recoverFailure(pctx, err.failure, err.failure.model ?? model, reason);
      if (route.kind === "retry") {
        if (route.note) appendRows(input, transcript, { role: "system", content: route.note });
        if (made) made.retried = true;
        return { skip: true };
      }
      return { failed: `provider failed: ${reason}` };
    }
    const routed = err instanceof ModelTransportError && err.routable ? routeAround(state, err.status) : null;
    if (!routed) return { failed: reason };
    await emit(input.ports.events, { kind: "model.cascade", step: ctx.step, from: routed.from, status: err instanceof ModelTransportError ? err.status ?? null : null, released: routed.released });
    asked = routed.retry.model;
    startedAt = Date.now();
    try {
      completion = await measureModelRequest(input, ctx.step, requestFor(routed.retry.model, routed.retry));
    } catch (retryErr) {
      if (input.signal?.aborted) throw retryErr;
      if (isResumable(input, retryErr)) causes.set(state, retryErr);
      return { failed: retryErr instanceof Error ? retryErr.message : String(retryErr) };
    }
  }
  const reask = reaskAsCoder(state, input.policy, completion, { role: firstAsk.role, hasTools: tools.length > 0 });
  if (reask) {
    await emit(input.ports.events, { kind: "model.coder_reask", step: ctx.step, ...completion.model ? { model: completion.model } : {} });
    asked = reask.ask.model;
    startedAt = Date.now();
    try {
      completion = await measureModelRequest(input, ctx.step, requestFor(reask.ask.model, reask.ask, [reask.brief]));
    } catch (err) {
      if (input.signal?.aborted) throw err;
      if (isResumable(input, err)) causes.set(state, err);
      return { failed: err instanceof Error ? err.message : String(err) };
    }
  }
  turnSucceeded(state, { acted: (completion.toolCalls ?? []).length > 0, durationMs: Date.now() - startedAt, ...completion.model ? { model: completion.model } : {} });
  adoptServedModel(input.policy, state, completion.model);
  const downgrade = hooks.model.downgrade?.(pctx, asked, completion.model);
  if (downgrade) await emit(input.ports.events, downgrade);
  return {
    content: completion.content ?? "",
    toolCalls: (completion.toolCalls ?? []).map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
    meta: { model: completion.model, usage: completion.usage, interrupted: completion.interrupted, ...completion.parts ? { parts: completion.parts } : {}, ...completion.meta ? { native: completion.meta } : {} }
  };
}
async function synthesizeFinal(input, state, hooks, transcript, pack, tally, why = {}) {
  if (input.signal?.aborted) return null;
  const pctx = policyContext(input, state, currentView(transcript, []), state.step, 0);
  const prompt = hooks.stall.synthesis?.(pctx, why);
  if (!prompt) return null;
  const decision = await hooks.model.resolve(pctx);
  const model = decision ? decision.model : input.policy.pinnedModel;
  const fields = hooks.model.turnFields?.(pctx);
  const ask = { role: "user", content: prompt };
  const validation = specValidationSection(state);
  const validationSections = validation ? [validation] : [];
  let completion;
  try {
    completion = await measureModelRequest(
      input,
      state.step,
      {
        messages: [...withVolatileTail(transcript, pack, null, [...input.ports.context.turnSections?.() ?? [], ...validationSections]), ask],
        ...model ? { model, strict: decision?.strict ?? false } : {},
        maxTokens: SYNTHESIS_MAX_TOKENS,
        // A transport records this turn as the run's forced closing one (and what stopped the run), never an ordinary turn.
        ...why.failureStreak !== void 0 ? { forcedFinish: why } : {},
        ...askFields(fields),
        ...renderTaskState(state.taskState) ? { progress: renderTaskState(state.taskState) } : {}
      },
      "model_synthesis"
    );
  } catch (err) {
    if (isResumable(input, err)) throw err;
    return null;
  }
  adoptServedModel(input.policy, state, completion.model);
  tallyTurn(tally, completion.model, completion.usage);
  await emit(input.ports.events, {
    kind: "model.completed",
    step: state.step,
    ...completion.model ? { model: completion.model } : {},
    ...completion.usage ? { usage: completion.usage } : {}
  });
  const raw = completion.content ?? "";
  const output = hooks.stall.settle ? hooks.stall.settle(pctx, raw) : raw.trim();
  if (!output) return null;
  appendRows(input, transcript, ask, { role: "assistant", content: output });
  return output;
}
async function dispatchCall(input, state, call, watch, facts = { refused: false }, step = state.step) {
  const invoke = () => dispatchCallCore(input, state, call, watch, facts, step);
  const verdict = (result) => result.isError || result.data?.ok === false ? "failed" : "completed";
  return measureWorkflow(input.ports.events, workflowScope(input, step), "dispatch", () => isSpawnTool(call.name) ? measureWorkflow(input.ports.events, workflowScope(input, step), "spawn", invoke, verdict, input.signal) : invoke(), verdict, input.signal);
}
async function dispatchCallCore(input, state, call, watch, facts, step) {
  const { ports, signal } = input;
  if (call.malformed) return declineMalformedCall(ports, call, facts, step);
  if (blocksChildSpawn(input.task.dispatch, call.name)) {
    return { data: { ok: false, error: CHILD_SPAWN_REFUSAL }, isError: true };
  }
  const platform = ports.platform;
  const own2 = ownsCall(ports, call.name);
  if (platform && own2 && platform.handsOff?.(call.name) && state.model.phase === "plan") {
    state.model = reduceRunPolicy(state.model, { type: "hand_off" });
  }
  try {
    const box = {};
    const exec = async (name, args, stepSignal) => {
      const run = stepSignal ?? signal;
      const extension = ports.extensions;
      if (extension?.handles(name)) {
        const ran = await extension.dispatch(name, args, run);
        if (ran.isError) box.failed = true;
        if (ran.control) box.control = ran.control;
        return ran.data;
      }
      if (platform && own2) {
        const result2 = await platform.execute(name, args, { ...run ? { signal: run } : {}, progress: { rungs: state.stall?.rungs ?? {} }, callId: call.id, step });
        box.failed = result2.isError === true;
        box.observedData = result2.observedData;
        if (result2.parts || result2.meta) box.native = { ...result2.parts ? { parts: result2.parts } : {}, ...result2.meta ? { meta: result2.meta } : {} };
        if (result2.cached) box.kind = "cached";
        else if (result2.neutral) box.kind = "neutral";
        if (result2.aborted) {
          box.killed = true;
          return signal?.aborted ? stoppedResult(result2.data) : interruptedResult(result2.data);
        }
        return result2.data;
      }
      if (!ports.capabilities) return { ok: false, error: "This run has no registry tool provider." };
      const result = await registryOf(ports).dispatch(name, args, { caps: ports.capabilities, ...run ? { signal: run } : {} });
      box.control = result.control;
      return extension?.shape ? extension.shape(name, result.data) : result.data;
    };
    const data = own2 && platform?.watchesItself ? await exec(call.name, call.args) : await runToolWithWatch(exec, watch, signal, call.name, call.args, own2 ? platform?.interruptible : void 0);
    const servingModel2 = facts.model && facts.model !== "default" ? facts.model : state.model.model;
    const surfaceCap = own2 ? platform?.resultCap?.(servingModel2) : void 0;
    const capped = capToolResult(call.name, data, surfaceCap ?? resultCapFor(call.name, ports.model, servingModel2, data));
    const failed3 = box.failed === true || !own2 && !!capped && capped.ok === false && capped.skipped !== true;
    const dispatched = { data: capped, ...box.control ? { control: box.control } : {}, ...failed3 ? { isError: true } : {} };
    if (box.kind) callKinds.set(dispatched, box.kind);
    if (state.specValidation && !box.killed) observedToolData.set(dispatched, box.observedData ?? data);
    if (box.native) nativeResults.set(dispatched, box.native);
    if (box.killed) killedResults.add(dispatched);
    return dispatched;
  } catch (err) {
    if (signal?.aborted || isResumable(input, err)) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    return { data: { ok: false, error: reason }, isError: true };
  }
}
async function declineMalformedCall(ports, call, facts, step) {
  const truncated = facts.interruption === "truncated";
  const policy = ports.platform?.malformed;
  const answered = await policy?.answer?.({ id: call.id, name: call.name, arguments: call.raw.arguments }, { step, truncated });
  if (answered) {
    facts.refused = true;
    return { data: answered.data, ...answered.isError ? { isError: true } : {} };
  }
  const outcome = malformedCallOutcome(call, truncated, truncated ? policy?.retryHint : void 0);
  facts.refused = true;
  policy?.refused?.({ name: call.name, arguments: call.raw.arguments }, truncated, outcome);
  return { data: outcome, isError: true };
}

// ../packages/agent-run/src/telemetry/outcomeRow.ts
function buildOutcomeRow(input) {
  const { state } = input;
  const tally = resumeTally(state.telemetry);
  const progress = state.guards?.progress;
  const preflight = state.preflight;
  const runCost = reportedRunCost(tally.costMc);
  const work = evaluateRunWork(state);
  return {
    entryPoint: input.entryPoint,
    ...input.runId ? { runId: input.runId } : {},
    ...input.parentRunId ? { parentRunId: input.parentRunId } : {},
    steps: state.step,
    toolCalls: tally.toolCalls,
    toolErrors: tally.toolErrors,
    compactions: state.compaction?.compactions ?? 0,
    stallRecoveries: state.stall?.recoveriesTotal ?? 0,
    escalations: state.guards?.escalations ?? 0,
    verify: tally.verify ?? "not-run",
    terminalStatus: input.kind,
    ...work ? { work } : {},
    ...state.pipeline ? { pipeline: state.pipeline } : {},
    ...tally.model ? { model: tally.model } : {},
    tokens: tally.tokens,
    cacheReadTokens: tally.cacheReadTokens,
    ...runCost !== void 0 ? { cost: runCost } : {},
    firstSpawnTurn: tally.firstSpawnTurn ?? null,
    coveredReadStubs: state.reads?.stubCount ?? 0,
    shellFileReads: tally.shellFileReads,
    repoErrors: tally.repoErrors,
    contextPackTokens: contextPackTokens(state),
    ...preflight ? { modelPreflight: preflight } : {},
    unkeptReadyClaims: progress?.unkeptTurns ?? 0,
    progressTrips: tripsBySignal(progress?.tripsBySignal),
    ...input.reason === RUN_CANCELLED_REASON ? { cancelled: true } : {},
    ...input.kind === "failed" && isRateLimitFailure(input.reason) ? { rateLimited: true } : {},
    // The tenant spent its own allowance: stored, and never taught to routing. Classified HERE, once, so every reporter that sends the row carries it.
    ...input.kind === "failed" && isTenantBudgetFailure(input.reason) ? { quotaExhausted: true } : {},
    ...isDegraded(state) ? { degraded: true } : {}
  };
}
function isDegraded(state) {
  return (state.degradedBy?.length ?? 0) > 0;
}
function tripsBySignal(bySignal) {
  const out = {};
  for (const [signal, n] of Object.entries(bySignal ?? {})) if (n) out[signal] = n;
  return out;
}
function contextPackTokens(state) {
  if (!state.context) return 0;
  const block = turnContextBlock(state.context, null);
  return block ? defaultEstimateTokens(block) : 0;
}

// ../packages/agent-run/src/runSettle.ts
async function settle(input, hooks, state, transcript, kind, extra) {
  return measureWorkflow(input.ports.events, workflowScope(input, state.step), "settle", () => settleCore(input, hooks, state, transcript, kind, extra), (result) => result.kind === "failed" ? result.reason === RUN_CANCELLED_REASON ? "cancelled" : "failed" : result.kind === "paused" ? "blocked" : "completed");
}
async function settleCore(input, hooks, state, transcript, kind, extra) {
  state.messages = transcript;
  const validation = state.specValidation;
  const checks = validation?.completed ?? [];
  const failedChecks = checks.filter((check) => check.exitCode !== 0).length;
  const unfinished = kind === "finished" ? hooks.finish.unfinishedWork(state) ?? (missingSpecEvidence(state) ? specUnverifiedReason(state) : null) ?? (failedChecks ? `PRD validation recorded ${failedChecks} failing acceptance check(s). See the run trace for their exit results.` : null) : null;
  if (unfinished) {
    kind = "failed";
    extra = { ...extra, reason: unfinished };
  }
  let cause = extra.cause;
  if ((kind === "finished" || kind === "failed") && cause === void 0) {
    try {
      const consolidated = await measureWorkflow(input.ports.events, { ...workflowScope(input, state.step), operation: "memory_consolidate" }, "settle", () => hooks.memory.consolidate(
        policyContext(input, state, currentView(transcript, []), state.step, 0),
        { learn: kind === "finished" }
      ));
      if (consolidated !== void 0 && input.ports.store.commitMemory) await measureWorkflow(input.ports.events, { ...workflowScope(input, state.step), operation: "memory_commit" }, "settle", () => input.ports.store.commitMemory(consolidated));
    } catch (err) {
      if (isResumable(input, err)) cause = err;
    }
  }
  const resumable = cause !== void 0;
  if ((kind === "finished" || kind === "failed") && !resumable && extra.reason !== RUN_CANCELLED_REASON && state.telemetry) {
    const recorded = hooks.verify.recorded?.(policyContext(input, state, currentView(transcript, []), state.step, 0));
    if (recorded !== void 0) tallyVerify(state.telemetry, recorded);
  }
  try {
    await measureWorkflow(input.ports.events, { ...workflowScope(input, state.step), operation: "store_save" }, "settle", () => input.ports.store.save(state));
  } catch {
  }
  if (kind === "yielded" || resumable) {
    return kind === "failed" || cause !== void 0 ? { kind: "failed", reason: extra.reason ?? (cause instanceof Error ? cause.message : "failed"), state, cause } : { kind: "yielded", state };
  }
  if (kind === "finished" || kind === "failed") {
    if (validation) {
      await emit(input.ports.events, {
        kind: "run.spec_validation",
        step: state.step,
        completed: checks.length,
        failed: failedChecks,
        pending: Object.keys(validation.pending ?? {}).length,
        unverified: unverifiedSpecCheckCount(state),
        incomplete: missingSpecEvidence(state)
      });
    }
    const row = measureWorkflowSync(input.ports.events, workflowScope(input, state.step), "grade", () => buildOutcomeRow({ entryPoint: input.policy.entryPoint, runId: input.task.runId, parentRunId: input.task.dispatch.parentRunId, kind, ...extra.reason !== void 0 ? { reason: extra.reason } : {}, state }), (row2) => ({ ...row2.work ?? { assigned: 0, done: 0, blocked: 0, inReview: 0, open: 0 } }));
    try {
      if (input.ports.events.outcome) await measureWorkflow(input.ports.events, workflowScope(input, state.step), "outcome", () => input.ports.events.outcome(row));
    } catch {
    }
    await emit(input.ports.events, { kind: "run.finished", step: state.step, outcome: kind });
  }
  if (kind === "finished") return { kind, output: extra.output ?? "", state };
  if (kind === "paused") return { kind, question: extra.question ?? "", approvalId: extra.approvalId ?? newApprovalId(state), state };
  return { kind, reason: extra.reason ?? "failed", state, ...extra.cause !== void 0 ? { cause: extra.cause } : {}, ...extra.exhausted ? { exhausted: true } : {}, ...extra.failureStreak !== void 0 ? { failureStreak: extra.failureStreak } : {} };
}

// ../packages/agent-run/src/kernelSteering.ts
function steeringTakers(run, contextAt) {
  const { input, hooks } = run;
  const { ports } = input;
  const stopsOn = (texts) => input.policy.stopWords !== false && isStopSteer(texts);
  const append = (...rows) => appendRows(input, run.transcript, ...rows);
  let afterFinish = [];
  const appendDirections = async (directions, step) => {
    append(...directions.map((item) => ({ role: "user", content: item.text, person: true, ...item.parts?.length ? { parts: item.parts } : {} })));
    for (const _item of directions) await emit(ports.events, { kind: "steer.applied", step });
  };
  const takeSteers = async (ctx) => {
    const steered = (await ports.steering?.drain({ step: ctx.step }) ?? []).map(steerInput);
    if (steered.length === 0) return "none";
    const texts = steered.map((s) => s.text);
    if (stopsOn(texts)) {
      run.stopped = true;
      return "stop";
    }
    const injected = await hooks.steering.inject(contextAt(ctx.step, ctx.stepInCall), texts);
    const rows = injected ?? texts.map((text) => ({ role: "user", content: text }));
    append(...rows.map((row, i) => ({ ...row, ...rows.length === steered.length && steered[i]?.parts?.length && !row.parts ? { parts: steered[i].parts } : {}, person: true })));
    for (let i = 0; i < steered.length; i += 1) await emit(ports.events, { kind: "steer.applied", step: ctx.step });
    return "applied";
  };
  const takeJoined = async (ctx) => {
    const steered = (await ports.steering?.drain({ step: ctx.step }) ?? []).map(steerInput);
    if (steered.length === 0) return "none";
    const texts = steered.map((s) => s.text);
    if (stopsOn(texts)) {
      run.stopped = true;
      return "stop";
    }
    for (let i = 0; i < steered.length; i += 1) await emit(ports.events, { kind: "steer.applied", step: ctx.step });
    return { text: texts.join("\n\n"), parts: steered.flatMap((s) => s.parts ?? []) };
  };
  const lateSteerNote = async (ctx) => {
    const steered = (await ports.steering?.drain({ step: ctx.step }) ?? []).map(steerInput);
    if (stopsOn(steered.map((item) => item.text))) {
      run.stopped = true;
      return null;
    }
    const followUps = steered.length || afterFinish.length ? [] : (await ports.steering?.followUp?.() ?? []).map(steerInput);
    afterFinish.push(...steered, ...followUps);
    return afterFinish.length ? { note: "The user sent more direction while you were finishing. Address the upcoming user messages before finishing." } : null;
  };
  const flushFinishDirections = async (step) => {
    if (!afterFinish.length || run.stopped) return;
    const pending = afterFinish;
    afterFinish = [];
    await appendDirections(pending, step);
  };
  const takeFollowUps = async (ctx) => {
    const followUps = (await ports.steering?.followUp?.() ?? []).map(steerInput);
    if (followUps.length === 0) return false;
    await appendDirections(followUps, ctx.step);
    return true;
  };
  return { takeSteers, takeJoined, lateSteerNote, takeFollowUps, flushFinishDirections };
}

// ../packages/agent-run/src/kernelNoTools.ts
function noToolCallsHook(run, deps) {
  const { input, hooks } = run;
  const { ports, policy } = input;
  const { append } = deps;
  const sentBack = async (step, content, kept = "block") => {
    await ports.delivery?.sentBack?.({ step, content, kept });
  };
  const requeue = async (pctx, step, said, note, kept = "block", parts = [], tell = true) => {
    if (tell) await sentBack(step, said, kept);
    const quoted = kept === "reply" && ports.delivery?.owns?.settle && hooks.stall.settle ? hooks.stall.settle(pctx, said) : said;
    if (quoted.trim() || ports.delivery?.stall?.quoteEmpty) append({ role: "assistant", content: quoted, ...run.turnNative });
    append({ role: "user", content: note, ...parts.length > 0 ? { parts: [...parts] } : {} });
  };
  return async (ctx, turn) => {
    const pctx = deps.contextAt(ctx.step, ctx.stepInCall);
    pctx.content = turn.content;
    pctx.served = { ...run.facts.model ? { model: run.facts.model } : {}, ...run.facts.interruption ? { interruption: run.facts.interruption } : {} };
    const judged = ports.delivery?.judged?.(turn.content);
    if (judged !== void 0) pctx.judged = judged;
    if (ports.delivery?.stall?.menu && run.selection?.tools) pctx.tools = [...run.selection.tools];
    const finalTurn = run.selection?.final === true;
    if (finalTurn) pctx.tools = [];
    const finishing = hooks.guards.isFinishing?.(pctx) === true;
    if (finishing) pctx.finishing = true;
    const steersFirst = ports.delivery?.stall?.steersFirst === true;
    if (steersFirst) {
      const steered = await deps.takeJoined(ctx);
      if (steered === "stop") return { action: "stop", ok: false, output: "cancelled", finished: true };
      if (steered !== "none") {
        await requeue(pctx, ctx.step, turn.content, steered.text, "block", steered.parts);
        return { action: "continue" };
      }
    }
    const children = await hooks.finish.liveChildren?.(pctx);
    if (children) {
      await requeue(pctx, ctx.step, turn.content, children);
      return { action: "continue" };
    }
    const stalled2 = run.watch.hasInterrupt() || finalTurn ? void 0 : await (hooks.stall.recoverAsync ? hooks.stall.recoverAsync(pctx) : hooks.stall.recover(pctx));
    if (stalled2?.action === "steer" || stalled2?.action === "escalate") await sentBack(ctx.step, turn.content, stalled2.action === "escalate" ? "reply" : "block");
    else if (stalled2?.action === "pause" && policy.stallExhausted === "settle") await sentBack(ctx.step, turn.content, "settled");
    if (stalled2) await emit(ports.events, { kind: "stall.recovered", step: ctx.step, action: stalled2.action, ...stalled2.note ? { note: stalled2.note } : {}, ...stalled2.detail ? { detail: stalled2.detail } : {} });
    if (stalled2 && stalled2.action === "pause") {
      const notice = stalled2.note ?? "paused";
      if (policy.stallExhausted === "finish") return { action: "finish", output: turn.content.trim() ? `${turn.content}

${notice}` : notice };
      if (policy.stallExhausted === "settle") {
        const settled = hooks.stall.settle ? hooks.stall.settle(pctx, turn.content) : turn.content;
        if (settled.trim()) append({ role: "assistant", content: settled, ...run.turnNative });
        return { action: "finish", output: settled };
      }
      if (policy.stallExhausted === "note") await requeue(pctx, ctx.step, turn.content, notice);
      return { action: "stop", ok: false, output: notice, finished: true };
    }
    if (stalled2 && stalled2.action === "fail") {
      return { action: "stop", ok: false, output: stalled2.note ?? "failed", finished: true };
    }
    if (stalled2 && stalled2.action === "settle") {
      const answer = stalled2.note ?? "";
      if (answer.trim()) append({ role: "assistant", content: answer });
      return { action: "finish", output: answer };
    }
    if (stalled2) {
      const kept = stalled2.action === "escalate" ? "reply" : "block";
      if (stalled2.rows) append(...stalled2.rows);
      else await requeue(pctx, ctx.step, turn.content, stalled2.note ?? "Continue: do the work, do not describe it.", kept, [], false);
      return { action: "continue" };
    }
    const owed = hooks.finish.settleBlock(pctx);
    if (owed) await emit(ports.events, { kind: "finish.blocked", step: ctx.step, reason: "review_verdict_missing", block: owed, detail: { ...policy.signoff } });
    const block = owed ?? hooks.subagents.backstop(pctx);
    if (block) {
      await requeue(pctx, ctx.step, turn.content, block);
      return { action: "continue" };
    }
    if (missingSpecEvidence(pctx.state) && (finalTurn || pctx.state.specValidation?.prompted)) {
      return { action: "stop", ok: false, output: specUnverifiedReason(pctx.state), finished: true };
    }
    const verification = finalTurn ? null : await deps.verifyBlock(pctx);
    if (verification) {
      await emit(ports.events, { kind: "finish.blocked", step: ctx.step, reason: "verify", block: verification });
      await requeue(pctx, ctx.step, turn.content, verification);
      return { action: "continue" };
    }
    const open = finalTurn ? null : await hooks.finish.openWork?.(pctx);
    if (open) {
      await emit(ports.events, { kind: "finish.blocked", step: ctx.step, reason: LINKED_WORK_OPEN, block: open });
      await requeue(pctx, ctx.step, turn.content, open);
      return { action: "continue" };
    }
    const output = hooks.stall.settle ? hooks.stall.settle(pctx, turn.content) : turn.content;
    if (steersFirst) {
      const late2 = await deps.takeJoined(ctx);
      if (late2 === "stop") return { action: "stop", ok: false, output: "cancelled", finished: true };
      if (late2 !== "none") {
        await requeue(pctx, ctx.step, turn.content, late2.text, "block", late2.parts);
        return { action: "continue" };
      }
    }
    if (output.trim()) append({ role: "assistant", content: output, ...run.turnNative });
    const late = await deps.takeSteers(ctx);
    if (late === "stop") return { action: "stop", ok: false, output: "cancelled", finished: true };
    if (late === "applied") {
      await sentBack(ctx.step, turn.content);
      return { action: "continue" };
    }
    if (await deps.takeFollowUps(ctx)) {
      await sentBack(ctx.step, turn.content);
      return { action: "continue" };
    }
    if (finalTurn || finishing) await ports.delivery?.finalAccepted?.({ step: ctx.step, content: turn.content });
    return { action: "finish", output };
  };
}

// ../packages/agent-run/src/kernelHooks.ts
var MUTATING_TOOLS = /* @__PURE__ */ new Set(["write_file", "edit_file", "delete_file"]);
function isMutationCall(name, args) {
  if (MUTATING_TOOLS.has(name)) return true;
  return !isReadOnlyShellCall(name, args);
}
var ASK_TOOLS = /* @__PURE__ */ new Set(["ask_human", "ask_user"]);
function asLoopControl(control) {
  return control;
}
function optionsOf(control) {
  const options = control.options;
  return Array.isArray(options) ? options.filter((o) => typeof o === "string") : void 0;
}
function rewriteRow(row, data, verbatim) {
  row.content = verbatim && typeof data === "string" ? data : JSON.stringify(data ?? null);
}
function kernelHooks(run) {
  const { input, state, hooks, transcript, offered, tally } = run;
  const { ports, policy } = input;
  const contextAt = (step, turn) => policyContext(input, state, currentView(transcript, offered), step, turn);
  const append = (...rows) => appendRows(input, transcript, ...rows);
  const verifyBlock = async (pctx) => {
    const validation = specValidationRetry(state);
    if (validation) return validation;
    if (policy.verify === "none") return null;
    const verdict = await hooks.verify.verify(pctx);
    if (verdict && verdict.ran !== false) tallyVerify(tally, verdict.ok);
    return verdict && !verdict.ok ? verdict.note ?? "Verification failed: fix it before finishing." : null;
  };
  const stubs = /* @__PURE__ */ new WeakSet();
  const held = /* @__PURE__ */ new WeakSet();
  const starts = /* @__PURE__ */ new Map();
  const { takeSteers, takeJoined, lateSteerNote, takeFollowUps, flushFinishDirections } = steeringTakers(run, contextAt);
  return {
    beforeTurn: async (ctx) => {
      const verdict = run.budget?.beforeTurn();
      if (verdict?.kind === "contain") {
        append({ role: "assistant", content: verdict.text });
        await emit(ports.events, { kind: "budget.contained", step: ctx.step, spentMc: verdict.spentMc, capMc: verdict.capMc, unpricedCalls: verdict.unpricedCalls, text: verdict.text });
        return { action: "stop", ok: true, finished: true, output: verdict.text };
      }
      if (verdict?.kind === "warn") {
        const tail = volatileTail([verdict.text]);
        if (tail) append({ role: tail.role, content: String(tail.content) });
        await emit(ports.events, { kind: "budget.warning", step: ctx.step, spentMc: verdict.spentMc, capMc: verdict.capMc, unpricedCalls: verdict.unpricedCalls, text: verdict.text });
      }
      if (await takeSteers(ctx) === "stop") return { action: "stop", ok: false, output: RUN_CANCELLED_REASON, finished: true };
      const base = currentView(transcript, offered);
      const selectNow = async () => hooks.tools.select(policyContext(input, state, base, ctx.step, ctx.stepInCall), offered);
      const forced = run.selection?.retried === true && run.selection.forced ? run.selection.forced : await hooks.guards.forcedTurn?.(policyContext(input, state, base, ctx.step, ctx.stepInCall), { select: async () => await selectNow() ?? offered, cache: run.cache });
      const surfaceMenu = await ports.platform?.turn?.({
        step: ctx.step,
        select: async () => forced ? forced.selected : await selectNow() ?? offered,
        progress: { rungs: state.stall?.rungs ?? {} },
        cache: run.cache,
        ...forced?.menu ? { forced: forced.menu } : {}
      });
      const menu = surfaceMenu ?? forced?.menu;
      const finalBy = finalSource(menu, () => hooks.guards.finalTurn?.(policyContext(input, state, base, ctx.step, ctx.stepInCall)) === true);
      const finalTurn = finalBy !== void 0;
      const advertised = finalTurn ? [] : (menu?.tools ?? forced?.selected ?? await selectNow())?.filter((schema) => !blocksChildSpawn(input.task.dispatch, schema.function.name));
      run.selection = {
        tools: advertised,
        ...forced ? { forced } : {},
        ...menu?.toolChoice && !finalTurn ? { toolChoice: menu.toolChoice } : {},
        ...menu?.tail && menu.tail.length > 0 ? { tail: menu.tail } : {},
        ...finalBy ? { final: true, finalBy } : {}
      };
      const view = advertised ? { ...base, tools: [...advertised] } : base;
      const compacted = await hooks.compaction.compact(policyContext(input, state, view, ctx.step, ctx.stepInCall));
      if (compacted) {
        applyCompaction(state, view, compacted, ctx.step);
        await emit(ports.events, {
          kind: "context.compacted",
          step: ctx.step,
          dropped: compacted.dropped,
          ...compacted.beforeTokens !== void 0 ? { beforeTokens: compacted.beforeTokens } : {},
          ...compacted.afterTokens !== void 0 ? { afterTokens: compacted.afterTokens } : {},
          ...compacted.summarized !== void 0 ? { summarized: compacted.summarized } : {},
          ...compacted.masked ? { masked: compacted.masked } : {},
          ...compacted.note ? { note: compacted.note } : {},
          ...compacted.covered !== void 0 ? { covered: compacted.covered } : {}
        });
      }
      run.facts.model = void 0;
      run.facts.interruption = void 0;
      await emit(ports.events, { kind: "turn.started", step: ctx.step });
      return void 0;
    },
    afterTurn: async (ctx, turn) => {
      run.turnContent = turn.content ?? "";
      run.turnNative = nativeOfTurn(turn.meta);
      const meta = turn.meta && typeof turn.meta === "object" ? turn.meta : void 0;
      const model = meta ? meta.model : tally.model;
      const usage = meta?.usage;
      run.facts.model = meta?.model;
      run.facts.interruption = meta?.interrupted;
      if (run.selection?.finalBy === "guards") hooks.guards.finalTurnDone?.(contextAt(ctx.step, ctx.stepInCall));
      tallyTurn(tally, model, usage);
      if (run.budget?.afterTurn(usage)) await emit(ports.events, { kind: "budget.unpriced", step: ctx.step, ...model ? { model } : {} });
      await emit(ports.events, { kind: "model.completed", step: ctx.step, ...model ? { model } : {}, ...usage ? { usage } : {} });
    },
    onNoToolCalls: noToolCallsHook(run, { contextAt, append, takeSteers, takeJoined, takeFollowUps, verifyBlock }),
    onRepetitionLoop: async (ctx, loop) => {
      await emit(ports.events, { kind: "loop.repetition", step: ctx.step, copies: loop.copies, block: loop.block });
    },
    beforeToolCalls: (_ctx, turn, calls) => {
      const output = ports.extensions?.terminalTurn?.({ content: turn.content ?? "" }, calls.map((c) => ({ name: c.name, args: c.args, malformed: c.malformed })));
      return output === void 0 ? void 0 : { action: "stop", ok: true, output, finished: true };
    },
    beforeDispatch: async (call, ctx) => {
      starts.set(call.id, Date.now());
      if (blocksChildSpawn(input.task.dispatch, call.name)) {
        return { result: { data: { ok: false, error: CHILD_SPAWN_REFUSAL }, isError: true } };
      }
      const pctx = contextAt(ctx.step, ctx.stepInCall);
      const pcall = toPolicyCall(call);
      const scope = workflowScope(input, ctx.step);
      const gated = hooks.tools.gate && await measureWorkflow(
        ports.events,
        { ...scope, operation: "governance_check" },
        "dispatch",
        () => hooks.tools.gate(pctx, pcall),
        (result) => result ? "blocked" : "completed",
        input.signal
      );
      if (gated) {
        const refused = { data: gated.data, isError: true, ...gated.control ? { control: asLoopControl(gated.control) } : {} };
        if (gated.control) held.add(refused);
        return { result: refused };
      }
      const decision = hooks.guards.beforeDispatch && await measureWorkflow(
        ports.events,
        { ...scope, operation: "guard_check" },
        "dispatch",
        () => hooks.guards.beforeDispatch(pctx, pcall),
        (result) => result?.skip ? "blocked" : "completed",
        input.signal
      );
      if (decision?.skip) {
        const { data, isError, control } = decision.skip;
        const skipped2 = { data, isError: isError ?? true, ...control ? { control: asLoopControl(control) } : {} };
        if (control) held.add(skipped2);
        return { result: skipped2 };
      }
      if (ASK_TOOLS.has(call.name)) {
        const note = hooks.subagents.backstop(pctx);
        if (note) return { result: { data: { ok: false, error: note }, isError: true } };
      }
      const meta = hooks.tools.meta?.(pctx, pcall);
      if (meta) return { result: { data: meta.data } };
      const covered = hooks.tools.beforeDispatch?.(pctx, pcall);
      if (covered) {
        const stub = { data: covered.data };
        stubs.add(stub);
        run.cache.served(ctx.step);
        return { result: stub };
      }
      const platform = ports.platform;
      if (platform?.preflight && ownsCall(ports, call.name)) {
        const pre = await measureWorkflow(
          ports.events,
          { ...scope, operation: "platform_preflight" },
          "dispatch",
          () => platform.preflight({ id: call.id, name: call.name, args: call.args, arguments: call.raw.arguments, malformed: call.malformed }, { step: ctx.step }),
          (result) => result && "result" in result && result.result.isError ? "blocked" : "completed",
          input.signal
        );
        if (pre && "result" in pre) return { result: { data: pre.result.data, ...pre.result.isError ? { isError: true } : {} } };
        if (pre && "rewrite" in pre) {
          const { name, args } = pre.rewrite;
          return { rewrite: { ...call, name, args, raw: { ...call.raw, name, arguments: JSON.stringify(args) } } };
        }
      }
      return void 0;
    },
    onFinish: async (ctx, summary, call) => {
      const pctx = contextAt(ctx.step, ctx.stepInCall);
      pctx.content = summary;
      pctx.toolCalls = [toPolicyCall(call)];
      const verifyRefused = await verifyBlock(pctx);
      const gated = verifyRefused ?? await hooks.finish.gate(pctx);
      const reason = verifyRefused ? "verify" : lastFinishReason(state);
      const judged = hooks.guards.finish ? await hooks.guards.finish(pctx, { block: gated, reason }) : gated;
      const block = judged ?? hooks.subagents.backstop(pctx);
      if (block) {
        const openWorkHold = gated != null && block === gated && reason === LINKED_WORK_OPEN;
        if (!openWorkHold) state.finish = { ...state.finish, finishBlockedOnce: true };
        return block;
      }
      return lateSteerNote(ctx);
    },
    onAskHuman: async (ctx, control) => {
      if (control.parked) return void 0;
      const answer = await hooks.ask.answer(contextAt(ctx.step, ctx.stepInCall), control.question, optionsOf(control));
      if (answer.kind === "answered") return { data: { ok: true, answer: answer.answer } };
      return void 0;
    },
    afterDispatch: async (call, result, message, ctx) => {
      const stub = stubs.has(result) || held.has(result);
      const kind = callKinds.get(result);
      if (!stub) {
        if (kind === "cached") run.cache.served(ctx.step);
        else if (kind !== "neutral") run.cache.ran();
      }
      const ok = !result.isError && !(result.data && typeof result.data === "object" && result.data.ok === false);
      if (!stub) {
        tallyCall(tally, ctx.step, call.name, call.args, result.data, ok);
        if (ok && isMutationCall(call.name, call.args)) bumpMutations(tally);
        const canonical = resolveToolAlias(call.name);
        if (ok && (MUTATING_TOOLS.has(canonical) || canonical === "run_command" && !isReadOnlyShellCall(canonical, call.args))) {
          state.finish.ciVerified = false;
          delete tally.verify;
        }
        await emit(ports.events, { kind: "tool.dispatched", step: ctx.step, tool: call.name, ok, callId: call.id, args: call.args, result: result.data }, { durationMs: Date.now() - (starts.get(call.id) ?? Date.now()) });
        starts.delete(call.id);
      }
      const pctx = contextAt(ctx.step, ctx.stepInCall);
      const pcall = toPolicyCall(call);
      let data = result.data;
      const noted = await hooks.guards.observe(pctx, pcall, data, result.isError === true);
      if (noted) data = noted.data;
      const nudged = hooks.subagents.nudge(pctx, pcall, data);
      if (nudged) data = nudged.data;
      if (data !== result.data) rewriteRow(message, data, message.parts !== void 0 || ports.platform?.verbatimText === true);
      if (!stub) {
        hooks.tools.observe?.(pctx, pcall, data, result.isError === true);
        if (!kind) {
          hooks.verify.observe?.(pctx, pcall, result.data, message.meta, ok);
          if (state.specValidation) observeSpecCheck(state, { ...pcall, name: resolveToolAlias(pcall.name) }, observedToolData.get(result), message.meta?.details, ok);
        }
        if (!ownsCall(ports, call.name)) await hooks.memory.observe?.(pctx, pcall, result.data, result.isError);
        rememberWrite(state, call, ok);
      }
      if (held.has(result) && result.control?.parked) {
        return { skipRemaining: { data: { ok: false, skipped: true, error: "Not run: the run is parked on an approval." }, isError: false } };
      }
      return steerSkip(run.watch);
    },
    afterToolCalls: async (ctx) => {
      await flushFinishDirections(ctx.step);
      const pctx = contextAt(ctx.step, ctx.stepInCall);
      await hooks.guards.endTurn?.(pctx, run.turnContent);
      hooks.stall.acted?.(pctx);
      await ports.platform?.turnEnded?.({ step: ctx.step });
      if (run.facts.refused) {
        run.facts.refused = false;
        const directive = ports.platform?.malformed?.roundDirective(run.facts.interruption === "truncated");
        if (directive) append({ role: "system", content: directive });
      }
      await emit(ports.events, { kind: "turn.finished", step: ctx.step });
      return void 0;
    }
  };
}
function finalSource(menu, guardsFinal) {
  if (menu?.final === true) return "surface";
  if (menu?.toolChoice === "required") return void 0;
  return guardsFinal() ? "guards" : void 0;
}
function readOnlyPort(run) {
  const guards = run.hooks.guards;
  if (!guards.isReadOnly) return void 0;
  return (call) => guards.isReadOnly?.(policyContext(run.input, run.state, currentView(run.transcript, run.offered), run.state.step, 0), call.name) ?? false;
}

// ../packages/agent-run/src/telemetry/workflowHooks.ts
function workflowHooks(hooks, input) {
  const finish = hooks.finish;
  return { ...hooks, finish: {
    ...finish,
    settleBlock: (ctx) => measureWorkflowSync(input.ports.events, workflowScope(input, ctx.step), "finish", () => finish.settleBlock(ctx), void 0, (block) => block ? "blocked" : "completed"),
    gate: (ctx) => measureWorkflow(input.ports.events, workflowScope(input, ctx.step), "finish", () => finish.gate(ctx), (block) => block ? "blocked" : "completed"),
    ...finish.openWork ? { openWork: (ctx) => measureWorkflow(input.ports.events, workflowScope(input, ctx.step), "ledger", () => finish.openWork(ctx), (block) => block ? "blocked" : "completed", input.signal, () => ({ ...evaluateRunWork(ctx.state) ?? { assigned: 0, done: 0, blocked: 0, inReview: 0, open: 0 } })) } : {},
    ...finish.liveChildren ? { liveChildren: (ctx) => measureWorkflow(input.ports.events, workflowScope(input, ctx.step), "finish", () => finish.liveChildren(ctx), (block) => block ? "blocked" : "completed") } : {}
  } };
}

// ../packages/agent-run/src/policy/budget/usd.ts
var usd = (millicents) => `$${(millicents / MILLICENTS_PER_USD).toFixed(2)}`;
function runBudgetCapMillicents(maxRunBudgetUsd) {
  return typeof maxRunBudgetUsd === "number" && Number.isFinite(maxRunBudgetUsd) && maxRunBudgetUsd > 0 ? Math.round(maxRunBudgetUsd * MILLICENTS_PER_USD) : null;
}
function noPriceNote(unpricedCalls) {
  return unpricedCalls > 0 ? `${unpricedCalls} ${unpricedCalls === 1 ? "call" : "calls"} had no known price` : null;
}
function budgetWarning(spentMc, capMc, unpricedCalls = 0) {
  const note = noPriceNote(unpricedCalls);
  const spent = note ? `at least ${usd(spentMc)} (${note})` : usd(spentMc);
  return `[Run budget] This run has spent ${spent} of its ${usd(capMc)} budget \u2014 over 80%. Stop exploring and converge: finish the essential change now, then answer with what you did and exactly what is left.`;
}
function budgetContainedReply(spentMc, capMc, unpricedCalls = 0) {
  const note = noPriceNote(unpricedCalls);
  const spent = note ? `at least ${usd(spentMc)} spent \u2014 ${note}` : `${usd(spentMc)} spent`;
  return `Run stopped: it reached its ${usd(capMc)} spend budget (${spent}). Nothing was rolled back \u2014 the changes made so far are in place. Ask to continue to resume from here, or raise the "builderforce.maxRunBudgetUsd" setting (0 turns the cap off).`;
}
function localSpendMeter() {
  let spent = 0;
  let unpriced = 0;
  return {
    spentMc: () => spent,
    unpricedCalls: () => unpriced,
    add: (pricedMc) => {
      if (pricedMc === void 0) unpriced += 1;
      else spent += pricedMc;
    }
  };
}
function usdBudget(usdCap, meter) {
  const own2 = runBudgetCapMillicents(usdCap);
  if (own2 == null) return void 0;
  const inherited = meter.capMc?.();
  const capMc = inherited !== void 0 ? Math.min(own2, inherited) : own2;
  const caps = { maxSpendMillicents: capMc };
  let warned = false;
  let unpricedSaid = false;
  return {
    beforeTurn() {
      const spentMc = meter.spentMc();
      const unpricedCalls = meter.unpricedCalls();
      const usage = { spendMillicents: spentMc };
      if (runBudgetBreach(caps, usage)) return { kind: "contain", text: budgetContainedReply(spentMc, capMc, unpricedCalls), spentMc, capMc, unpricedCalls };
      if (!warned && runBudgetWarnDue(caps, usage)) {
        warned = true;
        return { kind: "warn", text: budgetWarning(spentMc, capMc, unpricedCalls), spentMc, capMc, unpricedCalls };
      }
      return void 0;
    },
    afterTurn(usage) {
      const priced = usage?.pricedMc;
      meter.add(priced);
      if (priced !== void 0 || unpricedSaid) return false;
      unpricedSaid = true;
      return true;
    }
  };
}

// ../packages/agent-run/src/policy/tools/cacheServedStreak.ts
var CACHE_SERVED_STREAK = 6;
var MIN_STREAK_TURNS = 2;
var MAX_NO_PROGRESS_TURNS = 2;
var CacheServedStreak = class {
  streak;
  turns;
  fired;
  constructor(saved) {
    this.streak = saved?.streak ?? 0;
    this.turns = new Set(saved?.turns ?? []);
    this.fired = saved?.fired ?? 0;
  }
  /** A repeat the read cache answered (stub, covered window, replay, repeated write), on `step`. */
  served(step) {
    this.streak += 1;
    this.turns.add(step);
  }
  /** A call the host actually ran - the run touched the world again. */
  ran() {
    this.streak = 0;
    this.turns.clear();
  }
  get count() {
    return this.streak;
  }
  /** Whether the streak is due a forced turn. */
  due() {
    return this.streak >= CACHE_SERVED_STREAK && this.turns.size >= MIN_STREAK_TURNS && this.fired < MAX_NO_PROGRESS_TURNS;
  }
  /** A forced turn was spent on the streak: the count starts over. */
  consume() {
    this.ran();
    this.fired += 1;
  }
  /** The counter as plain data. */
  state() {
    return { streak: this.streak, turns: [...this.turns], fired: this.fired };
  }
};

// ../packages/agent-run/src/runAgent.ts
async function runAgent(input) {
  const { task, policy, ports, signal } = input;
  const hooks = workflowHooks(composePolicyHooks(input.modules), input);
  const state = input.resume ? resumeState(input.resume, policy) : freshState(policy);
  const resumed = Boolean(input.resume);
  const validation = state.specValidation ?? planSpecValidation(task);
  if (validation) state.specValidation = validation;
  if (state.pipeline === void 0 && input.pipeline !== void 0) state.pipeline = input.pipeline;
  if (!state.work && !resumed) measureWorkflowSync(ports.events, workflowScope(input, state.step), "work", () => {
    if (task.assignedWork?.length) state.work = planWork(task.assignedWork);
    return state.work ?? [];
  }, (work) => ({ assigned: work.length, criteria: work.reduce((n, item) => n + item.criteria.length, 0) }));
  const tally = state.telemetry ??= freshTally();
  const offered = offeredSchemas(ports, { rungs: state.stall?.rungs ?? {} }).filter((schema) => !blocksChildSpawn(task.dispatch, schema.function.name));
  const transcript = asMessages(state.messages);
  let pack = state.context ?? EMPTY_PACK2;
  if (!resumed) {
    const opening = measureWorkflowSync(ports.events, workflowScope(input, state.step), "opening", () => openingRows(task, policy.approvalGates), (rows) => ({ messages: rows.length }));
    transcript.splice(0, transcript.length, ...opening);
    state.messages = transcript;
    pack = await measureWorkflow(ports.events, { ...workflowScope(input, state.step), operation: "context_pack" }, "opening", () => buildContextPack(input, hooks, state, offered), void 0, input.signal);
    state.context = pack;
  }
  ports.attach?.({
    policy: () => state.model,
    report: (event) => state.model = reduceRunPolicy(state.model, event),
    ask: (hasTools) => turnRouting(state.model, hasTools)
  });
  if (!resumed) {
    await emit(ports.events, { kind: "run.started", step: state.step });
    if (pack.answer && !state.work?.length && !state.specValidation) {
      appendRows(input, transcript, { role: "assistant", content: pack.answer });
      state.messages = transcript;
      return settle(input, hooks, state, transcript, "finished", { output: pack.answer });
    }
    const preflight = await hooks.model.preflight?.(policyContext(input, state, currentView(transcript, offered), state.step, 0));
    if (preflight) await emit(ports.events, preflight);
    const seeded = await hooks.guards.seed?.(policyContext(input, state, currentView(transcript, offered), state.step, 0));
    if (seeded) state.model = seeded;
  }
  const budget = usdBudget(policy.budgets.usd, ports.spend ?? localSpendMeter());
  const run = {
    input,
    state,
    hooks,
    transcript,
    offered,
    tally,
    watch: portInterruptWatch(ports.steering),
    turnContent: "",
    stopped: false,
    facts: { refused: false },
    cache: input.cacheStreak ?? new CacheServedStreak(state.reads.servedStreak),
    ...budget ? { budget } : {}
  };
  const isReadOnly = readOnlyPort(run);
  let loopResult;
  const kernelDone = beginWorkflowStage(ports.events, workflowScope(input, state.step), "kernel");
  try {
    loopResult = await runAgentLoop({
      messages: transcript,
      // The kernel pushes rows in the agent's own shape — the SAME shape a requeue, an
      // answered ask and a steer push — so a saved and resumed transcript reads exactly
      // like a continuous one.
      codec: {
        assistant: (turn) => announceRow(input, {
          role: "assistant",
          content: turn.content ?? "",
          toolCalls: turn.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
          ...nativeOfTurn(turn.meta)
        }),
        tool: (call, result) => announceRow(input, toolRow(call.id, result, ports.platform?.verbatimText === true))
      },
      ports: {
        complete: (ctx) => completeTurn(input, state, hooks, ctx, offered, transcript, pack, run.selection),
        dispatch: (call, ctx) => dispatchCall(input, state, call, run.watch, run.facts, ctx.step),
        ...isReadOnly ? { isReadOnly } : {}
      },
      hooks: kernelHooks(run),
      budget: { startStep: state.step, ...input.maxSteps !== void 0 ? { maxSteps: input.maxSteps } : {}, ...policy.budgets.steps !== void 0 ? { stepCap: policy.budgets.steps } : {} },
      ...signal ? { signal } : {}
    });
    kernelDone(loopResult.cancelled || signal?.aborted ? "cancelled" : loopResult.finished && !loopResult.ok ? "failed" : "completed", { steps: loopResult.step - state.step, toolCalls: tally.toolCalls, toolErrors: tally.toolErrors, tokens: tally.tokens });
  } catch (err) {
    kernelDone(signal?.aborted ? "cancelled" : "failed");
    const reason = err instanceof Error ? err.message : String(err);
    return settle(input, hooks, state, transcript, "failed", { reason, ...signal?.aborted || !isResumable(input, err) ? {} : { cause: err } });
  }
  state.step = loopResult.step;
  state.messages = transcript;
  state.reads = { ...state.reads, servedStreak: run.cache.state() };
  if (run.stopped || loopResult.cancelled || signal?.aborted) {
    return settle(input, hooks, state, transcript, "failed", { reason: RUN_CANCELLED_REASON });
  }
  if (loopResult.awaitingInput) {
    const approvalId = loopResult.awaitingInput.approvalId ?? newApprovalId(state);
    state.askedGates = [...state.askedGates, approvalId];
    return settle(input, hooks, state, transcript, "paused", { question: loopResult.awaitingInput.question, approvalId });
  }
  if (loopResult.exhausted || loopResult.finished && loopResult.ok && !loopResult.output.trim()) {
    let output;
    try {
      output = await synthesizeFinal(input, state, hooks, transcript, pack, tally, loopResult.exhausted && loopResult.exhaustedBy === "failures" ? { failureStreak: loopResult.failureStreak } : {});
    } catch (err) {
      return settle(input, hooks, state, transcript, "failed", { reason: err instanceof Error ? err.message : String(err), ...isResumable(input, err) ? { cause: err } : {} });
    }
    if (output) return settle(input, hooks, state, transcript, "finished", { output });
  }
  if (loopResult.exhausted) {
    return settle(input, hooks, state, transcript, "failed", { reason: loopResult.exhaustedBy === "failures" ? "tool calls kept failing" : "step budget spent", exhausted: true, ...loopResult.exhaustedBy === "failures" ? { failureStreak: loopResult.failureStreak } : {} });
  }
  if (!loopResult.finished) {
    return settle(input, hooks, state, transcript, "yielded", {});
  }
  if (!loopResult.ok) {
    const cause = causeOf(state);
    return settle(input, hooks, state, transcript, "failed", { reason: loopResult.output || "the run stopped", ...cause !== void 0 ? { cause } : {} });
  }
  return settle(input, hooks, state, transcript, "finished", { output: loopResult.output });
}

// ../packages/agent-run/src/policy/guards/shipGate.ts
function withShipGate(guards, gate) {
  if (!gate) return guards;
  return {
    ...guards,
    beforeDispatch: async (ctx, call) => {
      const verdict = publishAllowed(gate.policy, call.name, call.args, gate.host ?? "cloud");
      if (!verdict.ok) {
        await gate.onRefused?.(call.name, verdict.error);
        return { skip: { data: { ok: false, error: verdict.error }, isError: true } };
      }
      return guards.beforeDispatch?.(ctx, call);
    }
  };
}

// ../packages/workload/src/actionClassifier.ts
var MIN_CONFIDENCE = 0.45;
var INSTRUCTION_CHARS = 600;
var CONTEXT_CHARS = 2e3;
var CONTEXT_WEIGHT = 0.5;
var sig = (source, weight = 1) => ({
  re: new RegExp(source, "i"),
  weight
});
var SIGNALS = [
  [
    "data_migration",
    [
      sig("\\bbackfill(ing|ed)?\\b", 2),
      sig("\\bdata migration\\b", 2),
      sig("\\bre-?index(ing)?\\b"),
      sig("\\bmigrate .{0,20}\\bdata\\b", 2),
      sig("\\bseed (the )?(database|table|data)\\b", 2),
      sig("\\betl\\b", 2)
    ]
  ],
  [
    "sql",
    [
      sig("\\bsql\\b", 2),
      sig("\\bquery\\b"),
      sig("\\bschema\\b"),
      sig("\\bmigration\\b"),
      sig("\\bpostgres|postgresql|sqlite|mysql\\b", 2),
      sig("\\bcreate table|alter table|drop table\\b", 2),
      sig("\\bindex(es)? on\\b"),
      sig("\\bforeign key|primary key\\b", 2)
    ]
  ],
  [
    "tests",
    [
      sig("\\bunit test|integration test|e2e test\\b", 2),
      sig("\\btests?\\b"),
      sig("\\bvitest|jest|pytest|playwright|mocha\\b", 2),
      sig("\\btest coverage\\b", 2),
      sig("\\bassert(ion)?s?\\b"),
      sig("\\bspec file\\b", 2)
    ]
  ],
  [
    "docs",
    [
      sig("\\bdocument(ation)?\\b", 2),
      sig("\\breadme\\b", 2),
      sig("\\bchangelog\\b", 2),
      sig("\\bdocstring|jsdoc|tsdoc\\b", 2),
      sig("\\bwrite .{0,20}\\bguide\\b", 2),
      sig("\\bcomment(s|ing)?\\b")
    ]
  ],
  [
    "devops_ci",
    [
      sig("\\bci\\b|\\bcd\\b", 2),
      sig("\\bgithub actions?|gitlab ci|jenkins|circleci\\b", 2),
      sig("\\bdocker(file)?|kubernetes|k8s|helm\\b", 2),
      sig("\\bdeploy(ment|ing)?\\b"),
      sig("\\bpipeline\\b"),
      sig("\\bbuild (script|config|failure)\\b", 2),
      sig("\\bterraform|ansible\\b", 2)
    ]
  ],
  [
    "provisioning",
    [
      sig("\\bprovision(ing|ed)?\\b", 2),
      sig("\\bspin up\\b", 2),
      sig("\\bcreate (a|an|the) (bucket|cluster|queue|instance|database|namespace)\\b", 2),
      sig("\\bdns|certificate|tls cert\\b"),
      sig("\\bconfigure .{0,20}\\b(account|tenant|workspace|environment)\\b")
    ]
  ],
  [
    "frontend_ui",
    [
      sig("\\bui\\b|\\bux\\b", 2),
      sig("\\bcomponent\\b"),
      sig("\\breact|vue|svelte|angular\\b", 2),
      sig("\\bcss|tailwind|stylesheet|styling\\b", 2),
      sig("\\bbutton|modal|dropdown|layout|page\\b"),
      sig("\\bresponsive|dark mode|accessib(le|ility)\\b", 2),
      sig("\\bfront-?end\\b", 2)
    ]
  ],
  [
    "backend_api",
    [
      sig("\\bapi\\b", 2),
      sig("\\bendpoint|route handler\\b", 2),
      sig("\\brest|graphql|grpc\\b", 2),
      sig("\\bback-?end\\b", 2),
      sig("\\bservice layer|controller|middleware\\b", 2),
      sig("\\bserver\\b"),
      sig("\\bauth(entication|orization)?\\b")
    ]
  ],
  [
    "refactor",
    [
      sig("\\brefactor(ing|ed)?\\b", 2),
      sig("\\bclean ?up\\b", 2),
      sig("\\bextract (a |the )?(function|method|component|module|helper)\\b", 2),
      sig("\\brename\\b"),
      sig("\\bdeduplicat|\\bdry\\b", 2),
      sig("\\brestructure|reorganis|reorganiz\\b", 2),
      sig("\\bsimplify\\b")
    ]
  ],
  [
    "bugfix",
    [
      sig("\\bbug\\b", 2),
      sig("\\bfix(es|ed|ing)?\\b", 2),
      sig("\\bbroken|crash(es|ing)?|regression\\b", 2),
      sig("\\berror\\b"),
      sig("\\bstack ?trace|exception\\b", 2),
      sig("\\bnot working|fails? to\\b", 2),
      sig("\\bdebug(ging)?\\b")
    ]
  ],
  [
    "analysis",
    [
      sig("\\banalys|analyz\\b", 2),
      sig("\\binvestigate|investigation\\b", 2),
      sig("\\bresearch\\b", 2),
      sig("\\bexplain|summaris|summariz\\b"),
      sig("\\bwhy (does|is|did|are)\\b", 2),
      sig("\\baudit|assess(ment)?\\b", 2),
      sig("\\bcompare\\b")
    ]
  ],
  [
    "decision",
    [
      sig("\\bapprove|approval\\b", 2),
      sig("\\bshould we\\b", 2),
      sig("\\bdecide|decision\\b", 2),
      sig("\\bsign ?off\\b", 2),
      sig("\\bchoose between\\b", 2)
    ]
  ]
];
function classifyRunAction(prompt) {
  const text = (prompt ?? "").trim();
  if (!text) {
    return { actionType: DEFAULT_ACTION_TYPE, confidence: 0 };
  }
  const { ask, context: pasted } = classifyRequest(text);
  const paragraphBreak = ask.indexOf("\n\n");
  const instructionEnd = paragraphBreak > 0 ? Math.min(paragraphBreak, INSTRUCTION_CHARS) : INSTRUCTION_CHARS;
  const instruction = ask.slice(0, instructionEnd);
  const context = (ask.slice(instructionEnd) + (pasted ? `
${pasted}` : "")).slice(0, CONTEXT_CHARS);
  let total = 0;
  let best = null;
  for (const [actionType, signals] of SIGNALS) {
    let score2 = 0;
    for (const s of signals) {
      if (s.re.test(instruction)) {
        score2 += s.weight;
      } else if (context && s.re.test(context)) {
        score2 += s.weight * CONTEXT_WEIGHT;
      }
    }
    total += score2;
    if (score2 > 0 && (best === null || score2 > best.score)) {
      best = { actionType, score: score2 };
    }
  }
  if (!best || total === 0) {
    return { actionType: DEFAULT_ACTION_TYPE, confidence: 0 };
  }
  const confidence = best.score / total;
  if (confidence < MIN_CONFIDENCE) {
    return { actionType: DEFAULT_ACTION_TYPE, confidence };
  }
  return { actionType: best.actionType, confidence };
}

// ../packages/workload/src/arcStage.ts
var ARC_STAGES = ["idea", "make", "run", "measure", "reach"];
var ARC_STAGE_SET = new Set(ARC_STAGES);
function isArcStage(value) {
  return typeof value === "string" && ARC_STAGE_SET.has(value);
}

// ../packages/workload/src/profile.ts
var TYPICAL_OUTPUT_TOKENS = {
  code: 4e3,
  plan: 1500,
  review: 1200,
  verify: 800,
  explore: 1e3,
  chat: 800,
  utility: 400
};
var DEFAULT_OUTPUT_TOKENS = 1e3;
var nonNegative = (n) => typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.ceil(n) : void 0;
function profileWorkload(input) {
  const role = isModelRole(input.role) ? input.role : void 0;
  const { actionType, confidence } = classifyRunAction(input.instruction);
  const cap2 = nonNegative(input.maxOutputTokens);
  const typical = role ? TYPICAL_OUTPUT_TOKENS[role] : DEFAULT_OUTPUT_TOKENS;
  return {
    role,
    arcStage: isArcStage(input.arcStage) ? input.arcStage : void 0,
    actionType,
    actionConfidence: confidence,
    inputTokens: nonNegative(input.inputTokens) ?? 0,
    outputTokens: cap2 !== void 0 ? Math.min(cap2, typical) : typical,
    agentic: input.hasTools === true
  };
}

// ../packages/workload/src/tokens.ts
var CHARS_PER_TOKEN = 4;
function estimateTokensFromChars(charCount) {
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

// ../packages/agent-run/src/route/routeRun.ts
function defaultPipelineRouting() {
  return { mode: "always" };
}
function decideRunPipeline(route) {
  if (!route.routing) return null;
  const { actionType } = classifyRunAction(route.request);
  return scorePipeline(pipelineFeaturesOf(route.request, { actionType, followUp: route.followUp === true }), {
    mode: route.routing.mode,
    ...route.routing.threshold !== void 0 ? { threshold: route.routing.threshold } : {}
  });
}
function pipelinePolicyOptions(route, pipeline) {
  const quick = pipeline?.route === "quick";
  const startPhase = quick ? "code" : "plan";
  const phaseModels = { ...route.phaseModels };
  const quickModel = route.routing?.quickModel?.trim();
  if (quick && quickModel) phaseModels.code = quickModel;
  return {
    startPhase,
    ...Object.keys(phaseModels).length ? { phaseModels } : {},
    ...quick && quickModel && !route.modelStrict ? { pinnedModel: quickModel } : {}
  };
}
function skipsVerifyStage(pipeline) {
  return pipeline?.route === "quick";
}
function routeRun(route) {
  const pipeline = decideRunPipeline(route);
  return { pipeline, start: pipelinePolicyOptions(route, pipeline), skipsVerify: skipsVerifyStage(pipeline) };
}

// ../packages/agent-run/src/openRun.ts
async function runCloseOut(closeOut, ctx, mode) {
  try {
    await measureWorkflow(ctx.ports.events, { runId: ctx.task.runId, entryPoint: ctx.policy.entryPoint, step: ctx.step, operation: "close_out" }, "finish", () => closeOut(ctx, mode));
  } catch (err) {
    await emit(ctx.ports.events, { kind: "finish.close_out_error", step: ctx.step, reason: err instanceof Error ? err.message : String(err) });
  }
}
function withCloseOut(finish, closeOut, ran) {
  return {
    ...finish,
    async openWork(ctx) {
      ran.value = true;
      await runCloseOut(closeOut, ctx, "finish");
      return finish.openWork?.(ctx) ?? null;
    },
    async gate(ctx) {
      ran.value = true;
      await runCloseOut(closeOut, ctx, "finish");
      return finish.gate(ctx);
    }
  };
}
function composeModules(surface, ran) {
  const modules = {};
  if (surface.finish || surface.closeOut) {
    const finish = createFinishHook(surface.finish);
    modules.finish = surface.closeOut ? withCloseOut(finish, surface.closeOut, ran) : finish;
  }
  if (surface.guards || surface.publishGate) modules.guards = withShipGate(createGuardsHook(surface.guards), surface.publishGate);
  if (surface.verify) modules.verify = createVerifyHook(surface.verify);
  if (surface.compaction) modules.compaction = createCompactionHook(surface.compaction);
  if (surface.preflight) modules.model = createModelHook({ recordedPreflight: surface.preflight });
  return modules;
}
function routedPolicy(policy, route, decision) {
  const { pipeline, start, skipsVerify } = decision;
  const prior = policy.modelStart;
  const folded = skipsVerify ? { ...policy, skipVerifyStage: true } : policy;
  if (!prior) {
    if (!pipeline) return folded;
    return {
      ...folded,
      ...start.pinnedModel ? { pinnedModel: start.pinnedModel } : {},
      modelOptions: { ...policy.modelOptions, startPhase: start.startPhase, ...start.phaseModels ? { phaseModels: start.phaseModels } : {} }
    };
  }
  if (!pipeline) {
    return start.phaseModels ? { ...folded, modelStart: { ...prior, phaseModels: start.phaseModels } } : folded;
  }
  const model = start.pinnedModel ?? prior.model;
  return {
    ...folded,
    modelStart: {
      ...prior,
      ...model ? { model } : {},
      ...route.modelStrict !== void 0 ? { strict: route.modelStrict } : {},
      ...start.startPhase && !prior.delegatedRole ? { startPhase: start.startPhase } : {},
      ...start.phaseModels ? { phaseModels: start.phaseModels } : {}
    }
  };
}
async function openRun(input) {
  measureWorkflowSync(input.ports.events, workflowScope(input), "start", () => {
    if (!input.policy?.entryPoint) throw new Error("openRun: policy.entryPoint is required");
    if (!ALL_ENTRY_POINTS.includes(input.policy.entryPoint)) throw new Error("openRun: policy.entryPoint must be registered");
    if (!input.ports.capabilities && !input.ports.platform?.closed) {
      throw new Error("openRun: a registry provider or a closed native catalog is required");
    }
  });
  const { surface = {}, route: requested, ...rest } = input;
  const route = requested && "decided" in requested ? requested : {
    request: rest.task.request ?? rest.task.prompt,
    modelStrict: rest.policy.modelStart?.strict ?? rest.policy.modelOptions?.strictPin,
    ...requested,
    routing: requested?.routing ?? defaultPipelineRouting()
  };
  const closeOutRan = { value: false };
  let run = { ...rest, modules: measureWorkflowSync(rest.ports.events, workflowScope(input), "compose", () => composeModules(surface, closeOutRan)) };
  if (run.resume?.pipeline !== void 0) {
    if (run.resume.pipeline?.route === "quick") run = { ...run, policy: { ...run.policy, skipVerifyStage: true } };
  } else {
    const input2 = "decided" in route ? route.input : route;
    const decision = "decided" in route ? route.decided : measureWorkflowSync(run.ports.events, workflowScope(run), "route", () => routeRun(route), (r) => ({ quick: Number(r.pipeline?.route === "quick"), full: Number(r.pipeline?.route === "full") }));
    run = { ...run, policy: routedPolicy(run.policy, input2, decision) };
    const { pipeline } = decision;
    run.pipeline = pipeline ? { route: pipeline.route, score: pipeline.score } : null;
    if (pipeline && !run.resume) {
      let said = false;
      run = {
        ...run,
        ports: {
          ...run.ports,
          events: tapEvents(run.ports.events, {
            after: async (event, sink) => {
              if (said || event.kind !== "run.started") return;
              said = true;
              await sink?.emit({ kind: "run.routed", step: event.step, route: pipeline.route, score: pipeline.score });
            }
          })
        }
      };
    }
  }
  const outcome = await runAgent(run);
  const stoppedByUser = outcome.kind === "failed" && outcome.reason === RUN_CANCELLED_REASON;
  const settledUnfinished = outcome.kind === "paused" || outcome.kind === "failed" && !stoppedByUser;
  if (surface.closeOut && settledUnfinished && !closeOutRan.value) {
    closeOutRan.value = true;
    await runCloseOut(surface.closeOut, policyContext(run, outcome.state, currentView([], []), outcome.state.step, 0), "settled");
  }
  return outcome;
}

// ../packages/agent-run/src/telemetry/runOutcomeRequest.ts
function outcomeSourceOf(entryPoint2) {
  switch (entryPoint2) {
    case "on-prem":
      return "onprem";
    case "vscode":
      return "ide";
    case "canvas":
      return "canvas";
    case "cloud":
      return "cloud";
    default:
      return "external";
  }
}
function outcomeTerminalStatus(row, stopped = false) {
  if (stopped || row.cancelled) return "cancelled";
  return row.terminalStatus === "finished" ? "completed" : "failed";
}
function runOutcomeRequestOf(row, scope) {
  const model = row.model?.trim();
  if (!model || !scope.clientRunId.trim()) return null;
  return {
    ...parseRunOutcomeTelemetry({ ...row, ...scope.parentClientRunId ? { parentRunId: scope.parentClientRunId } : {} }),
    ...wireCost(row),
    clientRunId: scope.clientRunId,
    model,
    source: outcomeSourceOf(row.entryPoint),
    terminalStatus: outcomeTerminalStatus(row, scope.stopped),
    steps: Math.max(0, Math.floor(row.steps)),
    // The row says the TENANT ran out of quota (`buildOutcomeRow` classified it once): the door stores it and never teaches it.
    ...row.quotaExhausted ? { quotaExhausted: true } : {},
    // Availability and degradation are kept beside the score, never folded into it: a throttled model is demoted without being called
    // bad, and a run served off its model does not earn full credit.
    ...row.rateLimited ? { rateLimited: true } : {},
    ...row.degraded ? { degraded: true } : {},
    ...scope.projectId != null ? { projectId: scope.projectId } : {},
    ...scope.taskId != null ? { taskId: scope.taskId } : {},
    ...scope.actionType ? { actionType: scope.actionType } : {},
    ...scope.routingSignal === false || !workSupportsRoutingSample(row.work, row.terminalStatus === "finished") ? { routingSignal: false } : {}
  };
}

// src/runActivity.ts
var TARGET_KEYS = ["path", "file", "filePath", "command", "cmd", "glob", "query", "q", "search", "url", "name", "title", "id"];
var MAX_DETAIL = 72;
function shortenTarget(value, max = MAX_DETAIL) {
  const v = value.replace(/\s+/g, " ").trim();
  if (v.length <= max) return v;
  if (v.includes("/") || v.includes("\\")) return `\u2026${v.slice(v.length - (max - 1))}`;
  return `${v.slice(0, max - 1)}\u2026`;
}
function activityTarget(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return void 0;
  const record5 = args;
  for (const key of TARGET_KEYS) {
    const value = record5[key];
    if (typeof value === "string" && value.trim()) return shortenTarget(value);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  if (Array.isArray(record5.paths)) {
    const names = record5.paths.filter((p) => typeof p === "string" && p.trim() !== "");
    if (names.length) return shortenTarget(names.join(", "));
  }
  return void 0;
}
var QUESTION_KEYS = ["query", "q", "search", "pattern", "glob", "key"];
var VISIT_QUESTION_SEPARATOR = " \u220B ";
function visitTarget(args) {
  const scope = activityTarget(args);
  if (!scope) return void 0;
  const record5 = args;
  for (const key of QUESTION_KEYS) {
    const value = record5[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const question = shortenTarget(value);
    return question === scope ? scope : `${scope}${VISIT_QUESTION_SEPARATOR}${question}`;
  }
  return scope;
}
function toolActivity(label, args, step, startedAt) {
  const detail = activityTarget(args);
  return { phase: "tool", label, startedAt, step, ...detail ? { detail } : {} };
}
var BETWEEN_TURNS_LABEL = "between-turns";
var CONTEXT_FOLD_LABEL = "context-fold";
function betweenTurnsActivity(step, startedAt) {
  return { phase: "thinking", label: BETWEEN_TURNS_LABEL, startedAt, step };
}
function contextFoldActivity(step, startedAt) {
  return { phase: "thinking", label: CONTEXT_FOLD_LABEL, startedAt, step };
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  return bytes < 1024 ? `${Math.round(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
function elapsedText(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 6e4) return `${Math.round(ms / 1e3)}s`;
  return `${Math.floor(ms / 6e4)}m ${Math.round(ms % 6e4 / 1e3)}s`;
}
function describeLiveStep(step, capturedAtMs) {
  const elapsed = elapsedText(Number.isFinite(capturedAtMs) ? capturedAtMs - step.startedAt : 0);
  const what = step.phase === "tool" ? `running \`${step.label}\`${step.detail ? ` on ${step.detail}` : ""}` : step.phase === "awaiting" ? `PAUSED waiting for the user to approve \`${step.label}\` \u2014 nothing advances until they answer` : step.phase === "composing" ? `composing a \`${step.label || "tool"}\` call${step.bytes != null ? ` \u2014 ${formatBytes(step.bytes)} of arguments so far` : ""}` : step.phase === "thinking" && step.label === BETWEEN_TURNS_LABEL ? "preparing the next model turn after the last tool returned (guards, steering, tool menu, context fold)" : step.phase === "thinking" && step.label === CONTEXT_FOLD_LABEL ? "waiting on the model for the context-fold summary" : step.phase === "thinking" ? "waiting on the model (no token received yet)" : step.phase === "writing" ? "streaming the reply" : step.phase === "finishing" ? "doing post-run work (ticket capture / status reconciliation)" : "starting up";
  return `${what} (${elapsed} so far${step.step > 0 ? `, loop step ${step.step}` : ""})`;
}
function midRunNotice(activity, capturedAtMs) {
  const doing = activity ? ` At capture it was ${describeLiveStep(activity, capturedAtMs)}.` : " No in-flight step was recorded at capture.";
  return `\u26A0 CAPTURED MID-RUN \u2014 the agent was STILL EXECUTING when this report was taken.${doing} Anything below that reads as "it never did X" may simply be work it had not reached yet; re-copy once the run settles to get a verdict on a finished run.`;
}

// src/modelScorecard.ts
var SILENT_TURNS_AT = 3;
function modelOf(ev) {
  const m = ev.args?.model;
  return typeof m === "string" && m && m !== "default" ? m : null;
}
function modelScorecard(events) {
  const byModel = /* @__PURE__ */ new Map();
  const row = (model) => {
    let score2 = byModel.get(model);
    if (!score2) {
      score2 = {
        model,
        turns: 0,
        toolCalls: 0,
        textOnlyTurns: 0,
        unliftedMarkupTurns: 0,
        failures: 0,
        stopped: 0,
        upstreamReportedTurns: 0,
        upstreamFunctionCalls: 0,
        upstreamRecovered: 0,
        adapterLossTurns: 0
      };
      byModel.set(model, score2);
    }
    return score2;
  };
  for (const ev of events) {
    if (ev.label === STOPPED_TURN_STEP) {
      const model2 = modelOf(ev);
      if (model2) row(model2).stopped += 1;
      continue;
    }
    if (ev.label !== "llm.complete") continue;
    const model = modelOf(ev);
    if (!model) continue;
    if (ev.category === "error") {
      row(model).failures += 1;
      continue;
    }
    if (ev.category !== "llm") continue;
    const score2 = row(model);
    const args = ev.args;
    const calls = typeof args?.toolCalls === "number" ? args.toolCalls : 0;
    score2.turns += 1;
    score2.toolCalls += calls;
    if (calls === 0 && (ev.textChars ?? 0) > 0) score2.textOnlyTurns += 1;
    if (args?.unliftedCallMarkup === true) score2.unliftedMarkupTurns += 1;
    if (typeof args?.upstreamFunctionCalls === "number") {
      score2.upstreamReportedTurns += 1;
      score2.upstreamFunctionCalls += args.upstreamFunctionCalls;
      if (typeof args.upstreamRecovered === "number") score2.upstreamRecovered += args.upstreamRecovered;
      if (args.upstreamFunctionCalls > calls) score2.adapterLossTurns += 1;
    }
  }
  return [...byModel.values()];
}
function silentModelFlag(s) {
  const base = " \xB7 \u26A0 made NO tool calls while another model in this run did";
  if (s.upstreamReportedTurns > 0 && s.upstreamFunctionCalls === 0) {
    return `${base}. Its raw responses carried 0 structured function calls on the ${s.upstreamReportedTurns} turn(s) its vendor reported, so the MODEL did not call \u2014 nothing was lost on the way.`;
  }
  return `${base}: this model is not emitting structured calls on its route.`;
}
function formatModelScorecard(scores) {
  const markup = scores.some((s) => s.unliftedMarkupTurns > 0);
  const stopped = scores.some((s) => s.stopped > 0);
  const lost = scores.some((s) => s.adapterLossTurns > 0);
  if (scores.length < 2 && !markup && !stopped && !lost) return [];
  const anyActed = scores.some((s) => s.toolCalls > 0);
  const lines = ["Per model:"];
  for (const s of scores) {
    const parts = [`${s.turns} turn(s)`, `${s.toolCalls} tool call(s)`];
    if (s.textOnlyTurns) parts.push(`${s.textOnlyTurns} text-only`);
    if (s.upstreamReportedTurns) {
      parts.push(`raw response: ${s.upstreamFunctionCalls} structured call(s) over ${s.upstreamReportedTurns} reported turn(s)`);
    }
    if (s.upstreamRecovered) parts.push(`${s.upstreamRecovered} rebuilt from the final frame`);
    if (s.failures) parts.push(`${s.failures} failed`);
    if (s.stopped) parts.push(`${s.stopped} stopped by the user mid-stream`);
    const flag = s.unliftedMarkupTurns ? ` \xB7 \u26A0 ${s.unliftedMarkupTurns} turn(s) wrote a tool call as MARKUP that no parser lifted, so the call never ran. The model tried to act; this is a parser gap, not a refusal.` : s.adapterLossTurns ? ` \xB7 \u26A0 on ${s.adapterLossTurns} turn(s) the vendor returned structured tool calls that never reached the loop: the calls were lost in translation, so this is an adapter defect, not the model.` : scores.length > 1 && anyActed && s.toolCalls === 0 && s.turns >= SILENT_TURNS_AT ? silentModelFlag(s) : "";
    lines.push(`  \u2022 ${s.model}: ${parts.join(" \xB7 ")}${flag}`);
  }
  return lines;
}
function modelTurnLog(events) {
  const turns = [];
  for (const ev of events) {
    if (ev.label !== "llm.complete") continue;
    const model = modelOf(ev);
    if (!model) continue;
    const args = ev.args;
    const requested = typeof args?.requestedModel === "string" && args.requestedModel && args.requestedModel !== "default" && args.requestedModel !== model ? args.requestedModel : void 0;
    if (ev.category === "error") {
      turns.push({
        index: turns.length + 1,
        model,
        ...requested ? { requestedModel: requested } : {},
        toolCalls: 0,
        textOnly: false,
        failed: true,
        ...typeof ev.durationMs === "number" ? { durationMs: ev.durationMs } : {}
      });
      continue;
    }
    if (ev.category !== "llm") continue;
    const calls = typeof args?.toolCalls === "number" ? args.toolCalls : 0;
    const turn = {
      index: turns.length + 1,
      model,
      ...requested ? { requestedModel: requested } : {},
      toolCalls: calls,
      textOnly: calls === 0 && (ev.textChars ?? 0) > 0,
      // What the turn SPENT its time producing. Absent on traces that predate the
      // accounting, so an old chat's log renders exactly as it used to.
      ...typeof args?.argBytes === "number" && args.argBytes > 0 ? { argBytes: args.argBytes } : {},
      ...typeof ev.usage?.completion === "number" && ev.usage.completion > 0 ? { completionTokens: ev.usage.completion } : {},
      ...typeof ev.durationMs === "number" ? { durationMs: ev.durationMs } : {},
      ...args?.unliftedCallMarkup === true ? { unliftedCallMarkup: true } : {},
      ...typeof args?.role === "string" ? { role: args.role } : {},
      ...typeof args?.failovers === "string" && args.failovers ? { failovers: args.failovers } : {}
    };
    if (typeof args?.upstreamFunctionCalls === "number") {
      turn.upstreamFunctionCalls = args.upstreamFunctionCalls;
      if (typeof args.upstreamRecovered === "number") turn.upstreamRecovered = args.upstreamRecovered;
    }
    turns.push(turn);
  }
  return turns;
}
function formatOneTurn(t) {
  const model = t.requestedModel ? `${t.model} (requested ${t.requestedModel})` : t.model;
  const role = t.role ? `[${t.role}] ` : "";
  const parts = [];
  if (t.failed) {
    parts.push("FAILED");
  } else {
    parts.push(`${t.toolCalls} tool call(s)`);
    if (t.textOnly) parts.push("text-only");
  }
  if (typeof t.upstreamFunctionCalls === "number") {
    parts.push(`raw response: ${t.upstreamFunctionCalls} structured call(s)`);
  }
  if (t.upstreamRecovered) parts.push(`${t.upstreamRecovered} rebuilt from the final frame`);
  if (t.unliftedCallMarkup) parts.push("\u26A0 unlifted call markup");
  if (t.argBytes) parts.push(`${formatBytes(t.argBytes)} of arguments`);
  if (t.completionTokens) parts.push(`${t.completionTokens.toLocaleString("en-US")} completion tok`);
  if (typeof t.durationMs === "number") parts.push(`${t.durationMs}ms`);
  if (t.failovers) parts.push(`gateway left: ${t.failovers}`);
  return `  ${t.index}. ${role}${model} \xB7 ${parts.join(" \xB7 ")}`;
}
function formatModelTurnLog(turns) {
  if (!turns.length) return [];
  return ["Turn log:", ...turns.map(formatOneTurn)];
}

// src/shipVerification.ts
var BASE_BRANCHES = /* @__PURE__ */ new Set(["main", "master"]);
function parseGitShortStatus(output) {
  if (!output) return null;
  const header = output.split("\n").map((l) => l.trim()).find((l) => l.startsWith("##"));
  if (!header) return null;
  const body = header.slice(2).trim();
  if (!body || body.startsWith("HEAD (no branch)")) return { branch: null, upstream: null, ahead: 0, behind: 0 };
  const ahead = /\bahead (\d+)/.exec(body);
  const behind = /\bbehind (\d+)/.exec(body);
  const names = body.replace(/\s*\[.*$/, "").trim();
  const [branch, upstream] = names.split("...");
  return {
    branch: branch?.trim() || null,
    upstream: upstream?.trim() || null,
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0
  };
}
var GIT_PUSH = gitCommandPattern("push");
var GIT_STATUS_CMD = gitCommandPattern("status");
function commandOf(ev) {
  const a = ev.args;
  if (typeof a?.command === "string") return a.command;
  if (typeof a?.cmd === "string") return a.cmd;
  return "";
}
function outputOf(ev) {
  const r = ev.result;
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    const o = r;
    if (typeof o.output === "string") return o.output;
    if (typeof o.stdout === "string") return o.stdout;
  }
  return "";
}
function succeeded6(ev) {
  return !ev.isError && !isFailedToolResult(ev.result);
}
function isPush(ev) {
  return ev.label === "git_push" || GIT_PUSH.test(commandOf(ev));
}
function dirtyPathsOf(output) {
  const out = [];
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.length < 4 || line.startsWith("##")) continue;
    let path = line.slice(3);
    const arrow = path.indexOf(" -> ");
    if (arrow >= 0) path = path.slice(arrow + 4);
    path = path.trim().replace(/^"(.*)"$/, "$1");
    if (path) out.push(path);
  }
  return out;
}
function touchedStillDirty(touched, dirty) {
  const norm2 = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const d = dirty.map(norm2);
  return touched.map(norm2).some((t) => d.some((p) => t === p || t.endsWith(`/${p}`)));
}
var DEFAULT_BRANCH_CMD = gitCommandPattern("remote|symbolic-ref|branch");
function defaultBranchFromTrace(steps) {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const ev = steps[i];
    if (!succeeded6(ev) || !DEFAULT_BRANCH_CMD.test(commandOf(ev))) continue;
    const out = outputOf(ev);
    const m = /HEAD branch:\s*(\S+)/.exec(out) ?? /origin\/HEAD\s*->\s*origin\/(\S+)/.exec(out) ?? /^\s*refs\/remotes\/origin\/(\S+)\s*$/m.exec(out);
    if (m?.[1] && m[1] !== "HEAD" && m[1] !== "(unknown)") return m[1];
  }
  return null;
}
async function onBaseBranch(git, touchedFiles, deltaTicketId) {
  if (!git?.onBaseBranch || !touchedFiles.length || deltaTicketId == null) return false;
  try {
    return await git.onBaseBranch("", touchedFiles);
  } catch {
    return false;
  }
}
function shippedToBaseBranch(events, opts) {
  const steps = events.filter((e) => e.category === "tool");
  const defaultBranch = opts?.defaultBranch?.trim() || defaultBranchFromTrace(steps);
  const isBase = (branch) => BASE_BRANCHES.has(branch) || branch === defaultBranch;
  let pushedAt = -1;
  for (let i = 0; i < steps.length; i += 1) {
    if (succeeded6(steps[i]) && isPush(steps[i])) pushedAt = i;
  }
  if (pushedAt < 0) return false;
  const touched = opts?.touchedFiles ?? [];
  for (let i = pushedAt; i < steps.length; i += 1) {
    const ev = steps[i];
    if (!succeeded6(ev)) continue;
    const isStatus = i === pushedAt || ev.label === "git_status" || GIT_STATUS_CMD.test(commandOf(ev));
    if (!isStatus) continue;
    const output = outputOf(ev);
    const status = parseGitShortStatus(output);
    if (!status) continue;
    if (!(status.branch && isBase(status.branch) && status.upstream && status.ahead === 0)) continue;
    if (touched.length > 0 && touchedStillDirty(touched, dirtyPathsOf(output))) continue;
    return true;
  }
  return false;
}

// src/chatActivity.ts
var PHASES = ["started", "completed", "failed", "paused", "resumed", "cancelled"];
function isPhase(v) {
  return typeof v === "string" && PHASES.includes(v);
}
function str4(v) {
  return typeof v === "string" && v.trim() ? v : void 0;
}
function parseChatActivity(msg) {
  if (!msg.metadata) return null;
  let meta;
  try {
    const parsed = JSON.parse(msg.metadata);
    if (!parsed || typeof parsed !== "object") return null;
    meta = parsed;
  } catch {
    return null;
  }
  const ticketKind = str4(meta.ticketKind) ?? "task";
  const ticketRef = str4(meta.ticketRef) ?? "";
  const agentName = str4(meta.agentName) ?? str4(meta.agentRef) ?? "";
  if (meta.runMilestone != null && isPhase(meta.phase)) {
    return {
      kind: "milestone",
      phase: meta.phase,
      agentName,
      ticketKind,
      ticketRef,
      executionId: typeof meta.executionId === "number" ? meta.executionId : null,
      ...str4(meta.toStatus) ? { toStatus: str4(meta.toStatus) } : {},
      ...str4(meta.note) ? { note: str4(meta.note) } : {},
      ...str4(meta.question) ? { question: str4(meta.question) } : {}
    };
  }
  if (meta.agentDispatch === true) {
    return { kind: "dispatch", agentName, ticketKind, ticketRef };
  }
  return null;
}
function isActivityMessage(msg) {
  return parseChatActivity(msg) !== null;
}
function activityMessageCount(messages) {
  let n = 0;
  for (const m of messages) if (isActivityMessage(m)) n += 1;
  return n;
}
var DEFAULT_CHAT_ACTIVITY_LABELS = {
  milestoneStarted: "{agent} started working on {kind} #{ref}",
  milestoneCompleted: "{agent} finished {kind} #{ref}",
  milestoneCompletedWithLane: "{agent} finished {kind} #{ref} \u2014 moved to {lane}",
  milestoneFailed: "{agent}\u2019s run on {kind} #{ref} failed",
  milestonePaused: "{agent} paused on {kind} #{ref} \u2014 waiting on a human answer",
  milestonePausedWithQuestion: "{agent} paused on {kind} #{ref} \u2014 needs an answer: {question}",
  milestoneResumed: "{agent} resumed work on {kind} #{ref}",
  milestoneCancelled: "{agent}\u2019s run on {kind} #{ref} was cancelled",
  agentDispatched: "{agent} was assigned to {kind} #{ref}"
};
function activityIcon(activity) {
  if (activity.kind === "dispatch") return "\u{1F464}";
  switch (activity.phase) {
    case "started":
      return "\u25B6";
    case "completed":
      return "\u2713";
    case "failed":
      return "!";
    case "paused":
      return "?";
    case "resumed":
      return "\u25B6";
    case "cancelled":
      return "\u25A0";
    default:
      return "\u2022";
  }
}
function activityTone(activity) {
  if (activity.kind === "dispatch") return "neutral";
  if (activity.phase === "completed") return "good";
  if (activity.phase === "failed") return "bad";
  if (activity.phase === "paused") return "waiting";
  return "neutral";
}
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}
function chatActivityText(activity, labels) {
  const base = { agent: activity.agentName, kind: activity.ticketKind, ref: activity.ticketRef };
  if (activity.kind === "dispatch") return fill(labels.agentDispatched, base);
  switch (activity.phase) {
    case "started":
      return fill(labels.milestoneStarted, base);
    case "completed":
      return activity.toStatus ? fill(labels.milestoneCompletedWithLane, { ...base, lane: activity.toStatus }) : fill(labels.milestoneCompleted, base);
    case "failed":
      return fill(labels.milestoneFailed, base);
    case "paused":
      return activity.question ? fill(labels.milestonePausedWithQuestion, { ...base, question: activity.question }) : fill(labels.milestonePaused, base);
    case "resumed":
      return fill(labels.milestoneResumed, base);
    case "cancelled":
      return fill(labels.milestoneCancelled, base);
    default:
      return "";
  }
}

// src/modelReply.ts
import { isConsolidationMarker } from "@seanhogg/builderforce-memory/working";
function isModelReply(m) {
  return m.role === "assistant" && !isStepMessage(m) && !isConsolidationMarker(m) && !isActivityMessage(m) && !isStoppedBeforeStart(m);
}

// src/persistedSteps.ts
function stepSig(category, label, tsIso) {
  return `${category}|${label}|${tsIso ?? ""}`;
}
function parseStepMessage(metadata) {
  if (!metadata) return null;
  try {
    const m = JSON.parse(metadata);
    if (m.kind !== "step" || typeof m.category !== "string") return null;
    return {
      step: {
        category: m.category,
        label: typeof m.label === "string" ? m.label : m.category,
        args: m.args,
        result: m.result,
        isError: m.isError,
        durationMs: m.durationMs,
        resultBytes: m.resultBytes,
        truncated: m.truncated,
        usage: m.usage,
        finishReason: m.finishReason,
        textChars: m.textChars,
        ttftMs: m.ttftMs
      },
      tsIso: typeof m.ts === "string" ? m.ts : void 0
    };
  } catch {
    return null;
  }
}
function traceWithPersistedSteps(messages, trace) {
  const seen = /* @__PURE__ */ new Set();
  for (const ev of trace) seen.add(stepSig(ev.category, ev.label, ev.ts));
  const fromMessages = [];
  for (const message of messages) {
    if (!isStepMessage(message)) continue;
    const parsed = parseStepMessage(message.metadata);
    if (!parsed) continue;
    const sig2 = stepSig(parsed.step.category, parsed.step.label, parsed.tsIso);
    if (seen.has(sig2)) continue;
    seen.add(sig2);
    const s = parsed.step;
    fromMessages.push({
      ts: parsed.tsIso ?? message.createdAt ?? "",
      recovered: true,
      category: s.category,
      label: s.label,
      args: s.args,
      result: s.result,
      ...s.isError ? { isError: true } : {},
      ...s.durationMs != null ? { durationMs: s.durationMs } : {},
      ...s.ttftMs != null ? { ttftMs: s.ttftMs } : {},
      ...s.resultBytes != null ? { resultBytes: s.resultBytes } : {},
      ...s.truncated ? { truncated: true } : {},
      ...s.usage ? { usage: s.usage } : {},
      ...s.finishReason !== void 0 ? { finishReason: s.finishReason } : {},
      ...s.textChars != null ? { textChars: s.textChars } : {}
    });
  }
  if (fromMessages.length === 0) return trace;
  return [...trace, ...fromMessages].sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
}

// src/localWorkspaceTools.ts
var LOCAL_WORKSPACE_TOOLS = /* @__PURE__ */ new Set([
  "read_file",
  "list_files",
  "search_code",
  // Code navigation over the definition index. Pinned for the reason the file tools are,
  // and more acutely: "where is the auth middleware?" shares no stem with "find_symbol",
  // so relevance drops the one call that answers it and the run falls back to searching
  // and paging through files — the pattern these two tools exist to replace.
  "find_symbol",
  "file_outline",
  // The semantic index (Builderforce Desktop). Pinned for the same reason and more so:
  // its whole purpose is the question phrased in words — "how do refunds reach the
  // ledger?" — which is exactly the turn whose text shares no stem with the tool name.
  // Inert where the host does not advertise them (desktop app not running, web Brain).
  "semantic_search",
  "repo_map",
  // The free-token readers (cost levers, WS-L): a long doc read compressed, and a question
  // answered by a LOCAL model over the files it names. "summarize the design notes" shares
  // no stem with either name, and they exist to be reached for BEFORE a paid read.
  // Inert where the host did not advertise them (no compressor / no local model).
  "read_compressed",
  "local_research",
  "write_file",
  "edit_file",
  "delete_file",
  "run_command",
  // A background command's companions (PRD 35 E6): a turn that started `npm test` in the
  // background and now asks "did it pass?" shares no stem with `command_status`.
  "command_status",
  "command_stop",
  // The git tools, read and publish alike. They belong here for exactly the reason the
  // file tools do: "commit the change and push to main" is not one domain among many a
  // query can be relevant to, it is the surface doing its job. The turn that produced
  // this set is the proof — `run_command` shared no stem with that request, missed the
  // relevance cut, and the agent spent the run unable to find the tool its own persona
  // had just told it to use. `git_status` before a commit, and `open_pull_request`
  // after one, are dropped by the same mechanism on a turn phrased "ship this".
  "git_status",
  "git_diff",
  "git_history",
  "git_sync_latest",
  "git_undo",
  "git_redo",
  "git_commit",
  "git_push",
  "open_pull_request",
  // Cleanup after a merge is the LAST step of shipping and the one most easily trimmed:
  // by the time the agent reaches it, the turn's text is about the change, not about
  // branches, so "cleanup" shares no stem with anything the user said. Unpinned, the
  // agent falls back to hand-rolled `run_command` git — which is exactly how
  // `git push origin --delete <branch>` → `remote ref does not exist` happened.
  "git_cleanup_merged",
  // Delegation to a sub-agent. It belongs here for the same reason and fails the same
  // way: a turn phrased "where does the auth middleware live?" shares no stem with
  // "delegate", so relevance drops the one tool that would answer it cheaply, and the
  // agent burns the turns delegation exists to save. Nothing is pinned that the host
  // did not advertise — the web Brain offers no `spawn_agent`, so this is inert there.
  "spawn_agent",
  // Its side-by-side twin — what a planner's `hand_off` fans out to; editor-only.
  "spawn_agents",
  // The owner's verbs for children running in the background (editor-only): a turn about
  // "check on Ada" or "tell a2 to stop" shares no stem with the tool names either.
  "wait_agents",
  "message_agent",
  "stop_agent"
]);
var CODE_CHANGE_TOOLS = /* @__PURE__ */ new Set([
  "write_file",
  "edit_file",
  "delete_file",
  "canvas_write_build_file",
  "canvas_edit_build_file",
  "canvas_restore_build_file"
]);
var PREVIEW_REVIEW_TOOL = "canvas_inspect_preview";
var STUDIO_WORKSPACE_TOOLS = /* @__PURE__ */ new Set([
  "canvas_list_build_files",
  "canvas_read_build_file",
  "canvas_search_build_files",
  "canvas_write_build_file",
  "canvas_edit_build_file",
  "canvas_read_build_diagnostics",
  "canvas_read_preview_console",
  "canvas_list_build_file_history",
  "canvas_restore_build_file",
  // Install / build / type-check / test in the browser runtime: "does it build?" shares
  // no stem with the tool's name, the same miss that dropped `run_command` on the IDE.
  "canvas_run_build_command",
  PREVIEW_REVIEW_TOOL
]);
var UNSCOPED_MUTATION_TOOLS = /* @__PURE__ */ new Set([
  "run_command",
  // The Studio's twin: the same shell, run in the browser runtime, whose changed files
  // are saved back to the workspace — so a cached `canvas_read_build_file` is as stale
  // after it as a `read_file` is after `run_command`.
  "canvas_run_build_command",
  "git_sync_latest",
  "git_undo",
  "git_redo",
  // Cleanup checks out the base branch and fast-forwards it, so every file in the
  // checkout can differ from what a read before it returned — the same reason the
  // three above are here.
  "git_cleanup_merged"
]);
var PROJECT_MEMORY_TOOLS = /* @__PURE__ */ new Set(["recall_facts", "remember_fact"]);
function isRepoPublishTool(name) {
  return REPO_PUBLISH_TOOLS.has(name);
}
var REPO_STATE_READ_TOOLS = /* @__PURE__ */ new Set(["review_ticket_branches"]);
function isRepoStateReadTool(name) {
  return REPO_STATE_READ_TOOLS.has(name);
}
function isLocalWorkspaceTool(name) {
  return LOCAL_WORKSPACE_TOOLS.has(name);
}
function isProjectMemoryTool(name) {
  return PROJECT_MEMORY_TOOLS.has(name);
}
function isCodeChangeTool(name) {
  return CODE_CHANGE_TOOLS.has(name);
}
function isUnscopedMutationTool(name) {
  return UNSCOPED_MUTATION_TOOLS.has(name);
}
function canChangeCodeHere(toolNames) {
  return toolNames.some(isCodeChangeTool);
}
function canShipHere(toolNames) {
  return toolNames.includes("git_commit") && toolNames.includes("git_push");
}
function localToolsIn(toolNames) {
  return toolNames.filter(isLocalWorkspaceTool);
}
function canReviewInPreview(toolNames) {
  return toolNames.includes(PREVIEW_REVIEW_TOOL);
}
function studioToolsIn(toolNames) {
  return canReviewInPreview(toolNames) ? toolNames.filter((name) => STUDIO_WORKSPACE_TOOLS.has(name)) : [];
}
function memoryToolsIn(toolNames) {
  return toolNames.filter(isProjectMemoryTool);
}

// src/workItemBookkeeping.ts
var WORK_ITEM_TOOL = /^(builtin_(tasks|tickets|kanban)_|ticket[-_.])/i;
var LOCAL_TICKET_READ = /^ticket[-_.](list|get|search|read)/i;
function isWorkItemTool(name) {
  return WORK_ITEM_TOOL.test(name) || name === SERVER_TICKET_LINK_TOOL;
}
function isWorkItemWrite(name) {
  return isWorkItemTool(name) && !isReadOnlyPlatformTool(name) && !LOCAL_TICKET_READ.test(name);
}
var TICKETING_INTENTS = [
  /\b(?:create|file|raise|log)\s+(?:[\w'-]+\s+){0,3}?(?:tickets?|tasks?|issues?)\b/i,
  /\bopen\s+(?:an?|one|new|separate|individual)\s+(?:[\w'-]+\s+){0,2}?(?:tickets?|tasks?|issues?)\b/i
];
function asksForWorkItems(text) {
  const t = text ?? "";
  return TICKETING_INTENTS.some((p) => p.test(t));
}

// src/runEffect.ts
var MUTATION_TOOL = /(^|_)(write|edit|save|create|update|delete|apply|patch|publish|send|dispatch|run_command|assign|link|move|set)(_|$)/i;
function isMutationTool(name) {
  return isCodeChangeTool(name) || MUTATION_TOOL.test(name) || isWorkItemWrite(name);
}
function isBookkeepingWrite(name) {
  return !isCodeChangeTool(name) && isWorkItemWrite(name);
}
function hasEditIntent(messages) {
  return messages.some((m) => m.role === "user" && asksForChange(m.content));
}
function asksForWorkItemsIn(messages) {
  return messages.some((m) => m.role === "user" && asksForWorkItems(m.content));
}

// src/workflowDiagnostics.ts
function workflowDiagnostics(events) {
  return summarizeWorkflow(events.flatMap((event) => {
    if (event.label !== "workflow.stage" && !event.label.startsWith("workflow.stage.")) return [];
    const metric = workflowMetricOf(event.args);
    return metric ? [metric] : [];
  }));
}
function formatWorkflowDiagnostics(workflow) {
  const row = (stage, s) => `| ${stage} | ${s.status} | ${s.attempts} | ${s.completed} | ${s.failed} | ${s.blocked} | ${s.cancelled} | ${s.running} | ${s.totalMs ?? "null"} | ${s.maxMs ?? "null"} | ${s.latestCounters ? JSON.stringify(s.latestCounters) : ""} |`;
  return [
    "",
    "### `workflow.metrics`",
    "",
    `\`observedStages=${workflow.observedStages}/${workflow.totalStages}\``,
    "",
    "| stage | status | attempts | completed | failed | blocked | cancelled | running | totalMs | maxMs | latestCounters |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...workflow.stages.flatMap((s) => [row(s.stage, s), ...(s.operations ?? []).map((op) => row(`${s.stage}.${op.operation}`, op))])
  ];
}

// src/runSlices.ts
var at = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NaN;
};
var stepOf = (ev) => {
  if (ev.label !== "llm.complete") return null;
  const step = ev.args?.step;
  return typeof step === "number" && Number.isFinite(step) ? step : null;
};
function runStarts(events, persons) {
  const turns = events.map((ev) => ({ t: at(ev.ts), step: stepOf(ev) })).filter((x) => x.step !== null && Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  if (turns.length === 0) return persons.map((m) => ({ t: at(m.createdAt), ask: m.content }));
  const starts = [];
  let prevStep = Number.POSITIVE_INFINITY;
  let prevTurn = Number.NEGATIVE_INFINITY;
  let prevStart = Number.NEGATIVE_INFINITY;
  for (const turn of turns) {
    const messaged = persons.some((m) => at(m.createdAt) > prevTurn && at(m.createdAt) <= turn.t);
    const reset = starts.length === 0 || turn.step < prevStep || turn.step === prevStep && messaged;
    prevStep = turn.step;
    prevTurn = turn.t;
    if (!reset) continue;
    const asked = [...persons].reverse().find((m) => at(m.createdAt) <= turn.t && at(m.createdAt) > prevStart);
    const t = asked ? at(asked.createdAt) : turn.t;
    starts.push({ t, ask: asked?.content ?? "" });
    prevStart = t;
  }
  return starts;
}
function splitRuns(events, messages) {
  const persons = messages.filter((m) => m.role === "user" && Number.isFinite(at(m.createdAt))).sort((a, b) => at(a.createdAt) - at(b.createdAt));
  const starts = persons.length === 0 ? [] : runStarts(events, persons);
  if (starts.length <= 1) return [{ ask: starts[0]?.ask ?? persons[0]?.content ?? "", events: [...events], messages: [...messages] }];
  const slices = starts.map((s) => ({ ask: s.ask, events: [], messages: [] }));
  const sliceAt = (iso) => {
    const t = at(iso);
    let i = 0;
    if (Number.isFinite(t)) while (i + 1 < starts.length && starts[i + 1].t <= t) i++;
    return slices[i];
  };
  for (const ev of events) sliceAt(ev.ts).events.push(ev);
  for (const m of messages) sliceAt(m.createdAt).messages.push(m);
  return slices;
}

// src/runProgress.ts
function callSignature(ev) {
  return callFingerprint(ev.label, ev.args);
}
function targetSignature(ev) {
  const target = subjectOf(ev);
  if (target) return `${ev.label}:${target}`;
  return isPagedDataCall(ev) ? `${ev.label}:${callFingerprint("", ev.args)}` : null;
}
function callTargetKey(ev) {
  return targetSignature(ev) ?? callSignature(ev);
}
var PAGE_KEYS = ["offset", "page", "cursor", "skip", "after", "pageToken", "page_token", "next"];
function isPagedDataCall(ev) {
  if (isMutationTool(ev.label)) return false;
  const args = ev.args && typeof ev.args === "object" ? ev.args : null;
  return !!args && PAGE_KEYS.some((k) => args[k] != null);
}
function subjectOf(ev) {
  const target = visitTarget(ev.args);
  return target ? oneSpelling(target) : void 0;
}
function oneSpelling(path) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}
function isCacheAnswered(ev) {
  const r = ev.result;
  if (!r || typeof r !== "object") return false;
  const o = r;
  return o.covered === true || o.replayed === true || o.derived === true || o.skipped === true && typeof o.note === "string" || typeof o.note === "string" && /^Duplicate \S+ call/.test(o.note);
}
var IDLE_GAP_MS = 12e4;
function computeRunProgress(events, messages = []) {
  const slices = splitRuns(events, messages);
  if (slices.length === 1) return { ...progressOf(events, hasEditIntent(messages), asksForWorkItemsIn(messages)), runs: [] };
  const askedIn = (ask, own2, asked) => asked(own2) || isContinuationDirective(ask) && asked(messages);
  const each = slices.map((s) => ({ s, p: progressOf(s.events, askedIn(s.ask, s.messages, hasEditIntent), askedIn(s.ask, s.messages, asksForWorkItemsIn)) }));
  const runs = each.map(({ s, p }) => ({
    ask: s.ask,
    turns: s.events.filter((e) => e.label === "llm.complete").length,
    calls: s.events.filter((e) => e.category === "tool").length,
    cacheAnswered: p.cacheAnswered,
    mutationsSucceeded: p.mutationsSucceeded,
    bookkeepingWrites: p.bookkeepingWrites,
    spinning: p.spinning,
    activeMs: Math.max(0, p.wallClockMs - p.idleMs)
  }));
  return { ...each[each.length - 1].p, runs };
}
function progressOf(events, editIntent, workItemsAsked) {
  const tools = events.filter((e) => e.category === "tool");
  const seenCalls = /* @__PURE__ */ new Map();
  let duplicateCalls = 0;
  let cacheAnswered = 0;
  const targetCounts = /* @__PURE__ */ new Map();
  const sinceEdit = /* @__PURE__ */ new Map();
  const revisitsOf = /* @__PURE__ */ new Map();
  let revisits = 0;
  let targetedCalls = 0;
  let mutationsAttempted = 0;
  let mutationsSucceeded = 0;
  let bookkeepingWrites = 0;
  let streaks = 0;
  let longestStreak = null;
  let current = null;
  const waits = new WaitCeiling();
  const changed = (subject) => {
    for (const key of sinceEdit.keys()) if (key.endsWith(`:${subject}`)) sinceEdit.set(key, 0);
    for (const [s, t] of seenCalls) if (t === subject) seenCalls.delete(s);
  };
  for (const ev of tools) {
    const sig2 = callSignature(ev);
    const subject = subjectOf(ev);
    const digest = ev.isError ? null : waitDigestOf(ev.label, ev.result);
    if (digest === null || delegationReportedOf(ev.label, ev.result) || delegatedChangedPathsOf(ev.label, ev.result).length > 0) waits.reset();
    const waiting = digest !== null && waits.waited(digest);
    if (!waiting) {
      if (seenCalls.has(sig2)) duplicateCalls += 1;
      else seenCalls.set(sig2, subject);
    }
    const cached = isCacheAnswered(ev);
    if (cached) cacheAnswered += 1;
    const failed3 = Boolean(ev.isError) || isFailedToolResult(ev.result);
    if (waiting) {
      current = null;
    } else if (current && current.sig === sig2) {
      current.streak.count += 1;
      if (failed3) current.streak.failed += 1;
      if (current.streak.count === 2) streaks += 1;
      if (!longestStreak || current.streak.count > longestStreak.count) longestStreak = current.streak;
    } else {
      current = { sig: sig2, streak: { label: ev.label, count: 1, failed: failed3 ? 1 : 0 } };
    }
    const target = targetSignature(ev);
    if (target) {
      targetedCalls += 1;
      targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
      const seen = sinceEdit.get(target) ?? 0;
      if (seen > 0) {
        revisits += 1;
        revisitsOf.set(target, (revisitsOf.get(target) ?? 0) + 1);
      }
      sinceEdit.set(target, seen + 1);
    }
    const delegated = isDelegationTool(ev.label) ? codeChangesOf(ev.label, ev.args, ev.result) ?? [] : [];
    if (delegated.length > 0 && !isMutationTool(ev.label)) {
      mutationsAttempted += 1;
      mutationsSucceeded += 1;
      for (const file of delegated) changed(oneSpelling(file));
    }
    if (isMutationTool(ev.label)) {
      mutationsAttempted += 1;
      if (!cached && !ev.isError && !isFailedToolResult(ev.result)) {
        mutationsSucceeded += 1;
        if (isBookkeepingWrite(ev.label)) bookkeepingWrites += 1;
        if (subject) changed(subject);
      }
    }
  }
  const repeatedTargets = [...revisitsOf.entries()].map(([label, again]) => ({ label, count: again + 1 })).sort((a, b) => b.count - a.count);
  const distinctTargets = targetCounts.size;
  const revisitRatio = targetedCalls > 0 ? revisits / targetedCalls : 0;
  let modelMs = 0;
  let toolMs = 0;
  let slowestStep = null;
  const timed = [];
  for (const ev of events) {
    const ms = typeof ev.durationMs === "number" && Number.isFinite(ev.durationMs) ? ev.durationMs : 0;
    const t = Date.parse(ev.ts);
    if (Number.isFinite(t)) timed.push({ t, ms });
    if (ev.category === "llm") modelMs += ms;
    else if (ev.category === "tool") toolMs += ms;
    if (ms > 0 && (!slowestStep || ms > slowestStep.ms)) slowestStep = { label: ev.label, ms };
  }
  timed.sort((a, b) => a.t - b.t);
  let idleMs = 0;
  for (let i = 1; i < timed.length; i++) {
    const uncovered = timed[i].t - timed[i - 1].t - timed[i].ms;
    if (uncovered > IDLE_GAP_MS) idleMs += uncovered;
  }
  const wallClockMs = timed.length > 1 ? timed[timed.length - 1].t - timed[0].t : 0;
  const didWork = tools.length > 0;
  const effects = mutationsSucceeded - (workItemsAsked ? 0 : bookkeepingWrites);
  const noEffect = editIntent && didWork && effects === 0;
  const stuckOnCall = longestStreak !== null && longestStreak.count >= BACK_TO_BACK_AT;
  const spinning = targetedCalls >= 6 && revisitRatio >= 0.4 || stuckOnCall;
  return {
    duplicateCalls,
    cacheAnswered,
    longestStreak,
    streaks,
    stuckOnCall,
    repeatedTargets,
    distinctTargets,
    targetedCalls,
    revisitRatio,
    mutationsAttempted,
    mutationsSucceeded,
    bookkeepingWrites,
    editIntent,
    noEffect,
    spinning,
    wallClockMs,
    idleMs,
    modelMs,
    toolMs,
    slowestStep
  };
}

// src/runProgressReport.ts
function progressDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1e3) return `${ms}ms`;
  if (ms < 6e4) return `${(ms / 1e3).toFixed(ms < 1e4 ? 1 : 0)}s`;
  const m = Math.floor(ms / 6e4);
  const s = Math.round(ms % 6e4 / 1e3);
  return s ? `${m}m ${s}s` : `${m}m`;
}
var MAX_NAMED_TARGETS = 4;
function formatStreak(s) {
  const outcome = s.failed === 0 ? "" : s.failed === s.count ? ` (all ${s.count} failed)` : ` (${s.failed} of ${s.count} failed)`;
  return `\`${s.label}\` \xD7${s.count} BACK-TO-BACK${outcome}`;
}
function spunEarlier(p) {
  if (p.spinning) return null;
  for (let i = p.runs.length - 2; i >= 0; i--) if (p.runs[i].spinning) return { run: p.runs[i], index: i };
  return null;
}
var MAX_NAMED_RUNS = 8;
var ASK_LABEL_CHARS = 48;
function formatRuns(runs) {
  const first = Math.max(0, runs.length - MAX_NAMED_RUNS);
  const named = runs.slice(first).map((r, i) => {
    const ask = r.ask.replace(/\s+/g, " ").trim();
    const label = ask.length > ASK_LABEL_CHARS ? `${ask.slice(0, ASK_LABEL_CHARS)}\u2026` : ask;
    return `#${first + i + 1} "${label}" ${r.turns} turn(s) \xB7 ${r.calls} call(s)${r.cacheAnswered ? ` \xB7 ${r.cacheAnswered} cache-answered` : ""} \xB7 ${changedOf(r)}${r.spinning ? " \u26A0 SPUN" : ""}`;
  });
  return `Runs (latest last; the "Latest run" figures are run #${runs.length}'s): ${first ? `(${first} earlier) ` : ""}${named.join(" | ")}`;
}
function formatChatTotals(runs) {
  const sum = (pick) => runs.reduce((n, r) => n + pick(r), 0);
  return `Chat totals (${runs.length} runs): ${sum((r) => r.turns)} turn(s) \xB7 ${sum((r) => r.calls)} call(s) \xB7 ${sum(changesOf)} change(s)${ticketWrites(sum((r) => r.bookkeepingWrites))} \xB7 ${progressDuration(sum((r) => r.activeMs ?? 0))} active`;
}
function changesOf(r) {
  return r.mutationsSucceeded - r.bookkeepingWrites;
}
function ticketWrites(n) {
  return n > 0 ? ` (+${n} ticket/task write(s))` : "";
}
function changedOf(r) {
  return `${changesOf(r)} changed${ticketWrites(r.bookkeepingWrites)}`;
}
function formatRunProgress(p, opts = {}) {
  const lines = [];
  const multi = p.runs.length > 1;
  const scope = multi ? `Latest run (#${p.runs.length} of ${p.runs.length}) \xB7 ` : "";
  const reach = p.targetedCalls > 0 ? `${p.distinctTargets} distinct target(s) over ${p.targetedCalls} targeted call(s)` : "no targeted calls";
  lines.push(
    `${scope}Progress: ${reach}${p.repeatedTargets.length ? ` \xB7 ${Math.round(p.revisitRatio * 100)}% of calls revisited ground already covered` : " \xB7 no repeats"}${p.duplicateCalls ? ` \xB7 ${p.duplicateCalls} EXACT duplicate call(s)` : ""}${p.cacheAnswered ? ` \xB7 ${p.cacheAnswered} call(s) answered from the read cache, never re-run` : ""}${p.longestStreak ? ` \xB7 ${formatStreak(p.longestStreak)}${p.streaks > 1 ? ` (${p.streaks} such streaks)` : ""}` : ""}`
  );
  if (p.repeatedTargets.length) {
    const named = p.repeatedTargets.slice(0, MAX_NAMED_TARGETS).map((t) => `${t.label} \xD7${t.count}`).join(" \xB7 ");
    const rest = p.repeatedTargets.length - MAX_NAMED_TARGETS;
    lines.push(`Revisited: ${named}${rest > 0 ? ` (+${rest} more)` : ""}`);
  }
  if (multi) lines.push(formatRuns(p.runs), formatChatTotals(p.runs));
  const pending = opts.running ? " \xB7 run in progress \u2014 no effect verdict yet" : "";
  if (p.editIntent) {
    lines.push(
      `${scope}Effect: the request asked for a CHANGE \xB7 ${p.mutationsAttempted} mutating call(s) attempted, ${p.mutationsSucceeded} succeeded${bookkeeping(p)}${opts.running ? pending : p.noEffect ? " \xB7 \u26A0 NOTHING WAS CHANGED" : ""}`
    );
  } else if (p.mutationsAttempted > 0) {
    lines.push(`${scope}Effect: ${p.mutationsAttempted} mutating call(s) attempted, ${p.mutationsSucceeded} succeeded${pending}.`);
  }
  if (p.wallClockMs > 0) {
    const active = Math.max(0, p.wallClockMs - p.idleMs);
    lines.push(
      `${scope}Time: ${progressDuration(active)} wall clock \xB7 ${progressDuration(p.modelMs)} in the model \xB7 ${progressDuration(p.toolMs)} in tools${p.slowestStep ? ` \xB7 slowest ${p.slowestStep.label} (${progressDuration(p.slowestStep.ms)})` : ""}${p.idleMs > 0 ? ` \xB7 ${progressDuration(p.idleMs)} waiting on the user between turns, excluded (span ${progressDuration(p.wallClockMs)})` : ""}`
    );
  }
  return lines;
}
function runProgressVerdict(p) {
  if (!p.spinning && !p.noEffect) {
    const earlier = spunEarlier(p);
    if (!earlier) return null;
    const { run, index } = earlier;
    return `NO PROGRESS in run #${index + 1} of ${p.runs.length} ("${run.ask.replace(/\s+/g, " ").trim().slice(0, ASK_LABEL_CHARS)}"): it went back over ground it had already covered \u2014 ${run.turns} turn(s), ${run.calls} call(s)${run.cacheAnswered ? `, ${run.cacheAnswered} of them answered from the read cache` : ""}, ${changesOf(run)} change(s)${ticketWrites(run.bookkeepingWrites)}. The latest run did not spin; the figures above are its own. This is a LOOP in that run, not context pressure \u2014 see the Runs line.`;
  }
  const worst = p.repeatedTargets[0];
  const streak = p.stuckOnCall && p.longestStreak ? `it made the same call ${p.longestStreak.count} times in a row \u2014 ${formatStreak(p.longestStreak)} \u2014 with nothing else attempted between them${p.longestStreak.failed === p.longestStreak.count ? ", re-asking a question it had already been answered the same way each time" : ""}` : null;
  const revisit = p.repeatedTargets.length ? `${Math.round(p.revisitRatio * 100)}% of its targeted calls revisited a target it had already read${worst ? `, worst \`${worst.label}\` \xD7${worst.count}` : ""}` : null;
  const loop = p.spinning ? `NO PROGRESS \u2014 ${streak ? `${streak}${revisit ? `; ${revisit}` : ""}` : `the run kept going back over ground it had already covered: ${revisit}`}${p.duplicateCalls ? `, and ${p.duplicateCalls} call(s) repeated earlier arguments EXACTLY` : ""}. ` : "NO EFFECT \u2014 ";
  const effect = p.noEffect ? p.bookkeepingWrites > 0 && p.bookkeepingWrites === p.mutationsSucceeded ? `change requested, no code changed: the run's only successful writes were ${p.bookkeepingWrites} ticket/task bookkeeping call(s); filing or moving a ticket is not the change, so nothing the person asked for was modified. ` : `The request asked for a change and the run finished with ZERO successful mutating calls${p.mutationsAttempted ? ` (${p.mutationsAttempted} attempted, all failed)` : " \u2014 it never attempted one"}, so nothing was actually modified. ` : "";
  const remedy = p.spinning ? `This is a LOOP, not context pressure and not a model that "won't call tools" \u2014 the numbers on those signals are a consequence of the repetition, not its cause. ${streak && p.longestStreak && p.longestStreak.failed > 0 ? "A call repeated back-to-back after FAILING is the model ignoring the error it was given: the failure text usually names the exact change to make (a `repo`, a path, a missing argument). Check that the tool result reached the model un-truncated, and that the repeated-failure advisory fired; if it did and the model still repeated the call, the model is not reading tool results \u2014 switch models for this run." : streak ? "A call repeated back-to-back after SUCCEEDING is the model not retaining the answer it already has: the result was truncated, or too large to keep in the transcript. Check the truncated-results count above, and shrink or page that result rather than the transcript." : "Look at the repeated targets above: the agent is not retaining what it already read (the result was truncated, or the read was too narrow to answer the question). Widen the read, or cache the file in the transcript, rather than shrinking context or switching models."}` : 'Check the "Answered from memory" line first \u2014 a turn served from the Q&A cache or an Evermind head does NO work by construction, so a run made largely of those has no mutating call to find. Otherwise check whether the agent was ever offered a mutating tool this run (see the tools-advertised line) before concluding the model refused to act.';
  return `${loop}${effect}${remedy}`;
}
function bookkeeping(p) {
  return p.bookkeepingWrites > 0 ? ` (${p.bookkeepingWrites} of them ticket/task bookkeeping \u2014 not a change)` : "";
}

// src/runStore/gatewayRoutingTrace.ts
var FAILOVER_SEPARATOR = ", ";
function formatFailovers(routing) {
  const failovers = routing?.failovers ?? [];
  if (failovers.length === 0) return void 0;
  return failovers.map((f) => `${f.model}:${f.code}${f.kind ? ` ${f.kind}` : ""}`).join(FAILOVER_SEPARATOR);
}
function gatewayRoutingArgs(routing) {
  if (!routing) return {};
  const failovers = formatFailovers(routing);
  return {
    ...failovers ? { failovers } : {},
    ...routing.candidates?.length ? { candidates: routing.candidates.join(" > ") } : {},
    ...routing.traceId ? { traceId: routing.traceId } : {}
  };
}

// src/handOffParallelism.ts
function taskPackageDir(task, isPackageDir) {
  const paths = task.paths;
  if (paths.length === 0) return null;
  const dirs = paths.map((p) => p.replace(/\\/g, "/").replace(/\/$/, "")).map((p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");
  const prefix = (a, b) => {
    if (a === b) return a;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    let end = a.slice(0, i).lastIndexOf("/");
    if (end < 0) end = 0;
    return a.slice(0, end);
  };
  let common = dirs[0];
  for (const d of dirs.slice(1)) common = prefix(common, d);
  let dir = common;
  for (; ; ) {
    if (dir === null || dir === "" || dir === ".") return common;
    if (!isPackageDir) return common;
    if (isPackageDir(dir)) return dir;
    const up = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : ".";
    if (up === dir || up === ".") return common;
    dir = up;
  }
}
var normalizeRef = (s) => s.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
function referencesPackage(text, dir) {
  const normText = normalizeRef(text);
  if (normText === "") return false;
  const normDir = normalizeRef(dir);
  const base = normDir.slice(normDir.lastIndexOf("/") + 1);
  return normText.includes(normDir) || base !== "" && normText.includes(base);
}
var refText = (t) => t.brief?.trim() ? `${t.brief} ${t.title}` : t.title;
var normPaths = (t) => t.paths.map((p) => p.replace(/\\/g, "/"));
var scopeOf = (t) => ({ label: t.title, paths: normPaths(t) });
var pathDisjoint = (a, b) => overlappingScopes([scopeOf(a), scopeOf(b)]) === null;
function computeOrderDependencies(tasks, isPackageDir) {
  const deps = [];
  const packageOf = tasks.map((t) => taskPackageDir(t, isPackageDir));
  for (let j = 0; j < tasks.length; j += 1) {
    for (let i = 0; i < j; i += 1) {
      const packageDir = packageOf[i];
      if (packageDir === null || packageDir === "." || !pathDisjoint(tasks[i], tasks[j])) continue;
      if (referencesPackage(refText(tasks[j]), packageDir)) deps.push({ producer: i, consumer: j, packageDir });
    }
  }
  return deps;
}
function planScopeClash(tasks) {
  return overlappingScopes(tasks.filter((t) => t.paths.length > 0).map(scopeOf));
}
function canRunInParallel(tasks) {
  if (tasks.length < 2 || tasks.some((t) => t.paths.length === 0)) return false;
  return planScopeClash(tasks) === null;
}
function splitForParallel(tasks, isPackageDir) {
  const all = tasks.map((_, i) => i);
  const order = computeOrderDependencies(tasks, isPackageDir);
  const consumedBefore = (index) => order.some((d) => d.consumer === index);
  let lead = 0;
  while (lead < tasks.length && tasks[lead].paths.length > 0 && !consumedBefore(lead) && overlappingScopes(tasks.slice(0, lead + 1).map(scopeOf)) === null) lead += 1;
  const parallel = lead >= 2 ? all.slice(0, lead) : [];
  const result = { parallel, inline: all.slice(parallel.length), clash: planScopeClash(tasks) };
  if (order.length > 0) result.order = order;
  return result;
}
var HAND_OFF_MODE_LABEL = "hand_off.mode";
var HAND_OFF_CLASH_LABEL = "hand_off.scope_clash";
function handOffModeSentence(d) {
  const why = d.clash ? ` (${describeClash(d.clash)})` : "";
  if (d.mode === "parallel") return `All ${d.parallelTasks.length} tasks ran side by side as coding sub-agents.`;
  if (d.mode === "mixed") return `${d.parallelTasks.length} task(s) ran side by side as coding sub-agents; ${d.inlineTasks.length} went to the coding model inline${why}.`;
  return `All ${d.inlineTasks.length} task(s) went to the coding model inline${why}.`;
}
function modeOf(split) {
  if (split.parallel.length === 0) return "inline";
  return split.inline.length === 0 ? "parallel" : "mixed";
}
function describeClash(clash) {
  return `"${clash.a}" and "${clash.b}" both own ${clash.path}`;
}
function describeOrder(dep, titles) {
  return `"${titles[dep.consumer] ?? `#${dep.consumer + 1}`}" consumes ${dep.packageDir}, which "${titles[dep.producer] ?? `#${dep.producer + 1}`}" changes`;
}
function taskNumbers(indexes) {
  const n = indexes.map((i) => String(i + 1));
  return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}
function splitLayoutLine(split, titles = []) {
  const why = split.clash ? ` \u2014 ${describeClash(split.clash)}, so they cannot run at the same time` : "";
  const after = split.order?.length ? ` \u2014 ${split.order.map((d) => describeOrder(d, titles)).join("; ")}, so the consumer runs after the producer` : "";
  const mode = modeOf(split);
  if (mode === "mixed") {
    return `Side by side: task${split.parallel.length === 1 ? "" : "s"} ${taskNumbers(split.parallel)}. Then in order, by the coding model: task${split.inline.length === 1 ? "" : "s"} ${taskNumbers(split.inline)}${why || after}.`;
  }
  return mode === "inline" && (split.clash || after) ? `In order, by the coding model${why || after}.` : "";
}
function scopeClashCorrective(clash) {
  return `hand_off not filed: the tasks cannot run side by side \u2014 ${describeClash(clash)}. Narrow each task's paths to the files and directories it actually changes: a parent directory that contains another task's paths blocks parallel work. Then call hand_off again with the same tasks. If they genuinely share files, call it again unchanged: every task from the first overlapping one onward then runs inline, in plan order, after any tasks before it.`;
}

// src/routingByRole.ts
function decisionOf(e) {
  const a = e.args;
  if (!a || a.mode !== "parallel" && a.mode !== "inline" && a.mode !== "mixed") return null;
  return {
    mode: a.mode,
    parallelTasks: Array.isArray(a.parallelTasks) ? a.parallelTasks : [],
    inlineTasks: Array.isArray(a.inlineTasks) ? a.inlineTasks : [],
    clash: a.clash ?? null
  };
}
function decisionLine(d) {
  const counts = d.mode === "parallel" ? `${d.parallelTasks.length} side by side` : d.mode === "mixed" ? `${d.parallelTasks.length} side by side, ${d.inlineTasks.length} inline` : `${d.inlineTasks.length} inline`;
  return `  \u2022 hand_off: ${d.mode} \u2014 ${counts}${d.clash && d.mode !== "parallel" ? ` \xB7 overlap: ${describeClash(d.clash)}` : ""}`;
}
var ranked = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1]);
function routingByRole(turns, events) {
  const byRole = /* @__PURE__ */ new Map();
  for (const t of turns) {
    if (t.failed || !t.role) continue;
    const entry = byRole.get(t.role) ?? { turns: 0, models: /* @__PURE__ */ new Map(), failovers: /* @__PURE__ */ new Map() };
    entry.turns += 1;
    entry.models.set(t.model, (entry.models.get(t.model) ?? 0) + 1);
    for (const f of t.failovers?.split(FAILOVER_SEPARATOR) ?? []) if (f) entry.failovers.set(f, (entry.failovers.get(f) ?? 0) + 1);
    byRole.set(t.role, entry);
  }
  const count2 = (label) => events.filter((e) => e.label === label).length;
  const roleHandoffs = events.filter((e) => e.label === "llm.role_handoff");
  const hasArg = (e, key) => !!e.args && typeof e.args === "object" && key in e.args;
  const progressForced = events.filter((e) => e.label === PROGRESS_FORCED_LABEL && !!e.args && typeof e.args === "object").map((e) => e.args).filter((a) => a.forced === "hand_off");
  const progressForcedHandOffs = progressForced.length;
  const progressSignals = [...new Set(progressForced.map((a) => typeof a.signal === "string" ? a.signal : "").filter(Boolean))];
  return {
    roles: [...byRole.entries()].map(([role, e]) => ({
      role,
      turns: e.turns,
      models: ranked(e.models).map(([model, n]) => ({ model, turns: n })),
      failovers: ranked(e.failovers).map(([failover, n]) => ({ failover, turns: n }))
    })),
    coderReasks: roleHandoffs.filter((e) => hasArg(e, "from")).length,
    handOffs: roleHandoffs.filter((e) => hasArg(e, "via")).length,
    handOffsForced: count2("loop.hand_off_due") + progressForcedHandOffs,
    handOffsForcedByProgress: progressForcedHandOffs,
    handOffsForcedSignals: progressSignals,
    planBudgetsSpent: count2("loop.plan_budget_spent"),
    handOffModes: events.filter((e) => e.label === HAND_OFF_MODE_LABEL).map(decisionOf).filter((d) => d !== null),
    handOffClashesRefused: count2(HAND_OFF_CLASH_LABEL)
  };
}
function forcedText(r) {
  const byProgress = r.handOffsForcedByProgress ?? 0;
  const byBudget = r.handOffsForced - byProgress;
  const causes2 = [byBudget > 0 ? "the analysis budget" : "", byProgress > 0 ? `the progress guard${r.handOffsForcedSignals?.length ? ` (${r.handOffsForcedSignals.join(", ")})` : ""}` : ""].filter(Boolean);
  return r.handOffsForced ? ` \xB7 ${r.handOffsForced} forced by ${causes2.join(" and ")}` : "";
}
function formatRoutingByRole(r) {
  if (!r || r.roles.length === 0) return [];
  const lines = ["Routing by role:"];
  for (const role of r.roles) {
    const models = role.models.slice(0, 3).map((m) => `${m.model} \xD7${m.turns}`).join(", ");
    const left = role.failovers.length ? ` \xB7 gateway left: ${role.failovers.slice(0, 4).map((f) => `${f.failover} \xD7${f.turns}`).join(", ")}` : "";
    lines.push(`  \u2022 ${role.role}: ${role.turns} turn(s) \u2014 ${models}${left}`);
  }
  lines.push(
    `  \u2022 analysis \u2192 code: ${r.coderReasks} re-ask(s) on a first edit \xB7 ${r.handOffs} hand_off call(s)` + forcedText(r) + (r.planBudgetsSpent ? ` \xB7 ${r.planBudgetsSpent} ended analysis with no hand-off` : "") + (r.handOffClashesRefused ? ` \xB7 ${r.handOffClashesRefused} plan(s) sent back once for overlapping paths` : "")
  );
  for (const d of r.handOffModes ?? []) lines.push(decisionLine(d));
  const plan = r.roles.find((x) => x.role === "plan")?.models[0]?.model;
  const code = r.roles.find((x) => x.role === "code");
  if (r.coderReasks > 0 && plan && code && code.models.length === 1 && code.models[0].model === plan) {
    lines.push(`  \u26A0 every code turn was answered by the planning model (${plan}) \u2014 no stronger connected coder served one. See "gateway left" above, or the connected accounts' health in the / menu.`);
  }
  return lines;
}

// src/staffingSummary.ts
function sessionWorkInTrace(events) {
  let n = 0;
  for (const ev of events) {
    if (ev.category !== "tool" || ev.isError || isFailedToolResult(ev.result)) continue;
    if (isCodeChangeTool(ev.label) || ev.label === "git_commit" || ev.label === "git_push") n += 1;
  }
  return n;
}
function sessionShippedInTrace(events) {
  const lastWrite = events.reduce((index, event, i) => event.category === "tool" && !event.isError && !isFailedToolResult(event.result) && (isCodeChangeTool(event.label) || event.label === "git_commit") ? i : index, -1);
  return shippedToBaseBranch(events.slice(lastWrite + 1)) ? 1 : 0;
}
var DISPATCH_TOOL = /chats[._](dispatch_agent|execute_as_agent)|kanban[._](coordinate|materialize_work_items|assess_resource|assign_participant)|executions[._]submit|run[._-]?now/i;
function isDispatchTool(label) {
  return DISPATCH_TOOL.test(label);
}
var MAX_REFUSAL_CHARS = 180;
function didDispatch(ev) {
  if (ev.isError || isFailedToolResult(ev.result)) return false;
  const r = toolResultRecord(ev.result);
  if (!r) return true;
  const autoRun = r.autoRun && typeof r.autoRun === "object" ? r.autoRun : null;
  if (autoRun && typeof autoRun.dispatched === "boolean") return autoRun.dispatched;
  if (typeof r.dispatched === "boolean") return r.dispatched;
  return true;
}
function refusalMessage(ev) {
  const r = toolResultRecord(ev.result);
  const raw = r && typeof r.error === "string" && r.error || r && typeof r.detail === "string" && r.detail || (r && r.autoRun && typeof r.autoRun === "object" && typeof r.autoRun.detail === "string" ? String(r.autoRun.detail) : "") || (typeof ev.result === "string" ? ev.result : "") || (r ? JSON.stringify(r) : "") || "no reason given";
  const flat = String(raw).replace(/\s+/g, " ").trim();
  return flat.length > MAX_REFUSAL_CHARS ? `${flat.slice(0, MAX_REFUSAL_CHARS)}\u2026` : flat || "no reason given";
}
function asAgentOf(args) {
  const a = args && typeof args === "object" ? args : null;
  const v = a?.as_agent;
  return typeof v === "string" ? v.trim() : "";
}
function staffingSummaryInTrace(events) {
  let ticketsCreated = 0;
  let filedLocally = 0;
  let dispatchAttempts = 0;
  let dispatched = 0;
  const dispatchRefusals = [];
  const personaSubagents = [];
  for (const ev of events) {
    if (ev.category !== "tool") continue;
    if (isTicketWriteTool(ev.label) && !ev.isError && !isFailedToolResult(ev.result)) {
      ticketsCreated += 1;
      if (isLocalTicketCreateLabel(ev.label)) filedLocally += 1;
    }
    if (isDispatchTool(ev.label)) {
      dispatchAttempts += 1;
      if (didDispatch(ev)) dispatched += 1;
      else dispatchRefusals.push({ label: ev.label, message: refusalMessage(ev) });
    }
    if (ev.label === "spawn_agent") {
      const agent = asAgentOf(ev.args);
      if (!agent) continue;
      const args = ev.args;
      const result = toolResultRecord(ev.result);
      const label = typeof args?.label === "string" && args.label.trim() || typeof result?.label === "string" && result.label.trim() || (typeof args?.task === "string" ? args.task.trim().slice(0, 60) : "") || "delegated work";
      personaSubagents.push({
        agent,
        label,
        ok: !ev.isError && !isFailedToolResult(ev.result) && result?.ok !== false
      });
    }
  }
  const verdict = dispatched > 0 || personaSubagents.some((p) => p.ok) ? "staffed" : dispatchRefusals.length > 0 ? "staffing-refused" : ticketsCreated > 0 && filedLocally === ticketsCreated ? "filed-locally" : ticketsCreated > 0 ? sessionWorkInTrace(events) > 0 ? "self-served" : "filed-not-staffed" : "no-work-filed";
  return { ticketsCreated, filedLocally, dispatchAttempts, dispatched, dispatchRefusals, personaSubagents, verdict };
}
function formatDispatchRefusals(refusals) {
  const counts = /* @__PURE__ */ new Map();
  for (const r of refusals) counts.set(r.message, (counts.get(r.message) ?? 0) + 1);
  return [...counts.entries()].map(([msg, n]) => n > 1 ? `${msg} \xD7${n}` : msg).join("; ");
}
function workFiledNotStaffedVerdict(s) {
  const refused = s.dispatchRefusals.length ? ` (${s.dispatchRefusals.length} refused: ${formatDispatchRefusals(s.dispatchRefusals)})` : "";
  return `Likely WORK FILED BUT NOT STAFFED \u2014 ${s.ticketsCreated} ticket(s) created, ${s.dispatched} dispatched${refused}. Nobody is running the work.`;
}
function formatStaffingSummary(s, opts) {
  if (s.verdict === "no-work-filed" && s.dispatchAttempts === 0 && s.personaSubagents.length === 0) return [];
  const refused = s.dispatchRefusals.length ? ` (${s.dispatchRefusals.length} refused: ${formatDispatchRefusals(s.dispatchRefusals)})` : "";
  const work = opts?.sessionWork ?? 0;
  const sessionDidIt = work > 0 && (s.verdict === "filed-not-staffed" || s.verdict === "staffing-refused" || s.verdict === "self-served");
  const tail = sessionDidIt ? ` \u2014 the session performed local work (${work} successful edit, commit, or push calls)` : s.verdict === "self-served" ? " \u2014 self-served: the session itself changed the code; a cloud dispatch was not required" : s.verdict === "filed-not-staffed" ? " \u2014 the work was filed but nobody is running it" : s.verdict === "filed-locally" ? " \u2014 filed on this device; the work runs here, by the session and its local sub-agents, and the tickets sync to the account when sync is on" : s.verdict === "staffing-refused" ? " \u2014 every attempt to staff the work was refused, so nobody is running it" : "";
  const lines = [
    `Staffing: ${s.ticketsCreated} ticket(s) filed \xB7 ${s.dispatched} dispatched${refused} \xB7 ${s.personaSubagents.length} persona sub-agent(s)${tail}`
  ];
  if (s.personaSubagents.length) {
    lines.push(
      `Persona sub-agents: ${s.personaSubagents.map((p) => `${p.agent} \u2014 ${p.label}${p.ok ? "" : " (no answer)"}`).join("; ")}`
    );
  }
  return lines;
}

// src/runFindings/policy.ts
import { NARRATION_OVERLAP } from "@seanhogg/builderforce-memory/working";
var RUN_FINDING_POLICY = Object.freeze({
  /** Read-only turns before the first write that make an analysis overrun. */
  analysisReadTurns: 8,
  /** Read-only turns after a readiness claim that leave it unkept. */
  unkeptReadTurns: 2,
  /** Turns that each made exactly one write, at which the run is writing serially. */
  serialSingleWriteTurns: 4,
  /** Prompt : completion ratio and prompt total at which the run's prompt is bloated. */
  promptBloatRatio: 50,
  promptBloatMinTokens: 5e5,
  /** Writes of one path that make churn. */
  editChurnWrites: 4,
  /** Argument bytes of one non-write call that are oversized. */
  oversizedArgBytes: 4 * 1024,
  /** Identical text (bytes) two calls of one tool must share to count as a copied block. */
  sharedArgBytes: 1024,
  /** A turn this slow (ms) is slow. */
  slowTurnMs: 6e4,
  /** Word-set overlap at which a pre-call text repeats the last kept one: memory's B7 fold threshold, so the
   *  diagnostic and the fold agree (`NARRATION_OVERLAP`, `@seanhogg/builderforce-memory/working`). */
  narrationOverlap: NARRATION_OVERLAP,
  /** Longest excerpt an evidence row quotes. */
  excerptChars: 160
});
var CHECK_TOOL = /diagnostic|typecheck|type[_-]check|(^|[_.-])tests?($|[_.-])|lint|(^|[_.-])verify($|[_.-])/i;
var CHECK_COMMAND = /\b(?:tsc|tsgo|vitest|jest|mocha|playwright|eslint|biome|oxlint|pytest|cargo\s+(?:check|test|clippy)|go\s+(?:test|vet))\b|\b(?:npm|pnpm|yarn|bun|npx)\b[^|;&\n]*?\b(?:test|lint|check|typecheck|type-check)\b/i;
var SHELL_TOOLS2 = /* @__PURE__ */ new Set(["run_command", "shell", "bash", "exec"]);

// src/runFindings/findingParts.ts
function finding3(kind, severity, params, evidence) {
  const first = evidence.reduce((min, e) => Math.min(min, e.step), Number.POSITIVE_INFINITY);
  const subject = params.path ?? params.tool;
  const id = `${kind}:${subject !== void 0 ? `${subject}:` : ""}${Number.isFinite(first) ? first : 0}`;
  return { id, kind, severity, params, evidence };
}
function withUniqueIds(findings) {
  const seen = /* @__PURE__ */ new Map();
  return findings.map((f) => {
    const n = (seen.get(f.id) ?? 0) + 1;
    seen.set(f.id, n);
    return n === 1 ? f : { ...f, id: `${f.id}#${n}` };
  });
}
function excerpt(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  const max = RUN_FINDING_POLICY.excerptChars;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}\u2026` : flat;
}
function turnEvidence(t, label = "llm.complete", text) {
  return { step: t.step, turn: t.index, label, ...text ? { excerpt: excerpt(text) } : {} };
}
function callEvidence(c, path, text) {
  return {
    step: c.step,
    ...c.turn > 0 ? { turn: c.turn } : {},
    label: c.name,
    ...path ? { path } : {},
    ...text ? { excerpt: excerpt(text) } : {}
  };
}
function fileLedger(view) {
  const rows = /* @__PURE__ */ new Map();
  for (const c of view.calls) {
    if (c.check) for (const row of rows.values()) row.checked = true;
    for (const path of c.paths) {
      const row = rows.get(path);
      if (row) {
        row.writes += 1;
        row.lastWrite = c;
        row.checked = false;
      } else {
        rows.set(path, { path, writes: 1, lastWrite: c, checked: false });
      }
    }
  }
  return [...rows.values()];
}
function unverifiedFiles(view) {
  return fileLedger(view).filter((r) => !r.checked);
}
function writeCalls(view) {
  return view.calls.filter((c) => c.write);
}

// src/runFindings/detectors/analysisOverrun.ts
function analysisOverrun(view) {
  const firstWrite = view.turns.find((t) => t.kind === "write");
  const before = firstWrite ? view.turns.filter((t) => t.index < firstWrite.index) : view.turns;
  const reads = before.filter((t) => t.kind === "read");
  const forced = before.find((t) => t.forced);
  const forcedByBudget = !!forced && view.routing.handOffsForced > 0;
  if (reads.length < RUN_FINDING_POLICY.analysisReadTurns && !forcedByBudget) return [];
  const evidence = [
    ...reads[0] ? [turnEvidence(reads[0])] : [],
    ...reads.length > 1 ? [turnEvidence(reads[reads.length - 1])] : [],
    ...forced ? [turnEvidence(forced, "loop.hand_off_due")] : []
  ];
  return [finding3("analysis_overrun", forcedByBudget ? "error" : "warn", {
    readTurns: reads.length,
    firstWriteTurn: firstWrite?.index ?? 0
  }, evidence)];
}

// src/runFindings/detectors/bracketBreak.ts
function bracketBreak(view) {
  const out = [];
  for (const c of view.calls) {
    if (!c.write) continue;
    for (const r of editedFilesOf(c.name, c.args)) {
      if (r.before === void 0 || r.after === void 0) continue;
      const delta = bracketDelta(r.before, r.after, r.path);
      if (!changesBalance(delta)) continue;
      out.push(finding3(
        "bracket_break",
        "error",
        { path: r.path, delta: describeBracketDelta(delta) },
        [callEvidence(c, r.path, r.after)]
      ));
    }
  }
  return out;
}

// src/runFindings/detectors/editChurn.ts
function editChurn(view) {
  return fileLedger(view).filter((f) => f.writes >= RUN_FINDING_POLICY.editChurnWrites).map((f) => finding3(
    "edit_churn",
    "warn",
    { path: f.path, writes: f.writes },
    view.calls.filter((c) => c.paths.includes(f.path)).map((c) => callEvidence(c, f.path))
  ));
}

// src/runFindings/detectors/filedThenInline.ts
function filedThenInline(view) {
  const { staffing } = view;
  if (staffing.ticketsCreated === 0 || staffing.dispatched > 0 || staffing.personaSubagents.some((p) => p.ok)) return [];
  const filed = view.calls.filter((c) => c.ok && isTicketWriteTool(c.name));
  const last = filed[filed.length - 1];
  if (!last) return [];
  const inline = view.calls.find((c) => c.write && c.step > last.step);
  if (!inline) return [];
  return [finding3("filed_then_inline", "info", { tickets: staffing.ticketsCreated }, [
    ...filed.map((c) => callEvidence(c, void 0, typeof c.args.title === "string" ? c.args.title : void 0)),
    callEvidence(inline, inline.paths[0])
  ])];
}

// src/composingActivity.ts
function utf8ByteLength2(text) {
  if (!text) return 0;
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
  }
  return bytes;
}
function toolCallArgBytes(calls) {
  let total = 0;
  for (const c of calls) total += utf8ByteLength2(c.args ?? "");
  return total;
}
function createComposingActivity(sink, opts) {
  const now = opts.now ?? Date.now;
  let names = /* @__PURE__ */ new Map();
  let bytes = 0;
  let startedAt = null;
  let published;
  const publish = (label, immediate) => {
    sink.set({
      phase: "composing",
      startedAt,
      step: opts.step,
      bytes,
      ...label ? { label } : {}
    });
    published = label;
    if (immediate) sink.repaint();
    else sink.coalescedRepaint();
  };
  return {
    onDelta(index, partial) {
      if (partial.name) names.set(index, partial.name);
      bytes += utf8ByteLength2(partial.argsFragment ?? "");
      const label = names.get(index) ?? published;
      if (startedAt === null) {
        startedAt = now();
        publish(label, true);
        return;
      }
      publish(label, !published && !!label);
    },
    bytes() {
      return bytes;
    },
    reset() {
      names = /* @__PURE__ */ new Map();
      bytes = 0;
      startedAt = null;
      published = void 0;
    }
  };
}

// src/runFindings/detectors/oversizedArgs.ts
function blocksOf(v, out = /* @__PURE__ */ new Set()) {
  if (typeof v === "string") {
    for (const p of v.split(/\n\s*\n/)) {
      const block = p.trim();
      if (utf8ByteLength2(block) >= RUN_FINDING_POLICY.sharedArgBytes) out.add(block);
    }
  } else if (Array.isArray(v)) {
    for (const x of v) blocksOf(x, out);
  } else if (v && typeof v === "object") {
    for (const x of Object.values(v)) blocksOf(x, out);
  }
  return out;
}
function sharingCalls(calls) {
  const holders = /* @__PURE__ */ new Map();
  for (const c of calls) for (const b of blocksOf(c.args)) holders.set(b, [...holders.get(b) ?? [], c]);
  const out = /* @__PURE__ */ new Set();
  for (const list2 of holders.values()) if (list2.length >= 2) for (const c of list2) out.add(c);
  return out;
}
function oversizedArgs(view) {
  const byTool = /* @__PURE__ */ new Map();
  for (const c of view.calls) {
    if (isCodeChangeTool(c.name)) continue;
    byTool.set(c.name, [...byTool.get(c.name) ?? [], c]);
  }
  const out = [];
  for (const [tool, calls] of byTool) {
    const shared = sharingCalls(calls);
    const flagged2 = calls.filter((c) => c.argBytes >= RUN_FINDING_POLICY.oversizedArgBytes || shared.has(c));
    if (flagged2.length === 0) continue;
    const evidence = flagged2.map((c) => ({
      ...callEvidence(c),
      note: shared.has(c) ? "argBytesShared" : "argBytes",
      params: { bytes: c.argBytes }
    }));
    out.push(finding3("oversized_args", "warn", { tool, bytes: Math.max(...flagged2.map((c) => c.argBytes)), calls: flagged2.length }, evidence));
  }
  for (const t of view.turns) {
    if (!t.handOffVia || t.argBytes < RUN_FINDING_POLICY.oversizedArgBytes || byTool.has(t.handOffVia)) continue;
    out.push(finding3(
      "oversized_args",
      "warn",
      { tool: t.handOffVia, bytes: t.argBytes, calls: 1 },
      [{ ...turnEvidence(t, t.handOffVia), note: "argBytes", params: { bytes: t.argBytes } }]
    ));
  }
  return out;
}

// src/runFindings/detectors/promptBloat.ts
function promptBloat(view) {
  const promptTokens = view.turns.reduce((sum, t) => sum + t.promptTokens, 0);
  const completion = view.turns.reduce((sum, t) => sum + t.completionTokens, 0);
  if (promptTokens < RUN_FINDING_POLICY.promptBloatMinTokens) return [];
  const ratio = completion > 0 ? promptTokens / completion : Number.POSITIVE_INFINITY;
  if (ratio < RUN_FINDING_POLICY.promptBloatRatio) return [];
  const writes = writeCalls(view).length;
  const peak = view.turns.reduce((max, t) => t.promptTokens > max.promptTokens ? t : max, view.turns[0]);
  return [finding3("prompt_bloat", "warn", {
    ratio: Number.isFinite(ratio) ? Math.round(ratio) : 0,
    promptTokens,
    perWrite: writes > 0 ? Math.round(promptTokens / writes) : 0
  }, [turnEvidence(peak)])];
}

// src/runFindings/detectors/repeatedNarration.ts
import { foldRepeatedNarration } from "@seanhogg/builderforce-memory/working";
function asNarration(t) {
  return { role: "assistant", content: t.text, tool_calls: t.calls.map(() => ({})) };
}
var isCandidate = (t) => t.calls.length > 0 && t.text.trim().length > 0;
function repeatedNarration(view) {
  const msgs = view.turns.map(asNarration);
  const folded = foldRepeatedNarration(msgs, RUN_FINDING_POLICY.narrationOverlap);
  const repeats = /* @__PURE__ */ new Set();
  let lastKept = null;
  for (let i = 0; i < view.turns.length; i++) {
    const t = view.turns[i];
    if (!isCandidate(t)) continue;
    if (folded[i] === msgs[i]) {
      lastKept = t;
      continue;
    }
    if (lastKept) repeats.add(lastKept);
    repeats.add(t);
  }
  if (repeats.size === 0) return [];
  const turns = [...repeats].sort((a, b) => a.index - b.index);
  return [finding3(
    "repeated_narration",
    "info",
    { turns: turns.length },
    turns.map((t) => turnEvidence(t, "agent.message", t.text))
  )];
}

// src/runFindings/detectors/reviewCapHit.ts
var CAP_MARKER = "review round 3";
var SHIP_TOOLS = /* @__PURE__ */ new Set(["git_push", "open_pull_request", "builtin_reviews_record"]);
function capError(c) {
  if (!SHIP_TOOLS.has(c.name) || !c.error) return null;
  return c.error.includes(CAP_MARKER) ? c.error : null;
}
function reviewCapHit(view) {
  const capped = view.calls.map((c) => ({ call: c, error: capError(c) })).filter((r) => r.error !== null);
  if (capped.length === 0) return [];
  return [finding3(
    "review_cap_hit",
    "info",
    { count: capped.length },
    capped.map(({ call, error }) => callEvidence(call, void 0, error))
  )];
}

// src/runFindings/detectors/sameModelRoles.ts
function soleModel(view, role) {
  const models = view.routing.roles.find((r) => r.role === role)?.models ?? [];
  return models.length === 1 ? models[0].model : null;
}
function sameModelRoles(view) {
  const r = view.routing;
  if (r.handOffs + r.handOffsForced + r.coderReasks === 0) return [];
  const plan = soleModel(view, "plan");
  if (!plan || plan !== soleModel(view, "code")) return [];
  const firstPlan = view.turns.find((t) => t.role === "plan");
  const firstCode = view.turns.find((t) => t.role === "code");
  return [finding3("same_model_roles", "info", { model: plan }, [
    ...firstPlan ? [turnEvidence(firstPlan)] : [],
    ...firstCode ? [turnEvidence(firstCode)] : []
  ])];
}

// src/runFindings/detectors/serialSingleWrites.ts
function serialSingleWrites(view) {
  const single = view.turns.filter((t) => t.calls.filter((c) => c.write).length === 1);
  if (single.length < RUN_FINDING_POLICY.serialSingleWriteTurns) return [];
  const promptTokens = single.reduce((sum, t) => sum + t.promptTokens, 0);
  return [finding3(
    "serial_single_writes",
    "warn",
    { turns: single.length, promptTokens },
    single.map((t) => {
      const write = t.calls.find((c) => c.write);
      return { ...turnEvidence(t, write.name), ...write.paths[0] ? { path: write.paths[0] } : {} };
    })
  )];
}

// src/runFindings/detectors/slowTurns.ts
function slowTurns(view) {
  const slow = view.turns.filter((t) => t.durationMs >= RUN_FINDING_POLICY.slowTurnMs);
  if (slow.length === 0) return [];
  const slowestMs = Math.max(...slow.map((t) => t.durationMs));
  return [finding3("slow_turns", "warn", { turns: slow.length, slowestMs }, slow.map((t) => ({ ...turnEvidence(t), note: "slowTurn", params: { ms: t.durationMs, completionTokens: t.completionTokens, argBytes: t.argBytes } })))];
}

// src/runFindings/detectors/stoppedUnverified.ts
function stoppedUnverified(view) {
  if (!view.stopped) return [];
  const files = unverifiedFiles(view);
  if (files.length === 0) return [];
  return [finding3("stopped_unverified", "error", { files: files.length }, [
    { step: view.stopped.step, label: STOPPED_TURN_STEP },
    ...files.map((f) => callEvidence(f.lastWrite, f.path))
  ])];
}

// src/runFindings/detectors/unkeptReadiness.ts
function readTurnsAfter(turns, from) {
  let n = 0;
  for (const t of turns) {
    if (t.index <= from) continue;
    if (t.kind !== "read") break;
    n += 1;
  }
  return n;
}
function unkeptReadiness(view) {
  const claims = view.turns.filter((t) => t.kind === "read" && claimsReady(t.text));
  const first = claims[0];
  if (!first) return [];
  const after = readTurnsAfter(view.turns, first.index);
  if (after < RUN_FINDING_POLICY.unkeptReadTurns) return [];
  return [finding3(
    "unkept_readiness",
    "warn",
    { claims: claims.length, readTurnsAfter: after },
    claims.map((t) => turnEvidence(t, "agent.message", t.text))
  )];
}

// src/runFindings/detectors/unverifiedWrites.ts
function unverifiedWrites(view) {
  const files = unverifiedFiles(view);
  if (files.length === 0) return [];
  const writes = writeCalls(view).filter((c) => c.paths.some((p) => files.some((f) => f.path === p))).length;
  return [finding3(
    "unverified_writes",
    "error",
    { files: files.length, writes },
    files.map((f) => callEvidence(f.lastWrite, f.path))
  )];
}

// src/runFindings/registry.ts
var RUN_FINDING_REGISTRY = [
  { kind: "analysis_overrun", detect: analysisOverrun },
  { kind: "unkept_readiness", detect: unkeptReadiness },
  { kind: "serial_single_writes", detect: serialSingleWrites },
  { kind: "prompt_bloat", detect: promptBloat },
  { kind: "unverified_writes", detect: unverifiedWrites },
  { kind: "bracket_break", detect: bracketBreak },
  { kind: "edit_churn", detect: editChurn },
  { kind: "filed_then_inline", detect: filedThenInline },
  { kind: "same_model_roles", detect: sameModelRoles },
  { kind: "oversized_args", detect: oversizedArgs },
  { kind: "slow_turns", detect: slowTurns },
  { kind: "repeated_narration", detect: repeatedNarration },
  { kind: "stopped_unverified", detect: stoppedUnverified },
  { kind: "review_cap_hit", detect: reviewCapHit }
];

// src/runFindings/runView.ts
var HAND_OFF_DUE = "loop.hand_off_due";
var ROLE_HANDOFF = "llm.role_handoff";
var record4 = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
function jsonBytes2(v) {
  try {
    return utf8ByteLength2(JSON.stringify(v ?? null));
  } catch {
    return 0;
  }
}
function isCheck(ev) {
  if (CHECK_TOOL.test(ev.label)) return true;
  return SHELL_TOOLS2.has(ev.label) && CHECK_COMMAND.test(commandOf(ev));
}
function callOf(ev, step, turn) {
  const ok = !ev.isError && !isFailedToolResult(ev.result);
  const args = record4(ev.args);
  const write = ok && isCodeChangeTool(ev.label) && !isCacheAnswered(ev);
  const err = record4(ev.result).error;
  return {
    step,
    turn,
    name: ev.label,
    args,
    ok,
    argBytes: jsonBytes2(ev.args),
    write,
    check: ok && isCheck(ev),
    paths: write ? editedPathsOf(ev.label, args) : [],
    ...!ok && typeof err === "string" ? { error: err } : {}
  };
}
function kindOf(t, failed3) {
  if (failed3) return "failed";
  if (t.forced) return "forced";
  if (t.calls.some((c) => c.write)) return "write";
  return t.toolCalls > 0 || t.calls.length > 0 ? "read" : "text";
}
function buildRunView(events, messages = []) {
  const list2 = [...events];
  const turns = [];
  const calls = [];
  let forcedNext = false;
  let stopped = null;
  for (const [i, ev] of list2.entries()) {
    const step = i + 1;
    const current = turns[turns.length - 1];
    if (ev.label === HAND_OFF_DUE) {
      forcedNext = true;
      continue;
    }
    if (ev.label === STOPPED_TURN_STEP) {
      const model = record4(ev.args).model;
      stopped = { step, ...typeof model === "string" ? { model } : {} };
      continue;
    }
    if (ev.label === "llm.complete") {
      const logged = modelTurnLog([ev])[0];
      if (!logged) continue;
      const failed3 = logged.failed === true;
      turns.push({
        index: turns.length + 1,
        step,
        role: logged.role ?? "",
        model: logged.model,
        kind: failed3 ? "failed" : "text",
        toolCalls: logged.toolCalls,
        promptTokens: ev.usage?.prompt ?? 0,
        completionTokens: logged.completionTokens ?? 0,
        durationMs: logged.durationMs ?? 0,
        argBytes: logged.argBytes ?? 0,
        forced: forcedNext && !failed3,
        text: "",
        calls: []
      });
      if (!failed3) forcedNext = false;
      stopped = null;
      continue;
    }
    if (!current) {
      if (ev.category === "tool") calls.push(callOf(ev, step, 0));
      continue;
    }
    if (ev.label === "agent.message" && typeof ev.result === "string" && !current.text) current.text = ev.result;
    else if (ev.label === ROLE_HANDOFF && typeof record4(ev.args).via === "string") current.handOffVia = record4(ev.args).via;
    else if (ev.category === "tool") {
      const call = callOf(ev, step, current.index);
      current.calls.push(call);
      calls.push(call);
    }
  }
  for (const t of turns) t.kind = kindOf(t, t.kind === "failed");
  return {
    events: list2,
    messages: [...messages],
    turns,
    calls,
    stopped,
    routing: routingByRole(modelTurnLog(list2), list2),
    staffing: staffingSummaryInTrace(list2)
  };
}

// src/runFindings/detectRunFindings.ts
var SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
var firstStep = (f) => f.evidence.reduce((min, e) => Math.min(min, e.step), Number.POSITIVE_INFINITY);
function compareFindings(a, b) {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || firstStep(a) - firstStep(b) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function summaryOf(view, findings, identity) {
  const ask = view.messages.find((m) => m.role === "user")?.content.replace(/\s+/g, " ").trim() ?? "";
  const max = RUN_FINDING_POLICY.excerptChars;
  const counts = { info: 0, warn: 0, error: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return {
    id: identity.id ?? "",
    title: identity.title ?? (ask.length > max ? `${ask.slice(0, max - 1).trimEnd()}\u2026` : ask),
    startedAt: view.events[0]?.ts ?? "",
    endedAt: view.events[view.events.length - 1]?.ts ?? "",
    models: [...new Set(view.turns.map((t) => t.model))],
    turns: view.turns.length,
    counts
  };
}
function detectRunFindings(events, messages = [], identity = {}) {
  const view = buildRunView(events, messages);
  const findings = withUniqueIds(RUN_FINDING_REGISTRY.flatMap((d) => d.detect(view)).sort(compareFindings));
  return {
    summary: summaryOf(view, findings, identity),
    turns: view.turns.map((t) => ({
      index: t.index,
      role: t.role,
      model: t.model,
      kind: t.kind,
      toolCalls: t.toolCalls,
      promptTokens: t.promptTokens,
      completionTokens: t.completionTokens,
      durationMs: t.durationMs
    })),
    findings,
    files: fileLedger(view).map((f) => ({ path: f.path, writes: f.writes, checked: f.checked }))
  };
}

// src/toolResultBudget.ts
var MAX_TOOL_RESULT_CHARS = DEFAULT_TOOL_OUTPUT_CHARS;
var READ_FILE_RESULT_CHARS2 = READ_FILE_RESULT_CHARS;
var READ_FILE_TOOL2 = READ_FILE_TOOL;
function trimToolResult(tool, out, opts = {}) {
  return shapeToolResult(tool, out, {
    advisory: opts.advisory,
    attachAdvisory: withAdvisory,
    summarize: opts.summarize ?? isCostLeverOn(void 0, "c7_tool_output_policy", null),
    ...opts.contextWindowTokens !== void 0 ? { contextWindowTokens: opts.contextWindowTokens } : {}
  });
}
function requestedReadWindow2(out, start, end) {
  return isReadFileResult(out) ? sliceReadFile(out, start, end) : out;
}

// src/providerFailureCause.ts
var RETRY_LABELS = /* @__PURE__ */ new Set(["llm.stream_interrupted", "llm.transport_error", "loop.model_failover"]);
var isFailedCompletion = (ev) => ev.label === "llm.complete" && (ev.isError === true || ev.category === "error");
var argsOf3 = (ev) => ev.args && typeof ev.args === "object" ? ev.args : {};
function providerFailureInTrace(events, messages = []) {
  const slices = splitRuns(events, messages);
  const run = slices[slices.length - 1]?.events ?? [];
  const completions = run.map((ev, i) => ({ ev, i })).filter(({ ev }) => ev.label === "llm.complete");
  const last = completions[completions.length - 1];
  if (!last || !isFailedCompletion(last.ev)) return null;
  const args = argsOf3(last.ev);
  const failure = args.failure && typeof args.failure === "object" ? args.failure : void 0;
  const previous = completions[completions.length - 2];
  const since = run.slice(previous ? previous.i + 1 : 0, last.i);
  const retried = since.some((ev) => RETRY_LABELS.has(ev.label));
  const reprompted = since.some((ev) => ev.label.startsWith("loop.recover_"));
  return {
    model: typeof args.model === "string" && args.model ? args.model : "default",
    message: typeof last.ev.result === "string" ? last.ev.result : String(last.ev.result ?? "unknown error"),
    failoverTried: retried,
    gateRepromptedNoTools: reprompted && failure?.toolCount === 0,
    answerKept: run.slice(last.i + 1).some((ev) => ev.label === "loop.reprompt_failed_answer_kept")
  };
}
function providerFailureVerdict(f) {
  const failover = f.failoverTried ? "A failover to another model was tried and failed too." : "No failover to another model was tried.";
  const gate = f.gateRepromptedNoTools ? " The request that failed came right after a delivery gate re-prompted the run: a delivery gate re-prompted a turn that offered no tools (the model was asked to act with nothing to act with)." : "";
  const headline = f.answerKept ? `PROVIDER FAILURE on the re-prompt \u2014 the run kept the answer it had already given. The re-prompt's completion on ${f.model} failed (${f.message}) and was not recovered.` : `PROVIDER FAILURE \u2014 the run's last completion on ${f.model} failed (${f.message}) and was not recovered, and the run ended on the error.`;
  return `${headline} ${failover}${gate} This is the provider's stream failing, not a tool the model was not offered: read the failed \`llm.complete\` step below.`;
}

// src/brainVerdict.ts
import { HISTORY_TOKEN_BUDGET as HISTORY_TOKEN_BUDGET2 } from "@seanhogg/builderforce-memory/working";
var CONTEXT_PROMPT_PEAK = Math.round(HISTORY_TOKEN_BUDGET2 * 1.5);
var LARGE_LOSSY_RESULT_BYTES = 2e4;
var VERDICT_RULES = [
  ["run-in-progress", (s) => s.running],
  ["stopped", (s) => s.outcome === "stopped"],
  ["memory-answered", (s) => s.memoryOnlyRun],
  ["provider-failure", (s) => s.providerFailure],
  ["spec-validation-incomplete", (s) => s.specValidationIncomplete === true],
  ["spec-check-failed", (s) => s.specValidationFailed === true],
  ["unanswered-question", (s) => s.outcome === "unanswered-question"],
  ["no-tools-advertised", (s) => s.noToolsAdvertised],
  ["tool-not-advertised", (s) => s.narratedUnadvertised],
  ["tool-calls-not-emitted", (s) => s.announcedUnmadeToolCall],
  ["answered-in-prose", (s) => s.answeredInProse],
  ["no-progress", (s) => s.noProgress],
  ["context-exhaustion", (s) => s.contextSignal && !s.degradationSignal],
  ["model-degradation", (s) => s.degradationSignal && !s.contextSignal],
  ["app-errors-unresolved", (s) => s.unresolvedAppFailures > 0],
  ["work-filed-not-staffed", (s) => s.workFiledNotStaffed],
  ["run-findings", (s) => (s.findingKinds?.length ?? 0) > 0],
  ["healthy", (s) => s.healthy]
];
function decideLikelyCause(signals) {
  return VERDICT_RULES.find(([, matches]) => matches(signals))?.[0] ?? "inconclusive";
}
var succeeded7 = (ev) => ev.category === "tool" && !ev.isError && !isFailedToolResult(ev.result);
function recoveredFailuresInTrace(events) {
  const lastOnTarget = /* @__PURE__ */ new Map();
  for (const ev of events) if (ev.category === "tool") lastOnTarget.set(callTargetKey(ev), ev);
  const recovered = /* @__PURE__ */ new Set();
  for (const ev of events) {
    if (!ev.isError || ev.category !== "tool") continue;
    const last = lastOnTarget.get(callTargetKey(ev));
    if (last && last !== ev && succeeded7(last)) recovered.add(ev);
  }
  return recovered;
}
function isHealthyRun(h) {
  return h.errors === h.recoveredFailures && !h.loopExhausted && h.emptyOrLengthFinishes === 0 && !h.contextSignal && !h.announcedUnmadeToolCall && !h.answeredInProse && !h.noProgress && h.unresolvedAppFailures === 0 && h.didWork;
}

// src/brainDiagnosticsText.ts
import { HISTORY_TOKEN_BUDGET as HISTORY_TOKEN_BUDGET3 } from "@seanhogg/builderforce-memory/working";
var kb = formatBytes;
function contextEvidence(d) {
  const parts = [];
  if (d.promptTokenPeak >= CONTEXT_PROMPT_PEAK) parts.push(`the prompt peaked at ${d.promptTokenPeak.toLocaleString("en-US")} tokens`);
  if (d.truncatedToolResults > 0) parts.push(`${d.truncatedToolResults} tool result(s) were trimmed to the ${toolResultBudgetText()} tool-result budget (by design)`);
  if (d.downgradeEvents > 0) parts.push(`${d.downgradeEvents} turn(s) were served by a smaller model than asked`);
  if (parts.length === 0 && d.largestToolResult) parts.push(`one ${d.largestToolResult.label} result was ${kb(d.largestToolResult.bytes)}`);
  return parts.length ? parts.join("; ") : "context pressure without a single dominant signal";
}
function toolResultBudgetText() {
  return `${Math.round(MAX_TOOL_RESULT_CHARS / 1e3)} KB`;
}
function contextPressureLine(d) {
  if (!d.contextPressureOnly) return null;
  const parts = [];
  if (d.tokensMeasured && d.promptTokenPeak > 0) parts.push(`prompt peaked at ${d.promptTokenPeak.toLocaleString("en-US")} tokens`);
  if (d.truncatedToolResults > 0) parts.push(`${d.truncatedToolResults} tool result(s) trimmed to the ${toolResultBudgetText()} budget by design`);
  if (!parts.length && d.largestToolResult) parts.push(`one ${d.largestToolResult.label} result was ${kb(d.largestToolResult.bytes)}`);
  return `Context: pressure noted (${parts.join(", ")}) \u2014 no turn was cut short by it. The working transcript has a ${HISTORY_TOKEN_BUDGET3.toLocaleString("en-US")}-token budget.`;
}
function healthyVerdict(d) {
  const recovered = d.recoveredFailures ?? 0;
  const pressure = d.contextPressureOnly ? " Context pressure was observed without a turn being cut short." : "";
  const failure = recovered > 0 ? `Completed \u2014 ${recovered} failed step(s) recovered. No unrecovered failure was recorded.` : "No failure signal was recorded.";
  return failure + pressure;
}
function verdictText(d) {
  const evermindAnswers = d.memoryAnswers?.filter((m) => m.source === "evermind") ?? [];
  switch (d.likelyCause) {
    case "run-in-progress":
      return 'Run in progress \u2014 verdict pending. The capture was taken while the run was still executing, so no cause is named and no "nothing was changed" claim is made; copy the report again once the run settles.';
    case "memory-answered":
      return `ANSWERED FROM MEMORY \u2014 no model ran this turn. The reply was served by the memory-first short-circuit (${(d.memoryAnswers ?? []).map((m) => m.source === "evermind" ? `the project Evermind SSM${m.projectId != null ? ` of project #${m.projectId}` : ""}${m.version != null ? ` v${m.version}` : ""}` : m.source === "symbol-index" ? "the workspace symbol index" : m.source === "deterministic" ? `the deterministic workspace action ${m.actionId ?? ""}`.trim() : "the Q&A cache").join(", ")}), so zero turns, zero tokens and zero tool calls is EXPECTED, not a fault. ${evermindAnswers.length ? "The Evermind SSM cannot call tools and answers only from what it has learned, so it can neither fetch live data nor do work \u2014 if the reply was wrong, garbled or stale, that is the cause. Turn Memory off for this chat, or disable inference on that head." : (d.memoryAnswers ?? []).every((m) => m.source === "symbol-index") ? 'The request was only "where is X defined?" and the symbol index resolved every name, so the definitions were listed without a model; ask for anything more to reach the model.' : (d.memoryAnswers ?? []).every((m) => m.source === "symbol-index" || m.source === "deterministic") ? "A deterministic workspace action (the PreFetch gate) settled the request without a model; ask for anything more to reach the model." : "The reply is a replay of an earlier answer to the same question; ask a differently-worded question to reach the model."} Switching models changes nothing here.`;
    case "provider-failure":
      return d.providerFailure ? providerFailureVerdict(d.providerFailure) : "PROVIDER FAILURE \u2014 the run's last completion failed and was not recovered.";
    case "spec-validation-incomplete":
      return "PRD validation ended with unverified acceptance requirements.";
    case "spec-check-failed":
      return "One or more PRD acceptance checks exited with a failure.";
    case "no-tools-advertised":
      return 'NO TOOLS ADVERTISED \u2014 at least one turn was handed ZERO tool definitions, so it could not have emitted a call whatever it wanted to do. This is a catalog/config failure on our side, not a model fault: the gateway MCP catalog (`/llm/v1/mcp/tools`) failed to load, or no actions were registered for this surface. See the "Tools available to the model" line in the Chat diagnostics block for the fetch error. Switching models will not help.';
    case "tool-not-advertised":
      return `TOOL NOT ADVERTISED \u2014 a turn wrote out ${d.narratedUnadvertisedTools.map((n) => `\`${n}\``).join(", ")} as prose while that tool was NOT among the ones it was offered that turn. No model can emit a call for a function it was never given, so this is OUR per-turn tool selection dropping a tool the prompt asked for \u2014 not a model that "won't call tools". Fix the selection (pin the tool, or name it in the system prompt so it is force-included) rather than switching models.`;
    case "tool-calls-not-emitted":
      return 'TOOL CALLS NOT EMITTED \u2014 a turn NARRATED a tool call in prose ("I\'ll call the tool\u2026", a bare `builtin_\u2026` name) but the run recorded ZERO tool steps, so nothing executed and the answer never got its data. The tools WERE advertised and the agent loop only runs structured `tool_calls`, so this is a model/provider fault: the model is describing calls instead of emitting them. Try a different model.';
    case "answered-in-prose":
      return "ANSWERED IN PROSE \u2014 at least one turn was handed tool definitions but replied with text and ZERO tool calls, so nothing ran. The tools were advertised; the model described the work instead of doing it. This is a model/provider fault: try a different model, or pin one that emits structured calls.";
    case "no-progress":
      return (d.progress && runProgressVerdict(d.progress)) ?? "NO PROGRESS \u2014 the run repeated work without advancing.";
    case "stopped":
      return "The latest run stopped before normal settlement.";
    case "unanswered-question":
      return "The latest run ended without answering the question.";
    case "run-findings":
      return `The trace recorded these findings: ${d.findingKinds?.join(", ")}.`;
    case "context-exhaustion":
      return `Likely CONTEXT EXHAUSTION (case A) \u2014 ${contextEvidence(d)}.`;
    case "model-degradation":
      return "Likely MODEL DEGRADATION (case B) \u2014 an Evermind/SSM turn returned empty while tokens stayed low.";
    case "app-errors-unresolved":
      return `APP STILL BROKEN \u2014 every tool call succeeded, but the run's last diagnostics read still reported ${d.unresolvedAppFailures} build/runtime failure(s) in the app it was working on. The tools are fine; the app is not. Read that diagnostics result in the trace below for the error \u2014 if it points into a package CDN or the preview runtime rather than the project's own files, the fault is the platform's, and rewriting project files will not fix it.`;
    case "work-filed-not-staffed":
      return workFiledNotStaffedVerdict(d.staffing);
    case "healthy":
      return healthyVerdict(d);
    case "inconclusive":
      return "Inconclusive \u2014 not enough signal to separate context exhaustion from model degradation.";
    default: {
      const unhandled = d.likelyCause;
      return `Unrecognised verdict: ${String(unhandled)}`;
    }
  }
}
function formatBrainDiagnostics(d) {
  const lines = ["--- Diagnostics ---", `Likely cause: ${verdictText(d)}`];
  if (d.specValidation) {
    const { completed, failed: failed3, pending, unverified } = d.specValidation;
    lines.push(completed === 0 ? `PRD validation is unverified. No check completed. Background jobs still pending at settlement: ${pending}.` : `PRD validation recorded ${completed} completed check(s), including ${failed3} with a failing exit. Background jobs still pending at settlement: ${pending}.`);
    if (unverified > 0) lines.push(`Declared acceptance checks still unverified: ${unverified}.`);
  }
  const scope = d.turnCoveragePartial ? " (this session)" : "";
  lines.push(`Turns${scope}: ${d.turns} \xB7 Tool calls: ${d.toolCalls} \xB7 Errors: ${d.errors}${d.recoveredFailures ? ` (${d.recoveredFailures} recovered)` : ""}${d.loopExhausted ? " \xB7 LOOP EXHAUSTED" : ""}`);
  if (d.tokensMeasured) {
    lines.push(
      `Tokens${scope}: prompt peak ${d.promptTokenPeak.toLocaleString()} \xB7 last-turn prompt ${d.lastPromptTokens.toLocaleString()} \xB7 completion total ${d.completionTokenTotal.toLocaleString()}`
    );
  } else {
    lines.push("Tokens: not reported by the gateway for this run.");
  }
  if (d.turnCoveragePartial) {
    lines.push(
      "Coverage: tool steps were recovered from this chat's durable history, but its earlier TURNS predate durable turn records \u2014 so the turn and token counts above describe only the current session, not the whole conversation. Send a new turn to capture a fully-measured run."
    );
  }
  lines.push(
    `Tool results: ${kb(d.toolResultBytes)} total${d.largestToolResult ? ` \xB7 largest ${d.largestToolResult.label} (${kb(d.largestToolResult.bytes)})` : ""}${d.truncatedToolResults ? ` \xB7 ${d.truncatedToolResults} trimmed to the ${toolResultBudgetText()} per-result budget (by design)` : ""}${d.pagedReadWindows ? ` \xB7 ${d.pagedReadWindows} read_file window(s) paged (continued by offset, not lost)` : ""}`
  );
  const pressure = contextPressureLine(d);
  if (pressure) lines.push(pressure);
  lines.push(...d.progress ? formatRunProgress(d.progress, { running: d.running }) : []);
  if (d.memoryUsage) lines.push(formatMemoryUsage(d.memoryUsage));
  lines.push(...d.staffing ? formatStaffingSummary(d.staffing, { sessionWork: d.sessionWork }) : []);
  if (d.errorSteps?.length) {
    for (const e of d.errorSteps) {
      lines.push(
        `Failed step: ${e.label}${e.model ? ` on ${e.model}` : ""}${e.recovered ? " (recovered by a later successful retry)" : ""} \u2014 ${e.message}` + (e.requiredRole || e.callerRole ? ` \u2014 requires ${e.requiredRole ?? "unknown"}, caller is ${e.callerRole ?? "unknown"}${e.remediation ? `; ${e.remediation}` : ""}` : "")
      );
      if (e.failure) lines.push(`  ${describeStreamFailure(e.failure)}`);
    }
    if (d.errors > d.errorSteps.length) lines.push(`(+${d.errors - d.errorSteps.length} earlier failure(s) not listed)`);
  }
  if (d.advertisedToolsLastTurn != null) {
    const range = d.advertisedToolsMin != null && d.advertisedToolsMin !== d.advertisedToolsLastTurn ? `${d.advertisedToolsMin}\u2013${d.advertisedToolsLastTurn}` : `${d.advertisedToolsLastTurn}`;
    lines.push(
      `Tools advertised per turn: ${range}${d.catalogTools ? ` (of ${d.catalogTools} in the catalog)` : ""}${d.advertisedToolsMin === 0 ? " \xB7 \u26A0 a turn was offered NONE" : ""}`
    );
  } else {
    lines.push("Tools advertised per turn: not recorded (this run predates per-turn tool accounting).");
  }
  if (d.narratedUnadvertisedTools.length) {
    lines.push(`Narrated but never advertised: ${d.narratedUnadvertisedTools.join(", ")} \u2014 the model was told to call a tool it was not given.`);
  }
  if (d.stallRecoveries > 0 || d.modelFailovers > 0 || d.stallUnrecovered) {
    lines.push(
      `Stall handling: ${d.stallRecoveries} re-prompt(s) \xB7 ${d.modelFailovers} model failover(s)${d.stallUnrecovered ? " \xB7 GAVE UP (the stall survived every attempt)" : d.stallRecovered ? " \xB7 recovered" : " \xB7 NOT recovered (no tool ran after the last re-prompt \u2014 the run ended on a turn the stall detector accepted as an answer)"}`
    );
  }
  if (d.streamRetries?.length) {
    lines.push(`Stream retries: ${d.streamRetries.length} \u2014 ${d.streamRetries.join(", ")} broke mid-turn and the turn was retried on another model (one retry per turn).`);
  }
  lines.push(...formatModelScorecard(d.modelScores ?? []));
  lines.push(...formatRoutingByRole(d.routing));
  lines.push(...formatModelTurnLog(d.modelTurns ?? []));
  if (d.downgradeEvents > 0) lines.push(`Model downgrades: ${d.downgradeEvents} turn(s) answered by a different model than requested (gateway failover).`);
  if (d.emptyOrLengthFinishes > 0) lines.push(`Degenerate turns: ${d.emptyOrLengthFinishes} ended on \`length\` or returned empty text.`);
  if (d.evermindUsed.length) lines.push(`Evermind/SSM answered: ${d.evermindUsed.join(", ")}`);
  if (d.memoryAnswers?.length) {
    lines.push(
      `Answered from memory (LLM skipped): ${d.memoryAnswers.length} turn(s) \u2014 ` + d.memoryAnswers.map((m) => m.source === "evermind" ? `Evermind SSM${m.projectId != null ? ` (project #${m.projectId}` : ""}${m.version != null ? `${m.projectId != null ? ", " : " ("}v${m.version}` : ""}${m.projectId != null || m.version != null ? ")" : ""}` : m.source === "symbol-index" ? "symbol index" : m.source === "deterministic" ? `workspace action ${m.actionId ?? ""}`.trim() : "Q&A cache").join(", ")
    );
  }
  if (d.workflow) lines.push(...formatWorkflowDiagnostics(d.workflow));
  return lines;
}

// src/toolExposure.ts
function toolExposureInTrace(events) {
  let lastTurn = null;
  let min = null;
  let catalog = null;
  let finishTurnsLeft = 0;
  for (const ev of events) {
    if (ev.category === "message" && ev.label === PROGRESS_FORCED_LABEL) {
      const f = ev.args;
      if (f?.forced === "finish") finishTurnsLeft = typeof f.recordTools === "number" && f.recordTools > 0 ? FINISH_RECORD_TURNS + 1 : 1;
    }
    if (ev.category !== "llm") continue;
    const a = ev.args;
    const finalReport = finishTurnsLeft > 0 && a?.advertisedTools === 0;
    if (typeof a?.advertisedTools === "number") finishTurnsLeft = finalReport ? 0 : Math.max(0, finishTurnsLeft - 1);
    if (!finalReport && typeof a?.advertisedTools === "number") {
      lastTurn = a.advertisedTools;
      min = min == null ? a.advertisedTools : Math.min(min, a.advertisedTools);
    }
    if (typeof a?.catalogTools === "number") catalog = a.catalogTools;
  }
  return { lastTurn, min, catalog };
}
function formatAdvertised(tools, defaultToolLimit) {
  const last = tools.advertisedLastTurn;
  const min = tools.advertisedMin;
  if (last != null) {
    const range = min != null && min !== last ? `${min}\u2013${last}` : `${last}`;
    return ` \xB7 ${range} advertised per turn (measured)${min === 0 ? " \xB7 \u26A0 a turn was offered NONE" : ""}`;
  }
  if (tools.count > defaultToolLimit) {
    return ` \xB7 per-turn selection capped at ${defaultToolLimit}, not yet measured (no turn in this run advertised tools)`;
  }
  return "";
}

// src/brainTriage.ts
var FILE_WRITE_TOOL = /(attachments|files?|project_files)[._](write|save|update)/i;
function isFileWriteTool(label) {
  return isCodeChangeTool(label) || FILE_WRITE_TOOL.test(label);
}
var UNBACKED_WRITE_CLAIM_NOTICE = "\u26A0 UNBACKED WRITE CLAIM \u2014 an assistant turn claimed it saved/updated a file, but no file-write tool (write_file / edit_file / attachments.write / project_files.save) succeeded in this run. The file was NOT modified.";
var UNBACKED_TICKET_CLAIM_NOTICE = "\u26A0 UNBACKED TICKET CLAIM \u2014 an assistant turn claimed it created/filed/linked a ticket or gap, but no create/link tool (tasks.create / chats.link_ticket / tickets.from_delta) succeeded in this run. Nothing was filed or linked to the chat.";
var FILE_SAVE_CLAIM = /\b(saved|updated|wrote|written|edited|persisted|added)\b[^.!?\n]*\b(file|attachment|roadmap|document|upload|\.md|\.csv|\.txt|\.json)\b/i;
var TICKET_CLAIM = /\b(created|filed|opened|logged|added|linked|tracked)\b[^.!?\n]*\b(ticket|task|gap|epic|issue|objective|bug|card|board)\b/i;
function detectUnbackedWriteClaim(events, messages) {
  const wroteOk = events.some(
    (e) => e.category === "tool" && isFileWriteTool(e.label) && !e.isError && !isFailedToolResult(e.result)
  );
  if (wroteOk) return false;
  return messages.some((m) => isModelReply(m) && typeof m.content === "string" && FILE_SAVE_CLAIM.test(m.content));
}
function detectUnbackedTicketClaim(events, messages) {
  const filedOk = events.some(
    (e) => e.category === "tool" && isTicketWriteTool(e.label) && !e.isError && !isFailedToolResult(e.result)
  );
  if (filedOk) return false;
  return messages.some((m) => isModelReply(m) && typeof m.content === "string" && TICKET_CLAIM.test(m.content));
}
function detectAnnouncedButUnmadeToolCall(events, messages) {
  if (events.some((e) => e.category === "tool")) return false;
  return messages.some(
    (m) => isModelReply(m) && typeof m.content === "string" && announcesUntakenAction(m.content)
  );
}
var LOOP_STEP = {
  recovery: "loop.recover_announced_tool_call",
  failover: "loop.model_failover",
  unrecovered: "loop.stall_unrecovered"
};
function stallRecoveriesInTrace(events) {
  return events.filter((e) => e.label === LOOP_STEP.recovery).length;
}
function modelFailoversInTrace(events) {
  return events.reduce((count2, event) => {
    if (event.label === LOOP_STEP.failover) return count2 + 1;
    if (event.label !== "llm.complete") return count2;
    const value = event.args?.failovers;
    return count2 + (typeof value === "string" ? value.split(FAILOVER_SEPARATOR).filter((part) => part.trim()).length : 0);
  }, 0);
}
function stallUnrecoveredInTrace(events) {
  return events.some((e) => e.label === LOOP_STEP.unrecovered);
}
function stallRecoveredInTrace(events) {
  let lastRecovery = -1;
  events.forEach((e, i) => {
    if (e.label === LOOP_STEP.recovery) lastRecovery = i;
  });
  return lastRecovery >= 0 && events.slice(lastRecovery + 1).some((e) => e.category === "tool");
}
function streamRetriesInTrace(events) {
  return events.filter((e) => e.label === "llm.stream_interrupted").map((e) => {
    const model = e.args?.model;
    return typeof model === "string" && model ? model : "unknown model";
  });
}
function narratedUnadvertisedInTrace(events) {
  const seen = [];
  for (const ev of events) {
    const raw = ev.args?.narratedUnadvertised;
    if (!Array.isArray(raw)) continue;
    for (const n of raw) {
      if (typeof n === "string" && n && !seen.includes(n)) seen.push(n);
    }
  }
  return seen;
}
function answeredInProseInTrace(events) {
  return events.some(
    (ev) => ev.args?.answeredInProse === true
  );
}
var SYMBOL_ANSWER_ACTION = "symbols.where-defined";
function memoryAnswersInTrace(events) {
  const out = [];
  for (const ev of events) {
    if (ev.category !== "recall") continue;
    const r = ev.result;
    const prefetched = r?.route === "answer";
    if (!prefetched && ev.label !== "evermind.answer" && ev.label !== "memory.answer" && ev.label !== "symbols.answer") continue;
    if (r?.skippedLlm !== true) continue;
    const symbolIndex = r.source === "symbol-index" || r.source === SYMBOL_ANSWER_ACTION;
    out.push({
      source: r.source === "evermind" ? "evermind" : symbolIndex ? "symbol-index" : prefetched ? "deterministic" : "qa-cache",
      ...prefetched && !symbolIndex && typeof r.source === "string" ? { actionId: r.source } : {},
      ...typeof r.version === "number" ? { version: r.version } : {},
      ...typeof r.evermindProjectId === "number" ? { projectId: r.evermindProjectId } : {}
    });
  }
  return out;
}
function cap(s, n = 2e3) {
  const str5 = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return str5.length > n ? str5.slice(0, n) + `\u2026 (+${str5.length - n} chars)` : str5;
}
function isEvermindModel(model) {
  return /(^|\/)evermind\b|^project_evermind:|^tenant_model:/i.test(model);
}
function modelsUsedInTrace(events) {
  const seen = [];
  for (const ev of events) {
    if (ev.category !== "llm" && ev.category !== "error" && ev.label !== STOPPED_TURN_STEP) continue;
    const m = ev.args?.model;
    if (typeof m === "string" && m && m !== "default" && !seen.includes(m)) seen.push(m);
  }
  return seen;
}
function accountUsedInTrace(events) {
  let account;
  for (const ev of events) {
    if (ev.category !== "llm") continue;
    const a = ev.args?.account;
    if (typeof a === "string" && a) account = a;
  }
  return account;
}
function byoUnresolvedInTrace(events) {
  const seen = [];
  for (const ev of events) {
    if (ev.category !== "llm") continue;
    const raw = ev.args?.byoUnresolved;
    if (typeof raw !== "string" || !raw) continue;
    for (const p of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!seen.includes(p)) seen.push(p);
    }
  }
  return seen;
}
function parseByoUnresolved(entries) {
  return entries.map((e) => {
    const i = e.indexOf(":");
    return i === -1 ? { provider: e, reason: "" } : { provider: e.slice(0, i), reason: e.slice(i + 1) };
  });
}
function byoReasonHint(reason) {
  switch (reason) {
    case "revoked":
      return "its token was revoked or expired \u2014 reconnect it in the web app under Settings \u25B8 API Keys";
    case "expired":
      return "its token expired and the refresh failed (often transient) \u2014 retry, or reconnect it under Settings \u25B8 API Keys";
    case "undecryptable":
      return "its stored credential could not be read \u2014 re-enter it under Settings \u25B8 API Keys";
    case "unsupported-auth":
      return "it is stored as a subscription (OAuth) but this provider only supports an API key \u2014 re-connect it with an API key under Settings \u25B8 API Keys";
    case "other-workspace":
      return "you connected this account in a DIFFERENT workspace \u2014 switch to that workspace, or connect it in this one under Settings \u25B8 API Keys";
    default:
      return "it could not be used this run \u2014 reconnect it under Settings \u25B8 API Keys";
  }
}
function byoUnresolvedSummary(entry) {
  return `${entry.provider}${entry.reason ? ` (${entry.reason})` : ""}: ${byoReasonHint(entry.reason)}`;
}
function accountLabel(account) {
  return account === "own" ? "the tenant's own connected account" : account === "shared_byo_unused" ? "the shared model pool (a connected account existed but was NOT used)" : account === "shared" ? "the shared model pool" : account;
}
function formatBrainProvenance(events, opts = {}) {
  const lines = [];
  if (opts.surface) lines.push(`Surface: ${opts.surface}`);
  lines.push(`Configured model: ${opts.configuredModel || "(gateway auto-select)"}`);
  const used = modelsUsedInTrace(events);
  if (used.length) lines.push(`Models used: ${used.join(", ")}`);
  const evermind = used.filter(isEvermindModel);
  if (evermind.length) lines.push(`Evermind: yes \u2014 ${evermind.join(", ")}`);
  const account = accountUsedInTrace(events);
  if (account) lines.push(`Account: ${accountLabel(account)}`);
  const byoUnresolved = parseByoUnresolved(byoUnresolvedInTrace(events));
  if (byoUnresolved.length) {
    lines.push("\u26A0 CONNECTED ACCOUNT NOT USED \u2014 a connected account existed but the run fell back to the shared pool instead of your own model:");
    for (const e of byoUnresolved) lines.push(`  \u2022 ${byoUnresolvedSummary(e)}`);
  }
  return lines;
}
var ROLE_GATE_REMEDIATION = "Re-select the workspace or ask a manager to raise your role.";
function parseRoleGateRefusal(message) {
  const m = typeof message === "string" ? message.match(/requires at least the '([^']+)' role \(caller has '([^']+)'\)/) : null;
  return { requiredRole: m?.[1] ?? null, callerRole: m?.[2] ?? null };
}
function unresolvedAppFailuresInTrace(events) {
  let last = 0;
  for (const ev of events) {
    if (ev.category !== "tool" || ev.isError) continue;
    const r = ev.result;
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const o = r;
    if (typeof o.failures !== "number") continue;
    if (o.failures > 0 && typeof o.report !== "string") continue;
    last = o.failures;
  }
  return last;
}
var MAX_REPORTED_ERRORS = 5;
var MAX_ERROR_CHARS = 240;
function errorMessageOf(e) {
  const r = e.result;
  let text;
  if (typeof r === "string") text = r;
  else if (r && typeof r === "object") {
    const o = r;
    text = typeof o.error === "string" && o.error ? o.error : typeof o.output === "string" && o.output ? o.output : JSON.stringify(r);
  } else text = String(r ?? "(no message)");
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_ERROR_CHARS ? `${flat.slice(0, MAX_ERROR_CHARS)}\u2026` : flat || "(no message)";
}
function byteLen(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length;
}
var MEMORY_READ_TOOLS = /* @__PURE__ */ new Set(["recall_facts", "builtin_recall_facts"]);
function memoryUsageInTrace(events) {
  const out = {
    evermindRecalls: 0,
    evermindItems: 0,
    evermindPromptTokens: 0,
    learnSteps: 0,
    reconcileSteps: 0,
    factsRead: 0,
    factsWritten: 0
  };
  for (const ev of events) {
    if (ev.category === "recall" && ev.label === "evermind.recall") {
      out.evermindRecalls += 1;
      const result = ev.result;
      if (result && typeof result === "object") {
        const count2 = result.count;
        if (typeof count2 === "number") out.evermindItems += count2;
        const tokens = result.blockTokens;
        if (typeof tokens === "number") out.evermindPromptTokens += tokens;
      }
    } else if (ev.category === "learn") {
      out.learnSteps += 1;
    } else if (ev.category === "reconcile") {
      out.reconcileSteps += 1;
    } else if (ev.category === "tool" && !ev.isError && !isFailedToolResult(ev.result)) {
      if (MEMORY_READ_TOOLS.has(ev.label)) out.factsRead += 1;
      if (REMEMBER_FACT_TOOLS.has(ev.label)) out.factsWritten += 1;
    }
  }
  return out;
}
function formatMemoryUsage(m) {
  const used = m.evermindRecalls + m.learnSteps + m.reconcileSteps + m.factsRead + m.factsWritten;
  if (used === 0) {
    return "BuilderForce memory: none recorded in this run \u2014 no Evermind recall step, no learn/reconcile, no recall_facts/remember_fact. A recall the loop did not trace is indistinguishable from one that never ran.";
  }
  const tok = m.evermindPromptTokens > 0 ? `, ~${m.evermindPromptTokens.toLocaleString("en-US")} prompt tok` : "";
  return `BuilderForce memory: Evermind recalls ${m.evermindRecalls} (${m.evermindItems} item(s)${tok}) \xB7 learn steps ${m.learnSteps} \xB7 reconcile ${m.reconcileSteps} \xB7 project-fact reads ${m.factsRead} \xB7 project-fact writes ${m.factsWritten}`;
}
function computeBrainDiagnostics(events, requestedModel, messages = [], ctx = {}) {
  const llm = events.filter((e) => e.category === "llm");
  const toolEvents = events.filter((e) => e.category === "tool");
  const errors = events.filter((e) => e.isError || e.category === "error");
  const loopExhausted = events.some((e) => e.label === "agent.loop" && e.isError);
  let promptTokenPeak = 0;
  let completionTokenTotal = 0;
  let lastPromptTokens = 0;
  let tokensMeasured = false;
  let emptyOrLengthFinishes = 0;
  let downgradeEvents = 0;
  const req = requestedModel && requestedModel !== "default" ? requestedModel : void 0;
  for (const ev of llm) {
    const u = ev.usage;
    if (u) {
      tokensMeasured = true;
      if (typeof u.prompt === "number") {
        promptTokenPeak = Math.max(promptTokenPeak, u.prompt);
        lastPromptTokens = u.prompt;
      }
      if (typeof u.completion === "number") completionTokenTotal += u.completion;
    }
    const emptyText = typeof ev.textChars === "number" && ev.textChars === 0;
    const toolCallsThisTurn = ev.args?.toolCalls;
    const askedNoTools = typeof toolCallsThisTurn === "number" ? toolCallsThisTurn === 0 : true;
    if (turnInterruption(ev.finishReason) || emptyText && askedNoTools) emptyOrLengthFinishes += 1;
    const a = ev.args;
    const asked = typeof a?.requestedModel === "string" && a.requestedModel !== "default" ? a.requestedModel : req;
    const resolved = a?.model;
    if (asked && typeof resolved === "string" && resolved && resolved !== "default" && resolved !== asked) downgradeEvents += 1;
  }
  let toolResultBytes = 0;
  let truncatedToolResults = 0;
  let pagedReadWindows = 0;
  let largestLossyResultBytes = 0;
  let largestToolResult = null;
  for (const ev of toolEvents) {
    const bytes = typeof ev.resultBytes === "number" ? ev.resultBytes : byteLen(ev.result);
    toolResultBytes += bytes;
    const paged = ev.label === READ_FILE_TOOL2;
    if (ev.truncated) {
      if (paged) pagedReadWindows += 1;
      else truncatedToolResults += 1;
    }
    if (!paged && bytes > largestLossyResultBytes) largestLossyResultBytes = bytes;
    if (!largestToolResult || bytes > largestToolResult.bytes) largestToolResult = { label: ev.label, bytes };
  }
  const recovered = recoveredFailuresInTrace(events);
  const errorSteps = errors.slice(-MAX_REPORTED_ERRORS).reverse().map((e) => {
    const model = e.args?.model;
    const failure = e.args?.failure;
    const message = errorMessageOf(e);
    const gate = parseRoleGateRefusal(message);
    return {
      label: e.label,
      message,
      ...typeof model === "string" && model !== "default" ? { model } : {},
      ...failure && typeof failure === "object" ? { failure } : {},
      ...gate.requiredRole ? { requiredRole: gate.requiredRole, remediation: ROLE_GATE_REMEDIATION } : {},
      ...gate.callerRole ? { callerRole: gate.callerRole } : {},
      ...recovered.has(e) ? { recovered: true } : {}
    };
  });
  const modelsUsed = modelsUsedInTrace(events);
  const modelScores = modelScorecard(events);
  const modelTurns = modelTurnLog(events);
  const routing = routingByRole(modelTurns, events);
  const evermindUsed = modelsUsed.filter(isEvermindModel);
  const memoryAnswers = memoryAnswersInTrace(events);
  const recoveredToolEvents = toolEvents.filter((e) => e.recovered).length;
  const recoveredTurns = llm.filter((e) => e.recovered).length;
  const turnCoveragePartial = recoveredToolEvents > 0 && recoveredTurns === 0;
  const contextPressure = promptTokenPeak >= CONTEXT_PROMPT_PEAK || truncatedToolResults > 0 || downgradeEvents > 0 || largestLossyResultBytes >= LARGE_LOSSY_RESULT_BYTES;
  const contextConsequence = emptyOrLengthFinishes > 0 || downgradeEvents > 0 || loopExhausted || errors.some((e) => e.label === "llm.complete");
  const contextSignal = contextPressure && contextConsequence;
  const contextPressureOnly = contextPressure && !contextConsequence;
  const degradationSignal = evermindUsed.length > 0 && emptyOrLengthFinishes > 0 && (!tokensMeasured || promptTokenPeak < CONTEXT_PROMPT_PEAK) && truncatedToolResults === 0;
  const didWork = toolEvents.length > 0 || completionTokenTotal > 0 || llm.length > 0;
  const announcedUnmadeToolCall = detectAnnouncedButUnmadeToolCall(events, messages);
  const stallRecoveries = stallRecoveriesInTrace(events);
  const modelFailovers = modelFailoversInTrace(events);
  const stallUnrecovered = stallUnrecoveredInTrace(events);
  const stallRecovered = stallRecoveredInTrace(events);
  const streamRetries = streamRetriesInTrace(events);
  const exposure = toolExposureInTrace(events);
  const narratedUnadvertisedTools = narratedUnadvertisedInTrace(events);
  const answeredInProse = toolEvents.length === 0 && answeredInProseInTrace(events);
  const noToolsAdvertised = exposure.min === 0 && toolEvents.length === 0;
  const memoryOnlyRun = memoryAnswers.length > 0 && llm.length === 0;
  const progress = computeRunProgress(events, messages);
  const noProgress = progress.spinning || spunEarlier(progress) !== null || progress.noEffect && !ctx.running;
  const staffing = staffingSummaryInTrace(events);
  const sessionShipped = sessionShippedInTrace(events);
  const sessionWork = sessionWorkInTrace(events);
  const memoryUsage = memoryUsageInTrace(events);
  const workFiledNotStaffed = sessionWork === 0 && (staffing.verdict === "filed-not-staffed" || staffing.verdict === "staffing-refused");
  const unresolvedAppFailures = unresolvedAppFailuresInTrace(events);
  const running = ctx.running === true;
  const providerFailure = running ? null : providerFailureInTrace(events, messages);
  const latest = splitRuns(events, messages).at(-1);
  const validation = latest.events.filter((event) => event.label === "run.spec_validation").at(-1)?.args;
  const specValidation = validation;
  const stopped = latest.events.some((event) => event.label === STOPPED_TURN_STEP);
  const answered = latest.messages.some((message) => message.role === "assistant" && message.content.trim());
  const outcome = running ? void 0 : stopped ? "stopped" : answered ? "answered" : hasExplicitQuestionIntent(classifyRequest(latest.ask)) && latest.events.some((event) => event.label === "llm.complete") ? "unanswered-question" : void 0;
  const findingKinds = detectRunFindings(latest.events, latest.messages).findings.filter((finding4) => finding4.severity !== "info").map((finding4) => finding4.kind);
  const likelyCause = decideLikelyCause({
    running,
    specValidationIncomplete: specValidation?.incomplete === true,
    specValidationFailed: (specValidation?.failed ?? 0) > 0,
    memoryOnlyRun,
    providerFailure: providerFailure !== null,
    noToolsAdvertised,
    narratedUnadvertised: narratedUnadvertisedTools.length > 0,
    announcedUnmadeToolCall,
    answeredInProse,
    noProgress,
    outcome,
    findingKinds,
    contextSignal,
    degradationSignal,
    unresolvedAppFailures,
    workFiledNotStaffed,
    healthy: isHealthyRun({
      errors: errors.length,
      recoveredFailures: recovered.size,
      loopExhausted,
      emptyOrLengthFinishes,
      contextSignal,
      announcedUnmadeToolCall,
      answeredInProse,
      noProgress,
      unresolvedAppFailures,
      didWork
    })
  });
  return {
    ...outcome ? { outcome } : {},
    workflow: workflowDiagnostics(events),
    findingKinds,
    turns: llm.length,
    toolCalls: toolEvents.length,
    errors: errors.length,
    errorSteps,
    recoveredFailures: recovered.size,
    running,
    loopExhausted,
    tokensMeasured,
    promptTokenPeak,
    completionTokenTotal,
    lastPromptTokens,
    toolResultBytes,
    truncatedToolResults,
    pagedReadWindows,
    largestToolResult,
    modelsUsed,
    modelScores,
    modelTurns,
    routing,
    evermindUsed,
    downgradeEvents,
    emptyOrLengthFinishes,
    announcedUnmadeToolCall,
    stallRecoveries,
    modelFailovers,
    stallUnrecovered,
    stallRecovered,
    streamRetries,
    advertisedToolsLastTurn: exposure.lastTurn,
    advertisedToolsMin: exposure.min,
    catalogTools: exposure.catalog,
    narratedUnadvertisedTools,
    answeredInProse,
    memoryAnswers,
    turnCoveragePartial,
    progress,
    contextPressureOnly,
    staffing,
    sessionShipped,
    sessionWork,
    ...typeof specValidation?.completed === "number" && typeof specValidation.failed === "number" && typeof specValidation.pending === "number" ? { specValidation: { completed: specValidation.completed, failed: specValidation.failed, pending: specValidation.pending, unverified: specValidation.unverified ?? 0, incomplete: specValidation.incomplete === true } } : {},
    memoryUsage,
    unresolvedAppFailures,
    providerFailure,
    likelyCause
  };
}
function buildBrainTriageReport(opts) {
  const { capturedAt, messages = [], chatId, chatTitle, agentLabel, configuredModel, surface, error, running, activity } = opts;
  const events = traceWithPersistedSteps(messages, opts.events);
  const errors = events.filter((e) => e.isError || e.category === "error");
  const lines = [];
  lines.push("=== BuilderForce Brain Triage ===");
  lines.push(`Captured:  ${capturedAt}`);
  if (chatId != null) lines.push(`Chat:      #${chatId}${chatTitle ? ` \u2014 ${chatTitle}` : ""}`);
  lines.push(`Brain:     ${agentLabel || "Brain (default)"}`);
  lines.push(...formatBrainProvenance(events, { configuredModel, surface }));
  lines.push(`Steps: ${events.length} \xB7 Errors: ${errors.length} \xB7 Messages: ${messages.length}`);
  if (error) lines.push(`Last error: ${error}`);
  if (running) lines.push(midRunNotice(activity, Date.parse(capturedAt)));
  lines.push("", ...formatBrainDiagnostics(computeBrainDiagnostics(events, configuredModel, messages, { running })));
  if (detectUnbackedWriteClaim(events, messages)) lines.push("", UNBACKED_WRITE_CLAIM_NOTICE);
  if (detectUnbackedTicketClaim(events, messages)) lines.push("", UNBACKED_TICKET_CLAIM_NOTICE);
  if (errors.length) {
    lines.push("", `--- Errors (${errors.length}) ---`);
    for (const ev of errors) {
      lines.push(`[${ev.ts}] ${ev.label} (${ev.category}) \u2014 ${cap(ev.result ?? ev.args ?? "")}`);
    }
  }
  lines.push("", `--- Execution trace (${events.length}) ---`);
  for (const ev of events) {
    lines.push(
      `[${ev.ts}] ${ev.label} (${ev.category})${ev.durationMs != null ? ` \xB7 ${ev.durationMs}ms` : ""}${ev.isError ? " \xB7 ERROR" : ""}`
    );
    if (ev.args !== void 0) lines.push(`    args:   ${cap(ev.args)}`);
    if (ev.result !== void 0) lines.push(`    result: ${cap(ev.result)}`);
  }
  lines.push("", `--- Logs (${events.length}) ---`);
  for (const ev of events) {
    const level = ev.isError || ev.category === "error" ? "ERROR" : "INFO";
    const summary = ev.result !== void 0 ? cap(ev.result, 300) : cap(ev.args, 300);
    lines.push(`[${ev.ts}] ${level.padEnd(5)} ${ev.label}${summary ? ` \u2014 ${summary}` : ""}`);
  }
  if (messages.length) {
    lines.push("", `--- Conversation (${messages.length}) ---`);
    for (const m of messages) {
      const who = m.role.toUpperCase();
      const model = m.role === "assistant" ? parseMessageProvenance(m)?.model : void 0;
      const stamp = model ? ` \xB7 ${model}` : "";
      lines.push(`[${m.createdAt ?? ""}] ${who}${stamp}: ${cap(m.content, 1500)}`);
    }
  }
  return lines.join("\n");
}

// src/codeChanges.ts
function codeChangesOf(name, args, out) {
  if (isCodeChangeTool(name)) {
    if (isFailedToolResult(out)) return null;
    const files = codeChangeFiles(args);
    const real = files.filter((f) => !isScratchScriptPath(f));
    if (files.length > 0 && real.length === 0) return null;
    return real;
  }
  const named = delegatedChangedPathsOf(name, out).filter((f) => !isScratchScriptPath(f));
  return named.length ? named : null;
}

export {
  hostOf,
  describeStreamFailure,
  INFERENCE_MODES,
  isInferenceMode,
  defaultInferenceMode,
  parseSyncId,
  syncIdText,
  UNBOUND_DESTINATION,
  defineRecordIndex,
  SCAN_STOP,
  selectRecords,
  scanByIndex,
  newLocalRecord,
  BOUND_ONLY_VERSION,
  isOwnRecord,
  isImported,
  dropPending,
  queueImport,
  journalWrite,
  BIND_PENDING_HOLDER,
  liveChatBindHolder,
  claimChatBind,
  releaseChatBind,
  MEDIAN_TURN_TOKENS,
  computeCostMillicents,
  priceTierBoundary,
  directCatalogId,
  listPriceOf,
  snapshotPriceBook,
  ANTHROPIC_RELEASES,
  foldSpendSavings,
  combineSpendSavings,
  USAGE_SURFACES,
  isUsageSurface,
  USAGE_SURFACE_HEADER,
  PROVENANCE_META_KEY,
  asProvenanceAccount,
  isConnectedAccountUnused,
  parseMessageProvenance,
  lastServedModel,
  withProvenanceMetadata,
  formatAssistantTranscriptHeading,
  STOPPED_TURN_META_KEY,
  STOPPED_TURN_STEP,
  stoppedTurnMetadata,
  isStoppedTurn,
  isStoppedBeforeStart,
  stoppedBeforeStartRow,
  serverChatIdOf,
  STEP_MESSAGE_ROLE,
  isStepMessage,
  attachEvermindLearn,
  formatEvermindLearnStep,
  hasExplicitQuestionIntent,
  classifyRequest,
  asksForChange,
  promisesUnfinishedWork,
  isContinuationDirective,
  memoryReplayable,
  continuationDirective,
  toolNamesMentionedIn,
  announcesUntakenAction,
  catalogToolNamesMentionedIn,
  claimsMissingToolData,
  MAX_ANNOUNCEMENT_RECOVERIES,
  modelFailoverNotice,
  nextFallbackModel,
  DEFAULT_ROUTE_THRESHOLD,
  summarizeRouteRuns,
  DECLINE_STATUS,
  offersHandOff,
  PLAN_TURN_BUDGET,
  reduceRunPolicy,
  isRequestRefusalStatus,
  isCoderReask,
  toolSchemaTokens,
  handoffReserveTokens,
  handoffTokenBudget,
  parseRunOutcomeTelemetry,
  isTenantBudgetFailure,
  isRateLimitFailure,
  editedFilesOf,
  editedPathsOf,
  bracketDelta,
  changesBalance,
  describeBracketDelta,
  advertisedToolName,
  resolveAdvertisedToolName,
  resolveCallName,
  toolNameSet,
  toolCallPaths,
  isMutatingTool,
  renderPolicyDirectives,
  stableStringify,
  limbicTraits,
  isFailedToolResult,
  fileToolKind,
  REMEMBER_FACT_TOOLS,
  savedFactOf,
  RunKnowledgeRecorder,
  VERIFY_DELEGATION_STEP,
  VERIFY_STEP,
  RESOLVE_OPEN_ISSUES,
  isChildReportText,
  judgeWith,
  lexicalStems,
  LEXICAL_WEIGHTS,
  rankLexically,
  parseSpecOpenItems,
  codeChangeTicketTitle,
  isMatchableSpecItemId,
  specTicketCoverage,
  profileWorkload,
  estimateTokensFromChars,
  isCostLeverOn,
  isReadOnlyShellCall,
  isTestPath,
  isDelegationTool,
  REVISIT_NUDGE_AT,
  REVISIT_HARD_AT,
  revisitAdvisory,
  withAdvisory,
  singleReadsOf,
  perFileResults,
  ReadCoverage,
  recordShellFileRead,
  FAILURE_NUDGE_AT,
  FAILURE_HARD_AT,
  FailureTally,
  failureReason,
  repeatedFailureAdvisory,
  WriteLedger,
  repeatedWriteNote,
  announcesDeliverable,
  BACK_TO_BACK_AT,
  stopIntent,
  READS_BEFORE_DELEGATION_NUDGE,
  ReadsWithoutSpawn,
  normalizeEvidencePath,
  createEvidenceLedger,
  DEFAULT_EVIDENCE_POLICY,
  fileIsUnchecked,
  outgoingGate,
  MAX_BLOCKING_REVIEW_ROUNDS,
  applyReviewRoundCap,
  reviewGate,
  shellPublishHint,
  DEFAULT_SHIP_POLICY,
  isShipMode,
  shipPolicyOf,
  publishVerbOf,
  shipSourceLabel,
  publishAllowed,
  narrowByHold,
  shipDirective,
  shipNudge,
  turnInterruption,
  isTruncatedTurn,
  isMalformedToolCall,
  SERVER_TICKET_CREATE_TOOL,
  SERVER_TICKET_LINK_TOOL,
  LOCAL_TICKET_CREATE_TOOL,
  isTicketWriteTool,
  SERVER_TICKET_TOOLS,
  ticketToolVocabulary,
  isLocalTicketCreateLabel,
  TICKET_FROM_DELTA_TOOL,
  ticketStatusMove,
  toolResultRecord,
  entityIdsOf,
  TICKET_RECORDING_TOOLS,
  CHAT_STAMPED_CREATE_TOOLS,
  stampRunChat,
  createLinkedToChat,
  isTicketRecordingTool,
  isReadOnlyPlatformTool,
  isMutatingPlatformTool,
  NOT_STARTED_TASK_STATUSES,
  linkedTicketsToAdvance,
  linkedTaskRows,
  linkedTicketsStillOpen,
  CHAT_TICKET_LIST_TOOL,
  canListChatTickets,
  declaresChatTicketListing,
  linkedTicketsToAdvanceFor,
  isOpenLinkedStatus,
  linkedTicketsToComplete,
  linkedTicketsReviewedComplete,
  codeChangeFile,
  chatWorkObligationTools,
  chatWorkLinkingDirective,
  RUN_CANCELLED_REASON,
  measureWorkflow,
  measureWorkflowSync,
  planModelWarning,
  downgradeDecision,
  newSteerKey,
  queueRunSteering,
  requeueRunSteering,
  childWorkRefs,
  drainRunSteering,
  hasRunInterrupt,
  runSteeringSource,
  runToolInterruptibly,
  isSpawnTool,
  attemptedDelegation,
  leftDelegationUndone,
  undelegatedRequestNudge,
  earlyDelegationNudge,
  MAX_OPEN_WORK_HOLDS,
  recordWorkSnapshot,
  workSupportsRoutingSample,
  workFinishPorts,
  FINISH_RECORD_TURNS,
  renderTaskState,
  applyTaskStateUpdate,
  expandWithSynonyms,
  DEFAULT_TOOL_LIMIT,
  isCappedToolRole,
  roleToolLimit,
  roleCappedSelection,
  truncateMiddle,
  runBudgetCapMillicents,
  CacheServedStreak,
  defaultPipelineRouting,
  routeRun,
  openRun,
  runOutcomeRequestOf,
  shortenTarget,
  activityTarget,
  VISIT_QUESTION_SEPARATOR,
  visitTarget,
  toolActivity,
  betweenTurnsActivity,
  contextFoldActivity,
  formatBytes,
  describeLiveStep,
  midRunNotice,
  modelScorecard,
  formatModelScorecard,
  modelTurnLog,
  formatModelTurnLog,
  BASE_BRANCHES,
  parseGitShortStatus,
  dirtyPathsOf,
  onBaseBranch,
  shippedToBaseBranch,
  parseChatActivity,
  isActivityMessage,
  activityMessageCount,
  DEFAULT_CHAT_ACTIVITY_LABELS,
  activityIcon,
  activityTone,
  chatActivityText,
  isModelReply,
  stepSig,
  parseStepMessage,
  traceWithPersistedSteps,
  LOCAL_WORKSPACE_TOOLS,
  CODE_CHANGE_TOOLS,
  PREVIEW_REVIEW_TOOL,
  STUDIO_WORKSPACE_TOOLS,
  UNSCOPED_MUTATION_TOOLS,
  isRepoPublishTool,
  isRepoStateReadTool,
  isLocalWorkspaceTool,
  isCodeChangeTool,
  isUnscopedMutationTool,
  canChangeCodeHere,
  canShipHere,
  localToolsIn,
  canReviewInPreview,
  studioToolsIn,
  memoryToolsIn,
  isWorkItemWrite,
  TICKETING_INTENTS,
  isMutationTool,
  hasEditIntent,
  codeChangesOf,
  computeRunProgress,
  progressDuration,
  formatRunProgress,
  runProgressVerdict,
  gatewayRoutingArgs,
  planScopeClash,
  canRunInParallel,
  splitForParallel,
  HAND_OFF_MODE_LABEL,
  HAND_OFF_CLASH_LABEL,
  handOffModeSentence,
  modeOf,
  splitLayoutLine,
  scopeClashCorrective,
  sessionWorkInTrace,
  sessionShippedInTrace,
  isDispatchTool,
  staffingSummaryInTrace,
  formatDispatchRefusals,
  workFiledNotStaffedVerdict,
  formatStaffingSummary,
  RUN_FINDING_POLICY,
  utf8ByteLength2 as utf8ByteLength,
  toolCallArgBytes,
  createComposingActivity,
  RUN_FINDING_REGISTRY,
  buildRunView,
  compareFindings,
  detectRunFindings,
  MAX_TOOL_RESULT_CHARS,
  READ_FILE_RESULT_CHARS2 as READ_FILE_RESULT_CHARS,
  trimToolResult,
  requestedReadWindow2 as requestedReadWindow,
  formatBrainDiagnostics,
  toolExposureInTrace,
  formatAdvertised,
  UNBACKED_WRITE_CLAIM_NOTICE,
  UNBACKED_TICKET_CLAIM_NOTICE,
  detectUnbackedWriteClaim,
  detectUnbackedTicketClaim,
  detectAnnouncedButUnmadeToolCall,
  stallRecoveriesInTrace,
  modelFailoversInTrace,
  stallUnrecoveredInTrace,
  narratedUnadvertisedInTrace,
  answeredInProseInTrace,
  isEvermindModel,
  modelsUsedInTrace,
  accountUsedInTrace,
  byoUnresolvedInTrace,
  parseByoUnresolved,
  byoReasonHint,
  byoUnresolvedSummary,
  formatBrainProvenance,
  ROLE_GATE_REMEDIATION,
  parseRoleGateRefusal,
  computeBrainDiagnostics,
  buildBrainTriageReport
};
//# sourceMappingURL=chunk-IJBC4LEZ.mjs.map