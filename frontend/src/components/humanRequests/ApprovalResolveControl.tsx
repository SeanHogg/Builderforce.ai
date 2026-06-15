'use client';

import { useState } from 'react';
import { approvalsApi, type Approval, type ResolvedApproval } from '@/lib/builderforceApi';

/**
 * The canonical resolve UI for a human-in-the-loop request: approve/reject an
 * action, or answer a question/feedback with free text. Self-contained — it owns
 * its own busy/draft/error state and the decide() call — and decides its OWN
 * visibility: renders nothing for an already-resolved (non-pending) request.
 *
 * Drop it wherever an approval surfaces (the Workforce approvals queue, a task
 * drawer's run gate, an agent-host panel) so the approve action lives next to the
 * gate instead of only in a separate queue. `onResolved` fires with the updated
 * row, including `startedExecutionId` when approving a task.execution gate kicks
 * off a run — the caller can follow that execution.
 */

function isAnswerable(kind: Approval['kind']): boolean {
  return kind === 'question' || kind === 'feedback';
}

export interface ApprovalResolveControlProps {
  approval: Approval;
  /** Fired after a successful resolve, with the updated row. */
  onResolved?: (updated: ResolvedApproval) => void;
  /** Denser layout for embedding in a panel/drawer. */
  compact?: boolean;
}

export function ApprovalResolveControl({ approval, onResolved, compact = false }: ApprovalResolveControlProps) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Visibility is the component's own call — only a pending request is resolvable.
  if (approval.status !== 'pending') return null;

  const resolve = async (body: Parameters<typeof approvalsApi.decide>[1]) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await approvalsApi.decide(approval.id, body);
      onResolved?.(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update request');
    } finally {
      setBusy(false);
    }
  };

  const errorNode = error ? (
    <span style={{ fontSize: 12, color: 'var(--danger, #dc2626)' }}>{error}</span>
  ) : null;

  if (isAnswerable(approval.kind)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={approval.kind === 'feedback' ? 'Write feedback…' : 'Write an answer…'}
          rows={compact ? 2 : 3}
          className="admin-select"
          style={{ minWidth: 200, width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || !draft.trim()}
            onClick={() => void resolve({ status: 'answered', responseText: draft.trim() })}
          >
            {busy ? 'Sending…' : 'Send answer'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => void resolve({ status: 'rejected' })}
          >
            Dismiss
          </button>
          {errorNode}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <button type="button" className="btn-ghost" disabled={busy} onClick={() => void resolve({ status: 'approved' })}>
        {busy ? 'Approving…' : 'Approve'}
      </button>
      <button type="button" className="btn-ghost" disabled={busy} onClick={() => void resolve({ status: 'rejected' })}>
        Reject
      </button>
      {errorNode}
    </div>
  );
}
