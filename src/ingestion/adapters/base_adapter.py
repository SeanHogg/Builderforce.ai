"""
Base adapter interface for all domain-specific ingestion adapters.
"""

import json
from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional
from datetime import datetime
from ...models.eng_health_record import EngHealthRecord, MetricDomain, DataQualityFlag


class BaseAdapter(ABC):
    """
    Abstract base class for all ingestion adapters.

    Each adapter implements one metric domain type and supports both
    webhook-driven ingestion and polling fallback.
    """

    def __init__(self, config: Dict[str, Any]):
        """
        Initialize adapter with configuration.

        Args:
            config: Adapter-specific configuration
        """
        self.config = config
        self.adapter_name = self.__class__.__name__

    @property
    @abstractmethod
    def metric_domain(self) -> MetricDomain:
        """Return the metric domain this adapter handles."""
        pass

    @abstractmethod
    async def ingest(self, payload: Dict[str, Any], incremental: bool = False) -> EngHealthRecord:
        """
        Ingest a single event or batch of events.

        Args:
            payload: Raw payload from source system
            incremental: Whether this is an incremental ingestion (webhook)

        Returns:
            EngHealthRecord normalized to canonical schema

        Raises:
            IngestionError: If ingestion fails
        """
        pass

    @abstractmethod
    async def poll(self, since: Optional[datetime] = None) -> List[EngHealthRecord]:
        """
        Poll for records since the specified timestamp.

        Args:
            since: Only records created after this timestamp

        Returns:
            List of EngHealthRecord instances

        Raises:
            IngestionError: If polling fails
        """
        pass

    def validate_payload(self, payload: Dict[str, Any]) -> bool:
        """
        Validate that payload contains expected fields for this domain.

        Args:
            payload: Payload to validate

        Returns:
            True if valid, raises IngestionError otherwise

        Raises:
            IngestionError: If validation fails
        """
        raise NotImplementedError(
            f"Subclass {self.__class__.__name__} must implement validate_payload"
        )

    def detect_quality_flags(self, payload: Dict[str, Any], record: EngHealthRecord) -> List[DataQualityFlag]:
        """
        Detect data quality flags based on anomaly detection rules.

        Args:
            payload: Original raw payload
            record: Normalized record

        Returns:
            List of data quality flags to apply
        """
        flags = []

        # Check for PII in resource allocation
        if self.metric_domain == MetricDomain.RESOURCE_ALLOCATION and record.service_id:
            normalizer = self.config.get("normalizer", {}).get("sanitize_pii")
            if normalizer:
                try:
                    if any(
                        keyword in str(record.service_id).lower()
                        for keyword in ["company", "employee", "user", "name", "email"]
                    ):
                        flags.append(DataQualityFlag.PII_EXISTS)
                except Exception:
                    pass

        return flags

    async def normalize(self, payload: Dict[str, Any]) -> EngHealthRecord:
        """
        Normalize raw payload to canonical EngHealthRecord format.

        Args:
            payload: Raw payload from source system

        Returns:
            Normalized EngHealthRecord
        """
        # Validate payload
        if not self.validate_payload(payload):
            errors = self._extract_validation_errors(payload)
            record = EngHealthRecord(
                record_id=self.config.get("record_id_prefix", "ingestion") + "_" +
                        str(hash(str(payload)) % 10**12),
                source_system=self.config.get("source_system", "unknown"),
                metric_domain=self.metric_domain,
                raw_payload=payload
            )
            for error in errors:
                record.data_quality_flags.append(DataQualityFlag(error))
            return record

        # Create normalized fields
        normalized_fields = self._extract_normalized_fields(payload)

        # Create record
        record = EngHealthRecord(
            record_id=self.config.get("record_id_prefix", "ingestion") + "_" +
                     str(abs(hash(json.dumps(payload))) % 10**12),
            source_system=self.config.get("source_system", "unknown"),
            metric_domain=self.metric_domain,
            team_id=payload.get("team", ""),
            service_id=payload.get("service", ""),
            environment=payload.get("environment"),
            event_timestamp=self._extract_timestamp(payload),
            raw_payload=payload,
            normalized_fields=normalized_fields
        )

        # Detect quality flags
        flags = self.detect_quality_flags(payload, record)
        record.data_quality_flags.extend(flags)

        return record

    def _extract_timestamp(self, payload: Dict[str, Any]) -> Optional[datetime]:
        """
        Extract timestamp from payload.

        Override in subclasses for domain-specific timestamp extraction.
        """
        # Try common fields
        timestamp_fields = ["timestamp", "created_at", "updated_at", "event_time"]
        for field in timestamp_fields:
            if field in payload:
                value = payload[field]
                if isinstance(value, str):
                    return self._parse_timestamp(value)
                elif isinstance(value, (int, float)):
                    return datetime.fromtimestamp(value / 1000.0)

        # For resource allocation, use effective_date_start
        if self.metric_domain == MetricDomain.RESOURCE_ALLOCATION and "effective_date_start" in payload:
            value = payload["effective_date_start"]
            if isinstance(value, str):
                return self._parse_timestamp(value)

        return datetime.utcnow()

    def _parse_timestamp(self, timestamp_str: str) -> Optional[datetime]:
        """
        Parse timestamp string to datetime.

        Supports ISO 8601 and common date formats.
        """
        # Try ISO format first
        try:
            return datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            pass

        # Try common date formats
        try:
            return datetime.strptime(timestamp_str, "%Y-%m-%dT%H:%M:%S.%f")
        except (ValueError, AttributeError):
            pass

        try:
            return datetime.strptime(timestamp_str, "%Y-%m-%dT%H:%M:%S")
        except (ValueError, AttributeError):
            pass

        try:
            return datetime.strptime(timestamp_str, "%Y-%m-%d %H:%M:%S")
        except (ValueError, AttributeError):
            pass

        try:
            return datetime.strptime(timestamp_str, "%Y-%m-%d")
        except (ValueError, AttributeError):
            pass

        return None

    def _extract_normalized_fields(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract domain-specific normalized fields.

        Override in subclasses.
        """
        # Default implementation extracts simple fields
        return {
            key: payload.get(key)
            for key in ["team", "service", "environment", "timestamp", "created_at", "updated_at"]
        }


class IngestionError(Exception):
    """Raised when ingestion fails."""
    pass