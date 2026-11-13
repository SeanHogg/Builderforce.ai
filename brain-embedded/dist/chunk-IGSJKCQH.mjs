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
    const tier = TIER_REF_RE.exec(v);
    return tier ? { tier: { kind: tier[1], ref: tier[2] } } : null;
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
function unboundMarker(record2, operation) {
  return { operation, ...unboundMarkerFields(record2.payload) };
}
function unboundMarkerFields(payload) {
  const text = JSON.stringify(payload) ?? "null";
  return { payloadSize: text.length, payloadHash: hashPayload(payload), payload: null };
}
async function dropPending(tx, record2) {
  const stale = await selectPendingOf(tx, record2.entityType, record2.id);
  if (stale.length > 0) await tx.acknowledge(stale.map((event) => event.eventId));
}
async function queueImport(tx, record2, chatClientId, waitsOn = []) {
  await dropPending(tx, record2);
  if (record2.deletedAt) return;
  if (record2.destination.kind === "bound") await ensureRecordPayloadFence(tx, record2.destination);
  await tx.append({
    idempotencyKey: importKey(record2.entityType, record2.id),
    clientEntityId: record2.id,
    entityType: record2.entityType,
    operation: "import",
    schemaVersion: record2.schemaVersion,
    occurredAt: record2.occurredAt,
    dependsOn: fencedDependsOn([...chatClientId && record2.entityType !== "chat" ? [importKey("chat", chatClientId)] : [], ...waitsOn]),
    destination: record2.destination,
    ...recordPayloadMarker()
  });
}
async function journalWrite(tx, record2, operation, options) {
  if (record2.destination.kind === "unbound") {
    await tx.append({
      idempotencyKey: options.key,
      clientEntityId: record2.id,
      entityType: record2.entityType,
      schemaVersion: record2.schemaVersion,
      occurredAt: record2.occurredAt,
      ...record2.baseVersion !== void 0 ? { baseVersion: record2.baseVersion } : {},
      dependsOn: options.dependsOn ?? [],
      destination: record2.destination,
      // The marker carries size + a content hash of the real payload, never the
      // payload itself; the record is the only copy while unbound (module comment).
      ...unboundMarker(record2, operation)
    });
    return;
  }
  const mapping = await tx.mapping(record2.entityType, record2.id, record2.destination);
  if (!isImported(mapping)) {
    await queueImport(tx, record2, options.chatClientId);
    return;
  }
  await dropPending(tx, record2);
  await tx.append({
    idempotencyKey: `${options.key}:server`,
    clientEntityId: record2.id,
    entityType: record2.entityType,
    operation,
    schemaVersion: record2.schemaVersion,
    occurredAt: record2.occurredAt,
    baseVersion: mapping.serverVersion,
    dependsOn: [],
    destination: record2.destination,
    payload: operation === "delete" && !PAYLOAD_ON_DELETE.has(record2.entityType) ? null : record2.payload
  });
}

// ../packages/local-first/src/holdLimits.ts
var SYNC_EVENT_RETENTION_DAYS = 90;
var DAY_MS = 24 * 60 * 60 * 1e3;
var HOLD_MAX_AGE_MS = 7 * DAY_MS;
var DEPENDENCY_PENDING_MAX_AGE_MS = SYNC_EVENT_RETENTION_DAYS * DAY_MS;
var HOLD_BACKOFF_CAP_MS = 60 * 60 * 1e3;

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

// ../packages/local-first/src/tombstone.ts
var RESNAPSHOT = Object.freeze({ action: "resnapshot" });

// ../packages/local-first/src/applyServerCursor.ts
var RESNAPSHOT2 = Object.freeze({ resnapshotRequired: true });

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

// ../packages/agent-stall/src/requestIntent.ts
var CHANGE_VERBS = "add|change|fix|update|reduce|increase|remove|delete|rename|refactor|implement|create|build|make|move|set|wire|migrate|replace|adjust|enable|disable|improve|write|edit|apply|correct|resolve|shrink|expand|hide|show|bump|revert|restore|install|upgrade|downgrade|rewrite|extract|split|merge";
var CHANGE_VERB = new RegExp(`\\b(${CHANGE_VERBS})\\b`, "i");
var FINISH_OBJECT = "(complete|finish|finali[sz]e)\\s+(the|this|that|these|those|it|my|our|your|all|implementation|work|task|change)\\b";
var FINISH_ORDER = new RegExp(`^\\s*(please\\s+)?(now\\s+)?${FINISH_OBJECT}`, "i");
var CHAINED_FINISH = new RegExp(`(\\band|\\bthen|[,.;])\\s+((also|then|please|now)\\s+)*${FINISH_OBJECT}`, "i");
var QUESTION_SHAPE = /^\s*(what|why|how|where|when|which|who|is|are|was|were|does|do|did|can|could|should|would|will)\b|\?\s*$/i;
var RESEARCH_LEAD = /^\s*(explain|describe|summar\w*|tell me|show me|list|compare|review|analyse|analyze|research|investigate|find|locate|trace|audit|look into|search)\b/i;
var REPORT_OBJECTS = "summary|report|findings|notes|overview|write-?up|answer|explanation|list|table|recommendations?";
var CHAINED_CHANGE = new RegExp(
  `(\\band|\\bthen|[,.;])\\s+((also|then|please|now)\\s+)*(${CHANGE_VERBS})\\b(?!\\s+(me|us)\\b|\\s+(up\\s+)?((a|an|the|your|me|us|my)\\s+)?(short\\s+|brief\\s+)?(${REPORT_OBJECTS})\\b)`,
  "i"
);
function asksForChange(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  const head = t.slice(0, 600);
  if (QUESTION_SHAPE.test(head)) return false;
  if (RESEARCH_LEAD.test(head)) return CHAINED_CHANGE.test(head) || CHAINED_FINISH.test(head);
  return CHANGE_VERB.test(head) || FINISH_ORDER.test(head) || CHAINED_FINISH.test(head);
}
var NOTHING_DONE = /\b(nothing (has been|was|is) (changed|modified|applied|edited|written|saved)|no (changes?|edits?) (have been|were|was) (made|applied|written|saved)|(not|never) (yet )?(been )?(applied|written|saved|committed)|has not been (changed|applied|modified)|before (applying|making) the edit)\b/i;
var DEFERRED_PROMISE = /\b(re-?run me|run me again|ask me again|in a follow-?up|next run|on the next turn|say the word|let me know and I'?ll|I'?ll (then )?(apply|make|write|implement|create|edit|fix|update|do|proceed|carry)|I will (then )?(apply|make|write|implement|create|edit|fix|update|proceed))\b/i;
var BUDGET_EXHAUSTED = /\b(tool-?call budget|step budget|iteration (cap|limit|budget)|ran out of (tool calls|steps|budget)|hit (the|my) (tool|step|budget))\b/i;
function promisesUnfinishedWork(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  return NOTHING_DONE.test(t) || DEFERRED_PROMISE.test(t) || BUDGET_EXHAUSTED.test(t);
}
var CONTINUATION = /^\s*(?:ok(?:ay)?[,\s]*)?(?:please\s+)?(?:now\s+)?(?:just\s+)?(?:go\s+ahead|carry\s+on|keep\s+going|make\s+it\s+so|do\s+it|do\s+that|do\s+so|fix\s+it|fix\s+that|apply\s+it|apply\s+that|apply|fix|go|proceed|continue|yes|yep|yeah|y|sure|confirm(?:ed)?|approved?|ship\s+it|send\s+it|run\s+it|do\s+the\s+fix|make\s+the\s+change)\s*[.!]*\s*$/i;
var MAX_CONTINUATION_CHARS = 40;
function isContinuationDirective(text) {
  const t = (text ?? "").trim();
  if (!t || t.length > MAX_CONTINUATION_CHARS) return false;
  return CONTINUATION.test(t);
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
function ids(list) {
  return (list ?? []).map((m) => m.id).filter((id) => !!id);
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
  for (const tier of tiers) {
    const hit = tier.find((m) => !used.has(m));
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
  const record2 = value;
  const keys = Object.keys(record2).filter((k) => record2[k] !== void 0).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record2[k])}`).join(",")}}`;
}

// ../packages/agent-tools/src/modelRoles.ts
var MODEL_ROLES = ["plan", "code", "verify", "explore", "chat", "utility"];
var MODEL_ROLE_DESCRIPTIONS = {
  plan: "Deciding an approach or breaking work down \u2014 no code written yet.",
  code: "Writing or editing code. The default when no role is named.",
  verify: "Checking work already done \u2014 reading test/build output, reviewing a diff.",
  explore: "Investigation \u2014 locating, searching, summarising.",
  chat: "A conversational answer with no task-shaped work behind it.",
  utility: "Small, mechanical, low-stakes work \u2014 formatting, extraction, a lookup."
};
var ROLE_SET = new Set(MODEL_ROLES);
function isModelRole(value) {
  return typeof value === "string" && ROLE_SET.has(value);
}
function delegationRole(raw) {
  return isModelRole(raw) ? raw : "code";
}

// ../packages/agent-tools/src/edit.ts
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
  const newS = withEol(newString, dominantEol(content));
  const { lf, at: at2 } = foldToLF(content);
  let spans = spansOf(lf, toLF(oldString), replaceAll).map(([s, e]) => [at2[s], at2[e]]);
  if (spans.length === 0) spans = spansOf(content, oldString, replaceAll);
  if (spans.length > 1 && !replaceAll) {
    return {
      ok: false,
      error: "oldString is not unique; add more surrounding context or set replaceAll"
    };
  }
  if (spans.length > 0) {
    const parts = [];
    let from = 0;
    for (const [s, e] of spans) {
      parts.push(content.slice(from, s), newS);
      from = e;
    }
    parts.push(content.slice(from));
    const next = parts.join("");
    const region = regionAt(content, spans[0][0], newS);
    return { ok: true, content: next, replaced: spans.length, region, excerpt: excerptAfterEdit(next, region) };
  }
  const nearest = findNearest(content, oldString);
  return {
    ok: false,
    error: "oldString not found in file \u2014 read_file and copy the exact text (including indentation)",
    ...nearest ? { nearest } : {}
  };
}
var editStr = (v) => typeof v === "string" ? v : void 0;
function editPathOf(a) {
  const p = a.path ?? a.file_path ?? a.filePath;
  return typeof p === "string" && p.trim() ? p.trim().replace(/\\/g, "/").replace(/^\.\//, "") : null;
}
function editedFilesOf(toolName, args) {
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const top = editPathOf(a);
  const out = [];
  if (toolName === "edit_file") {
    const replacement = (e, fallback) => {
      const path2 = editPathOf(e) ?? fallback;
      const before = editStr(e.old_string);
      const after = editStr(e.new_string);
      if (path2 && (before !== void 0 || after !== void 0)) {
        out.push({ path: path2, ...before !== void 0 ? { before } : {}, ...after !== void 0 ? { after } : {} });
      } else if (path2 && e !== a) {
        out.push({ path: path2 });
      }
    };
    if ("old_string" in a || "new_string" in a) replacement(a, null);
    if (Array.isArray(a.edits)) {
      for (const raw of a.edits) {
        if (raw && typeof raw === "object") replacement(raw, top);
      }
    }
  } else if (toolName === "write_file" && top) {
    const after = editStr(a.content);
    out.push({ path: top, ...after !== void 0 ? { after } : {} });
  }
  if (out.length === 0 && top) out.push({ path: top });
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
      ...r.excerpt ? { excerpt: r.excerpt } : {}
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
function normalizeScopePath(path2) {
  return path2.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}
function inScope(path2, scope) {
  const p = normalizeScopePath(path2);
  return scope.some((entry) => {
    const s = normalizeScopePath(entry);
    return s === "" || p === s || p.startsWith(`${s}/`);
  });
}
function overlappingScopes(scopes) {
  for (let i = 0; i < scopes.length; i++) {
    for (let j = i + 1; j < scopes.length; j++) {
      for (const path2 of scopes[i].paths) {
        if (inScope(path2, scopes[j].paths) || scopes[j].paths.some((q) => inScope(q, [path2]))) {
          return { a: scopes[i].label, b: scopes[j].label, path: normalizeScopePath(path2) };
        }
      }
    }
  }
  return null;
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
function segmentsOf(path2) {
  const raw = path2.trim().replace(/\\/g, "/");
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
function gatePathCandidates(path2, workspaceRoot) {
  if (!path2.trim()) return [];
  const { segments, rooted, climbs } = segmentsOf(path2);
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
function pathHitsPattern(path2, pattern) {
  return matchGlob(path2, pattern) || inScope(path2, [pattern]);
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
function evaluatePolicyGate(gates, toolName, path2, workspaceRoot, declared) {
  const called = normalizeToolName(toolName);
  const matches = (gates ?? []).filter(
    (g) => (!g.tool || g.tool === "*" || normalizeToolName(g.tool) === called) && (!g.sideEffect || classifyTool(called, declared) === g.sideEffect) && gateMatchesPath(g, path2, workspaceRoot)
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
function isTestSourcePath(path2) {
  return TEST_SOURCE_PATH.test(path2.replace(/\\/g, "/"));
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
  constructor(path2) {
    this.enabled = !isTestSourcePath(path2);
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
function extensionOf2(path2) {
  const base = path2.slice(path2.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}
function languageOf(path2) {
  return LANGUAGE_BY_EXT[extensionOf2(path2.replace(/\\/g, "/"))];
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
function extractJs(lines, out, path2 = "") {
  let cls;
  const owners = new CallbackOwnerScan(path2);
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
function extractSymbols(path2, content, cap2 = MAX_SYMBOLS_PER_FILE) {
  const language = languageOf(path2);
  if (!language) return [];
  const out = [];
  const outer = symbolCap;
  symbolCap = cap2;
  try {
    EXTRACTORS[language](content.split(/\r?\n/), out, path2.replace(/\\/g, "/"));
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
    const r = await ctx.caps.symbols.find(query, { scope, kind, limit });
    if (!r.ok) return { data: r };
    const data = {
      ok: true,
      query,
      total: r.total ?? 0,
      truncated: r.truncated === true,
      matches: (r.matches ?? []).map((m) => `${m.path}:${m.line} ${m.kind} ${m.name}${m.exported && m.kind !== "heading" ? " (export)" : ""}`),
      indexedFiles: r.indexedFiles
    };
    if ((r.total ?? 0) === 0) {
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
    const path2 = typeof args.path === "string" ? args.path.trim() : "";
    if (!path2) return { data: { ok: false, error: "path is required" } };
    const kind = asKind(args.kind);
    const file = await ctx.caps.repoRead.readFile(path2);
    if (!file.ok) return { data: file };
    const content = file.content ?? "";
    const all = extractSymbols(path2, content).filter((s) => !kind || s.kind === kind);
    const shown = all.slice(0, OUTLINE_MAX_ENTRIES);
    const data = {
      ok: true,
      path: file.path ?? path2,
      totalLines: content.split("\n").length,
      total: all.length,
      symbols: shown.map(formatSymbol)
    };
    if (all.length === 0) {
      data.note = kind ? `No ${kind} definitions found in ${path2}.` : `No definitions recognised in ${path2} (unsupported language, or a data/config file) \u2014 read_file it directly.`;
    } else if (all.length > shown.length) {
      const lastLine = shown.at(-1)?.line ?? 0;
      data.note = `Showing the first ${shown.length} of ${all.length} definitions (through line ${lastLine}). Pass \`kind\` to list one kind, or find_symbol for a specific name.`;
    }
    return { data };
  }
});
function markdownOutline(path2, content) {
  return extractSymbols(path2, content).filter((s) => s.kind === "heading").slice(0, OUTLINE_MAX_ENTRIES).map((s) => ({ heading: s.name, line: s.line }));
}
var SYMBOL_TOOLS = [findSymbolTool, fileOutlineTool];

// ../packages/agent-tools/src/fileRead.ts
var OUTLINE_FIRST_MIN_CHARS = 16e3;
var OUTLINE_FIRST_MIN_LINES = 300;
var OUTLINE_FIRST_PREFIX_LINES = 40;
function outlineFirstApplies(content, leverOn) {
  if (leverOn !== true) return false;
  const lines = content.split("\n").length;
  return content.length >= OUTLINE_FIRST_MIN_CHARS || lines >= OUTLINE_FIRST_MIN_LINES;
}
var READ_FILE_MAX_PATHS = 8;
var MARKDOWN_OUTLINE_MIN_CHARS = 16e3;
function readFileKey(path2, file, key) {
  if (file.truncated === true) {
    return { ok: false, path: path2, key, error: "the file is too large to load whole, so `key` cannot be used \u2014 page it with offset/limit" };
  }
  const read = readJsonKey(file.content ?? "", key);
  if (!read.ok) return { path: path2, key, ...read };
  if ("tooLarge" in read) {
    return {
      ok: true,
      path: path2,
      key: read.key,
      childKeys: read.childKeys,
      note: `"${read.key}" is ${read.size} characters \u2014 too large to return whole. Read one of its childKeys, e.g. key "${read.key}.${read.childKeys[0] ?? "\u2026"}".`
    };
  }
  return { ok: true, path: path2, key: read.key, content: read.content };
}
var isMarkdown = (path2) => /\.mdx?$/i.test(path2);
async function readOneFile(path2, opts, caps, leverOn) {
  const r = await caps.repoRead.readFile(path2);
  if (!r.ok) return r;
  if (opts.key) return readFileKey(r.path ?? path2, r, opts.key);
  const content = r.content ?? "";
  if (opts.offset === void 0 && opts.limit === void 0 && outlineFirstApplies(content, leverOn) && r.truncated !== true) {
    const symbols = extractSymbols(path2, content).slice(0, 150).map((s) => `L${s.line} ${s.kind} ${s.name}${s.exported && s.kind !== "heading" ? " (export)" : ""}`);
    const head = windowFileContent(content, { offset: 1, limit: OUTLINE_FIRST_PREFIX_LINES });
    return {
      ok: true,
      path: r.path ?? path2,
      outline: symbols,
      totalLines: head.totalLines,
      content: head.content,
      truncated: true,
      offset: 1,
      note: (symbols.length > 0 ? `This file is larger than one read: \`outline\` lists its ${symbols.length} definitions with line numbers. ` : "This file is larger than one read. ") + `The first ${OUTLINE_FIRST_PREFIX_LINES} lines follow. To read a specific span, call read_file again with \`offset\` (1-based line) and a small \`limit\`.`
    };
  }
  const win = windowFileContent(content, { offset: opts.offset, limit: opts.limit });
  const data = {
    ok: true,
    path: r.path ?? path2,
    content: win.content,
    truncated: win.truncated || r.truncated === true,
    totalLines: win.totalLines,
    offset: win.offset
  };
  let note = fileWindowNote(win);
  if (opts.offset === void 0 && isMarkdown(data.path ?? path2) && (content.length > MARKDOWN_OUTLINE_MIN_CHARS || win.truncated)) {
    const outline = markdownOutline(data.path ?? path2, content);
    if (outline.length > 0) {
      data.outline = outline;
      const pointer = "This document is larger than one read: `outline` lists its headings with their line numbers \u2014 page by heading line with offset (and a small limit) instead of reading it window by window.";
      note = note ? `${note} ${pointer}` : pointer;
    }
  }
  if (note) data.note = note;
  return data;
}
async function readManyFiles(paths, opts, caps, leverOn) {
  return Promise.all(
    paths.map(
      (path2) => readOneFile(path2, opts, caps, leverOn).catch((err) => ({ ok: false, path: path2, error: err instanceof Error ? err.message : String(err) }))
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
function inferRepoFromPath(path2) {
  if (typeof path2 !== "string" || !path2.trim()) return null;
  const parts = path2.split(/[\\/]/).filter((s) => s.length > 0 && s !== ".");
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
function pathInRepo(path2, repo) {
  if (!path2) return path2;
  const inner = commitPathCandidates(path2, repo);
  return inner.length > 0 ? inner[inner.length - 1] : void 0;
}
async function notARepoWithCandidates(action, ctx) {
  const listed = await shellRunWithStop(ctx, buildListCheckoutsCommand());
  return notARepoResult(action, parseCheckoutList(listed.stdout));
}
var NOT_A_REPO = /not a git repository/i;
function isNotARepo(r) {
  return NOT_A_REPO.test(`${r.stdout ?? ""} ${r.error ?? ""}`);
}
function commitPathCandidates(path2, repo) {
  const out = [path2];
  const dir = safeRepoArg(repo);
  if (dir) {
    const prefix = `${dir.replace(/\/+$/, "")}/`;
    if (path2.startsWith(prefix)) out.push(path2.slice(prefix.length));
    const leaf = dir.split("/").filter(Boolean).pop();
    if (leaf && path2.startsWith(`${leaf}/`)) out.push(path2.slice(leaf.length + 1));
  }
  return [...new Set(out)].filter((p) => p.trim() !== "");
}
var rootNotARepo = /* @__PURE__ */ new WeakSet();
function scopeAttempts(ctx, path2) {
  const fallback = defaultRepoOf(ctx);
  const shell = ctx.caps.shell;
  const attempts = [];
  if (!(fallback && shell && rootNotARepo.has(shell))) attempts.push({ path: path2 });
  const inferred = inferRepoFromPath(path2);
  if (inferred) attempts.push({ repo: inferred, path: pathInRepo(path2, inferred) });
  if (fallback && fallback !== inferred) attempts.push({ repo: fallback, path: pathInRepo(path2, fallback) });
  return attempts;
}
async function runInRepoScope(ctx, scope, run) {
  if (scope.repo) return { r: await run(scope.repo, scope.path), repo: scope.repo };
  for (const attempt of scopeAttempts(ctx, scope.path)) {
    const r = await run(attempt.repo, attempt.path);
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
function parseEntries(lines) {
  const out = { staged: [], unstaged: [], untracked: [], conflicted: [] };
  for (const line of lines) {
    if (line.length < 4 || line.startsWith("##")) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    if (xy === "!!") continue;
    if (xy === "??") {
      out.untracked.push(unquoteGitPath(rest));
      continue;
    }
    const arrow = rest.indexOf(" -> ");
    const path2 = unquoteGitPath(arrow === -1 ? rest : rest.slice(arrow + 4));
    const from = arrow === -1 ? void 0 : unquoteGitPath(rest.slice(0, arrow));
    if (CONFLICT.has(xy)) {
      out.conflicted.push(path2);
      continue;
    }
    const [x, y] = [xy[0], xy[1]];
    if (x !== " ") out.staged.push({ path: path2, status: x, ...from && (x === "R" || x === "C") ? { from } : {} });
    if (y !== " ") out.unstaged.push({ path: path2, status: y });
  }
  return out;
}
function parsePathSections(sections, paths, upstreamUsable) {
  return paths.map((path2, i) => {
    const lines = sections[i] ?? [];
    const logLine = lines.find((l) => l.includes(US));
    if (!logLine) return { path: path2, lastCommit: null, onUpstream: null };
    const space = logLine.indexOf(" ");
    const [author = "", email = "", date = "", ...subject] = logLine.slice(space + 1).split(US);
    const pushed = lines.find((l) => l.startsWith(PUSHED_MARK));
    return {
      path: path2,
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
  const truncated = Object.values(entries).some((list) => list.length > MAX_ENTRIES);
  const report = {
    ...header,
    staged: entries.staged.slice(0, MAX_ENTRIES),
    unstaged: entries.unstaged.slice(0, MAX_ENTRIES),
    untracked: entries.untracked.slice(0, MAX_ENTRIES),
    conflicted: entries.conflicted.slice(0, MAX_ENTRIES),
    clean: Object.values(entries).every((list) => list.length === 0),
    ...truncated ? { truncated: true } : {}
  };
  const wanted = statusPaths(paths);
  if (wanted.length > 0) report.paths = parsePathSections(sections, wanted, !!header.upstream && !header.upstreamGone);
  return { output: statusLines.join("\n").trim(), report };
}

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
    return `P${i}="$(pick ${candidates})" || MISSING="$MISSING "${shellQuote(p)}`;
  });
  const paths = opts.paths.map((_, i) => `"$P${i}"`).join(" ");
  return [
    "set -e",
    RESOLVE_BASE,
    'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
    'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    // A ticket branch was named: switch to it, creating it if new. Otherwise the base
    // branch is refused — unless the caller DECLARED it, the same declared act `git_push`
    // takes. Without that declaration "commit and push to main" had no reachable path at
    // all: push accepted `allowBaseBranch`, but the commit before it could never land on
    // main, so an explicit human instruction ended in a refusal every time.
    ...branch ? [`git rev-parse --verify --quiet "${branch}" >/dev/null && git checkout "${branch}" || git checkout -b "${branch}"`] : opts.allowBaseBranch ? [] : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }'],
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
  return [
    "set -e",
    RESOLVE_BASE,
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    ...opts.allowBaseBranch ? [] : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }'],
    // `-u` so a brand-new ticket branch gets its upstream on the first push.
    'git push -u origin "$CUR"',
    'echo "Pushed $CUR to origin"',
    // Report where the push LANDED — the branch header (`## main...origin/main`, with any
    // `[ahead N]` still owed) plus whatever is still uncommitted. That is the evidence a
    // host needs to call the change shipped, so the push verifies itself rather than
    // depending on the agent remembering a separate status call. Never fails the push.
    "git status --short --branch 2>/dev/null || true"
  ].join("\n");
}
function buildPullRequestCommand(opts) {
  const base = safeGitArg(opts.base);
  const reviewers = (opts.reviewers ?? []).map((r) => safeGitArg(r)).filter((r) => !!r);
  return [
    "set -e",
    "command -v gh >/dev/null 2>&1 || { echo NO_GH_CLI; exit 7; }",
    ...base ? [`BASE="${base}"`] : [RESOLVE_BASE],
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    '[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }',
    // Push first when the branch has no upstream — `gh pr create` fails on an unpushed
    // head, and "open a PR" plainly means the branch has to exist on the remote.
    'git rev-parse --abbrev-ref "@{upstream}" >/dev/null 2>&1 || git push -u origin "$CUR"',
    `gh pr create --base "$BASE" --head "$CUR" --title ${shellQuote(opts.title)} --body ${shellQuote(opts.body)}` + reviewers.map((r) => ` --reviewer "${r}"`).join("")
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
      repo: REPO_PARAM
    }
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    return runPublishTool("push", buildPushCommand({ allowBaseBranch: args.allowBaseBranch === true }), repo, ctx);
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
    const badRef = invalidRefResult("pull_request", { base: args.base, reviewers });
    if (badRef) return Promise.resolve(badRef);
    return runPublishTool(
      "pull_request",
      buildPullRequestCommand({ title, body, base: typeof args.base === "string" ? args.base : void 0, reviewers }),
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
function buildGitCommand(action, opts) {
  const path2 = safeGitArg(opts?.path);
  const pathArg = path2 ? ` -- "${path2}"` : "";
  const tracked = safeGitArg(opts?.trackedBranch);
  const viaSandbox = opts?.remoteViaSandbox === true;
  const fetchTracked = viaSandbox ? "" : `git fetch origin "${tracked}" 2>/dev/null && `;
  const absorb = tracked ? ["set -e", IDENTITY_EMAIL, IDENTITY_NAME, `${fetchTracked}git merge --ff-only "origin/${tracked}" 2>/dev/null || true`] : [];
  const publish = (force) => tracked && !viaSandbox ? [force ? "git push --force-with-lease origin HEAD" : "git push origin HEAD"] : [];
  switch (action) {
    case "status":
      return buildStatusCommand(opts?.paths, opts?.repo);
    case "diff":
      return `git --no-pager diff${pathArg}`;
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
    const { output, report } = parseGitStatusOutput(out, paths);
    return { data: { ok: true, action, output: output.slice(0, 2e4), ...report, ...r.error ? { error: r.error } : {} } };
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
  const ran = await runInRepoScope(ctx, scope, (repo, path2) => shellRunWithStop(ctx, buildGitCommand(action, {
    baseBranch,
    limit: opts.limit,
    path: path2,
    ...opts.paths?.length ? { paths: opts.paths, ...repo ? { repo } : {} } : {},
    ...trackedBranch ? { trackedBranch } : {},
    ...remote ? { remoteViaSandbox: true } : {}
  }), safeRepoArg(repo) ?? void 0));
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
  parameters: { type: "object", properties: { path: { type: "string", description: "Optional repo-relative file/dir to scope the diff to." }, repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("diff", { path: typeof args.path === "string" ? args.path : void 0, repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitHistoryTool = defineTool({
  name: "git_history",
  description: "Show recent commit history (git log --oneline), optionally scoped to a path. Use it to understand how a file evolved before changing it.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional repo-relative file/dir to scope history to." },
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
function proseKindOf(path2) {
  const base = path2.replace(/\\/g, "/").split("/").pop() ?? "";
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
    const path2 = typeof args.path === "string" ? args.path.trim() : "";
    if (!path2) return { data: { ok: false, error: "path is required" } };
    const kind = proseKindOf(path2);
    if (kind === "code") {
      return { data: { ok: false, path: path2, error: `read_compressed only reads prose (${PROSE_EXTENSIONS.join(" ")}). Use read_file for code \u2014 an edit needs the exact text.` } };
    }
    const semantic = ctx.caps.semantic;
    if (!semantic?.compress) return { data: { ok: false, path: path2, error: "Compression is not available on this surface right now \u2014 use read_file." } };
    const read = await ctx.caps.repoRead.readFile(path2);
    if (!read.ok || typeof read.content !== "string") return { data: read };
    const rate = typeof args.rate === "number" && Number.isFinite(args.rate) ? Math.min(RATE_MAX, Math.max(RATE_MIN, args.rate)) : void 0;
    const r = await compressProse(read.content, kind, {
      compress: (t, k) => semantic.compress(t, k),
      minChars: READ_COMPRESSED_MIN_CHARS,
      ...rate !== void 0 ? { rate } : {}
    });
    const data = { ok: true, path: path2, content: r.text, compressed: r.compressed };
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
function hitLinesFor(path2, hits) {
  if (!hits) return [];
  return [...hits.definitions, ...hits.references].filter((h) => h.path === path2).map((h) => h.line);
}
async function readExcerpts(ctx, files, hits) {
  const out = [];
  const per = Math.floor(EXCERPT_BUDGET_CHARS / Math.max(1, files.length));
  for (const path2 of files) {
    const r = await ctx.caps.repoRead.readFile(path2).catch(() => null);
    if (!r?.ok || typeof r.content !== "string") continue;
    out.push({ path: path2, text: excerptAround(r.content, hitLinesFor(path2, hits), per) });
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
  const path2 = rel2.replace(/\\/g, "/");
  return path2.split("/").includes(".builderforce") && !BUILDERFORCE_INPUTS.has(path2);
}

// ../packages/agent-tools/src/knowledge/shaCache.ts
function createShaCache(opts = {}) {
  const max = opts.max ?? 8;
  const now = opts.now ?? Date.now;
  const entries = /* @__PURE__ */ new Map();
  const join = (key, entry, signal) => {
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
    getOrRun(key, work, signal) {
      if (key === null) return work(signal);
      const hit = entries.get(key);
      if (hit && (hit.expires === void 0 || hit.expires > now())) {
        join(key, hit, signal);
        return hit.run;
      }
      if (hit) entries.delete(key);
      const controller = new AbortController();
      const entry = { run: void 0, waiting: 0, stopped: 0, controller, settled: false };
      entries.set(key, entry);
      while (entries.size > max) entries.delete(entries.keys().next().value);
      join(key, entry, signal);
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
  return extra.length > 0 ? args.replace(/--ignore=(\S+)/, (_m, list) => `--ignore=${list},${extra.join(",")}`) : args;
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
    const path2 = typeof args.path === "string" ? args.path : "";
    const paths = !path2 && Array.isArray(args.paths) ? args.paths.filter((p) => typeof p === "string" && p.trim() !== "") : [];
    if (!path2 && paths.length === 0) return { data: { ok: false, error: "path is required (or paths: a list of up to " + READ_FILE_MAX_PATHS + ")" } };
    if (paths.length > READ_FILE_MAX_PATHS) return { data: { ok: false, error: `paths takes at most ${READ_FILE_MAX_PATHS} files per call \u2014 split the rest into another read_file` } };
    const opts = {
      offset: typeof args.offset === "number" && args.offset > 0 ? Math.floor(args.offset) : void 0,
      limit: typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : void 0,
      key: typeof args.key === "string" ? args.key.trim() : ""
    };
    if (!path2) return { data: { ok: true, files: await readManyFiles(paths, opts, ctx.caps, ctx.outlineFirstReads) } };
    return { data: await readOneFile(path2, opts, ctx.caps, ctx.outlineFirstReads) };
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
    const path2 = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : "";
    const summary = typeof args.summary === "string" ? args.summary : void 0;
    if (!path2 || !content) return { data: { ok: false, error: "path and content are both required" } };
    if (ctx.caps.repoRead) {
      let existing;
      try {
        existing = await ctx.caps.repoRead.readFile(path2);
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
    const r = await ctx.caps.repoWrite.writeFile(path2, content, summary);
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
    const path2 = typeof args.path === "string" ? args.path : "";
    if (!path2) return { data: { ok: false, error: "path is required" } };
    const reason = typeof args.reason === "string" ? args.reason : void 0;
    const r = await ctx.caps.repoWrite.deleteFile(path2, reason);
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
        const failed2 = batch.files[batch.files.length - 1];
        return { data: { ok: false, error: failed2.error ?? "batch failed", files: batch.files.map(({ content: _c, ...rest }) => rest) } };
      }
      return {
        data: {
          ok: true,
          batched: true,
          count: batch.files.length,
          files: batch.files.map(({ content: _c, ok, path: path3, error, nearest, ...facts }) => ({
            path: path3,
            ok,
            ...Object.keys(facts).length ? facts : {},
            ...error ? { error } : {},
            ...nearest ? { nearest } : {}
          }))
        }
      };
    }
    const path2 = typeof args.path === "string" ? args.path : "";
    const oldString = typeof args.old_string === "string" ? args.old_string : "";
    const newString = typeof args.new_string === "string" ? args.new_string : "";
    const replaceAll = args.replace_all === true;
    if (!path2 || !oldString) return { data: { ok: false, error: "path and old_string are required" } };
    const r = await ctx.caps.repoWrite.editFile(path2, oldString, newString, replaceAll);
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
  description: "Run a shell command in the checked-out repository (real shell). Use it to install dependencies and run the build, type-check, lint, and tests. Returns combined stdout/stderr and the exit code. Verify your changes this way BEFORE calling finish. Do not re-run a command to grep/head/tail its output: when the result has an outputId and the output_filter tool is available, use output_filter on it.",
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
  ["file_outline", "read"]
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
var RunKnowledgeRecorder = class _RunKnowledgeRecorder {
  memory = new WorkingMemory();
  tools = [];
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
      for (const path2 of state.memory[kind] ?? []) r.memory.observe({ kind, path: path2 });
    }
    for (const query of state.memory.searched ?? []) r.memory.observe({ kind: "searched", query });
    r.tools.push(...state.tools ?? []);
    return r;
  }
  /** The state {@link restore} rebuilds this recorder from. */
  snapshot() {
    return { memory: this.memory.snapshot, tools: [...this.tools] };
  }
  setPrompt(prompt) {
    this.memory.setTask(prompt);
  }
  /** Record one successful tool call. Unknown tools still count toward `tools`. */
  record(name, args) {
    this.tools.push(name);
    const search = searchLabel(name, args);
    if (search) {
      this.memory.observe({ kind: "searched", query: search });
      return;
    }
    const kind = fileToolKind(name);
    const rec = args && typeof args === "object" && !Array.isArray(args) ? args : void 0;
    const many = kind === "read" && !!rec && !(typeof rec.path === "string" && rec.path !== "") && Array.isArray(rec.paths);
    if (kind && many) {
      for (const path2 of toolCallPaths(args)) this.memory.observe({ kind: OBSERVATION[kind], path: path2 });
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
    return this.memory.brief({ observations: this.tools.length });
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
    const str4 = (v) => typeof v === "string" ? v.trim() : "";
    const slug = str4(args.slug);
    const name = str4(args.name);
    const description = str4(args.description);
    const body = str4(args.body);
    if (!slug || !name || !description || !body) {
      return { data: { ok: false, error: "slug, name, description and body are all required" } };
    }
    const evidence = str4(args.evidence);
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
var spawnAgentTool = withDelegationNote(defineTool({
  name: "spawn_agent",
  description: "Delegate a self-contained sub-task to a child agent that works in its OWN context and reports back when it is done. Use it when finding something out would take many turns you do not want to carry \u2014 locating where a behaviour lives across an unfamiliar tree, checking whether a pattern is used anywhere else, summarising a large file you only need one fact from. The child sees NOTHING of this conversation, so `task` must state everything it needs to know, and it answers in prose \u2014 it cannot hand you files or tool output. Do NOT delegate work you can do in a turn or two. The child is a clone of you: it holds every tool you hold and carries its slice out end to end \u2014 investigating, editing, running commands, recording the work. You remain accountable for what ships, so check what it reports. " + LIVE_DELEGATION_NOTE,
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "A few words naming the delegation, e.g. 'locate the auth middleware'. Shown on the run timeline."
      },
      task: {
        type: "string",
        description: "The child's complete brief: what to find out or do, where to look, and exactly what to report back. Assume it knows nothing about the ticket beyond what you write here."
      },
      role: {
        type: "string",
        enum: [...MODEL_ROLES],
        description: `What kind of call the child's turns are \u2014 lets the surface pick a model suited to the work rather than reusing yours. Defaults to 'code'. ${ROLE_ENUM_DESCRIPTION}`
      },
      as_agent: {
        type: "string",
        description: "Run the child AS one of the workspace's agents \u2014 its id or name (e.g. 'Ada'). The child adopts that agent's role, bio, skills and personality so the delegated slice is done in that agent's voice and expertise. Prefer an agent already in this chat (builtin_chats_list_agents) or from builtin_cloud_agents_list_mine. Optional: when no teammate's role fits the slice, omit it and the child runs as a plain sub-agent."
      }
    },
    required: ["label", "task"]
  },
  requires: ["orchestrate"],
  async execute(args, ctx) {
    const str4 = (v) => typeof v === "string" ? v.trim() : "";
    const label = str4(args.label);
    const task = str4(args.task);
    if (!task) return { data: { ok: false, error: "task is required \u2014 the child sees none of your conversation" } };
    const role = delegationRole(args.role);
    const asAgent = str4(args.as_agent);
    const r = await ctx.caps.orchestration.spawn({
      label: label || task.slice(0, 60),
      task,
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
  const str4 = (v) => typeof v === "string" ? v.trim() : "";
  const out = [];
  for (const [i, item] of raw.entries()) {
    const w = item ?? {};
    const task = str4(w.task);
    if (!task) return `workstream ${i + 1} has no task \u2014 each child sees none of your conversation`;
    const ticket = str4(w.ticket);
    const role = str4(w.role);
    out.push({
      label: str4(w.label) || task.slice(0, 60),
      task,
      ...ticket ? { ticket } : {},
      ...role ? { role } : {},
      asAgent: str4(w.as_agent)
    });
  }
  return out;
}
var spawnAgentsTool = withDelegationNote(defineTool({
  name: SPAWN_AGENTS_TOOL,
  description: `Run SEVERAL independent workstreams side by side \u2014 up to ${MAX_WORKSTREAMS} child agents at once, each in its own context, each reporting back to the chat. Use it when the request splits into slices that do not depend on each other: a PRD's workstreams, one change per package or feature. Each child is a clone of you with every tool you hold, and carries its slice out end to end. Give slices that do not touch the same files, so they do not overwrite each other; once their reports are in, check the combined result and report per workstream. File one ticket per workstream first and pass its id as \`ticket\`. Each child sees nothing of this conversation, so every \`task\` must stand alone: what to change, where, and how to know it is done. ` + LIVE_DELEGATION_NOTE,
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
            ticket: { type: "string", description: "The ticket this workstream delivers, echoed in the result." },
            role: { type: "string", enum: [...MODEL_ROLES], description: "Model role for the child. Defaults to code." },
            as_agent: { type: "string", description: "Run this workstream AS one of the workspace's agents (its name or id). Optional: omit it when no teammate's role fits, and the child runs as a plain sub-agent." }
          },
          required: ["label", "task"]
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
      task: w.task,
      role: delegationRole(w.role),
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
    const count = Number(n.badges?.[item.count] ?? 0) || 0;
    return count > 0 ? [finding(item.kind, CODE_PACK_ID, [ref], "info", { count, files: 1 }, void 0, refAnchor(ref))] : [];
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
var CONSTRUCT_WORDS = /* @__PURE__ */ new Set(["then", "else", "fi", "do", "done", "esac", "{", "}", "(", ")"]);
function splitSegments(command) {
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
function tokens(segment) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m = re.exec(segment);
  while (m) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
    m = re.exec(segment);
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
  let i = 0;
  while (i < args.length && (args[i] ?? "").startsWith("-")) {
    i += args[i] === "-C" || args[i] === "-c" ? 2 : 1;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
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
  let words2 = tokens(flat);
  const leads = () => {
    const first = words2[0] ?? "";
    return CONSTRUCT_WORDS.has(first) || /^[A-Za-z_]\w*=/.test(first) || first === "if" || first === "while" || first === "until" || first === "!";
  };
  while (words2.length && leads()) {
    words2 = words2.slice(1);
  }
  const [program, ...args] = words2;
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
  const segments = splitSegments(command);
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
  const record2 = args;
  const command = typeof record2.command === "string" ? record2.command : typeof record2.cmd === "string" ? record2.cmd : "";
  return isReadOnlyShellCommand(command);
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
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const path2 = args.path;
  return typeof path2 === "string" && path2.trim() ? path2.trim() : null;
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

// ../packages/run-guards/src/multiRead.ts
function singleReadsOf(tool, args) {
  if (tool !== "read_file" || !args || typeof args !== "object" || Array.isArray(args)) return null;
  const { paths, ...rest } = args;
  if (!Array.isArray(paths) || typeof rest.path === "string" && rest.path !== "") return null;
  const named = paths.filter((p) => typeof p === "string" && p.trim() !== "").slice(0, READ_FILE_MAX_PATHS);
  if (named.length === 0) return null;
  return named.map((path2) => ({ ...rest, path: path2 }));
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
  const path2 = normalizePathArg(p);
  return path2 === dir || path2.startsWith(`${dir}/`);
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
    const path2 = typeof wanted.path === "string" ? wanted.path : "";
    if (!path2) return null;
    if (typeof wanted.key === "string") return null;
    const want = requestedReadWindow(wanted);
    for (const read of this.exact.values()) {
      if (read.tool !== "read_file" || !read.cached) continue;
      if (typeof read.args.key === "string") continue;
      const earlierPath = typeof read.args.path === "string" ? read.args.path : "";
      if (earlierPath !== path2) continue;
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
      const count2 = positiveInt2(n);
      return count2 ? { file, from: 1, count: count2 } : null;
    }
    if (n.startsWith("+")) {
      const from = positiveInt2(n.slice(1));
      return from ? { file, from } : null;
    }
    const count = positiveInt2(n);
    return count ? { file, count } : null;
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
  const { path: path2, content } = args;
  if (typeof path2 !== "string" || !path2.trim() || typeof content !== "string") return null;
  return { path: path2.trim(), fingerprint: callFingerprint(tool, args) };
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
    const path2 = pathArgOf(args);
    if (path2) this.written.delete(path2);
  }
};
function repeatedWriteNote(tool, path2) {
  return `Not re-run: this exact \`${tool}\` of "${path2}" already succeeded earlier in this run and nothing has changed the file since, so it already holds this content \u2014 writing it again cannot change anything. If something still looks broken, the cause is not that the write failed: re-read the error (it may predate your write), look elsewhere for the cause, or tell the user what you see.`;
}

// ../packages/run-guards/src/editRevert.ts
var MAX_HISTORY_PER_PATH = 16;
var MAX_PATHS2 = 200;
function stringArg(args, ...keys) {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === "string") return v;
  }
  return void 0;
}
function changeOf(args) {
  const path2 = pathArgOf(args);
  if (!path2) return null;
  const a = args;
  const content = stringArg(a, "content");
  if (content !== void 0) return { path: path2, sig: `w:${contentHash3(content)}` };
  const from = stringArg(a, "old_string", "oldString", "find");
  const to = stringArg(a, "new_string", "newString", "replace");
  if (from === void 0 || to === void 0 || from === to) return null;
  const f = contentHash3(from);
  const t = contentHash3(to);
  return { path: path2, sig: `e:${f}>${t}`, inverse: `e:${t}>${f}` };
}
function changesContent(args) {
  return changeOf(args) !== null;
}
var EditRevertTracker = class {
  history;
  constructor(state) {
    this.history = new Map((state ?? []).map(([p, h]) => [p, [...h]]));
  }
  /**
   * Record a call that ran. A successful content change is appended to its path's
   * history and returned as a revert when it restores earlier content; a failed one, or
   * a deletion (`deleted: true`), forgets the path — its content is unknown.
   */
  record(tool, args, outcome) {
    if (outcome.deleted) {
      const path2 = pathArgOf(args);
      if (path2) this.history.delete(path2);
      return null;
    }
    const change = changeOf(args);
    if (!change) return null;
    if (!outcome.ok) {
      this.history.delete(change.path);
      return null;
    }
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

// ../packages/run-guards/src/noProgress.ts
var NO_PROGRESS_TURNS = 4;
var CHURN_TURNS = 12;
var REGROUND_TURNS = 8;
var MAX_SEEN = 500;
var TEST_PATH = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$/i;
var TEST_COMMAND = /\b(test|tests|vitest|jest|pytest|mocha|tsc|tsgo|typecheck|lint|eslint|cargo\s+test|go\s+test)\b/i;
function isCheckCallDefault(tool, args) {
  if (tool === "run_checks" || tool === "run_tests") return true;
  if (tool !== "run_command" || !args || typeof args !== "object") return false;
  const command = args.command;
  return typeof command === "string" && TEST_COMMAND.test(command);
}
function isTestPath(path2) {
  return TEST_PATH.test(path2.split("\\").join("/"));
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
  groundThisTurn = false;
  churnThisTurn = false;
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
    this.turn = 0;
    this.lastSeenAt = new Map(Object.entries(state?.lastSeenAt ?? {}));
    this.targetOf = ports.targetOf ?? ((_tool, args) => pathArgOf(args));
    this.isCheckCall = ports.isCheckCall ?? isCheckCallDefault;
    this.isPlatformProgress = ports.isPlatformProgress;
  }
  /**
   * One call of the current turn ran. `wrote` = it changed content (a file edit, or a
   * mutating command that names no file). Returns
   * whether the call was a check whose result CHANGED — a failing check that answers
   * differently each time is the run fixing things, not repeating a failure.
   */
  observe(tool, args, outcome) {
    const path2 = this.targetOf(tool, args);
    if (path2) {
      if (!this.seen.has(path2)) {
        this.seen.add(path2);
        if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value);
        this.groundThisTurn = true;
      } else {
        const last = this.lastSeenAt.get(path2);
        if (last === void 0 || this.turn - last >= REGROUND_TURNS) this.groundThisTurn = true;
      }
      this.lastSeenAt.set(path2, this.turn);
    }
    if (outcome.ok && !path2 && this.isPlatformProgress?.(tool, args)) this.groundThisTurn = true;
    if (outcome.ok && outcome.wrote) {
      if (path2 && isTestPath(path2)) this.groundThisTurn = true;
      const fingerprint = contentHash3(callFingerprint(tool, args));
      if (!this.changes.has(fingerprint)) {
        this.changes.add(fingerprint);
        if (this.changes.size > MAX_SEEN) this.changes.delete(this.changes.values().next().value);
        this.churnThisTurn = true;
      }
    }
    if (!this.isCheckCall(tool, args)) return { checkChanged: false };
    const digest = resultDigest(outcome.result);
    if (digest === this.lastCheck) return { checkChanged: false };
    this.groundThisTurn = true;
    this.lastCheck = digest;
    return { checkChanged: true };
  }
  /** The turn's calls all ran. Returns the idle-turn streak after it. */
  endTurn() {
    let progressed = this.groundThisTurn;
    if (this.groundThisTurn) this.churnTurns = 0;
    else if (this.churnThisTurn) {
      this.churnTurns += 1;
      progressed = this.churnTurns <= CHURN_TURNS;
    }
    this.lastGround = this.groundThisTurn;
    this.lastIdle = !progressed;
    this.idleTurns = progressed ? 0 : this.idleTurns + 1;
    this.groundThisTurn = false;
    this.churnThisTurn = false;
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
  }
  snapshot() {
    return {
      seen: [...this.seen],
      idleTurns: this.idleTurns,
      ...this.lastSeenAt.size ? { lastSeenAt: Object.fromEntries(this.lastSeenAt) } : {},
      ...this.changes.size ? { changes: [...this.changes] } : {},
      ...this.churnTurns ? { churnTurns: this.churnTurns } : {},
      ...this.lastCheck ? { lastCheck: this.lastCheck } : {}
    };
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

// ../packages/run-guards/src/reverifyTracker.ts
var MAX_REVERIFY_PATHS = 200;
function addBounded(set, path2) {
  set.delete(path2);
  set.add(path2);
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
  wrote(path2) {
    addBounded(this.writtenPaths, path2);
    this.readBackSinceWrite.delete(path2);
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
    const count = this.readsThisTurn > 0 && this.allRepeatReadBacks ? this.readsThisTurn : 0;
    this.readsThisTurn = 0;
    this.allRepeatReadBacks = true;
    return count;
  }
  snapshot() {
    return {
      ...this.writtenPaths.size ? { writtenPaths: [...this.writtenPaths] } : {},
      ...this.readBackSinceWrite.size ? { readBackSinceWrite: [...this.readBackSinceWrite] } : {}
    };
  }
};

// ../packages/run-guards/src/progressDetector.ts
var LADDER_RESET_TURNS = 8;
var SIGNAL_RANK = {
  edit_revert: 0,
  repeated_failure: 1,
  circling_read: 2,
  reverifying: 3,
  unkept_ready: 4,
  no_progress: 5
};
function succeeded(result) {
  if (result.isError) return false;
  const d = result.data;
  return !(d && typeof d === "object" && d.ok === false);
}
function visitTargetOf(args) {
  const path2 = pathArgOf(args);
  if (!args || typeof args !== "object") return path2;
  const a = args;
  const question = [a.query, a.pattern, a.symbol, a.name].find((v) => typeof v === "string" && v.trim() !== "");
  if (path2 && question) return `${path2} \u220B ${question.trim()}`;
  return path2 ?? question?.trim() ?? null;
}
var ProgressDetector = class {
  constructor(state = {}, ports = {}) {
    this.ports = ports;
    this.visits = new VisitTally(state.visits);
    this.failures = new FailureTally(state.failures);
    this.edits = new EditRevertTracker(state.edits);
    this.progress = new NoProgressTracker(state.progress, ports);
    this.claims = new UnkeptClaimTracker(state.claims);
    this.trips = state.trips ?? 0;
    this.tripsBySignal = { ...state.tripsBySignal ?? {} };
    this.unkeptTurns = state.unkeptTurns ?? 0;
    this.quietTurns = state.quietTurns ?? 0;
    this.steer = state.steer;
    this.readiness = new ReadinessAdvisory(state.advisory);
    this.batching = new BatchingNudge(state.batching);
    this.reverify = new ReverifyTracker(state);
    this.turnCalls = [];
  }
  ports;
  visits;
  failures;
  edits;
  progress;
  claims;
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
  raise(signal) {
    if (!this.turnSignal || SIGNAL_RANK[signal.kind] < SIGNAL_RANK[this.turnSignal.kind]) this.turnSignal = signal;
  }
  /** The current turn's own text — what it said before its calls (a readiness claim?). */
  noteTurnText(text) {
    this.claims.noteText(text);
  }
  /** One call of the current turn ran. */
  observe(tool, args, result) {
    this.turnCalls.push({ tool, args, result });
    this.claims.observe(this.ports.isReadOnly?.(tool, args) === true);
    const ok = succeeded(result);
    const unscoped = (this.ports.isUnscopedMutation ?? ((t) => t === "run_command"))(tool, args);
    const wrote = ok && (changesContent(args) || unscoped && this.ports.isReadOnly?.(tool, args) !== true);
    if (unscoped) {
      this.visits.markAllMayHaveChanged();
      this.edits.reset();
      if (wrote) this.reverify.wroteAnything();
    } else if ((this.ports.isDelete ?? ((t) => t === "delete_file"))(tool)) {
      this.edits.record(tool, args, { ok, deleted: ok });
      this.forgetVisitsOf(pathArgOf(args));
    } else if (changesContent(args)) {
      const revert = this.edits.record(tool, args, { ok });
      if (revert) this.raise({ kind: "edit_revert", tool, target: revert.path });
      if (ok) {
        const path2 = pathArgOf(args);
        this.forgetVisitsOf(path2);
        if (path2) this.reverify.wrote(path2);
      }
    } else if (ok && this.ports.isReadOnly?.(tool, args)) {
      const target = visitTargetOf(args);
      if (target) {
        this.reverify.read(target);
        const visit = this.visits.record(`${tool}:${target}`, args);
        if (visit.count >= REVISIT_HARD_AT && !visit.mayHaveChanged) this.raise({ kind: "circling_read", tool, target, count: visit.count });
      }
    }
    const { checkChanged } = this.progress.observe(tool, args, { ok, wrote, result: result.data });
    if (ok || checkChanged) this.failures.clear(tool, args);
    else {
      const attempts = this.failures.record(tool, args);
      const reason = failureReason(result.data);
      if (attempts >= FAILURE_HARD_AT) this.raise({ kind: "repeated_failure", tool, count: attempts, ...reason ? { reason } : {} });
    }
  }
  forgetVisitsOf(path2) {
    if (!path2) return;
    this.visits.forget((key) => {
      const target = key.slice(key.indexOf(":") + 1);
      return target === path2 || target.startsWith(`${path2} \u220B `);
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
    if (!this.turnSignal && idle >= NO_PROGRESS_TURNS) this.raise({ kind: "no_progress", count: idle });
    const signal = this.turnSignal;
    this.turnSignal = null;
    if (!signal) {
      this.readiness.endTurn();
      const advisoryNote = this.readiness.observe(this.unkeptTurns);
      if (advisoryNote) return { kind: "advisory", note: advisoryNote };
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
    this.visits.forget(() => true);
    this.failures.reset();
    const note = progressSteerNote(signal, this.trips);
    if (this.trips === 1) {
      this.steer = note;
      return { kind: "steer", trip: this.trips, signal, note };
    }
    if (this.trips === 2) {
      this.steer = note;
      return { kind: "escalate", trip: this.trips, signal, note };
    }
    return { kind: "pause", trip: this.trips, signal, question: progressPauseQuestion(signal, this.trips) };
  }
  /** A host that could not escalate shows the steer instead (or after pausing, clears it). */
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
      ...this.reverify.snapshot()
    };
  }
};
function progressSteerNote(signal, trip) {
  const head = `Progress check (${trip === 1 ? "first warning" : "second warning \u2014 the run has been moved to a stronger model"}): `;
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
    case "no_progress":
      return `the last ${signal.count} turns touched no new file and changed nothing about the tests. Re-read the task, pick the next concrete step that changes code or runs a check, and do it now \u2014 or finish and explain what is blocking you.`;
  }
}
function progressPauseQuestion(signal, trip) {
  const what = {
    edit_revert: `keeps undoing its own change to ${signal.target ?? "a file"}`,
    repeated_failure: `keeps repeating a failing \`${signal.tool ?? "tool"}\` call`,
    circling_read: `keeps re-reading ${signal.target ?? "the same file"} without acting`,
    reverifying: "keeps re-checking files it already wrote and verified instead of reporting the result",
    unkept_ready: "keeps saying it has everything it needs, then reads more instead of acting",
    no_progress: "has stopped making progress (no new files, no test changes)"
  };
  return `This run ${what[signal.kind]} \u2014 progress check ${trip}, after earlier warnings. How should it proceed? Reply with guidance to continue, or stop the run.`;
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
  return {
    label: "loop.progress_check",
    args: override.detail ?? { trip: action.trip, signal: action.signal.kind, action: action.kind },
    result: `progress check ${action.trip}: ${action.signal.kind} \u2192 ${outcome}`
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
function normalizeEvidencePath(path2) {
  return path2.replace(/\\/g, "/").replace(/\/+/g, "/");
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
  const entryFor = (path2) => {
    const key = normalizeEvidencePath(path2);
    let e = entries.get(key);
    if (!e) {
      e = { latestHash: null, byHash: /* @__PURE__ */ new Map() };
      entries.set(key, e);
    }
    return e;
  };
  return {
    noteWrite(path2) {
      const e = entryFor(path2);
      e.latestHash = null;
      e.byHash.clear();
    },
    record(path2, contentHash4, check) {
      const e = entryFor(path2);
      if (e.latestHash !== null && e.latestHash !== contentHash4) return;
      e.latestHash = contentHash4;
      const capped = {
        ...check,
        findings: check.findings.slice(0, MAX_CHECK_FINDINGS),
        ...check.outputTail ? { outputTail: check.outputTail.slice(-MAX_CHECK_OUTPUT_TAIL) } : {}
      };
      const list = e.byHash.get(contentHash4);
      if (list) list.push(capped);
      else e.byHash.set(contentHash4, [capped]);
    },
    for(path2, contentHash4) {
      const e = entries.get(normalizeEvidencePath(path2));
      if (!e || e.latestHash !== contentHash4) return [];
      return e.byHash.get(contentHash4) ?? [];
    },
    current(path2) {
      const key = normalizeEvidencePath(path2);
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
function basenameOf(path2) {
  const normalized = normalizeEvidencePath(path2);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
function extOf(path2) {
  const base = basenameOf(path2);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}
function stemOf(path2) {
  const base = basenameOf(path2);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
var SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
function isSourceFile(path2) {
  return SOURCE_EXTENSIONS.has(extOf(path2));
}
function dirOf2(path2) {
  const normalized = normalizeEvidencePath(path2);
  const slash2 = normalized.lastIndexOf("/");
  return slash2 >= 0 ? normalized.slice(0, slash2) : "";
}
function moduleKey(path2) {
  return normalizeEvidencePath(path2).replace(/\.[cm]?[jt]sx?$/i, "");
}
function isExemptFromTestRule(path2, policy) {
  const normalized = normalizeEvidencePath(path2);
  return (policy.newSourceTestExempt ?? []).some((source) => new RegExp(source, "i").test(normalized));
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
function isErrorFinding(finding3) {
  const tokens2 = finding3.trim().split(/\s+/);
  return (tokens2[1] ?? "").toLowerCase() === "error";
}
function pass() {
  return { ok: true, unavailable: [] };
}
function refuse(reason) {
  return { ok: false, reason };
}
function firstFindings(check, max = 3) {
  const shown = check.findings.slice(0, max);
  const more = check.findings.length > max ? ` (+${check.findings.length - max} more)` : "";
  return shown.length ? shown.join("; ") + more : "(no findings recorded)";
}
function checkFailureReason(path2, check, detail) {
  const tail = check.outputTail?.trim();
  return `git_push refused: ${path2} failed ${check.kind} "${check.name}"${detail}. First findings: ${firstFindings(check)}.` + (tail ? ` Output (tail): ${tail.replace(/\s+/g, " ").trim().slice(0, 400)}.` : "") + ` Fix the failure and push again \u2014 the host runs the checks.`;
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
      const record2 = records.reduce((a, b) => b.at >= a.at ? b : a);
      if (record2.outcome === "fail") {
        const detail = record2.exitCode != null ? ` (exit ${record2.exitCode})` : "";
        return refuse(checkFailureReason(file.absPath, record2, detail));
      }
      if (record2.outcome === "unavailable") {
        unavailable2.push(`${file.absPath}: ${record2.name} (${kind}) unavailable`);
      }
      if (kind === "diagnostics") {
        if (record2.findings.some(isErrorFinding)) return refuse(checkFailureReason(file.absPath, record2, " (LSP error)"));
      }
    }
    if (policy.newSourceNeedsTest && file.isNew && isSourceFile(file.absPath) && !isTestPath(file.absPath) && !isExemptFromTestRule(file.absPath, policy)) {
      const stem = stemOf(file.absPath);
      const hasTest = files.some((t) => t !== file && !t.deleted && isTestPath(t.absPath) && covers(t, file, policy));
      if (!hasTest) {
        return refuse(
          `git_push refused: ${file.absPath} is new and has no test in this push. Add ${stem}.test.ts covering it, commit, and push again \u2014 the host runs the checks.`
        );
      }
    }
  }
  return unavailable2.length ? { ok: true, unavailable: unavailable2 } : pass();
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
  if (review.verdict === "changes_requested") {
    return refuse(
      `git_push refused: reviewer ${review.reviewerModel} requested changes. Findings: ${review.findings.slice(0, 5).join("; ") || "(none recorded)"}. Address them and push again.`
    );
  }
  return pass();
}
function shellPublishHint(command) {
  if (!gitCommandPattern("commit|push").test(command)) return null;
  return "That shell command publishes. Use the git_commit / git_push tools instead: git_push runs the evidence gates and the independent review before the push leaves the machine.";
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
function describe(value) {
  if (Array.isArray(value)) return `[array: ${value.length} items]`;
  if (value && typeof value === "object") return `{object: ${Object.keys(value).length} keys}`;
  return String(value);
}
function projectValue(value, step, depth) {
  if (typeof value === "string") {
    return value.length > step.stringChars ? `${value.slice(0, step.stringChars)}\u2026(+${value.length - step.stringChars} chars)` : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= step.depth) return describe(value);
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
  const withNote = (result) => opts.advisory && opts.attachAdvisory ? opts.attachAdvisory(result, opts.advisory) : result;
  const done = (served2, truncated) => ({ value: withNote(served2), served: served2, truncated });
  const lines = out.content.split("\n");
  const offset = typeof out.offset === "number" && out.offset > 0 ? Math.floor(out.offset) : 1;
  const totalLines = typeof out.totalLines === "number" && out.totalLines > 0 ? Math.floor(out.totalLines) : offset + lines.length - 1;
  const alreadyPartial = out.truncated === true;
  const served = (kept, note) => {
    const lastLine = offset + kept.length - 1;
    return { ...out, content: kept.join("\n"), offset, totalLines, truncated: lastLine < totalLines || alreadyPartial, note };
  };
  const build = (kept, note) => withNote(served(kept, note));
  const fits = (value) => JSON.stringify(value).length <= maxChars;
  if (fits(withNote({ ...out }))) return done({ ...out }, false);
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
function capFor(tool, opts) {
  if (opts.maxChars !== void 0) return opts.maxChars;
  const tableCap = !opts.summarize && !isPagedReadTool(tool) ? DEFAULT_TOOL_OUTPUT_CHARS : toolOutputCap(tool, opts.caps);
  return windowedCap(tool, tableCap, opts.contextWindowTokens);
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
  const cap2 = capFor(tool, opts);
  const full = JSON.stringify(attach(out ?? null, opts));
  if (full.length <= cap2) return { content: full, bytes, truncated: false };
  const advisoryChars = opts.advisory ? opts.advisory.length + 16 : 0;
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
  const record2 = args;
  for (const key of TARGET_KEYS) {
    const value = record2[key];
    if (typeof value === "string" && value.trim()) return shortenTarget(value);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  if (Array.isArray(record2.paths)) {
    const names = record2.paths.filter((p) => typeof p === "string" && p.trim() !== "");
    if (names.length) return shortenTarget(names.join(", "));
  }
  return void 0;
}
var QUESTION_KEYS = ["query", "q", "search", "pattern", "glob", "key"];
var VISIT_QUESTION_SEPARATOR = " \u220B ";
function visitTarget(args) {
  const scope = activityTarget(args);
  if (!scope) return void 0;
  const record2 = args;
  for (const key of QUESTION_KEYS) {
    const value = record2[key];
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

// src/chatActivity.ts
var PHASES = ["started", "completed", "failed", "paused", "resumed", "cancelled"];
function isPhase(v) {
  return typeof v === "string" && PHASES.includes(v);
}
function str3(v) {
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
  const ticketKind = str3(meta.ticketKind) ?? "task";
  const ticketRef = str3(meta.ticketRef) ?? "";
  const agentName = str3(meta.agentName) ?? str3(meta.agentRef) ?? "";
  if (meta.runMilestone != null && isPhase(meta.phase)) {
    return {
      kind: "milestone",
      phase: meta.phase,
      agentName,
      ticketKind,
      ticketRef,
      executionId: typeof meta.executionId === "number" ? meta.executionId : null,
      ...str3(meta.toStatus) ? { toStatus: str3(meta.toStatus) } : {},
      ...str3(meta.note) ? { note: str3(meta.note) } : {},
      ...str3(meta.question) ? { question: str3(meta.question) } : {}
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
    const sig = stepSig(parsed.step.category, parsed.step.label, parsed.tsIso);
    if (seen.has(sig)) continue;
    seen.add(sig);
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
var REPO_PUBLISH_TOOLS = /* @__PURE__ */ new Set([
  "git_commit",
  "git_push",
  "open_pull_request",
  // Cleanup deletes the merged branch locally and on origin, so the branch inventory a
  // platform read returns is different after it. It is ALSO an unscoped mutation (it
  // checks out and fast-forwards the base), and that set already clears everything —
  // listing it here states the second reason rather than relying on the first.
  "git_cleanup_merged"
]);
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
    return `#${first + i + 1} "${label}" ${r.turns} turn(s) \xB7 ${r.calls} call(s)${r.cacheAnswered ? ` \xB7 ${r.cacheAnswered} cache-answered` : ""} \xB7 ${r.mutationsSucceeded} changed${r.spinning ? " \u26A0 SPUN" : ""}`;
  });
  return `Runs (latest last; the figures above are run #${runs.length}'s): ${first ? `(${first} earlier) ` : ""}${named.join(" | ")}`;
}
function formatRunProgress(p) {
  const lines = [];
  const reach = p.targetedCalls > 0 ? `${p.distinctTargets} distinct target(s) over ${p.targetedCalls} targeted call(s)` : "no targeted calls";
  lines.push(
    `Progress: ${reach}${p.repeatedTargets.length ? ` \xB7 ${Math.round(p.revisitRatio * 100)}% of calls revisited ground already covered` : " \xB7 no repeats"}${p.duplicateCalls ? ` \xB7 ${p.duplicateCalls} EXACT duplicate call(s)` : ""}${p.cacheAnswered ? ` \xB7 ${p.cacheAnswered} call(s) answered from the read cache, never re-run` : ""}${p.longestStreak ? ` \xB7 ${formatStreak(p.longestStreak)}${p.streaks > 1 ? ` (${p.streaks} such streaks)` : ""}` : ""}`
  );
  if (p.repeatedTargets.length) {
    const named = p.repeatedTargets.slice(0, MAX_NAMED_TARGETS).map((t) => `${t.label} \xD7${t.count}`).join(" \xB7 ");
    const rest = p.repeatedTargets.length - MAX_NAMED_TARGETS;
    lines.push(`Revisited: ${named}${rest > 0 ? ` (+${rest} more)` : ""}`);
  }
  if (p.runs.length > 1) lines.push(formatRuns(p.runs));
  if (p.editIntent) {
    lines.push(
      `Effect: the request asked for a CHANGE \xB7 ${p.mutationsAttempted} mutating call(s) attempted, ${p.mutationsSucceeded} succeeded${p.noEffect ? " \xB7 \u26A0 NOTHING WAS CHANGED" : ""}`
    );
  } else if (p.mutationsAttempted > 0) {
    lines.push(`Effect: ${p.mutationsAttempted} mutating call(s) attempted, ${p.mutationsSucceeded} succeeded.`);
  }
  if (p.wallClockMs > 0) {
    const active = Math.max(0, p.wallClockMs - p.idleMs);
    lines.push(
      `Time: ${progressDuration(active)} wall clock \xB7 ${progressDuration(p.modelMs)} in the model \xB7 ${progressDuration(p.toolMs)} in tools${p.slowestStep ? ` \xB7 slowest ${p.slowestStep.label} (${progressDuration(p.slowestStep.ms)})` : ""}${p.idleMs > 0 ? ` \xB7 ${progressDuration(p.idleMs)} waiting on the user between turns, excluded (span ${progressDuration(p.wallClockMs)})` : ""}`
    );
  }
  return lines;
}
function runProgressVerdict(p) {
  if (!p.spinning && !p.noEffect) {
    const earlier = spunEarlier(p);
    if (!earlier) return null;
    const { run, index } = earlier;
    return `NO PROGRESS in run #${index + 1} of ${p.runs.length} ("${run.ask.replace(/\s+/g, " ").trim().slice(0, ASK_LABEL_CHARS)}"): it went back over ground it had already covered \u2014 ${run.turns} turn(s), ${run.calls} call(s)${run.cacheAnswered ? `, ${run.cacheAnswered} of them answered from the read cache` : ""}, ${run.mutationsSucceeded} change(s). The latest run did not spin; the figures above are its own. This is a LOOP in that run, not context pressure \u2014 see the Runs line.`;
  }
  const worst = p.repeatedTargets[0];
  const streak = p.stuckOnCall && p.longestStreak ? `it made the same call ${p.longestStreak.count} times in a row \u2014 ${formatStreak(p.longestStreak)} \u2014 with nothing else attempted between them${p.longestStreak.failed === p.longestStreak.count ? ", re-asking a question it had already been answered the same way each time" : ""}` : null;
  const revisit = p.repeatedTargets.length ? `${Math.round(p.revisitRatio * 100)}% of its targeted calls revisited a target it had already read${worst ? `, worst \`${worst.label}\` \xD7${worst.count}` : ""}` : null;
  const loop = p.spinning ? `NO PROGRESS \u2014 ${streak ? `${streak}${revisit ? `; ${revisit}` : ""}` : `the run kept going back over ground it had already covered: ${revisit}`}${p.duplicateCalls ? `, and ${p.duplicateCalls} call(s) repeated earlier arguments EXACTLY` : ""}. ` : "NO EFFECT \u2014 ";
  const effect = p.noEffect ? `The request asked for a change and the run finished with ZERO successful mutating calls${p.mutationsAttempted ? ` (${p.mutationsAttempted} attempted, all failed)` : " \u2014 it never attempted one"}, so nothing was actually modified. ` : "";
  const remedy = p.spinning ? `This is a LOOP, not context pressure and not a model that "won't call tools" \u2014 the numbers on those signals are a consequence of the repetition, not its cause. ${streak && p.longestStreak && p.longestStreak.failed > 0 ? "A call repeated back-to-back after FAILING is the model ignoring the error it was given: the failure text usually names the exact change to make (a `repo`, a path, a missing argument). Check that the tool result reached the model un-truncated, and that the repeated-failure advisory fired; if it did and the model still repeated the call, the model is not reading tool results \u2014 switch models for this run." : streak ? "A call repeated back-to-back after SUCCEEDING is the model not retaining the answer it already has: the result was truncated, or too large to keep in the transcript. Check the truncated-results count above, and shrink or page that result rather than the transcript." : "Look at the repeated targets above: the agent is not retaining what it already read (the result was truncated, or the read was too narrow to answer the question). Widen the read, or cache the file in the transcript, rather than shrinking context or switching models."}` : 'Check the "Answered from memory" line first \u2014 a turn served from the Q&A cache or an Evermind head does NO work by construction, so a run made largely of those has no mutating call to find. Otherwise check whether the agent was ever offered a mutating tool this run (see the tools-advertised line) before concluding the model refused to act.';
  return `${loop}${effect}${remedy}`;
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
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
var packageLookRoot;
function lookRoot() {
  if (packageLookRoot === void 0) {
    try {
      packageLookRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    } catch {
      packageLookRoot = typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : null;
    }
  }
  return packageLookRoot;
}
var hasPackageJson = (dir) => {
  const root = lookRoot();
  if (root === null) return false;
  try {
    return existsSync(path.join(root, dir, "package.json"));
  } catch {
    return false;
  }
};
function taskPackageDir(task) {
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
    if (hasPackageJson(dir)) return dir;
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
  return normText.includes(normDir) || normText.includes(path.posix.basename(normDir));
}
var refText = (t) => t.brief?.trim() ? `${t.brief} ${t.title}` : t.title;
var normPaths = (t) => t.paths.map((p) => p.replace(/\\/g, "/"));
var scopeOf = (t) => ({ label: t.title, paths: normPaths(t) });
var pathDisjoint = (a, b) => overlappingScopes([scopeOf(a), scopeOf(b)]) === null;
function computeOrderDependencies(tasks) {
  const deps = [];
  const packageOf = tasks.map(taskPackageDir);
  for (let j = 0; j < tasks.length; j += 1) {
    for (let i = 0; i < j; i += 1) {
      const packageDir = packageOf[i];
      if (packageDir === null || !pathDisjoint(tasks[i], tasks[j])) continue;
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
function splitForParallel(tasks) {
  const all = tasks.map((_, i) => i);
  const order = computeOrderDependencies(tasks);
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
  const count = (label) => events.filter((e) => e.label === label).length;
  const roleHandoffs = events.filter((e) => e.label === "llm.role_handoff");
  const hasArg = (e, key) => !!e.args && typeof e.args === "object" && key in e.args;
  return {
    roles: [...byRole.entries()].map(([role, e]) => ({
      role,
      turns: e.turns,
      models: ranked(e.models).map(([model, n]) => ({ model, turns: n })),
      failovers: ranked(e.failovers).map(([failover, n]) => ({ failover, turns: n }))
    })),
    coderReasks: roleHandoffs.filter((e) => hasArg(e, "from")).length,
    handOffs: roleHandoffs.filter((e) => hasArg(e, "via")).length,
    handOffsForced: count("loop.hand_off_due"),
    planBudgetsSpent: count("loop.plan_budget_spent"),
    handOffModes: events.filter((e) => e.label === HAND_OFF_MODE_LABEL).map(decisionOf).filter((d) => d !== null),
    handOffClashesRefused: count(HAND_OFF_CLASH_LABEL)
  };
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
    `  \u2022 analysis \u2192 code: ${r.coderReasks} re-ask(s) on a first edit \xB7 ${r.handOffs} hand_off call(s)` + (r.handOffsForced ? ` \xB7 ${r.handOffsForced} forced by the analysis budget` : "") + (r.planBudgetsSpent ? ` \xB7 ${r.planBudgetsSpent} ended analysis with no hand-off` : "") + (r.handOffClashesRefused ? ` \xB7 ${r.handOffClashesRefused} plan(s) sent back once for overlapping paths` : "")
  );
  for (const d of r.handOffModes ?? []) lines.push(decisionLine(d));
  const plan = r.roles.find((x) => x.role === "plan")?.models[0]?.model;
  const code = r.roles.find((x) => x.role === "code");
  if (r.coderReasks > 0 && plan && code && code.models.length === 1 && code.models[0].model === plan) {
    lines.push(`  \u26A0 every code turn was answered by the planning model (${plan}) \u2014 no stronger connected coder served one. See "gateway left" above, or the connected accounts' health in the / menu.`);
  }
  return lines;
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
  const record2 = toolResultRecord(result);
  if (!record2) return { localId: null, syncId: null };
  const idRef = parseEntityRef(record2.id);
  const syncId = parseSyncId(record2.syncId) ?? parseSyncId(record2.taskId) ?? (idRef && "sync" in idRef ? idRef.sync : null);
  const localId = isLocalId(record2.localId) ? record2.localId : idRef && "local" in idRef ? idRef.local : null;
  return { localId, syncId };
}

// src/staffingSummary.ts
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
  const verdict = dispatched > 0 || personaSubagents.some((p) => p.ok) ? "staffed" : dispatchRefusals.length > 0 ? "staffing-refused" : ticketsCreated > 0 && filedLocally === ticketsCreated ? "filed-locally" : ticketsCreated > 0 ? "filed-not-staffed" : "no-work-filed";
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
  const shipped = opts?.sessionShipped ?? 0;
  const sessionDidIt = shipped > 0 && (s.verdict === "filed-not-staffed" || s.verdict === "staffing-refused");
  const tail = sessionDidIt ? ` \u2014 the session itself changed the code (${shipped} write/commit call(s) succeeded); a cloud dispatch was not required` : s.verdict === "filed-not-staffed" ? " \u2014 the work was filed but nobody is running it" : s.verdict === "filed-locally" ? " \u2014 filed on this device; the work runs here, by the session and its local sub-agents, and the tickets sync to the account when sync is on" : s.verdict === "staffing-refused" ? " \u2014 every attempt to staff the work was refused, so nobody is running it" : "";
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

// src/brainTriage.ts
import { HISTORY_TOKEN_BUDGET } from "@seanhogg/builderforce-memory/working";

// src/toolExposure.ts
function toolExposureInTrace(events) {
  let lastTurn = null;
  let min = null;
  let catalog = null;
  for (const ev of events) {
    if (ev.category !== "llm") continue;
    const a = ev.args;
    if (typeof a?.advertisedTools === "number") {
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
var CONTEXT_PROMPT_PEAK = Math.round(HISTORY_TOKEN_BUDGET * 1.5);
var LARGE_LOSSY_RESULT_BYTES = 2e4;
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
var FILE_WRITE_TOOL = /(attachments|files?|project_files)[._](write|save|update)/i;
function isFileWriteTool(label) {
  return isCodeChangeTool(label) || FILE_WRITE_TOOL.test(label);
}
var UNBACKED_WRITE_CLAIM_NOTICE = "\u26A0 UNBACKED WRITE CLAIM \u2014 an assistant turn claimed it saved/updated a file, but no file-write tool (write_file / edit_file / attachments.write / project_files.save) succeeded in this run. The file was NOT modified.";
var UNBACKED_TICKET_CLAIM_NOTICE = "\u26A0 UNBACKED TICKET CLAIM \u2014 an assistant turn claimed it created/filed/linked a ticket or gap, but no create/link tool (tasks.create / chats.link_ticket / tickets.from_delta) succeeded in this run. Nothing was filed or linked to the chat.";
var FILE_SAVE_CLAIM = /\b(saved|updated|wrote|written|edited|persisted|added)\b[^.!?\n]*\b(file|attachment|roadmap|document|upload|\.md|\.csv|\.txt|\.json)\b/i;
var TICKET_WRITE_TOOL = new RegExp(
  `(tasks|objectives|key_results|initiatives|portfolios|specs|roadmap)[._]create|chats[._]link_ticket|tickets[._]from_delta|${LOCAL_TICKET_CREATE_LABEL.source}`,
  "i"
);
var TICKET_CLAIM = /\b(created|filed|opened|logged|added|linked|tracked)\b[^.!?\n]*\b(ticket|task|gap|epic|issue|objective|bug|card|board)\b/i;
function isTicketWriteTool(label) {
  return TICKET_WRITE_TOOL.test(label);
}
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
  return events.filter((e) => e.label === LOOP_STEP.failover).length;
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
  const str4 = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return str4.length > n ? str4.slice(0, n) + `\u2026 (+${str4.length - n} chars)` : str4;
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
var MEMORY_WRITE_TOOLS = /* @__PURE__ */ new Set(["remember_fact", "builtin_remember_fact"]);
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
        const count = result.count;
        if (typeof count === "number") out.evermindItems += count;
        const tokens2 = result.blockTokens;
        if (typeof tokens2 === "number") out.evermindPromptTokens += tokens2;
      }
    } else if (ev.category === "learn") {
      out.learnSteps += 1;
    } else if (ev.category === "reconcile") {
      out.reconcileSteps += 1;
    } else if (ev.category === "tool" && !ev.isError && !isFailedToolResult(ev.result)) {
      if (MEMORY_READ_TOOLS.has(ev.label)) out.factsRead += 1;
      if (MEMORY_WRITE_TOOLS.has(ev.label)) out.factsWritten += 1;
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
function sessionShippedInTrace(events) {
  let n = 0;
  for (const ev of events) {
    if (ev.category !== "tool" || ev.isError || isFailedToolResult(ev.result)) continue;
    if (isCodeChangeTool(ev.label) || ev.label === "git_commit" || ev.label === "git_push") n += 1;
  }
  return n;
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
      ...gate.callerRole ? { callerRole: gate.callerRole } : {}
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
  const memoryUsage = memoryUsageInTrace(events);
  const workFiledNotStaffed = sessionShipped === 0 && (staffing.verdict === "filed-not-staffed" || staffing.verdict === "staffing-refused");
  const unresolvedAppFailures = unresolvedAppFailuresInTrace(events);
  const healthy = errors.length === 0 && !loopExhausted && emptyOrLengthFinishes === 0 && !contextSignal && !announcedUnmadeToolCall && !answeredInProse && !noProgress && unresolvedAppFailures === 0 && didWork;
  const likelyCause = memoryOnlyRun ? "memory-answered" : noToolsAdvertised ? "no-tools-advertised" : narratedUnadvertisedTools.length > 0 ? "tool-not-advertised" : announcedUnmadeToolCall ? "tool-calls-not-emitted" : answeredInProse ? "answered-in-prose" : noProgress ? "no-progress" : contextSignal && !degradationSignal ? "context-exhaustion" : degradationSignal && !contextSignal ? "model-degradation" : unresolvedAppFailures > 0 ? "app-errors-unresolved" : workFiledNotStaffed ? "work-filed-not-staffed" : healthy ? "healthy" : "inconclusive";
  return {
    turns: llm.length,
    toolCalls: toolEvents.length,
    errors: errors.length,
    errorSteps,
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
    memoryUsage,
    unresolvedAppFailures,
    likelyCause
  };
}
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
  return `Context: pressure noted (${parts.join("; ")}) \u2014 no turn was cut short by it. The working transcript is held to a ${HISTORY_TOKEN_BUDGET.toLocaleString("en-US")}-token budget on purpose, so a prompt above that figure is the design working, not a fault.`;
}
function formatBrainDiagnostics(d) {
  const evermindAnswers = d.memoryAnswers?.filter((m) => m.source === "evermind") ?? [];
  const verdict = d.likelyCause === "memory-answered" ? `ANSWERED FROM MEMORY \u2014 no model ran this turn. The reply was served by the memory-first short-circuit (${(d.memoryAnswers ?? []).map((m) => m.source === "evermind" ? `the project Evermind SSM${m.projectId != null ? ` of project #${m.projectId}` : ""}${m.version != null ? ` v${m.version}` : ""}` : m.source === "symbol-index" ? "the workspace symbol index" : m.source === "deterministic" ? `the deterministic workspace action ${m.actionId ?? ""}`.trim() : "the Q&A cache").join(", ")}), so zero turns, zero tokens and zero tool calls is EXPECTED, not a fault. ${evermindAnswers.length ? "The Evermind SSM cannot call tools and answers only from what it has learned, so it can neither fetch live data nor do work \u2014 if the reply was wrong, garbled or stale, that is the cause. Turn Memory off for this chat, or disable inference on that head." : (d.memoryAnswers ?? []).every((m) => m.source === "symbol-index") ? 'The request was only "where is X defined?" and the symbol index resolved every name, so the definitions were listed without a model; ask for anything more to reach the model.' : (d.memoryAnswers ?? []).every((m) => m.source === "symbol-index" || m.source === "deterministic") ? "A deterministic workspace action (the PreFetch gate) settled the request without a model; ask for anything more to reach the model." : "The reply is a replay of an earlier answer to the same question; ask a differently-worded question to reach the model."} Switching models changes nothing here.` : d.likelyCause === "no-tools-advertised" ? 'NO TOOLS ADVERTISED \u2014 at least one turn was handed ZERO tool definitions, so it could not have emitted a call whatever it wanted to do. This is a catalog/config failure on our side, not a model fault: the gateway MCP catalog (`/llm/v1/mcp/tools`) failed to load, or no actions were registered for this surface. See the "Tools available to the model" line in the Chat diagnostics block for the fetch error. Switching models will not help.' : d.likelyCause === "tool-not-advertised" ? `TOOL NOT ADVERTISED \u2014 a turn wrote out ${d.narratedUnadvertisedTools.map((n) => `\`${n}\``).join(", ")} as prose while that tool was NOT among the ones it was offered that turn. No model can emit a call for a function it was never given, so this is OUR per-turn tool selection dropping a tool the prompt asked for \u2014 not a model that "won't call tools". Fix the selection (pin the tool, or name it in the system prompt so it is force-included) rather than switching models.` : d.likelyCause === "tool-calls-not-emitted" ? 'TOOL CALLS NOT EMITTED \u2014 a turn NARRATED a tool call in prose ("I\'ll call the tool\u2026", a bare `builtin_\u2026` name) but the run recorded ZERO tool steps, so nothing executed and the answer never got its data. The tools WERE advertised and the agent loop only runs structured `tool_calls`, so this is a model/provider fault: the model is describing calls instead of emitting them. Try a different model.' : d.likelyCause === "answered-in-prose" ? "ANSWERED IN PROSE \u2014 at least one turn was handed tool definitions but replied with text and ZERO tool calls, so nothing ran. The tools were advertised; the model described the work instead of doing it. This is a model/provider fault: try a different model, or pin one that emits structured calls." : d.likelyCause === "no-progress" ? (d.progress && runProgressVerdict(d.progress)) ?? "NO PROGRESS \u2014 the run repeated work without advancing." : d.likelyCause === "context-exhaustion" ? `Likely CONTEXT EXHAUSTION (case A) \u2014 ${contextEvidence(d)}.` : d.likelyCause === "model-degradation" ? "Likely MODEL DEGRADATION (case B) \u2014 an Evermind/SSM turn returned empty while tokens stayed low." : d.likelyCause === "app-errors-unresolved" ? `APP STILL BROKEN \u2014 every tool call succeeded, but the run's last diagnostics read still reported ${d.unresolvedAppFailures} build/runtime failure(s) in the app it was working on. The tools are fine; the app is not. Read that diagnostics result in the trace below for the error \u2014 if it points into a package CDN or the preview runtime rather than the project's own files, the fault is the platform's, and rewriting project files will not fix it.` : d.likelyCause === "work-filed-not-staffed" ? workFiledNotStaffedVerdict(d.staffing) : d.likelyCause === "healthy" ? "No failure signal \u2014 no errors, no truncated or empty turns, and no context pressure. Nothing here needs triaging." : "Inconclusive \u2014 not enough signal to separate context exhaustion from model degradation.";
  const lines = ["--- Diagnostics ---", `Likely cause: ${verdict}`];
  const scope = d.turnCoveragePartial ? " (this session)" : "";
  lines.push(`Turns${scope}: ${d.turns} \xB7 Tool calls: ${d.toolCalls} \xB7 Errors: ${d.errors}${d.loopExhausted ? " \xB7 LOOP EXHAUSTED" : ""}`);
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
  lines.push(...d.progress ? formatRunProgress(d.progress) : []);
  if (d.memoryUsage) lines.push(formatMemoryUsage(d.memoryUsage));
  lines.push(...d.staffing ? formatStaffingSummary(d.staffing, { sessionShipped: d.sessionShipped }) : []);
  if (d.errorSteps?.length) {
    for (const e of d.errorSteps) {
      lines.push(
        `Failed step: ${e.label}${e.model ? ` on ${e.model}` : ""} \u2014 ${e.message}` + (e.requiredRole || e.callerRole ? ` \u2014 requires ${e.requiredRole ?? "unknown"}, caller is ${e.callerRole ?? "unknown"}${e.remediation ? `; ${e.remediation}` : ""}` : "")
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
  return lines;
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
var MUTATION_TOOL = /(^|_)(write|edit|save|create|update|delete|apply|patch|publish|send|dispatch|run_command|assign|link|move|set)(_|$)/i;
function isMutationTool(name) {
  return isCodeChangeTool(name) || MUTATION_TOOL.test(name);
}
function hasEditIntent(messages) {
  return messages.some((m) => m.role === "user" && asksForChange(m.content));
}
function callSignature(ev) {
  return callFingerprint(ev.label, ev.args);
}
function targetSignature(ev) {
  const target = subjectOf(ev);
  return target ? `${ev.label}:${target}` : null;
}
function subjectOf(ev) {
  return visitTarget(ev.args)?.replace(/\\/g, "/").replace(/^\.\//, "");
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
  if (slices.length === 1) return { ...progressOf(events, hasEditIntent(messages)), runs: [] };
  const intentOf = (ask, own2) => hasEditIntent(own2) || isContinuationDirective(ask) && hasEditIntent(messages);
  const each = slices.map((s) => ({ s, p: progressOf(s.events, intentOf(s.ask, s.messages)) }));
  const runs = each.map(({ s, p }) => ({
    ask: s.ask,
    turns: s.events.filter((e) => e.label === "llm.complete").length,
    calls: s.events.filter((e) => e.category === "tool").length,
    cacheAnswered: p.cacheAnswered,
    mutationsSucceeded: p.mutationsSucceeded,
    spinning: p.spinning
  }));
  return { ...each[each.length - 1].p, runs };
}
function progressOf(events, editIntent) {
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
  let streaks = 0;
  let longestStreak = null;
  let current = null;
  for (const ev of tools) {
    const sig = callSignature(ev);
    const subject = subjectOf(ev);
    if (seenCalls.has(sig)) duplicateCalls += 1;
    else seenCalls.set(sig, subject);
    const cached = isCacheAnswered(ev);
    if (cached) cacheAnswered += 1;
    const failed2 = Boolean(ev.isError) || isFailedToolResult(ev.result);
    if (current && current.sig === sig) {
      current.streak.count += 1;
      if (failed2) current.streak.failed += 1;
      if (current.streak.count === 2) streaks += 1;
      if (!longestStreak || current.streak.count > longestStreak.count) longestStreak = current.streak;
    } else {
      current = { sig, streak: { label: ev.label, count: 1, failed: failed2 ? 1 : 0 } };
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
    if (isMutationTool(ev.label)) {
      mutationsAttempted += 1;
      if (!cached && !ev.isError && !isFailedToolResult(ev.result)) {
        mutationsSucceeded += 1;
        if (subject) {
          for (const key of sinceEdit.keys()) if (key.endsWith(`:${subject}`)) sinceEdit.set(key, 0);
          for (const [s, t] of seenCalls) if (t === subject) seenCalls.delete(s);
        }
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
  const noEffect = editIntent && didWork && mutationsSucceeded === 0;
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
function succeeded2(ev) {
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
    let path2 = line.slice(3);
    const arrow = path2.indexOf(" -> ");
    if (arrow >= 0) path2 = path2.slice(arrow + 4);
    path2 = path2.trim().replace(/^"(.*)"$/, "$1");
    if (path2) out.push(path2);
  }
  return out;
}
function touchedStillDirty(touched, dirty) {
  const norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const d = dirty.map(norm);
  return touched.map(norm).some((t) => d.some((p) => t === p || t.endsWith(`/${p}`)));
}
var DEFAULT_BRANCH_CMD = gitCommandPattern("remote|symbolic-ref|branch");
function defaultBranchFromTrace(steps) {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const ev = steps[i];
    if (!succeeded2(ev) || !DEFAULT_BRANCH_CMD.test(commandOf(ev))) continue;
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
    if (succeeded2(steps[i]) && isPush(steps[i])) pushedAt = i;
  }
  if (pushedAt < 0) return false;
  const touched = opts?.touchedFiles ?? [];
  for (let i = pushedAt; i < steps.length; i += 1) {
    const ev = steps[i];
    if (!succeeded2(ev)) continue;
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
  stallRecoveryNudge,
  stallShape,
  shouldRecoverStalledTurn,
  isExhaustedStall,
  modelFailoverNotice,
  stallExhaustedNotice,
  stallRecoveryToolChoice,
  nextFallbackModel,
  MAX_MODEL_FAILOVERS,
  chooseStallFailover,
  isModelRole,
  editedFilesOf,
  editedPathsOf,
  bracketDelta,
  changesBalance,
  describeBracketDelta,
  normalizeToolName,
  resolveToolAlias,
  toolCallPaths,
  toolSideEffect,
  classifyTool,
  isMutatingTool,
  CONTROL_TOOL_NAMES,
  renderPolicyDirectives,
  evaluatePolicyGate,
  stableStringify,
  policyGateCallKey,
  isNotARepo,
  buildCoreToolRegistry,
  limbicTraits,
  RunKnowledgeRecorder,
  SKILL_TOOLS,
  VERIFY_DELEGATION_STEP,
  VERIFY_STEP,
  RESOLVE_OPEN_ISSUES,
  isChildReportText,
  SUBAGENT_TOOLS,
  judgeWith,
  lexicalStems,
  LEXICAL_WEIGHTS,
  rankLexically,
  searchToolSchemas,
  TOOL_SEARCH_TOOL,
  TOOL_SEARCH_SCHEMA,
  isCostLeverOn,
  REVISIT_NUDGE_AT,
  REVISIT_HARD_AT,
  revisitAdvisory,
  withAdvisory,
  canonicalReadArgs,
  ReadCoverage,
  parseShellFileRead,
  isReadOnlyShellCall,
  shellPrintAsRead,
  recordShellFileRead,
  FAILURE_NUDGE_AT,
  FAILURE_HARD_AT,
  FailureTally,
  failureReason,
  repeatedFailureAdvisory,
  WriteLedger,
  repeatedWriteNote,
  isTestPath,
  claimsReady,
  ProgressDetector,
  progressAdvice,
  progressPauseQuestion,
  progressTraceStep,
  PUBLISH_TOOLS,
  planInRunVerify,
  inRunVerifyOutcome,
  BACK_TO_BACK_AT,
  stopIntent,
  READS_BEFORE_DELEGATION_NUDGE,
  ReadsWithoutSpawn,
  normalizeEvidencePath,
  createEvidenceLedger,
  gitCommandPattern,
  DEFAULT_EVIDENCE_POLICY,
  outgoingGate,
  reviewGate,
  shellPublishHint,
  turnInterruption,
  isTruncatedTurn,
  isMalformedToolCall,
  SERVER_TICKET_CREATE_TOOL,
  SERVER_TICKET_LINK_TOOL,
  LOCAL_TICKET_CREATE_TOOL,
  SERVER_TICKET_TOOLS,
  ticketToolVocabulary,
  isLocalTicketCreateLabel,
  ticketStatusMove,
  toolResultRecord,
  entityIdsOf,
  toolOutputCap,
  windowedCap,
  truncateMiddle,
  isReadFileResult,
  sliceReadFile,
  truncatedResultNote,
  shapeToolResult,
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
  isMutationTool,
  hasEditIntent,
  isCacheAnswered,
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
  routingByRole,
  isDispatchTool,
  staffingSummaryInTrace,
  formatDispatchRefusals,
  workFiledNotStaffedVerdict,
  formatStaffingSummary,
  MAX_TOOL_RESULT_CHARS,
  READ_FILE_RESULT_CHARS2 as READ_FILE_RESULT_CHARS,
  trimToolResult,
  requestedReadWindow2 as requestedReadWindow,
  toolExposureInTrace,
  formatAdvertised,
  isFailedToolResult,
  UNBACKED_WRITE_CLAIM_NOTICE,
  UNBACKED_TICKET_CLAIM_NOTICE,
  isTicketWriteTool,
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
  formatBrainDiagnostics,
  buildBrainTriageReport,
  BASE_BRANCHES,
  parseGitShortStatus,
  commandOf,
  dirtyPathsOf,
  onBaseBranch,
  shippedToBaseBranch,
  utf8ByteLength2 as utf8ByteLength,
  toolCallArgBytes,
  createComposingActivity
};
//# sourceMappingURL=chunk-IGSJKCQH.mjs.map