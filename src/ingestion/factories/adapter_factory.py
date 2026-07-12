# -*- coding: utf-8 -*-
"""
Adapter factory for creating domain-specific ingestion adapters.

Factory imports from adapters.base_adapter (all adapters inherit BaseAdapter).
Adapters are auto-registered by their metric domain, enabling dynamic creation
via AdapterFactory.create(domain, config).
"""

from typing import Dict, Any, Type, TypeVar

# Import from adapters.base_adapter (in the same package) to avoid cyclic dependencies
from ..adapters.base_adapter import BaseAdapter, IngestionError
from ..models.eng_health_record import MetricDomain

T = TypeVar("T", bound=BaseAdapter)


class AdapterFactory:
    """
    Factory for creating and managing ingestion adapters.

    Supports discovery and instantiation of registered adapters.
    """

    # Registry of available adapters: MetricDomain -> adapter class
    _adapters: Dict[MetricDomain, Type[BaseAdapter]] = {}

    @classmethod
    def register(cls, domain: MetricDomain, adapter_class: Type[BaseAdapter]) -> None:
        """
        Register an adapter for a metric domain.

        Args:
            domain: Metric domain this adapter handles
            adapter_class: Adapter class to register
        """
        cls._adapters[domain] = adapter_class

    @classmethod
    def create(cls, domain: MetricDomain, config: Dict[str, Any]) -> BaseAdapter:
        """
        Create an adapter instance for the specified domain.

        Args:
            domain: Metric domain to create adapter for
            config: Configuration for the adapter

        Returns:
            Adapter instance

        Raises:
            ValueError: If adapter not found for domain
        """
        if domain not in cls._adapters:
            raise ValueError(
                f"No adapter registered for metric domain: {domain}. "
                f"Available domains: {', '.join(cls._adapters.keys())}"
            )

        adapter_class = cls._adapters[domain]
        return adapter_class(config)

    @classmethod
    def list_domains(cls) -> list[MetricDomain]:
        """
        List all registered metric domains.

        Returns:
            List of available metric domains
        """
        return list(cls._adapters.keys())

    @classmethod
    def get_adapter_info(cls, domain: MetricDomain) -> dict[str, str]:
        """
        Get information about an adapter.

        Args:
            domain: Metric domain

        Returns:
            Dictionary with adapter information

        Raises:
            ValueError: If adapter not found
        """
        if domain not in cls._adapters:
            raise ValueError(f"No adapter found for domain: {domain}")

        adapter_class = cls._adapters[domain]

        return {
            "domain": domain.value,
            "adapter": adapter_class.__name__,
            "description": adapter_class.__doc__ or "No description available",
        }


# ----------------------------------------------------------------------
# Auto-register all adapters.
#
# These imports must resolve successfully; if any adapter module contains
# only stubs/placeholders, imports will fail and must be uncommented once
# concrete implementations exist.
# ----------------------------------------------------------------------

# Task Backlog (FR-1)
from ..adapters.task_backlog_adapters import (
    JiraAdapter,
    LinearAdapter,
    GithubAdapter,
    AzureDevOpsAdapter,
)

# Bug Count / Severity (FR-2)
from ..adapters.bug_count_adapters import (
    JiraAdapter as JiraBugAdapter,
    LinearAdapter as LinearBugAdapter,
    GithubAdapter as GithubBugAdapter,
    AzureDevOpsAdapter as AzureDevOpsBugAdapter,
)

# PR Cycle Time (FR-3)
from ..adapters.pr_cycle_time_adapters import (
    GithubAdapter as GithubPRAdapter,
    GitLabCIAdapter,
    AzureDevOpsAdapter as AzureDevOpsPRAdapter,
    BuildkiteAdapter,
)

# Build Failure Rate (FR-4)
from ..adapters.build_failure_rate_adapters import (
    JenkinsAdapter,
    GitHubActionsAdapter,
    CircleCIAdapter,
    GitLabCIAdapter as GitLabCIBuildAdapter,
    BuildkiteAdapter as BuildkiteBuildAdapter,
)

# Deployment Frequency (FR-5)
from ..adapters.deployment_frequency_adapters import (
    ArgoCDAdapter,
    SpinnakerAdapter,
    HarnessAdapter,
    GithubAdapter as GithubDeployAdapter,
)

# Incident Count (FR-6)
from ..adapters.incident_count_adapters import (
    PagerDutyAdapter,
    OpsGenieAdapter,
    FirehydrantAdapter,
)

# Team Velocity (FR-7)
from ..adapters.team_velocity_adapters import (
    JiraAdapter as JiraVelocityAdapter,
    LinearAdapter as LinearVelocityAdapter,
    AzureDevOpsAdapter as AzureDevOpsVelocityAdapter,
)

# Resource Allocation (FR-8)
from ..adapters.resource_allocation_adapters import (
    WorkdayAdapter,
    LatticeAdapter,
    CsvResourceAdapter,
)


# Register adapters for TASK_BACKLOG
AdapterFactory.register(MetricDomain.TASK_BACKLOG, GithubAdapter)
AdapterFactory.register(MetricDomain.TASK_BACKLOG, LinearAdapter)
AdapterFactory.register(MetricDomain.TASK_BACKLOG, JiraAdapter)
AdapterFactory.register(MetricDomain.TASK_BACKLOG, AzureDevOpsAdapter)

# Register adapters for BUG_COUNT
AdapterFactory.register(MetricDomain.BUG_COUNT, GithubBugAdapter)
AdapterFactory.register(MetricDomain.BUG_COUNT, LinearBugAdapter)
AdapterFactory.register(MetricDomain.BUG_COUNT, JiraBugAdapter)
AdapterFactory.register(MetricDomain.BUG_COUNT, AzureDevOpsBugAdapter)

# Register adapters for PR_CYCLE_TIME
AdapterFactory.register(MetricDomain.PR_CYCLE_TIME, GithubPRAdapter)
AdapterFactory.register(MetricDomain.PR_CYCLE_TIME, GitLabCIAdapter)
AdapterFactory.register(MetricDomain.PR_CYCLE_TIME, AzureDevOpsPRAdapter)
AdapterFactory.register(MetricDomain.PR_CYCLE_TIME, BuildkiteAdapter)

# Register adapters for BUILD_FAILURE_RATE
AdapterFactory.register(MetricDomain.BUILD_FAILURE_RATE, JenkinsAdapter)
AdapterFactory.register(MetricDomain.BUILD_FAILURE_RATE, GitHubActionsAdapter)
AdapterFactory.register(MetricDomain.BUILD_FAILURE_RATE, CircleCIAdapter)
AdapterFactory.register(MetricDomain.BUILD_FAILURE_RATE, GitLabCIBuildAdapter)
AdapterFactory.register(MetricDomain.BUILD_FAILURE_RATE, BuildkiteBuildAdapter)

# Register adapters for DEPLOYMENT_FREQUENCY
AdapterFactory.register(MetricDomain.DEPLOYMENT_FREQUENCY, ArgoCDAdapter)
AdapterFactory.register(MetricDomain.DEPLOYMENT_FREQUENCY, SpinnakerAdapter)
AdapterFactory.register(MetricDomain.DEPLOYMENT_FREQUENCY, HarnessAdapter)
AdapterFactory.register(MetricDomain.DEPLOYMENT_FREQUENCY, GithubDeployAdapter)

# Register adapters for INCIDENT_COUNT
AdapterFactory.register(MetricDomain.INCIDENT_COUNT, PagerDutyAdapter)
AdapterFactory.register(MetricDomain.INCIDENT_COUNT, OpsGenieAdapter)
AdapterFactory.register(MetricDomain.INCIDENT_COUNT, FirehydrantAdapter)

# Register adapters for TEAM_VELOCITY
AdapterFactory.register(MetricDomain.TEAM_VELOCITY, JiraVelocityAdapter)
AdapterFactory.register(MetricDomain.TEAM_VELOCITY, LinearVelocityAdapter)
AdapterFactory.register(MetricDomain.TEAM_VELOCITY, AzureDevOpsVelocityAdapter)

# Register adapters for RESOURCE_ALLOCATION
AdapterFactory.register(MetricDomain.RESOURCE_ALLOCATION, WorkdayAdapter)
AdapterFactory.register(MetricDomain.RESOURCE_ALLOCATION, LatticeAdapter)
AdapterFactory.register(MetricDomain.RESOURCE_ALLOCATION, CsvResourceAdapter)