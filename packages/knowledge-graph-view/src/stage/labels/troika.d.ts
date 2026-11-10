/**
 * The slice of `troika-three-text` (a declared peer; it ships no types) the stage's label pass uses: `Text` members
 * batched into ONE `BatchedText` draw call. Referenced by `labels/troika.ts` only.
 */
declare module 'troika-three-text' {
    import type { Mesh } from 'three';

    export class Text extends Mesh {
        text: string;
        font: string | null;
        fontSize: number;
        fontWeight: number | string;
        anchorX: number | string;
        anchorY: number | string;
        color: number | string | null;
        outlineWidth: number | string;
        outlineColor: number | string;
        fillOpacity: number;
        outlineOpacity: number;
        sdfGlyphSize: number | null;
        unicodeFontsURL: string | null;
        sync(callback?: () => void): void;
        dispose(): void;
    }

    export class BatchedText extends Text {
        addText(text: Text): void;
        removeText(text: Text): void;
    }

    export function configureTextBuilder(config: { sdfGlyphSize?: number; useWorker?: boolean; defaultFontURL?: string | null; unicodeFontsURL?: string | null }): void;
}
