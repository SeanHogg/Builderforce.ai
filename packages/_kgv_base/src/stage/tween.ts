/**
 * The placement tween's clock (PRD 43 B1a rule 5): `t` from 0 to 1 over at most {@link TWEEN_MS}, eased; reduced motion
 * jumps straight to 1. Pure (the caller passes the time), so the stage's frame loop and a test drive it the same way.
 */

export const TWEEN_MS = 760;
/** Each mark starts this much after the one before it (by index), up to {@link STAGGER_STEPS} steps; the placement tween spans the lot. */
export const STAGGER_MS = 45;
export const STAGGER_STEPS = 12;
/** The whole placement tween for a per-mark duration `ms`: one mark's run plus the stagger (0 stays 0: reduced motion jumps). */
export const spanOf = (ms: number): number => (ms > 0 ? ms + STAGGER_STEPS * STAGGER_MS : 0);

/** A staggered tween's clock: its linear progress over the span, the span and one mark's run (ms). */
export interface StaggerClock { lin: number; span: number; dur: number }

/**
 * The eased progress of the mark at instance `index` — the mark shader's per-instance clock, on the CPU, so a placement
 * replacing a running tween bakes each mark where it IS (not where the unstaggered tween would put it).
 */
export function staggerAt(c: StaggerClock, index: number): number {
    if (c.lin >= 1) return 1;
    const x = Math.min(1, Math.max(0, (c.lin * c.span - Math.min(index, STAGGER_STEPS) * STAGGER_MS) / Math.max(c.dur, 1)));
    return ease(x);
}

/** The stage's ONE clock (ms): the tween, the rig, the label fade and decorative motion all read it. */
export const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const ease = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export class Tween {
    private start = 0;
    private duration = 0;
    private running = false;
    private x = 1;

    /** Starts a tween at `now` (ms); a duration of 0 (reduced motion) lands at once. */
    begin(now: number, duration: number = TWEEN_MS): void {
        this.start = now;
        this.duration = Math.max(0, duration);
        this.running = this.duration > 0;
        this.x = this.running ? 0 : 1;
    }

    get active(): boolean { return this.running; }

    /** `t` at `now`; ends the tween once it reaches 1. */
    at(now: number): number {
        if (!this.running) return 1;
        const x = Math.min(1, Math.max(0, (now - this.start) / this.duration));
        this.x = x;
        if (x >= 1) this.running = false;
        return ease(x);
    }

    /** The LINEAR progress (0..1) of the last {@link at}: the stagger reads it, easing each mark on its own clock. */
    get linear(): number { return this.x; }

    /** Lands the tween where it is going (a new placement arriving mid-tween starts from the old target). */
    finish(): void { this.running = false; this.x = 1; }
}
