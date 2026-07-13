# PRD Analysis → Design Pack Workflow Spec

## Overview
Enables autonomous multi-agent workflows that transform PRDs (Product Requirements Documents) into complete design packs containing wireframes, architecture diagrams, API specs, data models, security models, and traceability matrices.

**Scope**: Per KR1 of OKR 4 — "PRD analysis workflow (6 specialist agents → design pack)".

## Workflow Definition

### Trigger
- User uploads a PRD file (markdown/text) via API or dashboard.
- PRD is linked to a project using existing PRD infrastructure (`taskPrd.ts`, `generatePrd.ts`).

### Workflow Stages

#### Stage 1: PRD Analysis (Product Agent)
- **Agent**: `tech-product` (Product Manager persona - new role)
- **Input**: PRD markdown file
- **Output**:
  ```json
  {
    "summary": "...",
    "requirements": [
      { "id": "FR-1", "text": "...", "type": "functional|non-functional", "priority": "P1" }
    ],
    "scopeBoundaries": ["...", "..."],
    "assumptions": ["...", "..."],
    "estimatedComplexity": "low|medium|high"
  }
  ```

#### Stage 2: UX Design (UX Agent)
- **Agent**: `ux-designer` (UI/UX persona - new role)
- **Input**: PRD requirements + Product analysis
- **Output**:
  ```json
  {
    "userStories": [...],
    "wireframes": [{
      "name": "Login Screen",
      "description": "...",
      "layout": "flex/grid",
      "notes": "...",
      "externalRef": "figma://... (placeholder)"
    }],
    "interactionFlows": [...],
    "designTokens": { "colors": [...], "typography": [...] }
  }
  ```

#### Stage 3: API Design (API Agent)
- **Agent**: `api-designer` (Software Architect persona - new role but leverages existing `code-creator` for implementation)
- **Input**: PRD requirements + UX wireframes
- **Output**:
  ```json
  {
    "openapiSpec": "openapi: 3.0.0\npaths:\n  /api/users:\n    get: ...",
    "endpoints": [
      {
        "method": "GET /api/users/:id",
        "description": "...",
        "requestSchema": {...},
        "responseSchema": {...},
        "notes": "Requires authentication"
      }
    ]
  }
  ```

#### Stage 4: Data Modeling (Data Agent)
- **Agent**: `data-modeler` (Database Engineer persona - new role)
- **Input**: API endpoints + PRD requirements
- **Output**:
  ```json
  {
    "schemas": [
      {
        "entityName": "User",
        "attributes": [{ "name": "id", "type": "uuid", "primary": true }],
        "relationships": [{"type": "one_to_many", "with": "Profile"}]
      }
    ],
    "erDiagram": "{ \"User|<Profile\" }"
  }
  ```

#### Stage 5: Security Review (Security Agent)
- **Agent**: `security-auditor` (Security Engineer persona - new role but leverages existing `code-reviewer` for code analysis skills)
- **Input**: Architecture + API design + Data models
- **Output**:
  ```json
  {
    "threatModel": [
      { "threat": "SQL Injection", "mitigation": "Parameterized queries", "severity": "low" }
    ],
    "complianceChecks": [
      { "area": "GDPR", "status": "pass", "notes": "User data consent handling" }
    ],
    "specificConcerns": [...]
  }
  ```

#### Stage 6: Design Pack Assembly (Orchestrator + Tag Agent)
- **Agent**: `packager` (orchestrator callback - not a role)
- **Input**: All intermediate outputs from stages 1-5
- **Output**:
  ```json
  {
    "designPackVersion": "1.0.0",
    "packageId": "uuid",
    "createdAt": "ISO8601",
    "project": "project-id",
    "artifacts": {
      "product-analysis": { "file": "prd-analysis.md", "type": "markdown" },
      "ux-design": { "file": "ux-design.json", "type": "json" },
      "api-spec": { "file": "openapi.yaml", "type": "yaml" },
      "data-model": { "file": "data-model.json", "type": "json" },
      "security-review": { "file": "security-review.json", "type": "json" },
      "traceability": { "file": "traceability.md", "type": "markdown" }
    },
    "metadata": { "prpId": "...", "workflowId": "..." }
  }
  ```

## Agent Roles to Register

### New Roles (6 in total)
1. `tech-product` — Product Manager (from existing platforms, creates PRD analysis summary)
2. `ux-designer` — UI/UX Designer (creates wireframes, flows, design tokens)
3. `api-designer` — Software Architect (creates OpenAPI specs, endpoint definitions)
4. `data-modeler` — Database Engineer (creates schema, ER diagrams, relationships)
5. `security-auditor` — Security Engineer (conducts threat model, compliance checks)
6. `packager` — Not an agent; orchestrator callback that assembles design pack

### Existing Roles (leveraged for implementation)
- `code-creator` — Used for API/schema generation (AI coding with file tools)
- `code-reviewer` — Used as base for security-auditor (extends with security-specific capabilities)
- `test-generator` — Not used for this workflow (reserved for implementation testing)

## Orchestration Design

### Global Orchestrator Extension
- **File**: `agent-runtime/src/builderforce/orchestrator.ts`
- **Changes**:
  - Add `PRD_ANALYSIS_WORKFLOW_TYPE` constant
  - Add `designPackSchema` TypeScript interface
  - Add `executePrdAnalysisWorkflow(specId, projectRoot)` method
  - Inject `PRD_ANALYSIS_WORKFLOW_TYPE` into existing `routeDetected()` matching

### Agent Role Registration
- **File**: `agent-runtime/src/builderforce/agent-roles.ts`
- **Changes**:
  - Add `TECH_PRODUCT_ROLE`
  - Add `UX_DESIGNER_ROLE`
  - Add `API_DESIGNER_ROLE`
  - Add `DATA_MODELER_ROLE`
  - Add `SECURITY_AUDITOR_ROLE`
  - Update `index.ts` exports

### PRD Workflow Spawner
- **File**: `api/src/application/prd/generatePrd.ts`
- **Changes**:
  - Add `spawnDesignPackWorkflow(prdId, projectId)` function
  - Returns `workflowId` for claimed execution
  - Integrated with existing workflow registration + claim loop

### Design Pack Storage
- **Files**:
  - `api/src/infrastructure/repositories/DesignPackRepository.ts` (new)
  - Database schema update in `api/src/infrastructure/database/schema.ts`
- **Contract**:
  ```typescript
  interface DesignPack {
    id: string;
    projectId: number;
    packageId: string;
    version: string;
    prdId: number;
    artifacts: Record<string, { slug: string; type: string; content: string }>;
    createdAt: Date;
    status: 'draft' | 'completed' | 'rejected';
  }
  ```

### Traceability Matrix Generator
- **File**: `agent-runtime/src/builderforce/tools/traceability-tool.ts` (new)
- **Output**: Maps PRD requirements → design artifacts with confidence scores
- **Format**:
  ```markdown
  # Traceability Matrix

  ## Requirement FR-1: Authenticated User Access
  - Source: PRD.md lines 45-51
  - Covered by: UX Screen 1 (Login), API Endpoint `POST /auth/login`, Security Review (MVP Phase)
  - Confidence: 95%

  ## ... (for all requirements)
  ```

## Acceptance Criteria (from PRD)

### P0 — Artifact Validity
- ✅ Wireframes are generated (JSON structure with layout/bounds, links to external tools)
- ✅ OpenAPI spec is valid YAML (passes linting in CI)
- ✅ ER diagrams are parse-able by visual tools (mermaid syntax)

### P0 — Coverage
- ✅ All functional requirements in PRD are represented in at least one artifact
- ✅ Non-functional requirements (performance, security) appear in architecture & security review

### P0 — Traceability
- ✅ Generated `traceability.md` maps each PRD requirement to 1+ artifact lines
- ✅ Confidence scores ≥ 90% for well-referenced requirements

### P0 — Workflow Completeness
- ✅ All 6 specialist agent outputs are present in design pack
- ✅ Workflow completes within 24 hours for PRDs ≤ 50 requirements

## Error Handling & Recovery

- Failed artifact generation triggers PRD workflow as part of `MAX_TASK_RETRIES`
- Partial artifacts are stored in `DesignPackRepository` with `draft` status
- Workflow resumption on restart picks up where it left off

## Integration Points

### API Routes
- `POST /api/prd/:prdId/design-pack` — Initiates PRD analysis workflow
- `GET /api/design-packs/:packageId` — Retrieves design pack download or preview
- `GET /api/design-packs/:packageId/artifacts/:key` — Single artifact stream/download
- `GET /api/prd/:prdId/design-pack/status` — Workflow status

### Database Schema
```sql
CREATE TABLE design_packs (
  id SERIAL PRIMARY KEY,
  package_id UUID NOT NULL UNIQUE,
  project_id INT REFERENCES projects(id) NOT NULL,
  prd_id INT REFERENCES prd_specs(id) ON DELETE CASCADE NOT NULL,
  version VARCHAR(20) NOT NULL,
  artifacts JSONB NOT NULL, -- { key: { slug, type, content_bytes } }
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft|completed|rejected
  completed_at TIMESTAMP,
  CONSTRAINT design_packs_package_id_check CHECK (package_id IS NOT NULL)
);
```

## Open Design Decisions

1. **Packaging**: Design packs as ZIP? Git submodule? Or single JSON with `artifacts/` map? -> **JSON map → simple API responses**, ZIP for downstream CI (future PR)

2. **Agent Routing**: Some requirements cross domains (UI + API) — which agent pays final vote? -> **Packager aggregates confidence scores from all agents, defaults to Product Agent ("most authoritative")**

3. **Traceability Matrix Generation**: Manual or automatic? -> **Automatic via `traceability-tool.ts`** (uses LLM embeddings of PRD ↔ artifact text)

4. **Design Pack Storage**: Persistent in DB (blobs) vs file system? -> **DB for JSON schemas, file system for large binary assets (Figma URLs, images)**

## Notes (this run's scope)

- This spec covers PRD analysis workflow orchestration (KR1) producing a complete design pack.
- Implementation phases:
  1. Agent role registration (`agent-roles.ts`)
  2. Orchestrator workflow entry points (`orchestrator.ts`)
  3. API endpoints (`api/src/application/prd/generatePrd.ts`)
  4. Design pack storage (`DesignPackRepository.ts`)
  5. Traceability tool + acceptance tests
  6. Frontend download UI (future run)