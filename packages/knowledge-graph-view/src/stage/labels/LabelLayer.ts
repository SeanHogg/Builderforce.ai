/**
 * The SDF label pass (PRD 43 B3, Labels): the placement's slot-relative `LabelRun`s drawn as JetBrains Mono through ONE
 * batched text object (troika `BatchedText` in WebGL: one draw call), each name with its halo and optional note line.
 *
 * Rule 5: the labels fade out when a tween begins, stay hidden while it runs, and are placed at the TARGET placement
 * when it lands, then fade in (`fade.ts`). A run whose glyphs the SDF font cannot draw — or every run, when the host
 * has no mono font — is handed back as a DOM caption instead (`runs.ts`).
 *
 * Text objects are cached by run (slot + text) and reused, so a camera switch back to a placement re-adds already
 * typeset names with no worker trip; a theme flip rewrites only colours. Framework-free; the text objects come through
 * {@link TextPort}, so tests drive the layer with a fake and the renderer with troika.
 */

import type { Object3D } from 'three';
import type { ThemeColors } from '../../scene/themeColors';
import type { MonoWeight, StageFontPort } from '../fonts';
import { TONE_ORDER } from '../tones';
import type { Caption, LabelRun, Placement } from '../types';
import { LabelFade } from './fade';
import { placeLabels, type LabelView, type PlacedLabel } from './runs';

/** The text object the layer drives (troika `Text`'s fields it uses). */
export interface LabelText {
    text: string;
    font: string | null;
    fontSize: number;
    anchorX: number | string;
    color: number | string | null;
    outlineWidth: number | string;
    outlineColor: number | string;
    fillOpacity: number;
    outlineOpacity: number;
    position: { set(x: number, y: number, z: number): unknown };
    dispose(): void;
}

export interface TextPort {
    /** The ONE batched object to mount (null: nothing draws, e.g. a test). */
    object: Object3D | null;
    create(): LabelText;
    add(t: LabelText): void;
    remove(t: LabelText): void;
    dispose(): void;
}

/** Typeset names kept for reuse (a camera's labels survive a switch away and back). */
const CACHE_MAX = 2000;

export class LabelLayer {
    readonly fade = new LabelFade();
    private runs: readonly LabelRun[] = [];
    private placement: Pick<Placement, 'position' | 'scale' | 'extrude'> | null = null;
    private readonly cache = new Map<string, LabelText>();
    private readonly active = new Map<string, { text: LabelText; tone: number; halo: number }>();
    private colors: ThemeColors | null = null;
    private dom: Caption[] = [];
    private opacityNow = 1;
    /** Placements made (a test reads it: labels are placed after the tween, never during). */
    placements = 0;

    constructor(private readonly port: TextPort, private readonly fonts: StageFontPort) {}

    get object(): Object3D | null { return this.port.object; }
    /** Runs routed to the DOM caption layer by the last placement. */
    get domCaptions(): readonly Caption[] { return this.dom; }
    get shown(): readonly string[] { return [...this.active.keys()]; }
    get opacity(): number { return this.opacityNow; }

    /** A new placement's runs. With `tweening`, they wait for {@link landed}; otherwise they are placed now. */
    setPlacement(p: Pick<Placement, 'position' | 'scale' | 'extrude' | 'labels'>, now: number, tweening: boolean): void {
        this.runs = p.labels;
        this.placement = p;
        if (tweening) this.fade.tweenBegan(now);
        else this.fade.landed(now, false);
    }

    landed(now: number): void { this.fade.landed(now); }

    /** Advances the fade; places the labels when one is due. Returns true while the fade needs frames (`fade.animating`). */
    tick(now: number, view: LabelView): boolean {
        if (this.fade.takePlacement()) this.place(view);
        this.setOpacity(this.fade.opacity(now));
        return this.fade.animating;
    }

    /** Re-place for a settled view (a `screen` run's size, the LOD, the depth) — never mid-tween. */
    place(view: LabelView): void {
        if (!this.placement || this.fade.state === 'out' || this.fade.state === 'hidden') return;
        const sdfAvailable = this.fonts.monoUrl(500) !== null;
        const placed = placeLabels(this.runs, this.placement, view, sdfAvailable);
        this.dom = placed.dom;
        this.placements++;
        const next = new Set<string>();
        for (const l of placed.sdf) {
            this.show(l.id, l, l.text, l.position, l.fontSize, l.tone, next);
            if (l.note) this.show(`${l.id}#note`, l, l.note.text, l.note.position, l.note.fontSize, l.note.tone, next);
        }
        for (const [id, a] of this.active) if (!next.has(id)) { this.port.remove(a.text); this.active.delete(id); }
        this.trimCache();
    }

    setPalette(colors: ThemeColors): void {
        this.colors = colors;
        for (const a of this.active.values()) this.colour(a.text, a.tone, a.halo);
    }

    private show(id: string, l: PlacedLabel, text: string, at: readonly [number, number, number], size: number, tone: number, into: Set<string>): void {
        let t = this.cache.get(id);
        if (!t) { t = this.port.create(); this.cache.set(id, t); }
        else { this.cache.delete(id); this.cache.set(id, t); } // most recently used last
        t.text = text;
        t.font = this.fonts.monoUrl(l.weight as MonoWeight);
        t.fontSize = size;
        t.anchorX = l.anchorX;
        t.outlineWidth = l.outlineWidth;
        t.position.set(at[0], at[1], at[2]);
        this.colour(t, tone, l.haloTone);
        t.fillOpacity = this.opacityNow;
        t.outlineOpacity = this.opacityNow;
        if (!this.active.has(id)) this.port.add(t);
        this.active.set(id, { text: t, tone, halo: l.haloTone });
        into.add(id);
    }

    private colour(t: LabelText, tone: number, halo: number): void {
        const c = this.colors;
        t.color = c ? c[TONE_ORDER[tone] ?? 'text'] : null;
        t.outlineColor = c ? c[TONE_ORDER[halo] ?? 'bg'] : 0;
    }

    private setOpacity(o: number): void {
        if (o === this.opacityNow) return;
        this.opacityNow = o;
        for (const a of this.active.values()) { a.text.fillOpacity = o; a.text.outlineOpacity = o; }
    }

    private trimCache(): void {
        for (const [id, t] of this.cache) {
            if (this.cache.size <= CACHE_MAX) break;
            if (this.active.has(id)) continue;
            t.dispose();
            this.cache.delete(id);
        }
    }

    dispose(): void {
        for (const a of this.active.values()) this.port.remove(a.text);
        for (const t of this.cache.values()) t.dispose();
        this.active.clear();
        this.cache.clear();
        this.port.dispose();
    }
}
