'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { usePermissionDebugger, type PermissionStatus } from '@/lib/PermissionDebuggerContext';
import { useEmulation } from '@/lib/EmulationContext';
import { useRolePreview } from '@/lib/RolePreviewContext';
import { useAuth } from '@/lib/AuthContext';
import { DEFAULT_ROLE_PERMISSIONS } from '@/lib/permissions';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PermissionGateProps {
  /** The permission key to check, e.g. "project:delete". */
  permission: string;
  /** Rendered when permission is denied. If omitted, nothing is shown. */
  fallback?: React.ReactNode;
  /** Associated API endpoint — shown in the debugger tooltip. */
  apiEndpoint?: string;
  /** If true, always render children but disable them when denied (soft-gate). */
  softGate?: boolean;
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * `PermissionGate` controls visibility of a UI element based on the current
 * user's (or emulated user's / role-preview's) effective permissions.
 *
 * When the Permission Debugger is active it renders colored border overlays:
 *   - Green  = granted
 *   - Red dashed = denied (shows ghost outline even for hidden elements)
 *   - Yellow = soft-gate (visible but disabled)
 *
 * Usage:
 *   <PermissionGate permission="project:delete" apiEndpoint="DELETE /api/projects/:id">
 *     <DeleteButton />
 *   </PermissionGate>
 */
export default function PermissionGate({
  permission,
  fallback = null,
  apiEndpoint,
  softGate = false,
  children,
}: PermissionGateProps) {
  const id = useId();
  const { debuggerActive, registerGate, unregisterGate } = usePermissionDebugger();
  const { emulation } = useEmulation();
  const { previewRole } = useRolePreview();
  const { user } = useAuth();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  // Determine the active role to evaluate permissions against
  const activeRole: string = (() => {
    if (emulation) return emulation.role;
    if (previewRole) return previewRole;
    // For normal users fall back to tenant role from auth
    // (AuthContext doesn't directly expose role, so we default to 'viewer' as safe floor)
    return (user as { tenantRole?: string } | null)?.tenantRole ?? 'viewer';
  })();

  // Check permission against the default matrix (overrides from DB not yet fetched client-side)
  const rolePerms: string[] = DEFAULT_ROLE_PERMISSIONS[activeRole] ?? [];
  const granted = rolePerms.includes(permission);
  const status: PermissionStatus = softGate && !granted ? 'soft-gate' : granted ? 'granted' : 'denied';

  // Register with debugger
  useEffect(() => {
    if (!debuggerActive) return;
    registerGate({ id, permission, status, apiEndpoint, grantedVia: granted ? activeRole : undefined });
    return () => unregisterGate(id);
  }, [debuggerActive, id, permission, status, granted, activeRole, apiEndpoint, registerGate, unregisterGate]);

  // ---------------------------------------------------------------------------
  // Debug overlay rendering
  // ---------------------------------------------------------------------------
  if (debuggerActive) {
    const borderStyle = status === 'granted'
      ? '2px solid #22c55e'   // green
      : status === 'soft-gate'
        ? '2px solid #eab308' // yellow
        : '2px dashed #ef4444'; // red dashed

    const content = status === 'denied' && !softGate
      ? (
        // Ghost outline for denied elements — shows where the element WOULD appear
        <div
          style={{ border: borderStyle, borderRadius: 4, minHeight: 24, minWidth: 48, background: 'rgba(239,68,68,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          data-permission={permission}
          data-permission-status="denied"
        >
          <span style={{ fontSize: 10, color: '#ef4444', fontFamily: 'monospace' }}>
            {permission} — DENIED
          </span>
        </div>
      )
      : (
        <div style={{ position: 'relative', display: 'inline-block' }}
          data-permission={permission}
          data-permission-status={status}
        >
          {children}
        </div>
      );

    return (
      <div
        ref={wrapperRef}
        style={{ position: 'relative', display: 'inline-block' }}
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
      >
        <div style={{ outline: borderStyle, outlineOffset: 2, borderRadius: 4, display: 'inline-block' }}>
          {content}
        </div>
        {tooltipVisible && (
          <div className="permission-gate-tooltip">
            <div><strong>Permission:</strong> {permission}</div>
            <div><strong>Status:</strong> {status.toUpperCase()}</div>
            <div><strong>Role:</strong> {activeRole}</div>
            {apiEndpoint && <div><strong>Endpoint:</strong> {apiEndpoint}</div>}
            {granted && <div><strong>Granted via:</strong> {activeRole} role</div>}
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Normal rendering (debugger off)
  // ---------------------------------------------------------------------------
  if (status === 'denied') return <>{fallback}</>;
  if (status === 'soft-gate') {
    return <div style={{ opacity: 0.5, pointerEvents: 'none', cursor: 'not-allowed' }}>{children}</div>;
  }
  return <>{children}</>;
}
