/**
 * Seed the Integration Gap Catalog with v1 baseline checks.
 *
 * This table is configuration-driven; new checks can be added via direct
 * SQL/management tool without a platform release.
 */

export const KNOWN_GAP_SEEDS = [
  // GitHub
  {
    provider: 'github',
    slug: 'no_push_or_deployment_webhook',
    name: "GitHub: No 'push' or 'deployment' webhook configured",
    description:
      "Your connected GitHub organization has no 'push' or 'deployment' webhooks registered. Deploy events will not reach BuilderForce, preventing automatic deployment orchestration.",
    severity: 'critical',
    category: 'missing_webhook',
    remediation_url: 'https://github.com/settings/hooks',
    api_signal_used: 'GitHub API: GET /repos/:id/hooks',
  },
  {
    provider: 'github',
    slug: 'github_webhook_secret_not_set',
    name: "GitHub: Webhook secret not set",
    description:
      "The webhooks configured for this GitHub repository are missing a secret. This exposes payload content to any service that can trigger a webhook, reducing security guarantees.",
    severity: 'critical',
    category: 'missing_permission',
    remediation_url: 'https://github.com/settings/hooks',
    api_signal_used: 'GitHub API: GET /repos/:id/hooks',
  },
  {
    provider: 'github',
    slug: 'repo_pull_request_webhook_missing',
    name: "GitHub: 'pull_request' webhook missing",
    description:
      "A 'pull_request' webhook is missing for this repository. Changes submitted via pull requests may not trigger expected automations (e.g., CI builds, change promotion).",
    severity: 'warning',
    category: 'missing_webhook',
    api_signal_used: 'GitHub API: GET /repos/:id/hooks',
  },

  // GitHub Actions
  {
    provider: 'github_actions',
    slug: 'actions_no_workflow_connected',
    name: "GitHub Actions: No workflow connected to a monitored repo",
    description:
      "GitHub Workflows are defined but not explicitly connected to monitored repositories via BuilderForce's source control integration. This may miss intended deployment or build events.",
    severity: 'warning',
    category: 'misconfiguration',
    api_signal_used: 'GitHub API: GET /repos/:id/actions/workflows',
  },

  // AWS
  {
    provider: 'aws',
    slug: 'aws_no_cloudtrail_destination',
    name: "AWS: No CloudTrail log destination configured",
    description:
      "AWS CloudTrail trails are not configured to forward log events to a monitoring or storage location (e.g., S3, CloudWatch Logs). This may prevent audit visibility.",
    severity: 'critical',
    category: 'misconfiguration',
    remediation_url: 'https://console.aws.amazon.com/cloudtrail/home',
    api_signal_used: 'AWS API: ListAllTrails',
  },
  {
    provider: 'aws',
    slug: 'aws_cost_anomaly_alert_threshold_not_set',
    name: "AWS: Cost anomaly alert threshold not set",
    description:
      "AWS Cost Anomaly Detection notifications are not configured. Unusual spending may not be surfaced in time for timely remediation.",
    severity: 'warning',
    category: 'misconfiguration',
    remediation_url: 'https://console.aws.amazon.com/home?region=us-east-1#CostAnomalyDetection',
    api_signal_used: 'AWS Cost Explorer API: GetAnomalySubscriptions',
  },

  // PagerDuty
  {
    provider: 'pagerduty',
    slug: 'no_escalation_policy_linked',
    name: "PagerDuty: No escalation policy linked to this service",
    description:
      "There are no escalation policies linked to the configured PagerDuty services. High-severity incidents may not be routed appropriately.",
    severity: 'critical',
    category: 'misconfiguration',
    remediation_url: 'https://support.pagerduty.com/docs/escalation-policies',
    api_signal_used: 'PagerDuty API: ListServices',
  },

  // Slack
  {
    provider: 'slack',
    slug: 'slack_no_channel_mapped_alert_rule',
    name: "Slack: No channel mapped to any alert rule",
    description:
      "No Slack channel is mapped to incident or alert rules. PagerDuty/Opsgenie triggers will not post to a configured notification channel.",
    severity: 'critical',
    category: 'incomplete_routing',
    remediation_url: 'Slack: Configure #incident-notifications and Map Integration/Rule',
    api_signal_used: 'Slack API: ListConversations',
  },
  {
    provider: 'slack',
    slug: 'slack_bot_token_missing_channel_scope',
    name: "Slack: Bot token missing 'channels:read' (or relevant) permissions",
    description:
      "The Slack integration token is missing the required channel-read scope. It will not be able to subscribe channels or display alerts.",
    severity: 'critical',
    category: 'missing_permission',
    remediation_url: 'Slack: OAuth Scopes in App Settings > Permissions',
    api_signal_used: 'Slack API: Auth.test',
  },

  // CI/CD placeholders until domain team provides concrete entries
  {
    provider: 'circleci',
    slug: 'ci_no_workflow_active',
    name: "CircleCI: No active workflow/monitor connected",
    severity: 'informational',
    category: 'misconfiguration',
    api_signal_used: 'CircleCI API: List project workflows',
  },
  {
    provider: 'jenkins',
    slug: 'jenkins_no_build_monitor',
    name: "Jenkins: No build monitoring configured",
    severity: 'informational',
    category: 'misconfiguration',
    api_signal_used: 'Jenkins REST API: List jobs (computable if accessible)',
  },

  // Placeholder for GCP
  {
    provider: 'gcp',
    slug: 'gcp_metrics_sink_not_set',
    name: "GCP: No Cloud Monitoring Logging Agent or MetricsSink configured",
    severity: 'informational',
    category: 'misconfiguration',
    api_signal_used: 'GCP Monitoring API: List NamedLocations',
  },
  {
    provider: 'azure',
    slug: 'azure_activity_log_sink_not_set',
    name: "Azure: No Diagnostic Settings to sink activity/alerts",
    severity: 'warning',
    category: 'misconfiguration',
    api_signal_used: 'Azure Monitor API: List Diagnostic Settings',
  },
];

/**
 * Idempotent seeding function. To run this in production, you must have access
 * to execute the seed script against the DB. Until then, the catalog table is
 * schema-rooted and ready, and seeds can be applied manually or via a separate
 * deploy step that runs the seeding function.
 */
export async function seedGapCatalog(): Promise<number> {
  console.log('Seed function (seedGapCatalog) is available but not executed. To seed the catalog manually, run the seeding function or apply INSERTs directly from KNOWN_GAP_SEEDS.');
  return KNOWN_GAP_SEEDS.length; // placeholder count
}