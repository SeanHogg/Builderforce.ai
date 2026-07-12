# Data Completeness Extension

A reusable data completeness scoring engine (0–100%) for BuilderForce agents. This extension calculates record-level and dataset-level completeness scores with configurable field weights, placeholder detection, and alert thresholds.

## Features

- **Record-level scoring**: Assign completeness scores (0–100%) to individual JSON objects
- **Dataset-level aggregation**: Compute overall, min, max, stdDev, and per-field metrics for collections of records
- **Configurable field weighting**: Prioritize critical fields by assigning non-zero weights
- **Placeholder detection**: Recognize common missing-value indicators (e.g., "N/A", "unknown")
- **Thresholds & tiers**: Automatic categorization into `critical` (<50%), `warning` (50–79%), or `passing` (≥80%)
- **Batch processing**: Supports efficient processing of large datasets while respecting memory constraints

## Installation

Enable the extension in your BuilderForce agent configuration:

```json
{
  "data-completeness": {
    "placeholders": ["N/A", "unknown", "-"],
    "thresholds": {
      "critical": 50,
      "warning": 50,
      "passing": 80
    }
  }
}
```

### Configuration Schema

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `placeholders` | string[] | `["N/A", "n/a", "unknown", "Unknown", "NA", "na", "-", "NULL", "null", "", "  "]` | List of values considered missing |
| `thresholds.critical` | number | 50 | Score below which record/dataset is "critical" |
| `thresholds.warning` | number | 50 | Score gap between critical and warning |
| `thresholds.passing` | number | 80 | Score at which record/dataset is "passing" |

## Usage

### Calling the Tool

Agents can call `score_data_completeness` with JSON input:

```typescript
import { ToolHandlerContext } from "@seanhogg/builderforce-agents/plugin-sdk";

const result = await toolHandler({
  tool: "score_data_completeness",
  parameters: {
    data: JSON.stringify({
      name: "John Doe",
      email: "john@example.com",
      age: 30,
      phone: null
    }),
    fieldWeightsJson: JSON.stringify({
      name: 1,
      email: 1,
      age: 1,
      phone: 2 // Higher weight for phone (more critical)
    }),
    placeholdersJson: JSON.stringify(["N/A", "null", ""]),
    thresholdsJson: JSON.stringify({
      critical: 50,
      warning: 50,
      passing: 80
    })
  }
});
```

### For Single Records

When `data` is a single JSON object:

```json
{
  "data": "{\"name\":\"Alice\",\"email\":\"alice@example.com\",\"age\":30}",
  "fieldWeightsJson": "{\"name\":1,\"email\":1,\"age\":1}"
}
```

**Response (single record package format):**
```json
{
  "score": 100,
  "tier": "passing",
  "missingFields": [],
  "topFieldGaps": [],
  "rawData": { "name": "Alice", "email": "alice@example.com", "age": 30 }
}
```

### For Datasets (Record Arrays)

When `data` is a JSON array:

```json
{
  "data": "[{\"name\":\"Alice\",\"age\":30},{\"name\":null,\"age\":null}]"
}
```

**Response (dataset aggregated format):**
```json
{
  "overallScore": 50,
  "minScore": 50,
  "maxScore": 100,
  "stdDev": 14.14,
  "perFieldCompleteness": {
    "name": { "totalCount": 2, "completedCount": 1, "completionRate": 50 },
    "age": { "totalCount": 2, "completedCount": 2, "completionRate": 100 }
  },
  "recordScores": [100, 0],
  "summary": {
    "criticalCount": 0,
    "warningCount": 0,
    "passingCount": 1,
    "avgScore": 50
  }
}
```

## Scoring Formula

For a record's score:

```
score = (Σ weight_i × present_i) / (Σ weight_i) × 100

where:
  weight_i = configured weight for field i (default: 1.0)
  present_i = 1 if field is non-null, non-empty, not placeholder
             = 0 if field is missing/empty/placeholder
```

### Examples

- **All fields present (5 fields, weight 1 each)**: `(1+1+1+1+1) / 5 × 100 = 100`
- **1 field present (weight 2), 4 zero-weight fields missing**: `(2) / (2+0+0+0+0) × 100 = 100`
- **1 field present (weight 2), 4 weight-1 fields missing**: `(2) / (2+1+1+1+1) × 100 ≈ 33.33`

## Threshold Tiers

| Tier | Minimum Score | Action |
|------|---------------|--------|
| `critical` | < 50 | Immediate attention required; automation gate |
| `warning` | 50–79 | Monitor progress; may require data enrichment |
| `passing` | ≥ 80 | Acceptable quality; proceed with confidence |

## Output Format

### Single Record (`RecordScoreData`)

```typescript
{
  score: number;                            // 0–100
  tier: "critical" | "warning" | "passing";
  missingFields: Array<{                   // Fields contributing 0 weight
    name: string;
    weight: number;
  }>;
  topFieldGaps: Array<{                     // Ranked by impact
    field: string;
    weight: number;
    impact: number;
  }>;
  rawData: object;                          // Original input
}
```

### Dataset (`DatasetReport`)

```typescript
{
  overallScore: number;                     // Mean of all scores (±0.01%)
  minScore: number;
  maxScore: number;
  stdDev: number;                           // Standard deviation
  perFieldCompleteness: Record<string, {
    totalCount: number;
    completedCount: number;
    completionRate: number;                 // ±0.1%
  }>;
  recordScores: Array<RecordScoreData>;
  summary: {
    criticalCount: number;                  # Records at critical tier
    warningCount: number;                   # Records at warning tier
    passingCount: number;                   # Records at passing tier
    avgScore: number;
  };
}
```

## Design Decisions & Out of Scope

| Aspect | Decision |
|--------|----------|
| **Data repair** | Engine only scores; does not impute missing values |
| **Schema inference** | Fields must be explicitly specified in config |
| **Type validation** | Values are present unless they match placeholder patterns (type mismatches counted as present) |
| **Deduplication** | Records scored independently; de-duplication is a downstream concern |
| **UI/Dashboards** | Visualizations are downstream consumers; API-first design |
| **PII detection** | Handled externally; scoring ignores PPI semantics |
| **Stream processing** | Batch và on-demand; native Kafka/Flink integration is future work |

## Integration Examples

### In a data pipeline:

```typescript
const scores = await scoreDataCompleteness({
  records,
  fieldWeights: { name: 2, email: 1, phone: 1 },
  thresholds: { critical: 50, warning: 50, passing: 80 }
});

if (scores.overallScore < 50) {
  // Flag dataset for immediate repair
  await queueCriticalItems(records);
}
```

### Filtering low-completeness batches in workflows:

```typescript
const batchReport = await scoreDataCompleteness({
  data: JSON.stringify(batch),
  fieldWeights: { ...requiredFields },
  thresholdsJson: JSON.stringify(DEFAULT_THRESHOLDS)
});
if (batchReport.summary.criticalCount > 0) {
  return "SKIP";
}
```

### Anomaly detection on field-level completeness:

```typescript
const report = await scoreDataCompleteness({
  records: hourlyData,
  fieldWeights: { customerId: 5, totalAmount: 1 },
  thresholdsJson: JSON.stringify(DEFAULT_THRESHOLDS)
});
if (report.perFieldCompleteness.customerId.completionRate < 90) {
  // Alertif: Missing customer discipline in xx% of records
  await signal(dataQualityAlert);
}
```

## Benchmarks

- **Target**: 1,000,000 records in ≤ 60 seconds (4-core machine)
- **Recommended batch size**: ≤ 100,000 records per invocation
- **Memory**: O(n) where n = number of fields × records loaded in memory

## Testing

Run unit tests: `npm run test src/scoring-engine.test.ts`

Coverage target: ≥ 90% for scoring logic modules

## Contributors

- BuilderForce.AI Team
- Based on PRD <2026.3.21>