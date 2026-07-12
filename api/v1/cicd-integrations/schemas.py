# -*- coding: utf-8 -*-
"""
Schemas for CI/CD Integration and Deploy Event APIs

In-line with models.py and following PRD functional requirements.
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional, List, Literal, Dict, Any, Annotated
from enum import Enum

from pydantic import BaseModel, Field, field_validator

from .models import (
    ConnectionStatus,
    IntegrationType,
    DeployEvent,
    IngestReceipt,
    ValidationErrorDetail,
    AuthFailureReason,
    TestConnectionVerdict,
    HiveSidebarSearchCriteria,
    OldestNowTimestamp,
    NewestCanBeNullTimestamp,
    QueryableTimeframe,
    OldestCanBeNullTimestamp,
)


class CreateIntegrationSchema(BaseModel):
    """
    Input schema for creating a new CI/CD integration.

    Contains both hyperparameters (idempotent) and a secrets hint, which is
    not persisted beyond this call (no database schema or storage by this API).
    """

    name: str = Field(..., min_length=1, max_length=255)
    integration_type: IntegrationType
    # NOTE: Secrets (webhook URL secret / auth tokens) are stored in database
    # configuration metadata. We intentionally omit them here to avoid
    # persisting sensitive data in the request body.
    webhook_url: Optional[str] = None
    webhook_secret: Optional[str] = None
    token: Optional[str] = None
    endpoint: Optional[str] = None
    username: Optional[str] = None

    @field_validator("webhook_url", "webhook_secret", "token", "endpoint", "username")
    @classmethod
    def ignore_secrets(cls, v: Optional[str]) -> Optional[str]:
        """
        Retain all values here to avoid breaking existing clients,
        but treat them as secrets-only (not persisted beyond this call).
        """
        return v


class TriggerTestConnectionSchema(BaseModel):
    """
    Schema for the `testConnection` action.

    Clarifies intent and can support future extension (e.g., custom headers, JSON bodies).
    """

    pass


class ValidatedPayloadDefine(BaseModel):
    """
    Schema for the payload that services write into ingestion log tables.

    Matches the canonical DeployEventData shape plus optional metadata.
    """

    service_name: str = Field(..., min_length=1)
    environment: str = Field(..., min_length=1)
    deploy_id: str = Field(..., min_length=1)
    timestamp: datetime
    status: str = Field(..., min_length=1)
    commit_sha: str = Field(..., min_length=1)
    custom_payload: Optional[Dict[str, Any]] = None


class IngestReceiptRoutedSchema(BaseModel):
    """
    Ingest receipt mapping for API responses.

    FR-2.2: operation-level receipts with clarity to the consumer.
    """

    event_id: str
    ingest_timestamp: datetime
    validation_passed: bool
    reason: Optional[str] = None
    validation_errors: List[ValidationErrorDetail] = []


class IntegrationListResponseSchema(BaseModel):
    """
    Minimal representation of a CI/CD integration for list views.

    Carries flags rather than full coupling.
    """

    id: str
    name: str
    integration_type: IntegrationType
    status: ConnectionStatus
    last_success_timestamp: Optional[datetime] = None
    connection_hint: Optional[str] = None

    @staticmethod
    def model_validate minimal_integration(integration: Integration) -> "IntegrationListResponseSchema":
        return IntegrationListResponseSchema.model_validate(integration)


class IntegrationDetailResponseSchema(BaseModel):
    """
    A fuller representation of an integration for detail views.

    Carries integration-wide details including telemetry and auth failure hints.
    """

    id: str
    name: str
    integration_type: IntegrationType
    status: ConnectionStatus
    last_success_timestamp: Optional[datetime] = None
    auth_failure_reason: Optional[AuthFailureReason] = None
    last_payload_hash: Optional[str] = None
    last_poll_result_count: Optional[int] = None
    connection_hint: Optional[str] = None

    @staticmethod
    def model_validate integration_detail(integration: Integration) -> "IntegrationDetailResponseSchema":
        return IntegrationDetailResponseSchema.model_validate(integration)


class CreateIntegrationResponseSchema(BaseModel):
    """
    Response for creating a new integration.

    Consistent with FR-3.2 (Deploy Event Inspector) where users must be able to
    view and inspect raw and parsed deploy events by integration.
    """

    integration: IntegrationDetailResponseSchema

    @staticmethod
    def model_validate created(integration: Integration) -> "CreateIntegrationResponseSchema":
        return CreateIntegrationResponseSchema.model_validate(integration)


class DeployEventListResponseSchema(BaseModel):
    """
    Minimal representation of a deploy event for list views.

    Includes integration ID to enable cross-resource navigation.
    """

    event_id: str
    integration_id: str
    service_name: str
    environment: str
    timestamp: datetime
    deploy_id: str
    status: str
    commit_sha: str
    validate_passed: bool

    @staticmethod
    def model_validate simple_deploy_event(event: DeployEvent) -> "DeployEventListResponseSchema":
        return DeployEventListResponseSchema.model_validate(event)


class DeployEventDetailResponseSchema(BaseModel):
    """
    Full representation of a deploy event for inspecting exchange data.

    Supports deep-dive queries and traceability (FR-3.2).
    """

    event_id: str
    integration_id: str
    service_name: str
    environment: str
    deploy_id: str
    timestamp: datetime
    status: str
    commit_sha: str
    ingest_timestamp: datetime
    ingest_event_id: str
    validation_passed: bool
    validation_errors: List[ValidationErrorDetail] = []
    custom_payload: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None

    @staticmethod
    def model_validate detailed_deploy_event(event: DeployEvent) -> "DeployEventDetailResponseSchema":
        return DeployEventDetailResponseSchema.model_validate(event)


class DeployEventQuerySchema(BaseModel):
    """
    Query shape for deploy event inspection.

    Aligns with FR-3.2 (search, filter, inspect by integration, time range, service, environment).
    """

    dim_integration_ids: List[str] = []
    dim_environment: str | None = None
    date_bounds: QueryableTimeframe
    order_key: str = "ts"
    sort_dir: Literal["asc", "desc"] = "asc"

    @field_validator("date_bounds")
    @classmethod
    def validate_date_bounds(cls, v: QueryableTimeframe) -> QueryableTimeframe:
        # V0: accept inclusive bounds for simplicity; consumers can adjust filters.
        if not v.start_ts or not v.end_ts:
            return v
        # Service TE: ensure start_ts <= end_ts
        if v.start_ts > v.end_ts:
            message = "start_ts must be before or equal to end_ts"
            raise ValueError(message)
        return v

    @field_validator("order_key")
    @classmethod
    def validate_order_key(cls, v: str) -> str:
        return str(v)


class OldestNowTimestampSchema(BaseModel):
    """
    Concrete implementation for Compose query shapes.

    Designates the 'oldest' value that the consumer expects (unique index condition).
    """

    field: str = "oldest_ts"
    value: datetime | None = None


class NewestCanBeNullTimestampSchema(BaseModel):
    """
    Concrete implementation for Compose query shapes.

    Designates the 'newest' value that the consumer expects (unique index condition).
    """

    field: str = "newest_ts"
    value: datetime | None = None


class OldestCanBeNullTimestampSchema(BaseModel):
    """
    Compose-compatible representation of 'oldest_ts' with optional null sentinel.

    Matches the notion of 'T' timestamp anchors used in Compose schemas.
    """

    # Service TE: distinct from OldestNowTimestamp to avoid ambiguity with the
    # `__init__` signature of the Compose-built pydantic model.
    ms_offset_days: int | None = None
    value: datetime | None = None


class EventDeliveryRateSchema(BaseModel):
    """
    Response schema for the delivery rate per integration per timeframe.

    FR-2.3: events received / events expected.
    """

    integration_id: str
    timeframe_minutes: int
    total_expected: int
    total_received: int
    reception_rate: float

    @staticmethod
    def model_validate rate(data: dict, integration_id: str) -> "EventDeliveryRateSchema":
        # Directly model-values for simplicity in this call
        return EventDeliveryRateSchema(
            integration_id=integration_id,
            timeframe_minutes=data.get("timeframe_minutes", 60),
            total_expected=data.get("total_expected", 0),
            total_received=data.get("total_received", 0),
            reception_rate=data.get("reception_rate", 0.0),
        )


class TimeframeMetricSchema(BaseModel):
    """
    Response schema for TimeframeMetric as modern Pydantic.

    Matches integration outings from backed CORE-NATIVE service.
    """

    window_minutes: int
    total_events: int
    events_processed: int
    validation_errors: int


class HiveSidebarSearchCriteriaSchema(BaseModel):
    """
    Compose-compatible schema for SearchCriteria.

    Aligns with the product flow requiring 2-level 'date_hier_start / date_hier_end'.
    """

    dim_integration_ids: List[str] = Field(default=[], description="Integration IDs to filter by.")
    dim_environment: str | None = Field(default=None, description="Environment to filter by.")
    date_hier_start: OldestCanBeNullTimestampSchema = Field(
        default_factory=OldestCanBeNullTimestampSchema,
        description="Start epoch for search query.",
    )
    date_hier_end: OldestCanBeNullTimestampSchema = Field(
        default_factory=OldestCanBeNullTimestampSchema,
        description="End epoch for search query.",
    )
    order_key: str = Field(default="ts", description="Sort key.")
    sort_dir: Literal["asc", "desc"] = Field(default="asc", description="Sort direction.")

    @field_validator("date_hier_start")
    @classmethod
    def validate_date_hier_start(cls, v: OldestCanBeNullTimestampSchema) -> OldestCanBeNullTimestampSchema:
        # Service TE: treat both `value` and `ms_offset_days` as bounding; order_key: 'ts'
        return v

    @field_validator("date_hier_end")
    @classmethod
    def validate_date_hier_end(cls, v: OldestCanBeNullTimestampSchema) -> OldestCanBeNullTimestampSchema:
        # Service TE: treat both `value` and `ms_offset_days` as bounding; order_key: 'ts'
        return v


class HiveOutputSchema(BaseModel):
    """
    Compose-compatible schema for Injectable Matrix.

    Ensures client-side time-series plotting isn't blocked by type mismatches.
    """

    ts: datetime
    dim_integration_id: str
    metric_events: int
    metric_validation_errors: int

    @classmethod
    def model_validate_push(cls, item: HiveOutput) -> "HiveOutputSchema":
        return HiveOutputSchema.model_validate(item)


class QueryableTimeframeSchema(BaseModel):
    """
    Schema for QueryableTimeframe in JSON.

    Defines start and end bounds.
    """

    start_ts: datetime
    end_ts: datetime

    @field_validator("start_ts", "end_ts")
    @classmethod
    def validate_datetime_bound(cls, v: datetime) -> datetime:
        # Service TE: only inclusive bounds for start_ts and end_ts; rescaling can be done by the caller
        return v


class IngestReceiptCreateSchema(BaseModel):
    """
    Create IngestReceipt from a validated payload.

    Used by ingestion pipelines after schema validation with reason non-Null.
    """

    event_data: ValidatedPayloadDefine
    validation_passed: bool = False
    reason: str | None = None
    validation_errors: List[ValidationErrorDetail] = []


class AuthFailureReasonSchema(BaseModel):
    """
    AuthFailureReason mapped into task-328 resolution.

    FR-3.3: list errors (code + message + field) per integration.
    """

    reason: AuthFailureReason
    # Map to ErrorCode and Message for display and remediation paths
    error_code: str
    message: str

    @staticmethod
    def model_validate_from(match: AuthFailureReason, error_code: str) -> "AuthFailureReasonSchema":
        return AuthFailureReasonSchema(reason=match, error_code=error_code, message="")