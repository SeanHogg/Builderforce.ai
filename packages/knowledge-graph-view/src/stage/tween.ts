/**
 * The placement tween's clock (PRD 43 B1a rule 5): `t` from 0 to 1 over at most {@link TWEEN_MS}, eased; reduced motion
 * jumps straight to 1. Pure (the caller passes the time), so the stage's frame loop and a test drive it the same way.
 */

export const TWEEN_MS = 400;

/** The stage's ONE clock (ms): the tween, the rig, the label fade and decorative motion all read it. */
export const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const ease = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export class Tween {
    private start = 0;
    private duration = 0;
    private running = false;

    /** Starts a tween at `now` (ms); a duration of 0 (reduced motion) lands at once. */
    begin(now: number, duration: number = TWEEN_MS): void {
        this.start = now;
        this.duration = Math.max(0, duration);
        this.running = this.duration > 0;
    }

    get active(): boolean { return this.running; }

    /** `t` at `now`; ends the tween once it reaches 1. */
    at(now: number): number {
        if (!this.running) return 1;
        const x = Math.min(1, Math.max(0, (now - this.start) / this.duration));
        if (x >= 1) this.running = false;
        return ease(x);
    }

    /** Lands the tween where it is going (a new placement arriving mid-tween starts from the old target). */
    finish(): void { this.running = false; }
}
