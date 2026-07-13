'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  listCapabilities,
  deleteCapability,
  updateCapability,
  type Capability,
} from '@/lib/capabilitiesApi';
import AddCapabilityModal from '@/components/capabilities/AddCapabilityModal';
import DeleteConfirmation from '@/components/capabilities/DeleteConfirmation';

/**
 * CapabilitiesList — main page for managing capabilities.
 *
 * Provides:
 * - Table view with inline title/status editing
 * - Add Capability modal
 * - Delete confirmation dialog
 * - Success/error feedback
 */
export default function CapabilitiesList() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [capabilityToDelete, setCapabilityToDelete] = useState<Capability | null>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saveError, setSaveError] = useState<string | null>(null);

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
  const handleAddSuccess = () => {
    loadCapabilities();
  };

  // Delete Capability conversation dialog
  const openDeleteDialog = (capability: Capability) => {
    setCapabilityToDelete(capability);
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setCapabilityToDelete(null);
  };

  const confirmDelete = async () => {
    if (!capabilityToDelete) return;

    try {
      await deleteCapability(capabilityToDelete.id);
      setCapabilities((prev) => prev.filter((c) => c.id !== capabilityToDelete.id));
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to delete capability');
    } finally {
      closeDeleteDialog();
    }
  };

  // Inline edit handlers
  const startInlineEdit = (id: string, fieldValue: string) => {
    setEditingId(id);
    setEditValue(fieldValue);
    setSaveError(null);
  };

  const handleInlineChange = (newVal: string) => {
    setEditValue(newVal);
    if (newVal.trim()) {
      setSaveError(null);
    }
  };

  const handleInlineSave = async () => {
    if (!editingId) return;

    const trimmedValue = editValue.trim();
    if (!trimmedValue) {
      setSaveError('Title cannot be empty');
      return;
    }

    try {
      await Promise.all([
        listCapabilities(), // Reload to verify no conflicts
        updateCapability(editingId, { title: trimmedValue }),
      ]);
      setCapabilities((prev) =>
        prev.map((c) =>
          c.id === editingId ? { ...c, title: trimmedValue } : c
        )
      );
      setEditingId(null);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update capability');
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditValue('');
    setSaveError(null);
  };

  const handleSaveUserConfirmation = () => {
    if (editingId) {
      void handleInlineSave();
    }
  };

  const handleCancelUserConfirmation = () => {
    handleCancelEdit();
  };

  // Statistic: Count by status
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

        .stats-bar {
          display: flex;
          align-items: center;
          gap: 20px;
          margin-bottom: 20px;
          font-size: 0.875rem;
          color: var(--text-muted);
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

        /* Inline edit styles */
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

        /* Tag chips */
        .tag-chip {
          display: inline-block;
          padding: 4px 10px;
          background-color: var(--bg-elevated, #f3f4f6);
          border-radius: 999px;
          font-size: 0.75rem;
          margin-right: 6px;
          margin-bottom: 4px;
        }

        /* Status badges */
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

        /* Empty state */
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

        /* Loading state */
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
        <button className="add-button" onClick={() => setDeleteDialogOpen(false)}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 5V15M5 10H15" />
          </svg>
          Add Capability
        </button>
      </header>

      {error && (
        <div className="error-box">
          <strong>Error:</strong> {error}
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
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 8 }}>No capabilities yet</h2>
          <p style={{ marginBottom: '16px' }}>
            Get started by adding your first capability using the button above.
          </p>
        </div>
      ) : (
        <>
          <div className="stats-bar">
            <span>Total: <strong>{capabilities.length}</strong></span>
            {VALID_STATUSES.map(status => (
              statusCounts[status] > 0 && (
                <span key={status} className="stat">
                  <span className="stat-dot" style={{ color: getStatusColor(status) }} />
                  <span>{status}: {statusCounts[status]}</span>
                </span>
              )
            ))}
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
                    {/* Inline title editing */}
                    <td>
                      {editingId === capability.id ? (
                        <input
                          type="text"
                          className="inline-edit-input"
                          value={editValue}
                          onChange={(e) => handleInlineChange(e.target.value)}
                          onBlur={handleSaveUserConfirmation}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleInlineSave();
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <div
                          onClick={() => startInlineEdit(capability.id, capability.title)}
                          style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                          title="Click to edit title"
                        >
                          {capability.title}
                        </div>
                      )}
                      {saveError && editingId === capability.id && (
                        <div style={{ color: '#dc2626', marginTop: '4px', fontSize: '0.8rem' }}>
                          {saveError}
                        </div>
                      )}
                    </td>
                    {/* Status badge with inline edit */}
                    <td>
                      {editingId === capability.id ? (
                        <input
                          type="text"
                          className="inline-edit-input"
                          value={editValue.toLowerCase()}
                          onChange={(e) => handleInlineChange(e.target.value)}
                          onBlur={handleSaveUserConfirmation}
                          list={`status-options-${capability.id}`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleInlineSave();
                            }
                          }}
                          autoComplete="off"
                          autoFocus
                        />
                      ) : (
                        <span
                          className={`status-badge status-${capability.status}`}
                          onClick={() => startInlineEdit(capability.id, capability.status)}
                          style={{ cursor: 'pointer', textDecoration: 'underline dotted', userSelect: 'none' }}
                          title="Click to edit status"
                        >
                          {capability.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                      )}
                      {editingId === capability.id && (
                        <datalist id={`status-options-${capability.id}`}>
                          {VALID_STATUSES.map(status => (
                            <option key={status} value={status.toLowerCase()} />
                          ))}
                        </datalist>
                      )}
                    </td>
                    <td>{capability.category || <em style={{ color: 'var(--text-muted)' }}>—</em>}</td>
                    <td>{capability.priority || <em style={{ color: 'var(--text-muted)' }}>—</em>}</td>
                    <td>
                      {capability.tags && capability.tags.length > 0 ? (
                        <div>
                          {capability.tags.map((tag, idx) => (
                            <span key={idx} className="tag-chip">{tag}</span>
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
                      >
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
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
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onSuccess={handleAddSuccess}
      />

      {/* Delete Confirmation Dialog */}
      {capabilityToDelete && (
        <DeleteConfirmation
          open={deleteDialogOpen}
          entityName={capabilityToDelete.title}
          onConfirm={confirmDelete}
          onCancel={closeDeleteDialog}
          error={saveError}
        />
      )}
    </div>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'draft': return '#4b5563';
    case 'proposed': return '#92400e';
    case 'in_progress': return '#1e40af';
    case 'completed': return '#15803d';
    case 'deprecated': return '#b91c1c';
    case 'retired': return '#6b7280';
    default: return '#9ca3af';
  }
}