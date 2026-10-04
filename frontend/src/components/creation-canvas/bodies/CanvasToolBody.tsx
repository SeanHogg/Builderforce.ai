import ToolRunner from '@/components/tools/ToolRunner';
import type { ToolResult } from '@/lib/tools';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';
import { asRecord } from './shared';

export function CanvasToolBody({ data }: CreationBodyProps) {
  const { edit } = useCreationNodeActions();
  const toolId = typeof data.toolId === 'string' ? data.toolId : '';
  const initialInput = asRecord(data.toolInput, {}) as Record<string, number>;
  const initialResult = data.toolResult && typeof data.toolResult === 'object' ? data.toolResult as ToolResult : null;
  if (!toolId) return null;

  return <ToolRunner
    toolId={toolId}
    surface="canvas"
    initialInput={initialInput}
    initialResult={initialResult}
    onInputChange={(input) => edit?.({ toolInput: input, toolResult: null })}
    onRunComplete={(input, result) => edit?.({
      toolInput: input,
      toolResult: result,
      result,
      status: result.scoreLabel || result.headline,
      qualityScore: result.score,
      qualityLabel: result.scoreLabel,
      qualityHeadline: result.headline,
      summary: result.summary,
      recommendations: result.recommendations,
      results: result.metrics.map((metric) => ({ title: metric.label, result: metric.value, detail: metric.hint })),
      gapCount: result.recommendations.length,
    })}
  />;
}
