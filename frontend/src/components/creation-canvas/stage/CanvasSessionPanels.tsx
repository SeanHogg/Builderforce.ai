import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { CopyButton } from '@/components/CopyButton';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import { useCanvasSessionFacts } from '../chrome/canvasSessionContext';
import type { useCanvasDiagnostics } from '../hooks/useCanvasDiagnostics';
import styles from '../CreationCanvas.module.css';

type BuildDiagnostics = ReturnType<typeof useCanvasDiagnostics>['buildDiagnostics'];

const MESSAGE_STYLE: CSSProperties = { padding: '9px 10px', borderBottom: '1px solid var(--border-subtle)' };
const AUTHOR_STYLE: CSSProperties = { textTransform: 'capitalize' };
const BODY_STYLE: CSSProperties = { margin: '4px 0', whiteSpace: 'pre-wrap' };

export interface CanvasConversationPanelProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  timeline: readonly CanvasTimelineMessage[];
  buildDiagnostics: BuildDiagnostics;
}

/** The session's whole conversation as a plain record, beside the board. */
export function CanvasConversationPanel({ open, setOpen, timeline, buildDiagnostics }: CanvasConversationPanelProps) {
  const t = useTranslations('creationCanvas');
  const fmt = useFormat();
  if (!open) return null;
  return <aside className={styles.historyPanel} aria-label={t('sessionConversation')}><header><div><strong>{t('sessionConversation')}</strong><small>{t('sessionConversationHint')}</small></div><span className={styles.panelHeaderActions}><CopyButton compact label={t('copyDiagnostics')} ariaLabel={t('copyChatDiagnostics')} getText={buildDiagnostics} /><button onClick={() => setOpen(false)} aria-label={t('closeConversation')}>×</button></span></header><div>{timeline.length ? timeline.map((message) => <article key={message.clientMessageId} style={MESSAGE_STYLE}><strong style={AUTHOR_STYLE}>{message.metadata?.authoredBy?.name || (message.messageRole === 'assistant' ? 'Brain' : message.messageRole)}</strong><p style={BODY_STYLE}>{message.body}</p><small>{fmt.dateTime(message.createdAt)}</small></article>) : <p>{t('brainEmpty')}</p>}</div></aside>;
}

export interface CanvasDiagnosticsPanelProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  revision: number;
  realtimeState: string;
  objectCount: number;
  connectionCount: number;
  thinking: boolean;
  actionCount: number;
  scope: string;
  buildDiagnostics: BuildDiagnostics;
}

/** The session's own state in one card — what a support thread asks for first. */
export function CanvasDiagnosticsPanel({ open, setOpen, revision, realtimeState, objectCount, connectionCount, thinking, actionCount, scope, buildDiagnostics }: CanvasDiagnosticsPanelProps) {
  const t = useTranslations('creationCanvas');
  const { persistence, role } = useCanvasSessionFacts();
  if (!open) return null;
  return <aside className={`${styles.historyPanel} ${styles.diagnosticsPanel}`} aria-label={t('canvasDiagnostics')}><header><div><strong>{t('diagnostics')}</strong><small>{t('diagnosticsHint')}</small></div><button onClick={() => setOpen(false)} aria-label={t('closeDiagnostics')}>×</button></header><div className={styles.diagnosticsSummary}><dl><div><dt>{t('diagSession')}</dt><dd>{t('diagSessionValue', { persistence, revision })}</dd></div><div><dt>{t('diagRealtime')}</dt><dd>{realtimeState}</dd></div><div><dt>{t('diagCanvas')}</dt><dd>{t('diagCanvasValue', { objects: objectCount, connections: connectionCount })}</dd></div><div><dt>{t('brain')}</dt><dd>{t('diagBrainValue', { state: thinking ? t('diagResponding') : t('diagReady'), actions: actionCount })}</dd></div><div><dt>{t('diagScope')}</dt><dd>{scope}</dd></div><div><dt>{t('diagAccess')}</dt><dd>{role}</dd></div></dl><CopyButton label={t('copyDiagnostics')} ariaLabel={t('copyCanvasDiagnostics')} getText={buildDiagnostics} /></div></aside>;
}
