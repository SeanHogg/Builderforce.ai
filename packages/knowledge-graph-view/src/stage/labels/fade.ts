/**
 * The labels' fade around a placement tween (PRD 43 B1a rule 5: labels fade during a tween and are placed after). A
 * label would be wrong mid-tween — its slot is moving — so when a tween begins the labels fade out from wherever they
 * are; while it runs they stay hidden; when it lands they are placed at the TARGET placement and fade back in. Reduced
 * motion (a 0 ms tween) re-places at once with no fade. Pure (the caller passes the time), so the frame loop and a test
 * drive it the same way.
 *
 *   shown ──tween──▶ out ──(faded)──▶ hidden ──land──▶ [place] in ──(faded)──▶ shown
 *                     └────────────── land ───────────────┘
 */

export const LABEL_FADE_MS = 120;

export type FadePhase = 'shown' | 'out' | 'hidden' | 'in';

export class LabelFade {
    private phase: FadePhase = 'shown';
    private from = 1;
    private start = 0;
    private placeDue = false;

    constructor(private readonly ms: number = LABEL_FADE_MS) {}

    get state(): FadePhase { return this.phase; }

    /** A tween begins: fade out from the current opacity. */
    tweenBegan(now: number): void {
        if (this.phase === 'hidden') return;
        this.from = this.opacity(now);
        this.start = now;
        this.phase = 'out';
    }

    /** The tween landed (or there was none): the caller places the labels now, then they fade in. */
    landed(now: number, animate = true): void {
        this.placeDue = true;
        if (!animate || this.ms <= 0) { this.phase = 'shown'; return; }
        this.from = 0;
        this.start = now;
        this.phase = 'in';
    }

    /** True once after `landed`: the labels must be re-placed at the target placement. */
    takePlacement(): boolean {
        const due = this.placeDue;
        this.placeDue = false;
        return due;
    }

    /** Label opacity at `now`, advancing the phase. */
    opacity(now: number): number {
        const k = this.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - this.start) / this.ms));
        switch (this.phase) {
            case 'shown': return 1;
            case 'hidden': return 0;
            case 'out': {
                const o = this.from * (1 - k);
                if (k >= 1) this.phase = 'hidden';
                return o;
            }
            case 'in': {
                if (k >= 1) this.phase = 'shown';
                return k;
            }
        }
    }

    /** True while the opacity is changing (the frame loop keeps drawing). */
    get animating(): boolean { return this.phase === 'out' || this.phase === 'in'; }
}
