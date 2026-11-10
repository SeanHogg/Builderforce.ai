/**
 * The stage's LIVE slot keys (PRD 43 B1a rules 1, 3): the MarkSet's keys plus every key a drill appended since, in slot
 * order — what picking, the a11y proxies and the cards must index by (a drilled symbol's slot is past
 * `MarkSet.keys.length`). Both renderers keep one; it survives an overflow rebuild and a context restore because it is
 * only ever reset by a NEW MarkSet. Listeners hear every change; the list object is replaced (never mutated), so a
 * consumer can compare by identity.
 */

export class LiveKeys {
    private list: readonly string[] = [];
    private readonly fns = new Set<() => void>();

    get(): readonly string[] { return this.list; }

    /** A new MarkSet: its keys, and nothing appended. */
    reset(keys: readonly string[]): void {
        if (keys === this.list) return;
        this.list = keys;
        this.fire();
    }

    /** A drill's run (`base` = the slot of its first key): keys past the current end are appended; known ones are kept. */
    append(run: { base: number; keys: readonly string[] }): void {
        const skip = Math.max(0, this.list.length - run.base);
        if (skip >= run.keys.length) return;
        this.list = [...this.list, ...run.keys.slice(skip)];
        this.fire();
    }

    on(fn: () => void): () => void { this.fns.add(fn); return () => { this.fns.delete(fn); }; }

    private fire(): void { for (const fn of this.fns) fn(); }
}
