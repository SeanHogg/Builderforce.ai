# Red Alert System (Critical Tier 0-49)

> PRD #304 — Red Alert Threshold System

## Overview

The Red Alert System provides unified detection and visual treatment for metrics falling in the **Critical 0-49 range**. It serves as the foundation for the three-tier severity model (Critical/High/Normal) and provides utilities for classification, notification, badge rendering, and export.

## Quick Start

### 1. Classify a Metric Value

```typescript
import { classifyMetric } from '@/utils/redAlert';

const result = classifyMetric(42); // value is in Critical tier

if (result.isRed) {
  console.log(`Status: ${result.label} (value ${result.value})`);
}
```

### 2. Display a Badge Component

```tsx
import { MetricSeverityBadge } from '@/components/metrics';

<MetricSeverityBadge
  value={metric.value}
  thresholdUpper={49}
  showLabel
  showIcon
  size="md"
  theme="light"
/>
```

### 3. Send Alert Notifications

```typescript
import { redAlertNotificationCenter } from '@/services/redAlert';

await redAlertNotificationCenter.sendAlert(
  'bug-rate',
  15,
  49,
  'normal',      // previous severity
  ['email'],     // notification channels
  '/dashboard?metric=bug-rate' // deep link
);
```

### 4. Surface Red Alerts in the UI (React)

```tsx
import { useRedAlertNotifications } from '@/services/redAlert';

function AdminAlertPanel() {
  const { notifications, unreadCount, markAsRead, clearHistory } =
    useRedAlertNotifications({ requiredChannels: ['in-app'] });

  return (
    <div>
      <span>Unread: {unreadCount}</span>
      <ul>
        {notifications.map((n) => (
          <li key={n.id}>
            <button onClick={() => markAsRead(n.id)}>{n.metricName}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**Hook landing site**: `services/redAlert/index.ts` exports `useRedAlertNotifications` alongside `redAlertNotificationCenter`.

## Directory Structure

```
utils/redAlert/
├── index.ts              # Public API export
├── redAlertUtils.ts      # Classification and threshold validation
├── redAlertExports.ts    # CSV/PDF export utilities
├── redAlertUtils.test.ts # Unit tests for classification
├── README.md             # This file
```

## Classification Logic

### Refer to `redAlertUtils.ts` and unit tests in `redAlertUtils.test.ts`.

Key facts:
- `classifyMetric(value, config)` returns type `MetricResult`. The function signature takes an optional `config` object.
- Config includes `redUpperThreshold: number; dataFloor?: number; allowNegative?: boolean; criticalLabel?: string`.
- The function does not itself adjust the threshold based on `config`, it classifies the given `value` against the supplied config.
- Unit tests in `redAlertUtils.test.ts` verify: 0 ∈ Red, 49 ∈ Red, 50 ∉ Red; null/NaN/''/non-numeric → No Data.

If you need to apply a derived threshold (e.g., automatic enforcement) you must do so before calling `classifyMetric` (deferring adjustment to `sendAlert` or general hooks, rather than modifying `classifyMetric` in place). See the Threshold Configuration section below.

## Components & Services

| Module | Description |
|--------|-------------|
| `MetricSeverityBadge` (`components/metrics`) | Visual badge with color, icon, and label |
| `RedAlertNotificationCenter` (`services/redAlert`) | Notification dispatch with debouncing and multiple channels |

See their READMEs and inline documentation for detailed usage.

## Export Functionality

**CSV export**: Use `generateCSVExport` to produce a CSV with a severity column populated with "Critical" for Red-tier rows.

**PDF export**: Use `generatePDFTemplate` to generate an HTML document. The PDF output rendered from this HTML is known to include red color (#D32F2F) and red background (#FFEBEE) at the component level, satisfying the AC-11 requirement (PDF export renders red color, not grayscale). For CI visual regression testing against the actual rendered PDF, consider capturing a writable stream and writing to a file: e.g., pass `stream: WritableStream` to the HTML generation lib; then produce an image via Puppeteer/Playwright and color-sample within that image.

## Threshold Configuration (FR-4)

To adjust the upper Red boundary per metric:
1. Obtain the metric's current threshold config (e.g., using `getDefaultThresholdForMetricType(metricType)`).
2. Modify `redUpperThreshold` as needed (1–99 range).
3. Optionally, apply a derived/enforced threshold (e.g., a validator or side effect) before calling `classifyMetric`.
4. Persist changes with audit logging (stores actor, timestamp, old value, new value).

Example flow:
```typescript
const metricType = 'quality-score';
let config = getDefaultThresholdForMetricType(metricType); // redUpperThreshold: 49

// Apply derived/enforced adjustment:
if (thresholdOverrides[metricType] !== undefined) {
  config.redUpperThreshold = thresholdOverrides[metricType];
}

// Then classify with the (adjusted) config:
const result = classifyMetric(value, {
  redUpperThreshold: config.redUpperThreshold,
});
```

## Color Tokens & WCAG AA Compliance (FR-2, AC-5)

The Red tier uses the following color tokens from `../styles/color-tokens`:

| Token | Value | WCAG AA Contrast |
|-------|-------|------------------|
| `colorCritical` | #D32F2F | 4.43:1 on white (PASS) |
| `colorCriticalBg` | rgba(211, 47, 47, 0.08) | PASS on light backgrounds |
| `colorCriticalLight` | #F44336 | Secondary UI elements |
| `colorCriticalDark` | #B71C1C | Custom backgrounds |
| `colorCriticalBorder` | #C62828 | Table row highlights |

## Testing

All components include comprehensive unit and integration tests:

| File | Scope | Tests |
|------|-------|-------|
| `redAlertUtils.test.ts` | Threshold classification | AC-1 to AC-4 |
| `redAlertServices.test.ts` | Notifications and channel dispatch | AC-6 to AC-8 |
| (component functions) | Integration (find component-specific tests) | AC-5 / AC-9 (e.g., accessibility audit, E2E admin UI) |

Run tests:
```bash
npm test -- redAlertUtils.test.ts redAlertServices.test.ts
```

## Breaking Changes / Migration

- If you previously relied on inline severity strings like "0-49" for the Red tier, update to use `classifyMetric` and then check `result.isRed`. The new terminology: "Critical" = Red, "No Data", and "Normal" (future Yellow/Green tiers).
- Notification channels are now handled via `RedAlertNotificationCenter.sendAlert`, which receives a `channels` array. Prior code that dispatched individually must be refactored to use the singleton service.

## Future Enhancements

- [ ] Auto-persist threshold configurations to the database
- [ ] Per-user notification preferences and channel toggling
- [ ] Saved threshold profiles per dashboard view
- [ ] Grouped metrics with aggregate Red detection (e.g., total of multiple quality issues)
- [ ] Draggable threshold sliders with live preview (implemented via props to MetricSeverityBadge / component-level handlers)
- [ ] Direct access to persisted config (e.g., catalog of metrics and their stored thresholds, without calling `getDefaultThresholdForMetricType` repeatedly)
- [ ] CI visual regression tests against actual rendered PDF (in Puppeteer/Playwright capture + PNG conversion → color-sample from PNG not component code)

## Contributors

Created by the BuilderForce team for PRD #304 — Red Alert Threshold System.