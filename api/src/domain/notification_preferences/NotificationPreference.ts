import { TenantId, UserId } from '../shared/types';

/**
 * NotificationPreference entity
 * 
 * FR3: User Role-Based Preferences
 * Tracks per-user notification settings for PMs and Leads:
 * - enabled: opted-in/out
 * - delivery_channels: email, in-app, slack
 * - send_time_utc: configured time (default 08:50 UTC, FR2)
 * - timezone: user's local timezone for AC1 (local delivery before 9AM)
 * - priority_filter: level-specific filters
 * - max_tasks: limit to prevent overload
 */
export interface NotificationPreferenceProps {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  enabled: boolean;
  /** 
   * Delivery channel preferences
   * @default {'email': true, 'in_app': true, 'slack': false}
   */
  deliveryChannels: { email: boolean; in_app: boolean; slack: boolean };
  /** 
   * Type of notification
   */
  notificationKind: 'pm_daily' | 'lead_daily';
  /** Time in HH:MM format (default '08:50' per FR2) */
  sendTimeUtc: string;
  /** Desired user timezone for local delivery time calculation */
  timezone: string;
  /** Priority filters (null = all) */
  priorityFilter: { high: boolean; medium: boolean; low: boolean } | null;
  /** Limit number of tasks per notification */
  maxTasks: number;
  /** Active status */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class NotificationPreference {
  private constructor(private readonly props: NotificationPreferenceProps) {}

  static create(
    props: Omit<NotificationPreferenceProps, 'id' | 'createdAt' | 'updatedAt'>,
  ): NotificationPreference {
    return new NotificationPreference({
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...props,
    });
  }

  static reconstitute(props: NotificationPreferenceProps): NotificationPreference {
    return new NotificationPreference(props);
  }

  // ------------------------------------------------------------------
  // Accessors
  // ------------------------------------------------------------------

  get id(): string {
    return this.props.id;
  }

  get tenantId(): TenantId {
    return this.props.tenantId;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get enabled(): boolean {
    return this.props.enabled;
  }

  get deliveryChannels(): NotificationPreferenceProps['deliveryChannels'] {
    return this.props.deliveryChannels;
  }

  get notificationKind(): NotificationPreferenceProps['notificationKind'] {
    return this.props.notificationKind;
  }

  get sendTimeUtc(): string {
    return this.props.sendTimeUtc;
  }

  get timezone(): string {
    return this.props.timezone;
  }

  get priorityFilter(): NotificationPreferenceProps['priorityFilter'] {
    return this.props.priorityFilter;
  }

  get maxTasks(): number {
    return this.props.maxTasks;
  }

  get active(): boolean {
    return this.props.active;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // ------------------------------------------------------------------
  // Behaviours
  // ------------------------------------------------------------------

  enable(): NotificationPreference {
    return this.update({ enabled: true, active: true });
  }

  disable(): NotificationPreference {
    return this.update({ enabled: false });
  }

  setActive(active: boolean): NotificationPreference {
    return this.update({ active });
  }

  updateDeliveryChannels(
    channels: { email: boolean; in_app: boolean; slack: boolean },
  ): NotificationPreference {
    return this.update({ deliveryChannels: channels });
  }

  updateSendTime(sendTimeUtc: string): NotificationPreference {
    return this.update({ sendTimeUtc });
  }

  updateMaxTasks(maxTasks: number): NotificationPreference {
    if (maxTasks < 1) throw new Error('maxTasks must be at least 1');
    return this.update({ maxTasks });
  }

  private update(updates: Partial<NotificationPreferenceProps>): NotificationPreference {
    return new NotificationPreference({
      ...this.props,
      ...updates,
      updatedAt: new Date(),
    });
  }
}