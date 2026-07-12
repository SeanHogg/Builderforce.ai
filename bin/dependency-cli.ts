#!/usr/bin/env node

/**
 * Dependency Resolution CLI
 *
 * Provides a command-line interface to generate dependency resolution reports,
 * visualize the critical path, and record resolutions.
 */

import * as readline from 'readline';
import { EventEmitter } from 'events';
import { DrizzleD1Database } from 'drizzle-orm/d1';
import type { DependencyResolutionReport } from '../api/src/application/dependency/types.js';

interface CliOptions {
  projectId: number;
  format: 'json' | 'markdown' | 'console';
  output?: string;
  stalenessHours?: number;
}

class DependencyCli extends EventEmitter {
  private projectId: number;
  private format: 'json' | 'markdown' | 'console';
  private output?: string;
  private stalenessHours: number | null;

  constructor(options: CliOptions) {
    super();
    this.projectId = options.projectId;
    this.format = options.format;
    this.output = options.output;
    this.stalenessHours = options.stalenessHours ? options.stalenessHours / 24 : null;
  }

  async execute(): Promise<void> {
    try {
      // Initialize d1
      const d1 = (global as any).DB as DrizzleD1Database;

      // Import after evaluation to avoid circular dependencies
      const { DependencyResolutionService } = await import('../api/src/application/dependency/DependencyResolutionService');

      const db = d1;
      const service = new DependencyResolutionService(db);

      const report = await service.generateReport(this.projectId, this.stalenessHours ?? 3);

      const start = Date.now();

      switch (this.format) {
        case 'json':
          this.emit('data', JSON.stringify(report, null, 2));
          break;

        case 'markdown':
          this.emit('data', this.renderMarkdown(report));
          break;

        case 'console':
          this.emit('data', this.renderConsole(report));
          break;
      }

      const elapsed = Date.now() - start;
      this.emit('end', { elapsed });
    } catch (err) {
      this.emit('error', err);
    }
  }

  private renderMarkdown(report: DependencyResolutionReport): string {
    const lines: string[] = [];

    lines.push(`# Dependency Resolution Report`);
    if (report.countedTasks === 0) {
      lines.push('\n⚠️ No tasks found in the project. Aborting report generation.');
      return lines.join('\n');
    }
    lines.push(`\n**Project ID**: ${report.projectId}`);
    lines.push(`**Total Blockers**: ${report.totalBlockers}`);
    lines.push(`**Critical Path Tasks at Risk**: ${report.criticalPathTasksAtRisk}`);
    lines.push(`**Projected Schedule Slip**: ${report.projectedScheduleSlipDays} days`);

    if (report.rankedBlockers.length > 0) {
      lines.push('\n## 🚨 Critical Blockers');
      lines.push('');

      for (let i = 0; i < report.rankedBlockers.length; i++) {
        const { blocker, dependencyImpactScore, resolutionSuggestions } = report.rankedBlockers[i];
        const speedRank = i + 1;
        const triangle = i === 0 ? '🚩' : i === 1 ? '🥇' : i === 2 ? '🥈' : '🥉';

        lines.push(`### Blocker ${speedRank} — [${blocker.task.title}]\n`);
        lines.push(`> Dependency to: **${blocker.upstreamBlocker?.title}**`);
        lines.push(`> Status: <span style="color: red;">${blocker.isHard ? '🚫 Hard' : '⚠️ Soft'} Blocker</span>`);
        lines.push(`> Stale for: ${blocker.stalenessDays} days`);
        lines.push(`> Impact Score: ${dependencyImpactScore.score} (Size: ${dependencyImpactScore.blockSize}, Slip: ${dependencyImpactScore.totalSlipDays} days, Priority: ${dependencyImpactScore.businessPriorityWeight})`);
        lines.push('');

        lines.push(`#### Suggested Actions`);
        for (let j = 0; j < resolutionSuggestions.length; j++) {
          const suggestion = resolutionSuggestions[j];
          const rank = j + 1;
          lines.push(`${j === 0 ? '-' : rank}. **${suggestion.category.toUpperCase()}** — ${suggestion.description}`);
          lines.push(`   • Owner: ${suggestion.suggestedOwner}`);
          lines.push(`   • Time to unblock: ${suggestion.estimatedTimeToUnblockMinutes} min`);
          lines.push(`   • Confidence: ${suggestion.confidence}`);
          lines.push(`   • Rationale: ${suggestion.rationale}`);
        }
        lines.push('');
      }

      lines.push(`## 📊 Dependency Impact Summary`);
      lines.push('');
      lines.push('| Upstream Task | Affected Size | Schedule Slip | Priority Weight | Impact Score |');
      lines.push('|---------------|--------------|---------------|-----------------|--------------|');

      const sortedByScore = [...report.rankedBlockers].sort((a, b) =>
        b.dependencyImpactScore.score - a.dependencyImpactScore.score
      );

      for (const item of sortedByScore) {
        const { blocker, dependencyImpactScore } = item;
        const upstreamTitle = blocker.upstreamBlocker?.title || 'N/A';
        lines.push('| ' + upstreamTitle.substr(0, 30) + ' | ' +
          dependencyImpactScore.blockSize + ' | ' +
          dependencyImpactScore.totalSlipDays + ' | ' +
          dependencyImpactScore.businessPriorityWeight + ' | ' +
          dependencyImpactScore.score + ' |'
        );
      }
      lines.push('');
    } else {
      lines.push('\n✅ No blockers detected on the critical path.');
    }

    lines.push(`## 📦 Task Graph`);
    lines.push('\n```mermaid\n' + report.mermaidDiagram + '\n```\n');

    return lines.join('\n');
  }

  private renderConsole(report: DependencyResolutionReport): string {
    const lines: string[] = [];
    lines.push('╔════════════════════════════════════════════════════════════════╗');
    lines.push('║          DEPENDENCY RESOLUTION REPORT                          ║');
    lines.push('╚════════════════════════════════════════════════════════════════╝');
    lines.push('');

    lines.push(`Project ID          : ${report.projectId}`);
    lines.push(`Total Blockers      : ${report.totalBlockers}`);
    lines.push(`Critical Path at Risk: ${report.criticalPathTasksAtRisk}`);
    lines.push(`Projected Slip      : ${report.projectedScheduleSlipDays} days`);
    lines.push('');

    for (let i = 0; i < report.rankedBlockers.length; i++) {
      const { blocker, dependencyImpactScore } = report.rankedBlockers[i];
      const rank = i + 1;

      lines.push(`[${i === 0 ? '🚩' : i === 1 ? '🥇' : i === 2 ? '🥈' : '🥉'}] Blocker #${rank}: ${blocker.task.title}`);
      lines.push(`       → Upstream: ${blocker.upstreamBlocker?.title}`);
      lines.push(`       → Type: ${blocker.isHard ? 'Hard' : 'Soft'} Blocker`);
      lines.push(`       → Stale: ${blocker.stalenessDays} days`);
      lines.push(`       → Impact Score: ${dependencyImpactScore.score}`);
      lines.push(`       → Affected Tasks: ${dependencyImpactScore.blockSize}`);
      lines.push(`       → Estimated Slip: ${dependencyImpactScore.totalSlipDays} days`);
      lines.push('');
    }

    lines.push(drawLine(report.mermaidDiagram));

    return lines.join('\n');
  }

  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function drawLine(text: string): string {
  // Count characters in the first line (simplified)
  const lineCount = text.split('\n').length;
  const padding = 10 + 4 + 52; // Fixed prefix width
  const border = '═'.repeat(padding);
  return border;
}

let cliInstance: DependencyCli | null = null;

async function runCli(options: CliOptions): Promise<void> {
  if (!cliInstance) {
    cliInstance = new DependencyCli(options);
  }

  await cliInstance.execute();
}

rl.on('close', () => {
  // Cleanup
});

export { DependencyCli, runCli };