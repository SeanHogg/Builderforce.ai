/**
 * THE error boundary of the view's cameras: a camera that throws while it draws shows a localized line, the
 * error's message and one action, instead of unmounting everything up to the host's root (a VS Code webview
 * went wholly black, its Knowledge / Canvas / Changes tabs with it). The action is "Back" when the crash
 * happened inside a drilled level (it leaves the level, then draws again) and "Try again" otherwise.
 * The boundary resets by itself when `resetKey` changes (another camera, another root, another level).
 *
 * A class because `componentDidCatch` has no hook equivalent.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { Pill } from './ui/Pill';
import { TYPE } from './ui/type';

export interface SurfaceErrorBoundaryProps {
    children: ReactNode;
    labels: KnowledgeGraphLabels;
    /** A change draws the children again (the camera, the root or the drill level moved on). */
    resetKey: string;
    /** Present inside a drilled level: the action is "Back" and leaves the level before drawing again. */
    onBack?: (() => void) | undefined;
}

interface State { error: Error | null; key: string }

export class SurfaceErrorBoundary extends Component<SurfaceErrorBoundaryProps, State> {
    state: State = { error: null, key: this.props.resetKey };

    static getDerivedStateFromError(error: unknown): Partial<State> {
        return { error: error instanceof Error ? error : new Error(String(error)) };
    }

    static getDerivedStateFromProps(props: SurfaceErrorBoundaryProps, state: State): Partial<State> | null {
        return props.resetKey === state.key ? null : { error: null, key: props.resetKey };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error('knowledge-graph-view: a camera failed to draw', error, info.componentStack);
    }

    private readonly recover = (): void => {
        this.props.onBack?.();
        this.setState({ error: null });
    };

    render(): ReactNode {
        const { error } = this.state;
        if (!error) return this.props.children;
        const words = this.props.labels.surface.scene;
        return (
            <div
                role="alert" data-testid="kg-camera-error"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: 16, maxWidth: '100%', boxSizing: 'border-box', background: cssVar('bg'), color: cssVar('text') }}
            >
                <p style={{ ...TYPE.title, overflowWrap: 'anywhere' }}>{words.errorTitle}</p>
                <p style={{ margin: 0, ...TYPE.mono, color: cssVar('muted'), overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{error.message}</p>
                <Pill onClick={this.recover}>{this.props.onBack ? words.errorBack : words.errorRetry}</Pill>
            </div>
        );
    }
}
