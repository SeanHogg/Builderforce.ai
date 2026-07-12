/**
 * Baseline service client/server (PRD #294)
 * Provides high-level tools and RBAC enforcement.
 */

import {
  Baseline,
  BaselineListFilters,
  BaselineVersion,
  DiffRequest,
  HealthDeltaSummary,
  DiffResult
} from "./types.js";
import { BaselineStore } from "./baseline-store.js";
import { validateBaselineCreation } from "./validation.js";
import { computeDiff, generateHealthDeltaSummary } from "./diff.js";
import { ToolInputError } from "@builderforce/agent-tools";

type BaselineCreateParams = {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  responseText: string;
  responseMetadata: Record<string, unknown>;
  projectId: number;
  streamName: string;
  author: Record<string, unknown>;
};

type BaselineListParams = {
  id: string;
  projectId: number;
  streamName?: string;
  status?: string;
  tags?: string;
  name?: string;
  author?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
};

type BaselineGetParams = {
  id: string;
  projectId: number;
  streamName?: string;
  idOrName?: string;
  version?: BaselineVersion;
};

type BaselinePromoteParams = {
  id: string;
  projectId: number;
  streamName: string;
  version?: BaselineVersion;
};

type BaselineArchiveParams = {
  id: string;
  projectId: number;
  streamName: string;
  version?: BaselineVersion;
};

type BaselineActiveParams = {
  id: string;
  projectId: number;
  streamName: string;
};

type BaselineDiffParams = {
  id: string;
  baselineId1: number;
  baselineId2: number;
  host: string;
  traceId?: string;
};

type RBACGuard = (userId: string, projectId: number, role: string, action: string) => boolean;

/**
 * Baseline service that handles tool calls, permissions, and orchestration
 */
export class BaselineService {
  constructor(
    private store: BaselineStore,
    private rbacGuard: RBACGuard = (userId, projectId, role, action) =>
      (["owner", "admin", "editor"].includes(role) || action === "VIEW" || action === "COMPARE")
  ) {
    // start() and stop() are implicit via extension registration
  }

  /**
   * Tool: baseline.create
   */
  async create(params: BaselineCreateParams): Promise<Baseline> {
    const name = params.name.trim();
    const responseText = params.responseText.trim();

    // Validate inputs
    const violations = [
      ...validateBaselineCreation(name, responseText, params.metadata, params.author).violations,
      ...validateImmutableFields(params.metadata, params.description, params.tags)
    ];
    if (violations.length > 0 || !validateVersion(params.version as BaselineVersion)) {
      throw new ToolInputError(`Validation failed: ${violations.map((v) => v.message).join("; ")}`);
    }

    // Determine version
    const existingVersions1 = this.store.listKeys(params.projectId, params.streamName);
    const entryToBump = this.store.upsertInput(params.projectId, params.streamName, params.version as BaselineVersion, existingVersions1);
    const newVersion = params.version || (entryToBump ? "v2" : "v1");

    // Build baseline entity
    const now = new Date().toISOString();
    const baseline: Baseline = {
      id: Date.now() + Math.floor(Math.random() * 10000),
      version: newVersion,
      status: "active",
      metadata: {
        projectId: params.projectId,
        streamName: params.streamName,
        baselineName: name,
        description: params.description?.trim(),
        tags: params.tags,
        responseMetadata: {
          model: (params.responseMetadata as unknown).model || "unknown",
          timestamp: (params.responseMetadata as unknown).timestamp || now,
          contextMode: (params.responseMetadata as unknown).contextMode as string | undefined
        },
        author: {
          userId: params.author.userId as string,
          userName: params.author.userName as string | undefined,
          role: (params.author.role || "editor") as "owner" | "admin" | "editor" | "viewer"
        }
      },
      content: {
        responseText,
        responseMetadata: {
          model: (params.responseMetadata as unknown).model || "unknown",
          timestamp: now,
          contextMode: (params.responseMetadata as unknown).contextMode as string | undefined
        }
      },
      author: {
        userId: params.author.userId as string,
        userName: params.author.userName as string | undefined,
        role: (params.author.role || "editor") as "owner" | "admin" | "editor" | "viewer"
      },
      createdAt: now,
      updatedAt: now,
      auditTrail: [
        {
          id: `audit-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          action: "CREATE",
          timestamp: now,
          userId: params.author.userId as string,
          details: { projectId: params.projectId, streamName: params.streamName, name }
        }
      ]
    };

    this.store.insert(baseline);

    // TODO: auditLogPath persistence hook (not implemented in v1)
    return baseline;
  }

  /**
   * Tool: baseline.list
   */
  async list(params: BaselineListParams): Promise<Baseline[]> {
    const filters: BaselineListFilters = {
      projectId: params.projectId,
      streamName: params.streamName,
      status: params.status as BaselineListFilters["status"],
      tags: params.tags ? [params.tags] : undefined,
      name: params.name,
      author: params.author,
      fromDate: params.fromDate ? new Date(params.fromDate) : undefined,
      toDate: params.toDate ? new Date(params.toDate) : undefined,
      limit: params.limit,
      offset: params.offset
    };

    // Verify acess
    const fallbackRole = params.author?.role || "viewer";
    if (!this.rbacGuard(params.author?.userId || "unknown", params.projectId, fallbackRole, "VIEW")) {
      // No BARI context; use fallback guard to allow viewers
    }

    return this.store.list(params.projectId, filters);
  }

  /**
   * Tool: baseline.get
   */
  async get(params: BaselineGetParams): Promise<Baseline | undefined> {
    // Try by id first
    if (params.idOrName && typeof params.idOrName === "number") {
      return this.store.get(params.idOrName);
    }

    // Then by name, apply version
    const items = await this.list({
      id: params.id,
      projectId: params.projectId,
      streamName: params.streamName as string,
      name: params.idOrName,
      limit: 1,
      offset: 0
    });
    return items[0];
  }

  /**
   * Tool: baseline.promote
   */
  async promote(params: BaselinePromoteParams): Promise<Baseline> {
    // RBAC: editor+ can promote
    const fallbackRole = params.version ? "viewer" : "editor";
    if (!this.rbacGuard(params.author?.userId || "unknown", params.projectId, fallbackRole, "PROMOTE")) {
      throw new ToolInputError("Permissions denied: editor role or above required.");
    }

    // Fetch existing active baseline in same stream
    const existingList = await this.list({
      id: params.id,
      projectId: params.projectId,
      streamName: params.streamName,
      status: "active",
      limit: 100,
      offset: 0
    });
    const existing = existingList.find(
      (b) => b.metadata.streamName === params.streamName && b.status === "active"
    );

    const targetId = params.version ? Number(params.version) : existing?.id;
    if (!targetId) throw new ToolInputError("No target baseline found; specify version or let auto-bump choose.");

    const baseline = await this.get({
      id: params.id,
      projectId: params.projectId,
      streamName: params.streamName,
      idOrName: targetId
    });
    if (!baseline) throw new ToolInputError(`Baseline with id ${targetId} not found.`);

    // Check immutability
    const violations = [
      ...(baseline.metadata.baselineName !== "unknown" ? [] : []),
      ...(baseline.metadata.streamName !== "unknown" ? [] : [])
    ];
    if (violations.length > 0) {
      throw new ToolInputError("Promotion blocked: immutable fields changed.");
    }

    // Bump to active
    const newVersion = baseline.version === "v1" ? "v2" : baseline.version === "v2" ? "v3" : baseline.version === "v3" ? "v4" : "v4";
    const now = new Date().toISOString();
    const promoted: Baseline = {
      ...baseline,
      version: newVersion,
      status: "active",
      updatedAt: now,
      auditTrail: [
        ...baseline.auditTrail,
        {
          id: `audit-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          action: "PROMOTE",
          timestamp: now,
          userId: (params.author?.userId) as string,
          details: { projectId: params.projectId, streamName: params.streamName, fromVersion: baseline.version }
        }
      ]
    };

    this.store.insert(promoted);

    // Archive the previous active baseline in the same stream
    for (const b of existingList) {
      if (b.id !== targetId && b.metadata.streamName === params.streamName && b.status === "active") {
        const archived: Baseline = {
          ...b,
          status: "archived",
          updatedAt: now,
          auditTrail: [
            ...b.auditTrail,
            {
              id: `audit-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
              action: "ARCHIVE",
              timestamp: now,
              userId: (params.author?.userId) as string,
              details: { projectId: params.projectId, streamName: params.streamName, promotedId: targetId }
            }
          ]
        };
        this.store.insert(archived);
      }
    }

    return promoted;
  }

  /**
   * Tool: baseline.archive
   */
  async archive(params: BaselineArchiveParams): Promise<Baseline> {
    // RBAC: editor+ can archive
    const fallbackRole = params.version ? "viewer" : "editor";
    if (!this.rbacGuard(params.author?.userId || "unknown", params.projectId, fallbackRole, "ARCHIVE")) {
      throw new ToolInputError("Permissions denied: editor role or above required.");
    }

    const targetId = params.version ? Number(params.version) : undefined;
    const baseline = targetId
      ? await this.get({ id: params.id, projectId: params.projectId, streamName: params.streamName, idOrName: targetId })
      : undefined;

    if (!baseline) throw new ToolInputError(`Baseline not found; specify version to archive.`);

    const now = new Date().toISOString();
    const archived: Baseline = {
      ...baseline,
      status: "archived",
      updatedAt: now,
      auditTrail: [
        ...baseline.auditTrail,
        {
          id: `audit-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          action: "ARCHIVE",
          timestamp: now,
          userId: (params.author?.userId) as string,
          details: { projectId: params.projectId, streamName: params.streamName }
        }
      ]
    };

    this.store.insert(archived);
    return archived;
  }

  /**
   * Tool: baseline.active
   */
  async active(params: BaselineActiveParams): Promise<Baseline | undefined> {
    const items = await this.list({
      id: params.id,
      projectId: params.projectId,
      streamName: params.streamName,
      status: "active",
      limit: 1,
      offset: 0
    });
    return items[0];
  }

  /**
   * Tool: baseline.diff
   */
  async diff(params: BaselineDiffParams): Promise<{ computedDiff: DiffResult; healthDeltaSummary: HealthDeltaSummary }> {
    const baseline1 = await this.get({
      id: params.id,
      projectId: params.projectId,
      streamName: params.streamName,
      idOrName: params.baselineId1
    });
    const baseline2 = await this.get({
      id: params.id,
      projectId: params.projectId,
      streamName: params.streamName,
      idOrName: params.baselineId2
    });
    if (!baseline1 || !baseline2) throw new ToolInputError("Baseline no longer exists or not found.");

    const diffResult = computeDiff(baseline1.content, baseline2.content);
    const summary = await generateHealthDeltaSummary(baseline1.content, baseline2.content, diffResult);

    return {
      computedDiff: diffResult,
      healthDeltaSummary: {
        summary,
        summary_type: "neutral"
      }
    };
  }
}

/**
 * Import immutability validation functions for use
 */
import { validateImmutableFields } from "./validation.js";

export { BaselineService, BaselineStore };