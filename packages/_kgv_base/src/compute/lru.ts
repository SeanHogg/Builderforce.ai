/** A bounded keep-most-recently-used map, with removal by key prefix (a graph's derived values all start with its id). */
export class Lru<T> {
    private readonly entries = new Map<string, T>();

    constructor(private readonly max: number) {}

    /** The value under `key`, marking it most recently used. */
    get(key: string): T | undefined {
        if (!this.entries.has(key)) return undefined;
        const hit = this.entries.get(key) as T;
        this.entries.delete(key);
        this.entries.set(key, hit);
        return hit;
    }

    set(key: string, value: T): T {
        this.entries.delete(key);
        this.entries.set(key, value);
        while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
        return value;
    }

    dropPrefix(prefix: string): void {
        for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.entries.delete(key);
    }
}
