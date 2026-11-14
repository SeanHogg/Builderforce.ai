import { createInMemoryLocalSyncQueue, createLocalDomainToolsWithRepository, } from "./localDomainTools";
/**
 * The dispatch line the host uses after install — the host's executor returns
 * exactly this. Pinned by the host-wiring cases in the suite.
 */
export const HOST_DOMAIN_TOOL_LINE = "return installLocalDomainTools(ctx).execute(request);";
const INSTALLED = new WeakMap();
function deviceIdOf(ports) {
    const fromConfig = ports.getConfig?.("builderforce.localDeviceId");
    const configured = typeof fromConfig === "string" ? fromConfig.trim() : "";
    if (configured)
        return configured;
    const held = ports.localDeviceId?.trim();
    if (held)
        return held;
    throw new Error("local_device_id_required");
}
function storeOf(ports) {
    if (!ports.localFirstStore)
        throw new Error("local_first_store_required");
    return ports.localFirstStore;
}
export function installLocalDomainTools(ctx, ports = {}) {
    const existing = INSTALLED.get(ctx);
    if (existing)
        return existing;
    const store = storeOf(ports);
    const deviceId = deviceIdOf(ports);
    const syncQueue = ports.syncQueue ?? createInMemoryLocalSyncQueue();
    const tools = createLocalDomainToolsWithRepository({
        store,
        deviceId,
        syncQueue,
        ...(ports.scope ? { scope: ports.scope } : {}),
        ...(ports.repository ? { repository: ports.repository } : {}),
    });
    const installed = {
        tools,
        syncQueue,
        execute(toolOrRequest, args) {
            if (typeof toolOrRequest === "string")
                return tools.execute(toolOrRequest, args ?? {});
            return tools.execute(toolOrRequest.tool, toolOrRequest.args ?? args ?? {});
        },
    };
    INSTALLED.set(ctx, installed);
    return installed;
}
//# sourceMappingURL=installLocalDomainTools.js.map