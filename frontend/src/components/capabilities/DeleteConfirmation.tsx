'use client';

import { useState, useEffect } from 'react';

interface DeleteConfirmationProps {
  open: boolean;
  entityName: string;
  onConfirm: () => void;
  onCancel: () => void;
  error?: string | null;
}

export default function DeleteConfirmation({
  open,
  entityName,
  onConfirm,
  onCancel,
  error,
}: DeleteConfirmationProps) {
  // Reset error state when modal opens
  const [internalError, setInternalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setInternalError(error || null);
    }
  }, [open, error]);

  if (!open) return null;

  return (
    <div className="delete-confirmation-overlay">
      <div className="delete-confirmation-dialog">
        <style>{`
          .delete-confirmation-overlay {
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 1200;
            animation: fadeIn 0.2s ease-in-out;
          }

          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }

          .delete-confirmation-dialog {
            background-color: var(--bg-surface, #ffffff);
            border-radius: 12px;
            padding: 32px;
            max-width: 480px;
            width: 90%;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
            animation: slideUp 0.2s ease-out;
          }

          @keyframes slideUp {
            from {
              transform: translateY(20px);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }

          .delete-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
          }

          .delete-icon {
            width: 48px;
            height: 48px;
            background-color: #fef2f2;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #dc2626;
          }

          .delete-title {
            margin: 0;
            font-size: 1.25rem;
            font-weight: 700;
            color: #111827;
          }

          .delete-body {
            margin-bottom: 24px;
            color: var(--text-primary, #374151);
            line-height: 1.6;
          }

          .item-name {
            font-weight: 600;
            color: #111827;
          }

          .confirmation-actions {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            padding-top: 16px;
            border-top: 1px solid var(--border-subtle, #e5e7eb);
          }

          .button {
            padding: 10px 20px;
            border-radius: 6px;
            font-weight: 600;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            min-width: 100px;
          }

          .button-secondary {
            background-color: var(--bg-elevated, #f3f4f6);
            color: var(--text-primary, #374151);
          }

          .button-secondary:hover {
            background-color: #e5e7eb;
          }

          .button-danger {
            background-color: #dc2626;
            color: white;
          }

          .button-danger:hover {
            background-color: #b91c1c;
          }

          .api-error {
            background-color: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 20px;
            color: #991b1b;
            font-size: 0.875rem;
          }

          .helper-text {
            font-size: 0.75rem;
            color: var(--text-muted, #6b7280);
            margin-top: 8px;
          }
        `}</style>

        {internalError && (
          <div className="api-error">
            <strong>Error:</strong> {internalError}
          </div>
        )}

        <div className="delete-header">
          <div className="delete-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.477 2 12c0 5.523 4.477 10 10 10s10-4.477 10-10c0-5.523-4.477-10-10-10zM8.5 7a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6.5 1.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM12 18a5.5 5.5 0 01-5.5-5.5c0-.436.056-.857.16-1.257.185-.708.548-1.328 1.043-1.823.495-.495 1.115-.858 1.823-1.043.4-.104.821-.16 1.257-.16s.857.056 1.257.16c.708.185 1.328.548 1.823 1.043.495.495.858 1.115 1.043 1.823.104.4.16.821.16 1.257A5.5 5.5 0 0112 18z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h2 className="delete-title">Delete Capability</h2>
        </div>

        <p className="delete-body">
          Are you sure you want to delete the capability <span className="item-name">"{entityName}"</span>?
        </p>
        <p className="helper-text">
          This action cannot be undone. All data associated with this capability will be permanently removed.
        </p>

        <div className="confirmation-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button-danger"
            onClick={onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}