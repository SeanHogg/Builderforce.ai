# -*- coding: utf-8 -*-
"""
CI/CD Integration & Deploy Event Object Model

Implements core concepts defined in the PRD.
Supported integration types and connection status enforcements are defined here.
"""

from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Optional, List, Literal, Dict, Any
from pydantic import BaseModel
from uuid import uuid4


class ConnectionStatus(str, Enum):
    """
    Connection status per integration.

    Values corresponding to PRD FR-1.1:
    - connected (success handshake or webhook receipt)
    - degraded (partial connectivity)
    - disconnected (no success handshake or webhook receipt within eligibility)
    - never_configured (first-time integration)
    - auth_failed (credential/token expiry detected)
    """

    CONNECTED = "connected"
    DEGRADED = "degraded"
    DISCONNECTED = "disconnected"
    NEVER_CONFIGURED = "never_configured"
    AUTH_FAILED = "auth_failed"


class IntegrationType(str, Enum):
    """
    Supported CI/CD integrations.

    All named integrations for the current iteration.
    """

    GITHUB_ACTIONS = "github_actions"
    JENKINS = "jenkins"
    GITLAB_CI_CD = "gitlab_ci_cd"
    CIRCLECI = "circleci"
    BUILDKITE = "buildkite"
    AZURE_DEVOPS_PIPELINES = "azure_devops_pipelines"


class DeployEventStatus(str, Enum):
    """
    Ingestion and processing status for each deploy event.

    FR-2.2: emit an ingest receipt (acknowledgment) per event, including validation pass/fail.
    """

    ACCEPTED = "accepted"
    REJECTED = "rejected"
    QUARANTINED = "quarantined"


class AuthFailureReason(str, Enum):
    """
    Specific reason for auth failures.

    Useful for FR-4.1 triggers and context-aware remediation paths (FR-5.1).
    """

    EXPIRED_TOKEN = "expired_token"
    INVALID_SECRET = "invalid_secret"
    INSUFFICIENT_SCOPES = "insufficient_scopes"
    NOT_AUTHORIZED = "not_authorized"


class ValidationErrorDetail(BaseModel):
    """
    Field-level validation error details attached to an ingest receipt.

    FR-2.2: capture field-level errors in ingest receipts and errors log (FR-3.3).
    """

    field_name: str
    error_code: str
    error_message: str
    # Optional: related context if relevant
    context: Optional[dict[str, Any]] = None


class DeployEventData(BaseModel):
    """
    Canonical deploy event payload as defined in the PRD.

    Every inbound deploy event MUST be validated against this schema (FR-2.1).
    """

    service_name: str
    environment: str
    deploy_id: str
    timestamp: datetime
    status: str
    commit_sha: str
    # Optional enrichments as they become available in data sources
    pr_number: Optional[int] = None
    triggered_by: Optional[str] = None
    custom_payload: Optional[Dict[str, Any]] = None


class IngestReceipt(BaseModel):
    """
    Acknowledgment response for each inbound deploy event.

    FR-2.2: describe pass/fail and field-level errors.
    """

    event_id: str
    ingest_timestamp: datetime
    validation_passed: bool
    reason: Optional[str] = None
    # Optional: trigger remediation flow if reason is non-null and validation_failed
    validation_errors: List[ValidationErrorDetail] = []


class Integration(BaseModel):
    """
    Minimal integration object formental visualization and API keys.

    API values per container-wired outputs.
    """

    # Service TE: ID assigned by system
    id: str = f"int_{uuid4().hex[:12]}"
    # Service TE: human-friendly display name
    name: str
    # Service TE: defines endpoint compatibility
    integration_type: IntegrationType
    status: ConnectionStatus = ConnectionStatus.DISCONNECTED
    # Service TE: last handshake/webhook reception or poll result
    last_success_timestamp: Optional[datetime] = None
    # Service TE: optional auth_failure_reason for auth_failed state
    auth_failure_reason: Optional[AuthFailureReason] = None
    # Service TE: webhook payload hash (FR-1.4) or last_poll_result_count (FR-1.5)
    last_payload_hash: Optional[str] = None
    last_poll_result_count: Optional[int] = None

    # Service TE: optional config hints (not full config)
    # The full integration config is stored in database configuration metadata.
    # This field holds lightweight hints for in-product UI.
    connection_hint: Optional[str] = None


class DeployEvent(BaseModel):
    """
    Deploy event persisted record.

    Central anchor for inspection and analytics.
    """

    event_id: str
    integration_id: str
    # Canonical service interface fields
    service_name: str
    environment: str
    deploy_id: str
    timestamp: datetime
    status: str
    commit_sha: str
    # Ingestion receipt fields
    ingest_timestamp: datetime
    ingest_event_id: str  # UUID that ties to the IngestReceipt
    validation_passed: bool
    validation_errors: List[ValidationErrorDetail] = []
    # Additional enrichments
    custom_payload: Optional[Dict[str, Any]] = None

    # An optional metadata payload can encode telemetry or ordering info
    metadata: Optional[Dict[str, Any]] = None


class TestConnectionVerdict(str, Enum):
    """
    Verdict from a test_connection action (FR-3.1).

    Used for success/failure signals and telemetry (OpenTelemetry-style).
    """

    PASS = "pass"
    FAIL = "fail"


def canonicalize_connection_status(
    status: ConnectionStatus,
    last_poll_result_count: Optional[int] = None,
) -> ConnectionStatus:
    """
    Helper to reconcile status with telemetry.

    Returns improved status when data suggests more recent connectivity.
    """

    if status not in (ConnectionStatus.DISCONNECTED, ConnectionStatus.AUTH_FAILED):
        return status
    # If we have recent polling data, treat as connected (not degraded for defaults)
    if status == ConnectionStatus.DISCONNECTED and last_poll_result_count is not None and last_poll_result_count > 0:
        return ConnectionStatus.CONNECTED
    # If we have auth failure but ongoing telemetry could indicate persistence, degrade over explicitly auth_failed
    if status == ConnectionStatus.AUTH_FAILED and last_poll_result_count is not None and last_poll_result_count > 0:
        return ConnectionStatus.DEGRADED
    return status


class OldestNowTimestamp(BaseModel):
    """
    Typed placeholder for compile-time safety for 'oldest_timestamp' fields.

    Reports inclusive lower bound (unique index safety) with sentinel Null for no data.
    """

    # Service TE: exclusive lower bound (unique index condition)
    oldest_ts: datetime | None
    # Service TE: field name for logging consistency
    field: str = "oldest_ts"


class NewestCanBeNullTimestamp(BaseModel):
    """
    Typed placeholder for compile-time safety for 'newest_timestamp' fields with optional nulls.

    Reports inclusive upper bound (unique index safety) with sentinel Null for no data.
    """

    # Service TE: inclusive upper bound (unique index condition)
    newest_ts: datetime | None
    # Service TE: field name for logging consistency
    field: str = "newest_ts"


class EventDeliveryRate(BaseModel):
    """
    Per-integration per-timeframe delivery rate (events received / events expected).

    Used in dashboards and alerting logic (FR-2.3, FR-4.1).
    """

    reception_rate: float
    total_expected: int
    total_received: int


class TimeframeMetric(BaseModel):
    """
    Count or fraction within a sliding time window.

    Supports coarse and time-aware counts and rate thresholds.
    """

    window_minutes: int
    total_events: int
    events_processed: int
    validation_errors: int


class HiveOutput(BaseModel):
    """
    Schema-conformant hive-container result for analytic queries.

    Enables client-side time-series plotting and alerting boundary checks.
    """

    ts: datetime
    dim_integration_id: str
    metric_events: int
    metric_validation_errors: int

    class Config:
        arbitrary_types_allowed = True


class QueryableTimeframe(BaseModel):
    """
    Time interval query shape.

    The client specifies start and end bounds, and the service computes inclusive windows.
    """

    start_ts: datetime
    end_ts: datetime


class HiveSidebarSearchCriteria(BaseModel):
    """
    Hive-section search criteria as agreed with cross-team product owners.

    Allows filtering events by integration and order across timeframes.
    """

    dim_integration_ids: List[str] = []  # e.g. ['int_abc123', 'int_xyz789']
    dim_environment: str | None = None
    date_hier_start: QueryableTimeframe  # use QueryableTimeframe for simple pivots; multiple tiers scale in variation
    date_hier_end: QueryableTimeframe  # support custom epochs per customer design (e.g., per sprints)
    order_key: str = "ts"  # e.g., "ts"
    sort_dir: Literal["asc"] = "asc"

    # slots for future multi-tier fields (e.g., order_key_sub, date_hier_start_sub, date_hier_end_sub)
    # we avoid hardcoding multiple layers for now to stay within generic catalog scope.
    # Future-phase breadcrumbs and dimension-filter seeds can extend this without divergence.


class SearchableFields(BaseModel):
    """
    Indexable fields for deploy event records.

    Currently mapped to types above; future granular searches will align with these.
    """

    # Composite uniqueness anchor
    dim_integration_id: str
    # Canonical service interface fields used for analysis
    service_name: str
    environment: str
    timestamp: datetime

    # Ingestion and validation fields
    validate_passed: bool


class AgendaDeliveryMetrics(BaseModel):
    """
    High-level usage metrics for small-team CLI/workflow tools.

    Corresponds to feltively-deployed metrics maps expected by cross-team product owners.
    """

    dims: Dict[str, Any]
    values: Dict[str, Any]


# TODO: Add curated list of supported integration features by type
# For now we expose all six as supported.
SUPPORTED_INTEGRATIONS: List[IntegrationType] = [
    IntegrationType.GITHUB_ACTIONS,
    IntegrationType.JENKINS,
    IntegrationType.GITLAB_CI_CD,
    IntegrationType.CIRCLECI,
    IntegrationType.BUILDKITE,
    IntegrationType.AZURE_DEVOPS_PIPELINES,
]