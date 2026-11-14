import { authedRaw } from "./bfApi";
export function gatewayRequest(secrets) {
    return async (path, init) => {
        const res = await authedRaw(secrets, path, {
            method: init?.method ?? "GET",
            ...(init?.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
        });
        return { status: res.status, body: res.body };
    };
}
//# sourceMappingURL=gatewayRequest.js.map