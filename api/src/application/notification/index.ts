/**
 * Daily PM/Lead Notifications Application Services
 * 
 * FR1/SCHED: Daily cron job handler for notifications at 08:50 UTC (FR2)
 * FR4/FR6: DailyNotificationGeneratorService — summarizes new/changed tasks for a given user
 * FR5: NotificationDeliveryService — multi-channel delivery (email, in-app)
 * 
 * NOTE: This module is not yet wired into the Cloudflare Workers ingress.
 * Current stub works via local tests or manual invocation of DailyNotificationCronHandler.
 * 
 * TODO: Wire these services into:
 * - App entry point (api/src/index.ts) for initialization
 * - Cloudflare Workers Scheduler trigger entry point (e.g., api/src/scheduler.ts) for FR1
 * - Configure 08:50 UTC via wrangler.toml cron or Cloudflare Scheduler API
 * 
 * @module notifications
 */

export type { NotificationDeliveryInput } from './NotificationDeliveryService';
export { NotificationDeliveryService } from './NotificationDeliveryService';

export type { DailyNotificationGenerationInput, DailyNotificationGenerationOutput } from './DailyNotificationGeneratorService';
export { DailyNotificationGeneratorService } from './DailyNotificationGeneratorService';

export type { CronContext } from './DailyNotificationCronHandler';
export {
  DailyNotificationCronHandler,
  triggerDailyNotifications,
} from './DailyNotificationCronHandler';