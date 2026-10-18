import { useState } from 'react';
import type { CreationOutcomeMetrics, CreationSnapshotSummary } from '@/lib/builderforceApi';
import type { LocalCheckpointSummary } from '@/lib/creationCheckpoints';

/**
 * The session panels' own state — history, the conversation log, diagnostics and the
 * outcome metrics — each open flag beside the data its panel shows.
 *
 * History keeps a SECOND list for a board with no server (`creationCheckpoints.ts`) rather
 * than a mapped one: a server revision is a monotonic number the API restores by, and a
 * local checkpoint is an id in this browser. Coercing them into one shape would hand one of
 * the two restore paths an identifier that means nothing to it. The PANEL is one panel; the
 * stores are two, because they genuinely are. The checkpoint name is typed inline (see
 * `createCheckpoint` for why it is not a prompt).
 */
export function useCanvasSessionPanelsState() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CreationSnapshotSummary[]>([]);
  const [localCheckpoints, setLocalCheckpoints] = useState<LocalCheckpointSummary[]>([]);
  const [checkpointName, setCheckpointName] = useState('');
  const [conversationOpen, setConversationOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [outcomeMetricsOpen, setOutcomeMetricsOpen] = useState(false);
  const [outcomeMetrics, setOutcomeMetrics] = useState<CreationOutcomeMetrics | null>(null);
  const [outcomeMetricsLoading, setOutcomeMetricsLoading] = useState(false);
  const [outcomeMetricsError, setOutcomeMetricsError] = useState<string | null>(null);
  return {
    historyOpen, setHistoryOpen, history, setHistory, localCheckpoints, setLocalCheckpoints, checkpointName, setCheckpointName,
    conversationOpen, setConversationOpen, diagnosticsOpen, setDiagnosticsOpen,
    outcomeMetricsOpen, setOutcomeMetricsOpen, outcomeMetrics, setOutcomeMetrics, outcomeMetricsLoading, setOutcomeMetricsLoading, outcomeMetricsError, setOutcomeMetricsError,
  };
}
