/**
 * Unit Tests for Red Alert Notification Service
 * 
 * Tests FR-3 to FR-4 (alerting, notifications, threshold configuration)
 * and AC-6 to AC-8 (notification dispatch, cooldown, payload validation)
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  RedAlertNotificationCenter,
  MetricSeverity,
} from './redAlertServices';

describe('Red Alert Notification Service', () => {
  let notificationCenter: RedAlertNotificationCenter;

  beforeEach(() => {
    notificationCenter = RedAlertNotificationCenter.getInstance();
  });

  afterEach(() => {
    notificationCenter.clearAlertState();
  });

  describe('AC-6 & AC-7: Notification dispatch and cooldown', () => {
    it('sends alert within 30-minute cooldown (AC-6)', async () => {
      const mockCallback = jest.fn();
      
      // Mock the channel dispatchers to capture which one was called
      notificationCenter['dispatchInApp'] = jest.fn(() => Promise.resolve({
        id: 'alert-1',
        metricName: 'test-metric',
        timestamp: new Date().toISOString(),
        payload: {} as any,
        channel: 'in-app' as const,
        deliveredAt: new Date().toISOString(),
      }));

      const result = await notificationCenter.sendAlert(
        'test-metric',
        42,
        49,
        'normal',
        ['in-app']
      );

      expect(result).not.toBeNull();
      expect(result?.channel).toBe('in-app');
    });

    it('does not send duplicate notification within 30-minute cooldown (AC-7)', async () => {
      // First notification
      const result1 = await notificationCenter.sendAlert(
        'test-metric',
        35,
        49,
        'normal',
        ['in-app']
      );

      // Second notification immediately after (should be debounced)
      const result2 = await notificationCenter.sendAlert(
        'test-metric',
        33,
        49,
        'critical',
        ['in-app']
      );

      // Should only return the first one (or null if debounced)
      // This tests that duplicate notifications are prevented
      const history = notificationCenter.getAlertHistory('test-metric');
      
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(result2).toBeNull();
    });

    it('sends notification after 30-minute cooldown expires', async () => {
      // Wait for 30+ minutes (in test simulation)
      await new Promise(resolve => setTimeout(resolve, 31 * 60 * 1000 + 1000));

      const result = await notificationCenter.sendAlert(
        'cooldown-metric',
        25,
        49,
        'normal',
        ['in-app']
      );

      expect(result).not.toBeNull();
    });
  });

  describe('AC-8: Notification payload structure', () => {
    it('includes metric name in payload', async () => {
      const result = await notificationCenter.sendAlert(
        'defect-density',
        15,
        49,
        'normal',
        ['in-app']
      );

      expect(result?.payload.metricName).toBe('defect-density');
    });

    it('includes current value in payload', async () => {
      const result = await notificationCenter.sendAlert(
        'defect-density',
        15,
        49,
        'normal',
        ['in-app']
      );

      expect(result?.payload.currentValue).toBe(15);
    });

    it('includes timestamp in payload', async () => {
      const result = await notificationCenter.sendAlert(
        'test-metric',
        42,
        49,
        'normal',
        ['in-app']
      );

      expect(result?.payload.timestamp).toBeDefined();
      expect(typeof result?.payload.timestamp).toBe('string');
    });

    it('includes deep link in payload if provided', async () => {
      const deepLink = '/dashboard?metric=test-metric';
      const result = await notificationCenter.sendAlert(
        'test-metric',
        44,
        49,
        'normal',
        ['in-app'],
        deepLink
      );

      expect(result?.payload.deepLink).toBe(deepLink);
    });

    it('includes site URL in payload', async () => {
      global.location = { origin: 'https://builderforce.ai' } as any;
      
      const result = await notificationCenter.sendAlert(
        'test-metric',
        40,
        49,
        'normal',
        ['in-app']
      );

      expect(result?.payload.siteUrl).toBe('https://builderforce.ai');
    });
  });

  describe('Multiple notification channels (FR-3)', () => {
    it('can send to multiple channels simultaneously', async () => {
      notificationCenter['dispatchInApp'] = jest.fn(() => Promise.resolve({
        id: 'alert-1', metricName: 'test', timestamp: new Date().toISOString(),
        payload: {} as any, channel: 'in-app' as const, deliveredAt: new Date().toISOString(),
      }));
      notificationCenter['dispatchEmail'] = jest.fn(() => Promise.resolve({
        id: 'alert-2', metricName: 'test', timestamp: new Date().toISOString(),
        payload: {} as any, channel: 'email' as const, deliveredAt: new Date().toISOString(),
      }));
      notificationCenter['dispatchWebhook'] = jest.fn(() => Promise.resolve({
        id: 'alert-3', metricName: 'test', timestamp: new Date().toISOString(),
        payload: {} as any, channel: 'webhook' as const, deliveredAt: new Date().toISOString(),
      }));

      const result = await notificationCenter.sendAlert(
        'multi-channel-metric',
        38,
        49,
        'normal',
        ['in-app', 'email', 'webhook']
      );

      expect(notificationCenter['dispatchInApp']).toHaveBeenCalled();
      expect(notificationCenter['dispatchEmail']).toHaveBeenCalled();
      expect(notificationCenter['dispatchWebhook']).toHaveBeenCalled();
    });
  });

  describe('Alert history management', () => {
    it('stores alerts and returns history for specific metric', () => {
      notificationCenter.sendAlert('metric1', 42, 49, 'normal', ['in-app']);
      notificationCenter.sendAlert('metric1', 30, 49, 'normal', ['in-app']);
      notificationCenter.sendAlert('metric2', 55, 49, 'normal', ['in-app']);

      const metric1History = notificationCenter.getAlertHistory('metric1');
      const metric2History = notificationCenter.getAlertHistory('metric2');

      expect(metric1History.length).toBe(2);
      expect(metric2History.length).toBe(1);
      expect(metric1History[0].metricName).toBe('metric1');
      expect(metric2History[0].metricName).toBe('metric2');
    });

    it('returns all recent alerts across all metrics', () => {
      notificationCenter.sendAlert('metric1', 42, 49, 'normal', ['in-app']);
      notificationCenter.sendAlert('metric2', 30, 49, 'normal', ['in-app']);

      const allAlerts = notificationCenter.getAllRecentAlerts(10);
      expect(allAlerts.length).toBe(2);
    });

    it('keeps only the last 100 alerts (memory management)', () => {
      // Simulate 150 alerts in quick succession
      for (let i = 0; i < 150; i++) {
        notificationCenter.sendAlert(`metric-${i}`, 30 + (i % 20), 49, 'normal', ['in-app']);
      }

      const allAlerts = notificationCenter.getAllRecentAlerts();
      expect(allAlerts.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Alert read states', () => {
    it('marks alert as read when requested', () => {
      notificationCenter.sendAlert('metric1', 42, 49, 'normal', ['in-app']);
      const alerts = notificationCenter.getAllRecentAlerts();
      const alertId = alerts[0]?.id;

      if (alertId) {
        notificationCenter.markAsRead(alertId);
      }

      const alert = notificationCenter.getAlertHistory('metric1')[0];
      expect(alert?.readAt).toBeDefined();
      expect(typeof alert?.readAt).toBe('string');
    });

    it('returns unread alert count', () => {
      notificationCenter.sendAlert('metric1', 42, 49, 'normal', ['in-app']);
      notificationCenter.sendAlert('metric2', 30, 49, 'normal', ['in-app']);
      
      notificationCenter.markAsRead(notificationCenter.getAlertHistory('metric1')[0]!.id!);

      const unreadCount = notificationCenter.getUnreadCount();
      expect(unreadCount).toBe(1);
    });
  });

  describe('Edge cases', () => {
    it('returns null when metric is not in Red tier', async () => {
      const result = await notificationCenter.sendAlert(
        'no-alert-metric',
        85,
        49,
        'normal',
        ['in-app']
      );

      expect(result).toBeNull();
    });

    it('returns null when value is null or No Data', async () => {
      const result1 = await notificationCenter.sendAlert(
        'no-data-metric',
        null as any,
        49,
        'normal',
        ['in-app']
      );

      const result2 = await notificationCenter.sendAlert(
        'no-data-metric',
        55,
        49,
        'normal',
        ['in-app']
      );

      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });

    it('forces first notification when previously in No Data state (initial entry)', async () => {
      // This is the first metric mention - treat as entering Red from No Data for telemetry/diagnostics
      notificationCenter.sendAlert(
        'initial-metric',
        20,
        49,
        'normal', // Treating normal as a baseline to avoid updating previousSeverity manually for parity with telemetry bug fix
        ['in-app']
      );

      const history = notificationCenter.getAlertHistory('initial-metric');
      expect(history.length).toBeGreaterThanOrEqual(1);
    });
  });
});