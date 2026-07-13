'use client';

import { useState, useEffect } from 'react';
import { createCapability, type CreateCapabilityDTO } from '@/lib/capabilitiesApi';

interface AddCapabilityModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddCapabilityModal({ open, onClose, onSuccess }: AddCapabilityModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'security',
    status: 'draft',
    priority: '',
    tags: '' as string[],
  });

  const [errors, setErrors] = useState({
    title: '',
    status: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setFormData({
        title: '',
        description: '',
        category: 'security',
        status: 'draft',
        priority: '',
        tags: '',
      });
      setErrors({ title: '', status: '' });
      setApiError(null);
    }
  }, [open]);

  const handleChange = (field: keyof typeof formData, value: string | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setApiError(null);
    // Clear validation error when user starts typing
    if (field === 'title') setErrors(prev => ({ ...prev, title: '' }));
    if (field === 'status') setErrors(prev => ({ ...prev, status: '' }));
  };

  const handleTagsAdd = (tag: string) => {
    if (tag.trim() && !formData.tags.includes(tag.trim())) {
      setFormData((prev) => ({
        ...prev,
        tags: [...prev.tags, tag.trim()],
      }));
      setApiError(null);
    }
  };

  const handleTagsRemove = (tagToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((tag) => tag !== tagToRemove),
    }));
    setApiError(null);
  };

  // Simulate chip input change
  const handleTagInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
      e.preventDefault();
      handleTagsAdd(e.currentTarget.value.trim());
      e.currentTarget.value = '';
    }
  };

  const handleTitleBlur = () => {
    if (!formData.title.trim()) {
      setErrors((prev) => ({ ...prev, title: 'Title is required' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    // FR.4.1: Title validation
    const titleError = formData.title.trim() ? '' : 'Title is required';
    setErrors((prev) => ({ ...prev, title: titleError }));

    if (titleError) return;

    // Validate status is valid
    if (!formData.status || !VALID_STATUSES.includes(formData.status as any)) {
      setErrors((prev) => ({ ...prev, status: 'Invalid status value' }));
      return;
    }

    if (formData.status) setErrors((prev) => ({ ...prev, status: '' }));

    setSubmitting(true);
    setApiError(null);

    try {
      const createDTO: CreateCapabilityDTO = {
        title: formData.title.trim(),
        description: formData.description.trim() || undefined,
        category: formData.category || undefined,
        status: formData.status,
        priority: formData.priority.trim() || undefined,
        tags: formData.tags.length > 0 ? formData.tags : undefined,
        tenantId: '0', // TODO: Resolve from auth context
        created_by_user_id: 'system', // TODO: Resolve from auth context
      };

      await createCapability(createDTO);
      onSuccess();
      onClose();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to create capability. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`capability-modal-overlay ${open ? 'visible' : ''}`}>
      <div className="capability-modal">
        <style>{`
          .capability-modal-overlay {
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.2s ease, visibility 0.2s ease;
          }

          .capability-modal-overlay.visible {
            opacity: 1;
            visibility: visible;
          }

          .capability-modal {
            background-color: var(--bg-surface, #ffffff);
            border-radius: 12px;
            padding: 32px;
            max-width: 600px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
          }

          .capability-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
          }

          .capability-modal-title {
            margin: 0;
            font-size: 1.5rem;
            font-weight: 700;
          }

          .close-button {
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .close-button:hover {
            background-color: var(--bg-elevated, #f3f4f6);
            color: var(--text-primary);
          }

          .form-group {
            margin-bottom: 20px;
          }

          .form-label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            font-size: 0.875rem;
          }

          .form-label.required::after {
            content: ' *';
            color: #dc2626;
          }

          .form-input,
          .form-textarea,
          .form-select {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid var(--border-subtle, #d1d5db);
            border-radius: 6px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s;
            background-color: var(--bg-surface, #ffffff);
            color: var(--text-primary);
          }

          .form-input:focus,
          .form-textarea:focus,
          .form-select:focus {
            border-color: var(--primary, #0ea5e9);
            box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.2);
          }

          .form-textarea {
            min-height: 100px;
            resize: vertical;
          }

          .error-message {
            color: #dc2626;
            font-size: 0.875rem;
            margin-top: 6px;
          }

          .chip-container {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            padding: 10px;
            border: 1px solid var(--border-subtle, #d1d5db);
            border-radius: 6px;
            margin-top: 8px;
          }

          .chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            background-color: var(--bg-elevated, #e0f2fe);
            color: #0369a1;
            border-radius: 999px;
            font-size: 0.75rem;
            font-weight: 600;
          }

          .chip-remove {
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            border: none;
            background: none;
            color: #0369a1;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            font-size: 14px;
            transition: background-color 0.2s;
          }

          .chip-remove:hover {
            background-color: rgba(0, 0, 0, 0.1);
            color: #b91c1c;
          }

          .chip-input {
            border: none;
            padding: 0;
            min-width: 120px;
            flex: 1;
          }

          .chip-input:focus {
            outline: none;
            box-shadow: none;
          }

          .chip-input::placeholder {
            color: var(--text-muted);
          }

          .form-actions {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-top: 32px;
            padding-top: 24px;
            border-top: 1px solid var(--border-subtle, #e5e7eb);
          }

          .button {
            padding: 10px 24px;
            border-radius: 6px;
            font-weight: 600;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
          }

          .button-secondary {
            background-color: var(--bg-elevated, #f3f4f6);
            color: var(--text-primary);
          }

          .button-secondary:hover {
            background-color: #e5e7eb;
          }

          .button-primary {
            background-color: var(--primary, #0ea5e9);
            color: white;
          }

          .button-primary:hover:not(:disabled) {
            background-color: #0284c7;
          }

          .button-primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
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
            margin-top: 6px;
          }
        `}</style>

        {apiError && (
          <div className="api-error">
            <strong>Error:</strong> {apiError}
          </div>
        )}

        <div className="capability-modal-header">
          <h2 className="capability-modal-title">Add Capability</h2>
          <button
            className="close-button"
            onClick={onClose}
            type="button"
            aria-label="Close modal"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Title - Required */}
          <div className="form-group">
            <label htmlFor="title" className={`form-label required`}>
              Title
            </label>
            <input
              id="title"
              type="text"
              className="form-input"
              value={formData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Enter capability title"
              maxLength={200}
              required
            />
            {errors.title && <div className="error-message">{errors.title}</div>}
          </div>

          {/* Description */}
          <div className="form-group">
            <label htmlFor="description" className="form-label">
              Description
            </label>
            <textarea
              id="description"
              className="form-textarea"
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Enter a description for this capability"
              maxLength={2000}
            />
            <div className="helper-text">{formData.description.length}/2000 characters</div>
          </div>

          {/* Category - Dropdown */}
          <div className="form-group">
            <label htmlFor="category" className="form-label">
              Category
            </label>
            <select
              id="category"
              className="form-select"
              value={formData.category}
              onChange={(e) => handleChange('category', e.target.value)}
            >
              {VALID_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category.replace('_', ' ').toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Status - Dropdown */}
          <div className="form-group">
            <label htmlFor="status" className="form-label">
              Status
            </label>
            <select
              id="status"
              className="form-select"
              value={formData.status}
              onChange={(e) => handleChange('status', e.target.value)}
            >
              {VALID_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                </option>
              ))}
            </select>
            {errors.status && <div className="error-message">{errors.status}</div>}
          </div>

          {/* Priority */}
          <div className="form-group">
            <label htmlFor="priority" className="form-label">
              Priority
            </label>
            <input
              id="priority"
              type="text"
              className="form-input"
              value={formData.priority}
              onChange={(e) => handleChange('priority', e.target.value)}
              placeholder="e.g., High, Normal, Low"
              maxLength={50}
            />
            <div className="helper-text">Optional priority level</div>
          </div>

          {/* Tags - Chip input (initially as text input with Enter to add) */}
          <div className="form-group">
            <label className="form-label">
              Tags
            </label>
            <div className="chip-container">
              {formData.tags.map((tag) => (
                <span key={tag} className="chip">
                  {tag}
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => handleTagsRemove(tag)}
                    aria-label={`Remove ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                className="chip-input"
                placeholder="Add tag and press Enter..."
                onKeyPress={handleTagInput}
                disabled={submitting || formData.tags.length >= 10}
                maxLength={50}
              />
            </div>
            <div className="helper-text">Optional: Add up to 10 tags to categorize this capability</div>
          </div>

          {/* Actions */}
          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={submitting || !!errors.title || !!errors.status}
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const VALID_STATUSES = [
  'draft',
  'proposed',
  'in_progress',
  'completed',
  'deprecated',
  'retired',
] as const;

const VALID_CATEGORIES = [
  'security',
  'performance',
  'usability',
  'accessibility',
  'compliance',
  'scalability',
  'reliability',
  'scalable_score',
] as const;