/** A field off an untyped JSON body, or undefined. */
export function field(body, key) {
    return body && typeof body === 'object' && !Array.isArray(body) ? body[key] : undefined;
}
export function stringField(body, key) {
    const value = field(body, key);
    return typeof value === 'string' ? value : '';
}
/** The gateway's error sentence (`{error:"…"}` or `{error:{message}}`), for a failure detail. */
export function errorDetail(body, status) {
    const error = field(body, 'error');
    if (typeof error === 'string' && error)
        return error;
    const nested = error && typeof error === 'object' ? error.message : undefined;
    return typeof nested === 'string' && nested ? nested : `HTTP ${status}`;
}
//# sourceMappingURL=port.js.map