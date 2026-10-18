/**
 * The platform-operator export sources (superadmin, cross-tenant by design).
 *
 *   admin.audit-log          the operator audit trail      GET /api/admin/audit-log/export
 *   admin.permission-matrix  effective role × permission   GET /api/admin/permissions/matrix/export
 *
 * Both routes used to hand-roll their CSV — the audit-log one doubled quotes in
 * the metadata column only, so an event name or IP containing a quote broke the
 * row. They are rows now, serialised by `export/exportSource`.
 */
import type { PlatformExportSource } from '../export/exportSource';
import { ADMIN_AUDIT_EXPORT_CAP, adminAuditFilterFrom, listAdminAuditLog } from '../audit/adminAuditLog';
import { loadPermissionMatrix } from './permissionMatrix';

export const adminAuditLogExportSource: PlatformExportSource = {
  id: 'admin.audit-log',
  label: 'Platform audit log',
  scope: 'platform',
  formats: ['csv', 'json', 'xlsx'],
  async load(ctx) {
    const entries = await listAdminAuditLog(ctx.db, adminAuditFilterFrom(ctx.param), { limit: ADMIN_AUDIT_EXPORT_CAP });
    return {
      filename: 'audit-log',
      title: 'Platform audit log',
      table: {
        columns: ['id', 'event', 'actorId', 'targetUserId', 'tenantId', 'ipAddress', 'createdAt', 'metadata'],
        rows: entries.map((e) => [e.id, e.event, e.actorId, e.targetUserId, e.tenantId, e.ipAddress, e.createdAt, e.metadata]),
      },
      json: { entries },
    };
  },
};

export const permissionMatrixExportSource: PlatformExportSource = {
  id: 'admin.permission-matrix',
  label: 'Permission matrix',
  scope: 'platform',
  formats: ['csv', 'xlsx', 'json'],
  async load(ctx) {
    const m = await loadPermissionMatrix(ctx.db);
    const granted = new Map(m.roles.map((role) => [role, new Set<string>(m.matrix[role] ?? [])]));
    return {
      filename: 'permission-matrix',
      title: 'Permission matrix',
      table: {
        columns: ['permission', ...m.roles],
        rows: m.permissions.map((perm) => [perm, ...m.roles.map((role) => (granted.get(role)?.has(perm) ? '1' : '0'))]),
      },
      json: { roles: m.roles, permissions: m.permissions, matrix: m.matrix },
    };
  },
};
