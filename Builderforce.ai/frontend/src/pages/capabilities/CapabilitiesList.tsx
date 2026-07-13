'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listCapabilities,
  deleteCapability,
  updateCapability,
  type Capability,
} from '@/lib/capabilitiesApi';
import AddCapabilityModal from '@/components/capabilities/AddCapabilityModal';
import DeleteConfirmation from '@/components/capabilities/DeleteConfirmation';

const VALID_STATUSES = [
  'draft',
  'proposed',
  'in_progress',
  'completed',
  'deprecated',
  'retired',
] as const;

/**
 * CapabilitiesList — main page for managing capabilities.
 *
 * Provides:
 * - Table view with inline title/status editing
 * - Add Capability modal
 * - Delete confirmation dialog
 * - Operation-specific success/error feedback (AC-7, AC-8)
 */
export default function CapabilitiesList() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add modal state
  const [addModalOpen, setAddModalOpen] = useState(false);

  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [capabilityToDelete, setCapabilityToDelete] = useState<Capability | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'title' | 'status' | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // Operation feedback (AC-8)
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show success message briefly
  const showSuccess = useCallback((message: string) => {
    setSuccessMessage(message);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setSuccessMessage(null), 4000);
  }, []);

  // Clear operation feedback
  const clearFeedback = useCallback(() => {
    setOperationError(null);
    setSuccessMessage(null);
  }, []);

  // Load capabilities
  const loadCapabilities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listCapabilities();
      setCapabilities(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load capabilities');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCapabilities();
  }, [loadCapabilities]);

  // Add Capability
  const handleOpenAddModal = () => {
    clearFeedback();
    setAddModalOpen(true);
  };

  const handleCloseAddModal = () => {
    setAddModalOpen(false);
  };

  const handleAddSuccess = () => {
    showSuccess('Capability added successfully');
    loadCapabilities();
  };

  // Delete Capability
  const openDeleteDialog = (capability: Capability) => {
    clearFeedback();
    setCapabilityToDelete(capability);
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setCapabilityToDelete(null);
  };

  const confirmDelete = async () => {
    if (!capabilityToDelete) return;

    setDeleteLoading(true);
    clearFeedback();
    try {
      await deleteCapability(capabilityToDelete.id);
      setCapabilities((prev) => prev.filter((c) => c.id !== capabilityToDelete.id));
      showSuccess('Capability deleted successfully');
      closeDeleteDialog();
    } catch (err) {
      setOperationError(
        err instanceof Error ? err.message : 'Failed to delete capability'
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  // Inline edit (FR.2.1, FR.2.2)
  const startInlineEdit = (id: string, field: 'title' | 'status', currentValue: string) => {
    clearFeedback();
    setEditingId(id);
    setEditingField(field);
    setEditValue(field === 'status' ? currentValue.toLowerCase() : currentValue);
  };

  const handleInlineChange = (newVal: string) => {
    setEditValue(newVal);
  };

  const handleInlineSave = async () => {
    if (!editingId || !editingField) return;

    const trimmedValue = editValue.trim();
    if (!trimmedValue && editingField === 'title') {
      setOperationError('Title cannot be empty');
      return;
    }

    // FR.4.2: Validate status values before submitting
    if (editingField === 'status') {
      const normalizedStatus = trimmedValue.toLowerCase();
      if (!VALID_STATUSES.includes(normalizedStatus as any)) {
        setOperationError(
          `Invalid status value: "${trimmedValue}". Valid values: ${VALID_STATUSES.map((s) =>
            s.replace('_', ' ')
          ).join(', ')}`
        );
        return;
      }
    }

    try {
      const updatePayload: Record<string, string> = {};
      if (editingField === 'title') {
        updatePayload.title = trimmedValue;
      } else {
        updatePayload.status = trimmedValue.toLowerCase();
      }

      await updateCapability(editingId, updatePayload);

      // Update local state immediately for responsive UX (AC-8)
      setCapabilities((prev) =>
        prev.map((c) =>
          c.id === editingId ? { ...c, [editingField]: trimmedValue ] } : c
        )
      );
      setEditingId(null);
      setEditingField(null);
      setEditValue('');
      showSuccess(
        editingField === 'title'
          ? 'Title updated successfully'
          : 'Status updated successfully'
      );
    } catch (err) {
      setOperationError(
        err instanceof Error ? err.message : 'Failed to update capability'
      );
    }
  };

  const handleInlineKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleInlineSave();
    }
    if (e.key === 'Escape') {
      cancelInlineEdit();
    }
  };

  const cancelInlineEdit = () => {
    setEditingId(null);
    setEditingField(null);
    setEditValue('');
    setOperationError(null);
  };

  // Stats
  const statusCounts = capabilities.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="capability-list-container">
      <style>{`
        .capability-list-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 24px;
          color: var(--text-primary);
        }
        .capability-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        .capability-title {
          margin: 0;
          font-size: 1.5rem;
          font-weight: 700;
        }
        .add-button {
          background-color: var(--primary, #0ea5e9);
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .add-button:hover {
          background-color: #0284c7;
        }
        .error-box {
          background-color: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 20px;
          color: #991b1b;
        }
        .success-box {
          background-color: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 8px;
          padding: 12px 16px;
          margin-bottom: 20px;
          color: #15803d;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.875rem;
          font-weight: 500;
        }
        .stats-bar {
          display: flex;
          align-items: center;
          gap: 20px;
          margin-bottom: 20px;
          font-size: 0.875rem;
          color: var(--text-muted);
          flex-wrap: wrap;
        }
        .stat {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .stat-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background-color: currentColor;
        }
        .table-container {
          overflow-x: auto;
          border: 1px solid var(--border-subtle, #e5e7eb);
          border-radius: 8px;
          background-color: var(--bg-surface, #ffffff);
        }
        table {
          width: 100%;
          border-collapse: collapse;
          min-width: 800px;
        }
        th, td {
          padding: 12px 16px;
          text-align: left;
          border-bottom: 1px solid var(--border-subtle, #e5e7eb);
        }
        th {
          background-color: var(--bg-elevated, #f9fafb);
          font-weight: 600;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
        }
        tr:last-child td {
          border-bottom: none;
        }
        tr:hover {
          background-color: var(--bg-elevated, #f9fafb);
        }
        .inline-edit-input {
          width: 100%;
          padding: 8px 12px;
          border: 2px solid var(--primary, #0ea5e9);
          border-radius: 6px;
          font-size: 14px;
          outline: none;
          background-color: var(--bg-surface, #ffffff);
          color: var(--text-primary);
        }
        .inline-edit-input:focus {
          box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.2);
        }
        .tag-chip {
          display: inline-block;
          padding: 4px 10px;
          background-color: var(--bg-elevated, #f3f4f6);
          border-radius: 999px;
          font-size: 0.75rem;
          margin-right: 6px;
          margin-bottom: 4px;
        }
        .status-badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .status-draft { background-color: #f3f4f6; color: #4b5563; }
        .status-proposed { background-color: #fef3c7; color: #92400e; }
        .status-in_progress { background-color: #dbeafe; color: #1e40af; }
        .status-completed { background-color: #dcfce7; color: #15803d; }
        .status-deprecated { background-color: #fee2e2; color: #b91c1c; }
        .status-retired { background-color: #f3f4f6; color: #6b7280; }

        .inline-edit-wrapper {
          position: relative;
        }
        .inline-edit-error {
          color: #dc2626;
          font-size: 0.75rem;
          margin-top: 4px;
        }
        .operation-feedback {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 16px;
        }

        .empty-state {
          text-align: center;
          padding: 48px 24px;
          color: var(--text-muted);
        }
        .empty-state-icon {
          font-size: 48px;
          margin-bottom: 16px;
          opacity: 0.5;
        }
        .loading-state {
          text-align: center;
          padding: 48px 24px;
          color: var(--text-muted);
        }
        .spinner {
          display: inline-block;
          width: 32px;
          height: 32px;
          border: 3px solid var(--border-subtle, #e5e7eb);
          border-top-color: var(--primary, #0ea5e9);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <header className="capability-header">
        <h1 className="capability-title">Capabilities</h1>
        <button
          className="add-button"
          onClick={handleOpenAddModal}
          data-testid="add-capability-button"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 5V15M5 10H15" />
          </svg>
          Add Capability
        </button>
      </header>

      {/* Operation feedback (AC-8, FR.5.4) */}
      {successMessage && (
        <div className="success-box" data-testid="success-message">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
              clipRule="evenodd"
            />
          </svg>
          {successMessage}
        </div>
      )}

      {operationError && (
        <div className="error-box" data-testid="operation-error">
          <strong>Error:</strong> {operationError}
        </div>
      )}

      {error && (
        <div className="error-box">
          <strong>Load Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
          <p style={{ marginTop: '12px' }}>Loading capabilities...</p>
        </div>
      ) : capabilities.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 8 }}>
            No capabilities yet
          </h2>
          <p style={{ marginBottom: '16px' }}>
            Get started by adding your first capability using the button above.
          </p>
        </div>
      ) : (
        <>
          <div className="stats-bar">
            <span>
              Total: <strong>{capabilities.length}</strong>
            </span>
            {VALID_STATUSES.map(
              (status) =>
                statusCounts[status] > 0 && (
                  <span key={status} className="stat">
                    <span
                      className="stat-dot"
                      style={{ color: getStatusColor(status) }}
                    />
                    <span>
                      {status.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}:{' '}
                      {statusCounts[status]}
                    </span>
                  </span>
                )
            )}
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '35%' }}>Title</th>
                  <th style={{ width: '20%' }}>Status</th>
                  <th style={{ width: '18%' }}>Category</th>
                  <th style={{ width: '12%' }}>Priority</th>
                  <th style={{ width: '15%' }}>Tags</th>
                  <th style={{ width: '100px' }}></th>
                </tr>
              </thead>
              <tbody>
                {capabilities.map((capability) => (
                  <tr key={capability.id}>
                    {/* Inline title editing (FR.2.2) */}
                    <td>
                      {editingId === capability.id && editingField === 'title' ? (
                        <div className="inline-edit-wrapper">
                          <input
                            type="text"
                            className="inline-edit-input"
                            value={editValue}
                            onChange={(e) => handleInlineChange(e.target.value)}
                            onBlur={() => void handleInlineSave()}
                            onKeyDown={handleInlineKeyDown}
                            autoFocus
                            maxLength={200}
                          />
                          {operationError && (
                            <div className="inline-edit-error">{operationError}</div>
                          )}
                        </div>
                      ) : (
                        <div
                          onClick={() =>
                            startInlineEdit(capability.id, 'title', capability.title)
                          }
                          style={{
                            cursor: 'pointer',
                            textDecoration: 'underline dotted',
                            color: 'var(--text-primary)',
                          }}
                          title="Click to edit title"
                        >
                          {capability.title}
                        </div>
                      )}
                    </td>

                    {/* Inline status editing (FR.2.1) */}
                    <td>
                      {editingId === capability.id && editingField === 'status' ? (
                        <div className="inline-edit-wrapper">
                          <input
                            type="text"
                            className="inline-edit-input"
                            value={editValue}
                            onChange={(e) => handleInlineChange(e.target.value)}
                            onBlur={() => void handleInlineSave()}
                            onKeyDown={handleInlineKeyDown}
                            list={`status-options-${capability.id}`}
                            autoComplete="off"
                            autoFocus
                          />
                          <datalist id={`status-options-${capability.id}`}>
                            {VALID_STATUSES.map((status) => (
                              <option key={status} value={status} />
                            ))}
                          </datalist>
                          {operationError && (
                            <div className="inline-edit-error">{operationError}</div>
                          )}
                        </div>
                      ) : (
                        <span
                          className={`status-badge status-${capability.status}`}
                          onClick={() =>
                            startInlineEdit(
                              capability.id,
                              'status',
                              capability.status
                            )
                          }
                          style={{
                            cursor: 'pointer',
                            textDecoration: 'underline dotted',
                            userSelect: 'none',
                          }}
                          title="Click to edit status"
                        >
                          {capability.status
                            .replace('_', ' ')
                            .replace(/\b\w/g, (l) => l.toUpperCase())}
                        </span>
                      )}
                    </td>

                    <td>
                      {capability.category || (
                        <em style={{ color: 'var(--text-muted)' }}>—</em>
                      )}
                    </td>
                    <td>
                      {capability.priority || (
                        <em style={{ color: 'var(--text-muted)' }}>—</em>
                      )}
                    </td>
                    <td>
                      {capability.tags && capability.tags.length > 0 ? (
                        <div>
                          {capability.tags.map((tag, idx) => (
                            <span key={idx} className="tag-chip">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <em style={{ color: 'var(--text-muted)' }}>—</em>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => openDeleteDialog(capability)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#dc2626',
                          cursor: 'pointer',
                          padding: '6px',
                          borderRadius: '4px',
                        }}
                        title="Delete capability"
                        data-testid={`delete-${capability.id}`}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Add Capability Modal */}
      <AddCapabilityModal
        open={addModalOpen}
        onClose={handleCloseAddModal}
        onSuccess={handleAddSuccess}
      />

      {/* Delete Confirmation Dialog (FR.3.2, FR.3.3) */}
      {capabilityToDelete && (
        <DeleteConfirmation
          open={deleteDialogOpen}
          entityName={capabilityToDelete.title}
          onConfirm={confirmDelete}
          onCancel={closeDeleteDialog}
          error={deleteLoading ? 'Deleting...' : null}
        />
      )}
    </div>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'draft':
      return '#4b5563';
    case 'proposed':
      return '#92400e';
    case 'in_progress':
      return '#1e40af';
    case 'completed':
      return '#15803d';
    case 'deprecated':
      return '#b91c1c';
    case 'retired':
      return '#6b7280';
    default:
      return '#9ca3af';
  }
}