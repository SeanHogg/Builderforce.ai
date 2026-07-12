"""
Version control platform integrators for PR cycle time ingestion.
"""

import json
from datetime import datetime
from typing import Dict, List, Any, Optional
from ...models.eng_health_record import EngHealthRecord, MetricDomain, DataQualityFlag
from ...models.eng_health_record import NormalizedFields


class GithubAdapter(BaseAdapter):
    """
    GitHub adapter for Task Backlog, Bug Count, and PR Cycle Time ingestion.

    Supports:
        - FR-1: Task Backlog (Github Issues)
        - FR-2: Bug Count (Issues with labels/type)
        - FR-3: PR Cycle Time (Pull Requests with cycle time sub-metrics)
    """

    @property
    def metric_domain(self) -> MetricDomain:
        return MetricDomain.TASK_BACKLOG

    def validate_payload(self, payload: Dict[str, Any]) -> bool:
        """Validate GitHub issue/PR payload."""
        return bool(payload.get("id") or payload.get("number"))

    def _extract_normalized_fields(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract normalized fields for GitHub issues/PRs.
        """
        normalized = {
            "item_id": payload.get("number"),
            "item_type": payload.get("pull_request") and "PR" or payload.get("pull_request") and "PullRequest" or "Issue",
            "status": payload.get("state"),
            "priority": payload.get("priority"),
            "story_points": payload.get("points") or payload.get("size"),
            "age_days": self._calculate_age_days(payload),
            "assignee_team": payload.get("assignee", {}).get("username"),
            "target_branch": payload.get("base", {}).get("ref"),
            "lines_changed": payload.get("additions", 0) + payload.get("deletions", 0),
            "review_count": payload.get("review_comments", 0),
            "created_at": payload.get("created_at"),
            "first_review_at": payload.get("reviews", [{}])[0].get("submitted_at") if payload.get("reviews") else None,
            "approved_at": next((r["submitted_at"] for r in payload.get("reviews", []) if r["state"] == "APPROVED"), None),
            "merged_at": payload.get("merged_at"),
            "closed_at": payload.get("closed_at"),
            "created_by_team": payload.get("user", {}).get("login"),
            "labels": payload.get("labels", []),
            "is_bug": self._is_bug(payload),
        }
        return normalized

    def _is_bug(self, payload: Dict[str, Any]) -> bool:
        """Check if payload represents a bug."""
        title = str(payload.get("title", ""))
        labels = [str(l.get("name", "")).lower() for l in payload.get("labels", [])]

        bug_keywords = ["bug", "defect", "issue", "crash", "segfault"]
        label_keywords = ["bug", "bugfix"]

        return any(kw in title.lower() for kw in bug_keywords) or any(kw in " ".join(labels) for kw in label_keywords)

    def _calculate_age_days(self, payload: Dict[str, Any]) -> Optional[float]:
        if "created_at" in payload and isinstance(payload["created_at"], str):
            created = self._parse_timestamp(payload["created_at"])
            if created:
                delta = datetime.utcnow() - created
                return round(delta.total_seconds() / 86400, 1)
        return None

    async def ingest(self, payload: Dict[str, Any], incremental: bool = False) -> EngHealthRecord:
        normalized = self._extract_normalized_fields(payload)
        record = await self.normalize(payload)

        # Inject normalized fields
        record.normalized_fields = {
            **record.normalized_fields,
            **normalized
        }

        # If this is a PR, ensure PR cycle time fields are extracted
        if payload.get("pull_request"):
            record.metric_domain = MetricDomain.PR_CYCLE_TIME

        return record

    async def poll(self, since: Optional[datetime] = None) -> List[EngHealthRecord]:
        """
        Poll GitHub for issues/PRs since the specified timestamp.
        """
        # STUB: Implement actual polling with GitHub API
        return []


class GitLabCIAdapter(BaseAdapter):
    """
    GitLab adapter for PR Cycle Time ingestion.
    """

    @property
    def metric_domain(self) -> MetricDomain:
        return MetricDomain.PR_CYCLE_TIME

    def validate_payload(self, payload: Dict[str, Any]) -> bool:
        """Validate GitLab MR instance."""
        return bool(payload.get("iid"))

    def _extract_normalized_fields(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract normalized fields for GitLab merge requests.
        """
        normalized = {
            "pr_id": payload.get("iid"),
            "item_type": "MR",
            "status": payload.get("state"),
            "priority": payload.get("priority"),
            "lines_changed": payload.get("diffs", []) and sum(len(d.get("old_path", "")[:0]) for d in payload.get("diffs", [])),
            "review_count": 0,  # STUB: Count approvals
            "created_at": payload.get("created_at"),
            "first_review_at": payload.get("updated_at") if payload.get("reactions_total") else None,
            "approved_at": next((a["approved_at"] for a in payload.get("approvals", []) if a["approved"]), None),
            "merged_at": payload.get("merged_at"),
            "closed_at": payload.get("closed_at"),
            "target_branch": payload.get("target_branch"),
            "author_team": payload.get("author").get("username") if payload.get("author") else None,
        }
        return normalized

    async def ingest(self, payload: Dict[str, Any], incremental: bool = False) -> EngHealthRecord:
        normalized = self._extract_normalized_fields(payload)
        record = await self.normalize(payload)
        record.normalized_fields = {
            **record.normalized_fields,
            **normalized
        }
        return record

    async def poll(self, since: Optional[datetime] = None) -> List[EngHealthRecord]:
        """
        Poll GitLab for merge requests since the specified timestamp.
        """
        # STUB: Implement actual polling with GitLab API
        return []


class AzureDevOpsAdapter(BaseAdapter):
    """
    Azure DevOps adapter for Task Backlog, Bug Count, PR Cycle Time, and Team Velocity.
    """

    @property
    def metric_domain(self) -> MetricDomain:
        return MetricDomain.TASK_BACKLOG

    def validate_payload(self, payload: Dict[str, Any]) -> bool:
        """Validate Azure DevOps work item payload."""
        return bool(payload.get("id"))

    def _extract_normalized_fields(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract normalized fields for Azure DevOps work items.
        """
        normalized = {
            "item_id": payload.get("id"),
            "item_type": payload.get("workItemType"),
            "status": payload.get("state"),
            "priority": payload.get("priority"),
            "story_points": payload.get("storyPoints"),
            "assignee_team": payload.get("teams", [{}])[0].get("name") if payload.get("teams") else None,
            "created_at": payload.get("fields", {}).get("System.CreatedDate"),
            "sprint_id": payload.get("fields", {}).get("System.IterationPath"),
            "tags": payload.get("fields", {}).get("System.Tags"),
            "is_bug": payload.get("workItemType", "").upper().endswith("BUG"),
        }
        return normalized

    async def ingest(self, payload: Dict[str, Any], incremental: bool = False) -> EngHealthRecord:
        normalized = self._extract_normalized_fields(payload)
        record = await self.normalize(payload)
        record.normalized_fields = {
            **record.normalized_fields,
            **normalized
        }
        # Map to appropriate domain based on type
        if normalized.get("is_bug"):
            record.metric_domain = MetricDomain.BUG_COUNT
        return record

    async def poll(self, since: Optional[datetime] = None) -> List[EngHealthRecord]:
        """
        Poll Azure DevOps for work items since the specified timestamp.
        """
        # STUB: Implement actual polling with Azure DevOps API
        return []