"""
Engineering Health Intelligence Ingestion Pipeline.

Continuously collects, normalizes, and stores eight core engineering health
signals into the canonical ``EngHealthRecord`` schema so that downstream
analytics, alerting, and reporting agents operate on a single authoritative
data layer.

Metric domains:
    - task_backlog
    - bug_count
    - pr_cycle_time
    - build_failure_rate
    - deployment_frequency
    - incident_count
    - team_velocity
    - resource_allocation
"""

from .models.eng_health_record import (
    EngHealthRecord,
    MetricDomain,
    DataQualityFlag,
    SCHEMA_VERSION,
    SCHEMA_NAME,
)
from .factories.adapter_factory import AdapterFactory

__all__ = [
    "EngHealthRecord",
    "MetricDomain",
    "DataQualityFlag",
    "SCHEMA_VERSION",
    "SCHEMA_NAME",
    "AdapterFactory",
]
