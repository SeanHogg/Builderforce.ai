'use client';

import { useRolePreview } from '@/lib/RolePreviewContext';

/**
 * Blue banner shown at the top of the viewport when a Super Admin is
 * previewing the UI as a different role (frontend-only, no API calls).
 *
 * CSS contract: the bar is 32 px tall. AppShell adds `role-preview-active`
 * class to the shell div to offset content when both bars may be stacked.
 */
export default function RolePreviewBar() {
  const { previewRole, exitPreview } = useRolePreview();

  if (!previewRole) return null;

  return (
    <div className="role-preview-bar" role="banner" aria-label="Role preview active">
      <span className="role-preview-bar__icon" aria-hidden="true">👁</span>
      <span className="role-preview-bar__info">
        Previewing as role: <strong>{previewRole}</strong>
        &nbsp;— this is a frontend-only preview. No API calls are affected.
      </span>
      <button
        type="button"
        className="role-preview-bar__btn"
        onClick={exitPreview}
      >
        Exit Preview
      </button>
    </div>
  );
}
