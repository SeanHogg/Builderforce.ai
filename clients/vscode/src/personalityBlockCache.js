export function createPersonalityBlockCache() {
    let cached;
    return {
        async get(persona, fetchValue) {
            const key = JSON.stringify(persona ?? {});
            if (cached && cached.key === key)
                return cached.value;
            const value = await fetchValue();
            if (value === null)
                return null;
            cached = { key, value };
            return value;
        },
        clear() {
            cached = undefined;
        },
    };
}
//# sourceMappingURL=personalityBlockCache.js.map