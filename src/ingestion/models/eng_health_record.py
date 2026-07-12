"""
Engineering Health Record Schema and Models
Canonical internal schema for all engineering health metrics.
"""

from dataclasses import dataclass, asdict
from enum import Enum, auto
from typing import Dict, List, Any, Optional
from datetime import datetime
import json


class MetricDomain(str, Enum):
    """Metric domain types supported by the ingestion pipeline."""
    TASK_BACKLOG = "task_backlog"
    BUG_COUNT = "bug_count"
    PR_CYCLE_TIME = "pr_cycle_time"
    BUILD_FAILURE_RATE = "build_failure_rate"
    DEPLOYMENT_FREQUENCY = "deployment_frequency"
    INCIDENT_COUNT = "incident_count"
    TEAM_VELOCITY = "team_velocity"
    RESOURCE_ALLOCATION = "resource_allocation"


class DataQualityFlag(str, Enum):
    """Flags indicating quality issues in normalized records."""
    MISSING_REQUIRED_FIELD = "missing_required_field"
    INVALID_TIMESTAMP = "invalid_timestamp"
    VALUE_OUT_OF_RANGE = "value_out_of_range"
    PII_EXISTS = "pii_exists"
    IDENTITY_MISMATCH = "identity_mismatch"


@dataclass
class NormalizedFields:
    """
    Domain-specific normalized fields for different metric types.
    Each type has its own sub-structure.
    """
    # Task Backlog
    item_id: Optional[str] = None
    item_type: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    story_points: Optional[float] = None
    age_days: Optional[float] = None
    sprint_id: Optional[str] = None
    iteration_id: Optional[str] = None
    assignee_team: Optional[str] = None
    
    # Bug Count
    severity: Optional[str] = None
    created_date: Optional[datetime] = None
    resolved_date: Optional[datetime] = None
    lines_fixed: Optional[int] = None
    
    # PR Cycle Time
    pr_id: Optional[str] = None
    created_at: Optional[datetime] = None
    first_review_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    merged_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    target_branch: Optional[str] = None
    lines_changed: Optional[int] = None
    review_count: Optional[int] = None
    
    # Build Failure Rate
    pipeline_name: Optional[str] = None
    trigger_type: Optional[str] = None
    status: Optional[str] = None
    duration_seconds: Optional[float] = None
    failure_stage: Optional[str] = None
    commit_sha: Optional[str] = None
    branch: Optional[str] = None
    
    # Deployment Frequency
    deploy_timestamp: Optional[datetime] = None
    env: Optional[str] = None
    version: Optional[str] = None
    initiator: Optional[str] = None
    outcome: Optional[str] = None
    
    # Incident Count
    incident_id: Optional[str] = None
    severity: Optional[str] = None
    start_time: Optional[datetime] = None
    acknowledged_time: Optional[datetime] = None
    resolved_time: Optional[datetime] = None
    postmortem_link: Optional[str] = None
    
    # Team Velocity
    team: Optional[str] = None
    sprint_id: Optional[str] = None
    sprint_dates: Optional[Dict[str, datetime]] = None
    planned_points: Optional[float] = None
    completed_points: Optional[float] = None
    carry_over_points: Optional[float] = None
    scope_change_delta: Optional[float] = None
    
    # Resource Allocation
    person_id_anonymized: Optional[str] = None
    role: Optional[str] = None
    level: Optional[str] = None
    allocation_percentage: Optional[float] = None
    effective_date_start: Optional[datetime] = None
    effective_date_end: Optional[datetime] = None


@dataclass
class EngHealthRecord:
    """
    Canonical envelope for all engineering health records.
    
    All ingested records must be mapped to this schema ensuring
    consistency across all metric domains.
    """
    record_id: str
    source_system: str
    metric_domain: MetricDomain
    team_id: Optional[str] = None
    service_id: Optional[str] = None
    environment: Optional[str] = None
    event_timestamp: Optional[datetime] = None
    ingested_at: datetime = None
    raw_payload: Dict[str, Any] = None
    normalized_fields: Dict[str, Any] = None
    data_quality_flags: List[DataQualityFlag] = None
    
    def __post_init__(self):
        """Initialize default values and normalize schema."""
        if self.ingested_at is None:
            self.ingested_at = datetime.utcnow()
        
        if self.raw_payload is None:
            self.raw_payload = {}
        
        if self.normalized_fields is None:
            self.normalized_fields = {}
        
        if self.data_quality_flags is None:
            self.data_quality_flags = []
    
    @property
    def data_quality_score(self) -> float:
        """
        Compute data-quality score (0.0 - 1.0).
        
        Higher score indicates better data quality.
        """
        if not self.data_quality_flags:
            return 1.0
        
        quality_score = 1.0 - (len(self.data_quality_flags) * 0.1)
        return max(0.0, min(1.0, quality_score))
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary format (excluding private attributes)."""
        result = asdict(self)
        
        # Convert datetime objects to ISO format strings
        if result["event_timestamp"] is not None:
            result["event_timestamp"] = result["event_timestamp"].isoformat()
        result["ingested_at"] = result["ingested_at"].isoformat()
        
        # Convert enum values to strings
        result["metric_domain"] = result["metric_domain"].value
        result["data_quality_flags"] = [flag.value for flag in result["data_quality_flags"]]
        
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EngHealthRecord":
        """
        Deserialize from dictionary format.
        
        Args:
            data: Dictionary with normalized field names and values
            
        Returns:
            EngHealthRecord instance
        """
        # Convert ISO format strings back to datetime objects
        if data.get("event_timestamp"):
            data["event_timestamp"] = datetime.fromisoformat(data["event_timestamp"])
        
        if data.get("ingested_at"):
            data["ingested_at"] = datetime.fromisoformat(data["ingested_at"])
        
        # Convert string enum values back to enum types
        if "metric_domain" in data:
            data["metric_domain"] = MetricDomain(data["metric_domain"])
        
        if "data_quality_flags" in data:
            data["data_quality_flags"] = [DataQualityFlag(flag) for flag in data["data_quality_flags"]]
        
        return cls(**data)
    
    def serialize(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict(), default=str)


def create_record_id() -> str:
    """
    Generate a unique record ID.
    
    Uses timestamp + UUID for uniqueness.
    """
    import uuid
    from uuid import uuid4
    return f"{datetime.utcnow().timestamp()}.{uuid4()}"


def sanitize_pii(text: str) -> str:
    """
    Basic PII sanitization - replace identifiable patterns with '***'.
    
    Args:
        text: Text to sanitize
        
    Returns:
        Sanitized text
    """
    if not text:
        return text
    
    import re
    # Replace common PII patterns
    sanitized = text
    substitutions = {
        r'\b\d{3}-\d{2}-\d{4}\b': '***-**-****',  # SSN
        r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b': '***@***.***',  # Email
        r'\b\d{10,}\b': '***',  # Phone numbers
    }
    
    for pattern, replacement in substitutions.items():
        sanitized = re.sub(pattern, replacement, sanitized)
    
    return sanitized


# Schema version information
SCHEMA_VERSION = "1.0.0"
SCHEMA_NAME = "EngHealthRecord"