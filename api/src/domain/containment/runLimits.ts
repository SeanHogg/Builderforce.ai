export interface RunLimits {
  maxFiles: number | null;
  maxRepositories: number | null;
  maxSpendMillicents: number | null;
}

export interface RunUsage {
  files: number;
  repositories: number;
  spendMillicents: number;
}

export function checkRunLimits(limits: RunLimits, usage: RunUsage): string | null {
  if (limits.maxFiles != null && usage.files > limits.maxFiles) return `file limit exceeded (${usage.files}/${limits.maxFiles})`;
  if (limits.maxRepositories != null && usage.repositories > limits.maxRepositories) return `repository limit exceeded (${usage.repositories}/${limits.maxRepositories})`;
  if (limits.maxSpendMillicents != null && usage.spendMillicents >= limits.maxSpendMillicents) return `spend limit reached (${usage.spendMillicents}/${limits.maxSpendMillicents} millicents)`;
  return null;
}
