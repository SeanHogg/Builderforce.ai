/**
 * A virtual clock for the timers the VIEW sets (`setTimeout` with a delay, `setInterval`, `requestAnimationFrame`), so whether
 * one fires inside a measurement no longer depends on how fast the machine is. Without it, the stage bus's 120 ms settle (and
 * any other delayed timer) fired during a visit's settle rounds on a slow run and after them on a fast one: a +-1 commit that
 * flipped between two runs of the same profile, and between CI and a laptop.
 *
 * Zero-delay timeouts stay REAL: they are the macrotask boundary the loopback worker and the upload loader yield on, and they
 * carry no notion of time. Everything with a delay is queued against a virtual `now` and fires only when the probe calls
 * {@link VirtualTimers.fireNext}, which jumps the clock to the earliest due timer. The probe does that only once the page is
 * calm, and the clock then runs to the end of a fixed horizon per visit ({@link VirtualTimers.advanceTo}), so every visit spans
 * the same virtual time: a repeating timer (a 1 s "elapsed" ticker) fires a fixed number of times instead of forever, and a
 * timer due past the horizon fires in the same later visit whatever other timers exist. `Date.now` is left real: the 1 s tickers
 * that store it re-render on each (virtual) tick, which is deterministic, and no rendering decision measured here reads it.
 */

interface Pending { id: number; due: number; seq: number; fn: () => void; every: number | null }

type Handler = (...args: unknown[]) => void;

/** A virtual frame: what `requestAnimationFrame` waits for. */
const FRAME_MS = 16;
/**
 * Virtual ids start far above any id the real timer functions hand out, so `clear*` can tell the two apart. The counter is
 * module-wide, so an id kept past one clock's life can never clear another clock's timer.
 */
let nextId = 1_000_000_000;

export class VirtualTimers {
    /** The virtual clock, in ms since {@link install}. */
    now = 0;
    private readonly pending = new Map<number, Pending>();
    private seq = 0;
    private restore: (() => void) | null = null;

    install(): void {
        if (this.restore) return;
        const g = globalThis as unknown as Record<string, unknown>;
        const saved = {
            setTimeout: g.setTimeout, clearTimeout: g.clearTimeout, setInterval: g.setInterval, clearInterval: g.clearInterval,
            requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame,
        };
        const realSetTimeout = saved.setTimeout as (fn: Handler, ms?: number, ...args: unknown[]) => unknown;
        const realClearTimeout = saved.clearTimeout as (id: unknown) => void;
        const realClearInterval = saved.clearInterval as (id: unknown) => void;
        const clear = (real: (id: unknown) => void) => (id: unknown): void => {
            if (typeof id === 'number' && this.pending.delete(id)) return;
            real(id);
        };
        g.setTimeout = (fn: Handler, ms?: number, ...args: unknown[]): unknown => {
            const delay = Number(ms) || 0;
            if (delay <= 0) return realSetTimeout(fn, 0, ...args);
            return this.add(() => fn(...args), delay, null);
        };
        g.setInterval = (fn: Handler, ms?: number, ...args: unknown[]): unknown => this.add(() => fn(...args), Math.max(1, Number(ms) || 0), Math.max(1, Number(ms) || 0));
        g.clearTimeout = clear(realClearTimeout);
        g.clearInterval = clear(realClearInterval);
        g.requestAnimationFrame = (fn: (t: number) => void): number => this.add(() => fn(this.now), FRAME_MS, null);
        g.cancelAnimationFrame = (id: unknown): void => { if (typeof id === 'number') this.pending.delete(id); };
        this.restore = () => { Object.assign(g, saved); };
    }

    uninstall(): void {
        this.restore?.();
        this.restore = null;
        this.pending.clear();
    }

    /** When the earliest pending timer is due, or null when none is. */
    nextDue(): number | null {
        let at: number | null = null;
        for (const p of this.pending.values()) if (at === null || p.due < at) at = p.due;
        return at;
    }

    /**
     * Moves the clock to the earliest due timer and runs every timer due then, in the order they were set (a timer one of
     * them sets runs on a later call). Returns how many ran; 0 when nothing is pending or the next one is past `until`.
     */
    fireNext(until = Infinity): number {
        const at = this.nextDue();
        if (at === null || at > until) return 0;
        this.now = at;
        const due = [...this.pending.values()].filter((p) => p.due === at).sort((a, b) => a.seq - b.seq);
        // As in a browser, one callback that throws does not stop the others due at the same time; the first error is rethrown
        // once they have all run, so the probe still fails on it.
        let failed: { error: unknown } | null = null;
        for (const p of due) {
            if (!this.pending.has(p.id)) continue; // cleared by an earlier one
            if (p.every === null) this.pending.delete(p.id);
            else { p.due = at + p.every; p.seq = this.seq++; }
            try { p.fn(); } catch (error) { failed ??= { error }; }
        }
        if (failed) throw failed.error;
        return due.length;
    }

    /** Moves the clock forward to `at` (never back) without running anything: the end of a visit's horizon. */
    advanceTo(at: number): void {
        if (at > this.now) this.now = at;
    }

    private add(fn: () => void, delay: number, every: number | null): number {
        const id = nextId++;
        this.pending.set(id, { id, due: this.now + delay, seq: this.seq++, fn, every });
        return id;
    }
}
