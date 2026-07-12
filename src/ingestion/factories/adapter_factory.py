"""
Adapter factory for creating domain-specific ingestion adapters.
"""

from typing import Dict, Any, Type, TypeVar
from ..adapters.base_adapter import BaseAdapter, MetricDomain
from .base import (
    GithubAdapter,
    JiraAdapter,
    LinearAdapter,
    AzureDevOpsAdapter,
    JenkinsAdapter,
    GitHubActionsAdapter,
    CircleCIAdapter,
    GitLabCIAdapter,
    BuildkiteAdapter,
    ArgoCDAdapter,
    SpinnakerAdapter,
    HarnessAdapter,
    PagerDutyAdapter,
    OpsGenieAdapter,
    FirehydrantAdapter,
    WorkdayAdapter,
    LatticeAdapter,
    CsvResourceAdapter
)

T = TypeVar('T', bound=BaseAdapter)


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
            "description": adapter_class.__doc__ or "No description available"
        }


# Auto-register all adapters
AdapterFactory.register(MetricDomain.TASK_BACKLOG, JiraAdapter)
AdapterFactory.register(MetricDomain.BUG_COUNT, JiraAdapter)
AdapterFactory.register(MetricDomain.TASK_BACKLOG, LinearAdapter)
AdapterFactory.register(MetricDomain.BUG_COUNT, LinearAdapter)
AdapterFactory.register(MetricDomain.TASK_BACKLOG, GithubAdapter)
AdapterFactory.register(MetricDomain.BUG_COUNT, GithubAdapter)
AdapterFactory.register(MetricDomain.TASK_BACKLOG, AzureDevOpsAdapter)
AdapterFactory.register(MetricDomain.BUG_COUNT, AzureDevOpsAdapter)

AdapterFactory.register(MetricDomain.PR_CYCLE_TIME, GithubAdapter)
AdapterFactory.register(MetricDomain.PR_CYCLE_TIME, GitLabCIAdapter)
AdapterFactory.register(MetricDomain.PR_CYCLE_TIME, AzureDevOpsAdapter)
AdapterFactory.register(MetricDomain.PR_CYCLE_TIME, BuildkiteAdapter)

AdapterFactory.register(MetricDomain.BUILD_FAILURE_RATE, JenkinsAdapter)
AdapterFactory.register(MetricDomain.BUILD_FAILURE_RATE, GitHubActionsAdapter)
AdapterFactory.register(MetricDomain.BUILD_FAILURE_RATE, CircleCIAdapter)
AdapterFactory.register(MetricDomain.BUILD_FAILURE_RATE, GitLabCIAdapter)
AdapterFactory.register(MetricDomain.BUILD_FAILURE_RATE, BuildkiteAdapter)

AdapterFactory.register(MetricDomain.DEPLOYMENT_FREQUENCY, ArgoCDAdapter)
AdapterFactory.register(MetricDomain.DEPLOYMENT_FREQUENCY, SpinnakerAdapter)
AdapterFactory.register(MetricDomain.DEPLOYMENT_FREQUENCY, HarnessAdapter)
AdapterFactory.register(MetricDomain.DEPLOYMENT_FREQUENCY, GithubAdapter)

AdapterFactory.register(MetricDomain.INCIDENT_COUNT, PagerDutyAdapter)
AdapterFactory.register(MetricDomain.INCIDENT_COUNT, OpsGenieAdapter)
AdapterFactory.register(MetricDomain.INCIDENT_COUNT, FirehydrantAdapter)

AdapterFactory.register(MetricDomain.TEAM_VELOCITY, JiraAdapter)
AdapterFactory.register(MetricDomain.TEAM_VELOCITY, LinearAdapter)
AdapterFactory.register(MetricDomain.TEAM_VELOCITY, AzureDevOpsAdapter)

AdapterFactory.register(MetricDomain.RESOURCE_ALLOCATION, WorkdayAdapter)
AdapterFactory.register(MetricDomain.RESOURCE_ALLOCATION, LatticeAdapter)
AdapterFactory.register(MetricDomain.RESOURCE_ALLOCATION, CsvResourceAdapter)