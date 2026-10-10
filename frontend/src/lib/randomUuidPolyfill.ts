/**
 * `crypto.randomUUID` for documents that are not a secure context.
 *
 * `randomUUID` is `[SecureContext]`: on a page served over plain HTTP it is simply
 * not there, while `crypto.getRandomValues` is. The frontend calls `randomUUID` in
 * some sixty places — ids for canvas objects, edges, correlation ids, idempotency
 * keys — so a visitor who reached `http://builderforce.ai/` crashed on the first
 * one (`RenderCrash: TypeError — crypto.randomUUID is not a function`, 69 events).
 * The middleware now upgrades to HTTPS (`lib/secureTransport.ts`), but a
 * prerendered page the Worker never sees can still be served once over HTTP, so
 * the platform guarantee is made HERE, once, rather than at sixty call sites.
 *
 * A raw inline `<head>` script in the ROOT layout, beside `EMBED_ERROR_REPORTER`,
 * so it runs before any bundle evaluates (the CSP allows inline scripts; see
 * `next.config.js`). It is a no-op wherever the native method exists. The value is
 * an RFC 4122 version-4 UUID from the same CSPRNG the native method uses.
 */
export const RANDOM_UUID_POLYFILL = `(function(){try{var c=typeof globalThis!=='undefined'?globalThis.crypto:window.crypto;if(!c||typeof c.randomUUID==='function'||typeof c.getRandomValues!=='function')return;var u=function(){var b=c.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var h='';for(var i=0;i<16;i++){h+=(b[i]+256).toString(16).slice(1);if(i===3||i===5||i===7||i===9)h+='-';}return h;};try{Object.defineProperty(c,'randomUUID',{value:u,configurable:true,writable:true});}catch(e){c.randomUUID=u;}}catch(e){}})();`;
