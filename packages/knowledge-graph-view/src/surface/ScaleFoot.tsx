/**
 * The scale sentence (`ScaleLine`) under a DOM camera: the List, and the stage's no-WebGL fallback. A stage camera draws it itself, under its Colour-by legend
 * (StageHost `scale`); without this the compact view's "Showing the top 60 nodes." and its Show all button would have nowhere to be.
 */

import type { ReactNode } from 'react';
import { muted } from '../styles';

export function ScaleFoot({ children }: { children?: ReactNode }) {
    if (!children) return null;
    return <div style={{ ...muted, padding: '8px 12px' }}>{children}</div>;
}
