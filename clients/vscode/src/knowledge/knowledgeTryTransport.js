/**
 * The Node transport of the sandbox Send: `node:http` / `node:https` `request()`, which has no proxy
 * and follows no redirect (a 3xx comes back as it is), with a DNS lookup that refuses an address
 * outside the target's mode at connect time. No `vscode` import: tested against a real local server.
 */
import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import { guardedLookup } from "./knowledgeTryRequest";
export function nodeOpen(req, signal) {
    return new Promise((resolve, reject) => {
        const lib = req.url.protocol === "https:" ? https : http;
        const headers = { ...req.headers, ...(req.body !== undefined ? { "content-length": String(Buffer.byteLength(req.body)) } : {}) };
        const request = lib.request(req.url, {
            method: req.method, headers, agent: false, signal,
            lookup: guardedLookup(dns.lookup, req.mode),
        }, (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res, destroy: () => { res.destroy(); request.destroy(); } }));
        request.on("error", reject);
        if (req.body !== undefined)
            request.write(req.body);
        request.end();
    });
}
//# sourceMappingURL=knowledgeTryTransport.js.map