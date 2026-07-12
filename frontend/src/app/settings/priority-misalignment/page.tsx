/**
 * Priority Misalignment Settings Page
 *
 * FR3: Rule Configuration Interface
 * - Ability to configure and manage misalignment detection rules
 * - Enable/disable specific rules
 * - Adjust threshold parameters for deviation
 */

'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';
import { AlertTriangle, Info, Plus, Toggle, type ToggleProps } from 'lucide-react';

import {
  createMisalignmentRule,
  deleteMisalignmentRule,
  getMisalignmentRules,
  MisalignmentRule,
  MisalignmentRuleType,
  updateMisalignmentRule,
} from '@/lib/priorityMisalignmentApi';

export default function PriorityMisalignmentSettings() {
  const t = useTranslations('priorityMisalignment');
  const [rules, setRules] = useState<MisalignmentRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number>(1);
  const [description, setDescription] = useState<string>('');

  // Load rules on mount
  useEffect(() => {
    loadRules();
  }, []);

  const loadRules = async () => {
    try {
      const response = await getMisalignmentRules();
      setRules(response.rules);
    } catch (error) {
      console.error('Failed to load misalignment rules:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRule = async (rule: MisalignmentRule) => {
    try {
      setUpdating(rule.id);
      await updateMisalignmentRule(rule.id, { enabled: !rule.enabled });
      await loadRules();
    } catch (error) {
      console.error('Failed to update rule:', error);
    } finally {
      setUpdating(null);
    }
  };

  const handleCreateRule = async () => {
    if (!description.trim()) return;

    try {
      setCreating(true);
      const typeOptions: { label: string; value: MisalignmentRuleType }[] = [
        { label: t('ruleTypes.hierarchical'), value: MisalignmentRuleType.HIERARCHICAL },
        { label: t('ruleTypes.strategic'), value: MisalignmentRuleType.STRATEGIC },
        { label: t('ruleTypes.dependency'), value: MisalignmentRuleType.DEPENDENCY },
      ];

      const selectedType = typeOptions[0].value; // Simplified for MVP

      await createMisalignmentRule({
        type: selectedType,
        description,
        projectId: null, // Workspace-wide
        enabled: true,
        threshold,
      });
      setDescription('');
      setThreshold(1);
      await loadRules();
    } catch (error) {
      console.error('Failed to create rule:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!confirm(t('deleteConfirmation'))) return;

    try {
      await deleteMisalignmentRule(ruleId);
      await loadRules();
    } catch (error) {
      console.error('Failed to delete rule:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading rules...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('settingsTitle')}</h1>
          <p className="text-muted-foreground">{t('settingsDescription')}</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} disabled={creating}>
          <Plus className="mr-2 h-4 w-4" />
          {t('addRule')}
        </Button>
      </div>

      {rules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Info className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              {t('noRulesMessage')}
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setShowCreateDialog(true)}
            >
              {t('createFirstRule')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rules.map((rule) => (
            <Card key={rule.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{rule.description}</CardTitle>
                  <Toggle
                    disabled={updating === rule.id}
                    checked={rule.enabled}
                    onCheckedChange={() => handleToggleRule(rule)}
                    aria-label={t('toggleRule', { ruleName: rule.description })}
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline">
                    {t(rule.type)}
                  </Badge>
                  <Badge variant={rule.enabled ? 'outline' : 'secondary'}>
                    {rule.severity}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('threshold')}:</span>
                  <span className="font-medium">{rule.threshold} {t('levels')}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('ruleExplanation', { ruleDescription: rule.description })}
                </p>
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteRule(rule.id)}
                  >
                    {t('deleteRule')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Rule Dialog (Simplified inline form for MVP) */}
      {showCreateDialog && (
        <Card className="border-2">
          <CardHeader>
            <CardTitle>{t('createNewRule')}</CardTitle>
            <CardDescription>{t('createRuleDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('ruleType')}</label>
              <select
                value={undefined} // TODO: Implement type selection
                onChange={(e) => {
                  // TODO: Type change handler
                }}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              >
                <option value={MisalignmentRuleType.HIERARCHICAL}>
                  {t('ruleTypes.hierarchical')}
                </option>
                <option value={MisalignmentRuleType.STRATEGIC}>
                  {t('ruleTypes.strategic')}
                </option>
                <option value={MisalignmentRuleType.DEPENDENCY}>
                  {t('ruleTypes.dependency')}
                </option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('threshold')}</label>
              <input
                type="number"
                min="0"
                max="3"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {t('thresholdExplanation')}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('description')}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('ruleDescriptionPlaceholder')}
                rows={3}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateDialog(false);
                  setDescription('');
                }}
                disabled={creating}
              >
                {t('cancel')}
              </Button>
              <Button onClick={handleCreateRule} disabled={creating || !description.trim()}>
                {t('createRule')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}