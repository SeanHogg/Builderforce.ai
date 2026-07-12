/**
 * Red Alert Threshold Configuration Hook (Admin)
 * 
 * FR-4: Authorized users (Admin role) can adjust the Red upper boundary per metric.
 * 
 * Features:
 * - Update Red threshold with validation
 * - Audit logging of threshold changes
 * - Live preview of how values would be reclassified
 * - Threshold persistence across sessions
 */

import { useState, useEffect, useCallback } from 'react';
import { 
  classifyMetric, 
  MetricSeverity, 
  validateThresholdConfig, 
  getDefaultThresholdForMetricType,
  ThresholdConfig,
} from '../utils/redAlertUtils';
import { RED_THEME } from '../styles/color-tokens';

interface MetricConfig {
  metricName: string;
  upperThreshold: number;
  criticalLabel: string;
  allowNegative: boolean;
}

interface ConfigChangeRecord {
  metricName: string;
  oldThreshold: number;
  newThreshold: number;
  timestamp: string;
  actor?: string; // For audit
}

interface PreviewResult {
  /** Would this value be critical? */
  isCritical: boolean;
  /** Manual icon override for testing / testability */
  manualIcon?: 'critical' | 'warning' | 'data';
  /** Simulated classification result */
  classification: MetricSeverity;
}

export function useRedAlertConfigs() {
  // Local storage key for persistence
  const STORAGE_KEY = 'builderforce-red-alert-configs';

  // State
  const [configs, setConfigs] = useState<Map<string, MetricConfig>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load configs from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const loaded = new Map<string, MetricConfig>();
        const parsed = JSON.parse(stored);
        Object.entries(parsed).forEach(([metricName, config]: [string, any]) => {
          // Validate loaded config
          const validation = validateThresholdConfig(config);
          if (validation.valid) {
            loaded.set(metricName, config);
          }
        });
        setConfigs(loaded);
      }
    } catch (e) {
      console.error('Failed to load Red Alert configs:', e);
      setError('Failed to load threshold configurations');
    } finally {
      setLoading(false);
    }
  }, []);

  // Save configs to localStorage
  const saveConfigs = useCallback((newConfigs: Map<string, MetricConfig>) => {
    try {
      const serialized: Record<string, any> = {};
      newConfigs.forEach((config, key) => {
        serialized[key] = config;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
      setConfigs(newConfigs);
    } catch (e) {
      console.error('Failed to save Red Alert configs:', e);
      setError('Failed to save threshold configurations');
    }
  }, []);

  /**
   * Get threshold config for a metric
   */
  const getThresholdConfig = useCallback((
    metricName: string
  ): ThresholdConfig => {
    const config = configs.get(metricName);
    
    if (!config) {
      // Return default config for unknown metrics
      return {
        redUpperThreshold: 49,
        dataFloor: 0,
        allowNegative: false,
        criticalLabel: 'Critical',
      };
    }
    
    return {
      redUpperThreshold: config.upperThreshold,
      dataFloor: 0,
      allowNegative: config.allowNegative,
      criticalLabel: config.criticalLabel || 'Critical',
    };
  }, [configs]);

  /**
   * Update Red upper threshold for a metric (FR-4)
   * 
   * @param metricName - The metric identifier
   * @param newThreshold - New upper threshold (1-99 range)
   * @param metadataChange - Optional metadata for audit logging
   */
  const updateThreshold = useCallback((
    metricName: string,
    newThreshold: number,
    metadataChange?: Partial<ThresholdConfig>
  ): { success: boolean; error?: string; auditLog?: ConfigChangeRecord } => {
    // Validate new threshold
    const validation = validateThresholdConfig({
      redUpperThreshold: newThreshold,
      ...(metadataChange || {}),
    });
    
    if (!validation.valid) {
      const errorMessage = validation.errors.join('; ');
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
    
    // Get current config
    const currentConfig = configs.get(metricName) || getDefaultThresholdForMetricType(metricName);
    const oldThreshold = currentConfig.redUpperThreshold;
    
    // Create new config map
    const newConfigs = new Map(configs);
    newConfigs.set(metricName, {
      metricName,
      upperThreshold: newThreshold,
      criticalLabel: (metadataChange?.criticalLabel as string) || currentConfig.criticalLabel,
      allowNegative: (metadataChange?.allowNegative as boolean) ?? currentConfig.allowNegative,
    });
    
    // Save and log change
    saveConfigs(newConfigs);
    
    // Audit log entry
    const auditLog: ConfigChangeRecord = {
      metricName,
      oldThreshold,
      newThreshold,
      timestamp: new Date().toISOString(),
      actor: metadataChange?.actor,
    };
    
    // NOTE: In a real application, this audit log should be persisted to
    // the audit trail (see project memory: 0287/0295 activity_log).
    // For now, it exists as a structured change log.
    console.log('[Red Alert Config] Threshold updated:', auditLog);
    
    return { success: true, auditLog };
  }, [configs, saveConfigs, setError]);

  /**
   * Delete or reset threshold config for a metric
   */
  const resetThreshold = useCallback((
    metricName: string,
    actor?: string
  ): { success: boolean; auditLog?: ConfigChangeRecord } => {
    const currentConfig = configs.get(metricName);
    
    if (!currentConfig) {
      return { success: false, error: 'No configuration found' };
    }
    
    // Get default config
    const defaultConfig = getDefaultThresholdForMetricType(metricName);
    
    const newConfigs = new Map(configs);
    newConfigs.delete(metricName);
    
    // Save (removes config from storage)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    setConfigs(newConfigs);
    
    // Audit log entry
    const auditLog: ConfigChangeRecord = {
      metricName,
      oldThreshold: currentConfig.upperThreshold,
      newThreshold: defaultConfig.redUpperThreshold,
      timestamp: new Date().toISOString(),
      actor,
    };
    
    console.log('[Red Alert Config] Threshold reset:', auditLog);
    
    return { success: true, auditLog };
  }, [configs]);

  /**
   * Preview how a metric value would be classified with current thresholds
   * 
   * @param metricName - The metric identifier
   * @param value - The metric value to test
   */
  const previewClassification = useCallback((
    metricName: string,
    value: unknown
  ): PreviewResult => {
    const config = getThresholdConfig(metricName);
    const result = classifyMetric(value, config);
    
    return {
      isCritical: result.isRed,
      manualIcon: result.isRed ? 'critical' : (result.isNoData ? 'data' : 'warning'),
      classification: result.severity,
    };
  }, [getThresholdConfig]);

  /**
   * Get cached configs
   */
  const getCachedConfigs = useCallback(() => {
    return configs;
  }, [configs]);

  /**
   * Clear all stored configs (useful for testing or reset)
   */
  const clearAllConfigs = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setConfigs(new Map());
      return { success: true };
    } catch (e) {
      console.error('Failed to clear configs:', e);
      return { success: false, error: 'Failed to clear configurations' };
    }
  }, []);

  return {
    // State
    loading,
    error,
    
    // Data access
    configs,
    getThresholdConfig,
    getCachedConfigs,
    
    // Actions
    updateThreshold,
    resetThreshold,
    previewClassification,
    clearAllConfigs,
  };
}

export default useRedAlertConfigs;