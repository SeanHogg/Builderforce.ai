import type { CreationFlowNode } from './CreationNode';
import type { Edge } from '@xyflow/react';
import type { CreationNodeData } from './types';
import type { CreationTimelineMessage } from '@/lib/builderforceApi';

export type MergeItem = { key: string; source: CreationFlowNode; target: CreationFlowNode | null; choice: 'branch' | 'parent' };

export type MergeReview = { parentId: string; parentRevision: number; parentNodes: CreationFlowNode[]; parentEdges: Edge[]; items: MergeItem[] };

export type FramePreset = { id: string; name: string; data: CreationNodeData };

export type CanvasTimelineMessage = Pick<CreationTimelineMessage, 'clientMessageId' | 'messageRole' | 'body' | 'createdAt'> & { id?: number; metadata?: CreationTimelineMessage['metadata'] };

export type BrowserSpeechRecognition = { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void };

export type AccountGate = { title: string; description: string; action: string };
