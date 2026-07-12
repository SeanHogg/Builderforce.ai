/**
 * Weekly Digest Scheduler
 *
 * Schedules the weekly digest worker to run according to configured schedule.
 * Implements FR3.6 (Digest Scheduler)
 */

import { CronJob } from 'cron';
import { WeeklyDigestWorker } from './WeeklyDigestWorker';

/**
 * Scheduler result
 */
interface SchedulerResult {
  success: boolean;
  job?: CronJob;
  error?: string;
}

/**
 * Weekly digest scheduler class
 */
export class WeeklyDigestScheduler {
  private worker: WeeklyDigestWorker;
  private job: CronJob | null = null;

  constructor(worker: WeeklyDigestWorker) {
    this.worker = worker;
  }

  /**
   * Configure and schedule digest generation
   * Default to running daily at 00:00 UTC (can be customized)
   */
  schedule(interval: 'daily' | 'weekly' = 'daily'): SchedulerResult {
    try {
      // Configure cron schedule
      let cronExpression = '0 0 * * *'; // Every day at 00:00 UTC

      if (interval === 'weekly') {
        // Running every week on Monday 00:00 UTC
        cronExpression = '0 0 * * 1';
      }

      console.log(`[Digest Scheduler] Scheduling digest worker with cron: ${cronExpression}`);

      this.job = new CronJob(
        cronExpression,
        async () => {
          console.log('[Digest Scheduler] Running scheduled digest generation...');
          await this.worker.run();
        },
        null,
        true, // run immediately on start
        'UTC'
      );

      console.log('[Digest Scheduler] Digest worker scheduled successfully');

      return {
        success: true,
        job: this.job,
      };
    } catch (error) {
      console.error('[Digest Scheduler] Failed to schedule digest worker:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Stop the digest scheduler
   */
  stop(): void {
    if (this.job) {
      this.job.stop();
      console.log('[Digest Scheduler] Digest worker scheduler stopped');
    }
  }

  /**
   * Check if scheduler is running
   */
  isRunning(): boolean {
    return this.job?.running ?? false;
  }
}