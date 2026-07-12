# QA Testing Guide for Builderforce AI

This guide provides detailed instructions for running, debugging, and understanding the QA tests for telemetry reconstruction (GAP-O1) and billing ledger consistency (GAP-O2).

## Prerequisites

- Node.js 20+ installed
- npm 9+ installed
- 500MB free disk space for test dependencies

## Quick Start

### Run All Tests

```bash
# From repository root
make test-qa  # if Makefile exists
npm run test:qa
npm run test:qa:all

# Or directly in qa-tests directory
cd qa-tests
npm test
```

### Run Specific Test Suites

```bash
# Only telemetry reconstruction tests (GAP-O1)
npm run test:qa:telemetry
cd qa-tests && npm test -- -t "GAP-O1"

# Only billing ledger consistency tests (GAP-O2)
npm run test:qa:billing
cd qa-tests && npm test -- -t "GAP-O2"
```

## Test Coverage

### GAP-O1: Telemetry Reconstruction Tests

Tests validate telemetry reconstruction from raw events:

| Test Suite | Description | Key Scenarios |
|------------|-------------|---------------|
| Normal Operation | Basic event processing | Simple sequences, start/end times |
| Out-of-Order Events | Timeline reconstruction | Sorted timestamps, gap handling |
| Missing/Partial Data | Data loss resilience | Partial events, missing timestamps |
| Edge Cases | Boundary conditions | Empty lists, single events |
| Timestamp Validation | Timestamp integrity | Negative values, undefined times |
| End-to-End | Complete workflows | Metadata preservation |

**Test Execution Time**: ~1-2 seconds

### GAP-O2: Billing Ledger Consistency Tests

Tests validate ledger-activity consistency:

| Test Suite | Description | Key Scenarios |
|------------|-------------|---------------|
| Normal Operation | Standard reconciliation | Matching entries, consistent totals |
| Consistency Checks | Error detection | Missing entries, mismatches, extraneous data |
| Scaling Tests | Performance | Multiple agents, high volume |
| Edge Cases | Boundary conditions | Empty data, zero credits |
| Metadata Accuracy | Data integrity | Metadata preservation, cost calculations |
| Entry Types | Segment validation | Execution, tool usage, LLM inference |

**Test Execution Time**: ~2-3 seconds

## Installation & Setup

### Install Dependencies

```bash
cd qa-tests
npm install
```

This installs:
- Jest test runner
- TypeScript compiler and types
- Jest TypeScript preset
- Jest test utilities

### Verify Installation

```bash
cd qa-tests
npm test -- --help
```

## Running Tests

### Interactive Mode

```bash
cd qa-tests
npm run test:watch
```

Watch mode runs tests in interactive mode - suitable for development.

### Verbose Output

```bash
cd qa-tests
npm test -- --verbose
```

Shows detailed output for each test case.

### Coverage Reports

```bash
cd qa-tests
npm run test:coverage
```

Generates coverage reports:
- LCOV format in `coverage/lcov-report/index.html`
- Terminal summary
- Per-file coverage breakdown

View reports in browser:
```bash
open coverage/lcov-report/index.html  # macOS
xdg-open coverage/lcov-report/index.html  # Linux
```

### Specific Test Suites

```bash
# Run all GAP-O1 tests
npm test -- -t "GAP-O1"

# Run specific test group
npm test -- -t "Normal Operation"

# Run specific test
npm test -- -t "should reconstruct telemetry from a simple sequence of events"
```

## CI/CD Integration

### GitHub Actions

Tests execute automatically on:
- Pull requests to `main`/`master`
- Pushes to `main` branch (when configured)
- Scheduled nightly runs (when configured)

### Triggering Tests

```bash
# Create a branch for testing
git checkout -b test-qa-updates
git add qa-tests/
git commit -m "Add QA tests"
git push origin test-qa-updates

# Open a pull request
# Automatic tests will run
```

### CI Job Status

- Green checkmark ✓ = All tests passed
- Red X = Failures, review logs in Actions tab
- ⏱️ Duration typically < 30 seconds

### Manual Test Runs

From commit:
```bash
 gh run list --workflow=ci.yml
 gh run view <run-id> --log
```

### Artifacts

After test run:
- Coverage reports
- Test logs
- Execution time metrics

## Testing Edge Cases

### Missing Events

```typescript
// Simulate partial data loss
const partialEvents = generatePartialMockTelemetryEvents(
  fullEvents, 
  0.2  // Remove 20% of events
);
```

### Out-of-Order Events

```typescript
// Generate events out of timestamp order
const outOfOrder = generateMockTelemetryEvents(
  'agent-1',
  'TestAgent',
  20,
  true  // Enable out-of-order events
);
```

### Invalid Data

```typescript
// Test with negative timestamps
const invalidEvents = createEdgeCaseScenarios().invalidTimestamps;
```

## Debugging Failed Tests

### View Detailed Logs

```bash
cd qa-tests
npm test -- -t "Failing test name" --verbose
```

### Debug Assertion

```typescript
// In failing test, add console.log
console.log('Activity:', activity);
console.log('Expected:', expected);
console.log('Actual:', actual);
```

### Use Test Debugger

#### VS Code

Install Jest extension, use built-in debugger.

#### Node.js

```bash
cd qa-tests
node --inspect-brk node_modules/.bin/jest --runInBand --inspect
```

Connect to debugger at `ws://localhost:9229`.

## Analyzing Test Failures

### Common Failure Types

1. **Assertion Errors**
   - Missing entry: No ledger entry found for activity
   - Mismatch: Total credits don't match
   - Extraneous entry: Found metadata not tied to activity

2. **Timeout Errors**
   - Test exceeded 10s limit
   - Check for infinite loops or expensive operations

3. **Test Infrastructure Errors**
   - Missing dependencies
   - TypeScript compilation errors
   - Wrong Jest version

### Interpreting Logs

```bash
# Sample failure output
 FAIL  qa-tests/billing-ledger-consistency.test.ts
  GAP-O2: Billing Ledger Consistency
    ✓ should reconcile activities with correct ledger entries (2ms)
    ✗ should detect missing ledger entries for activities (5ms)
      Expected: 3
    
      Received: 4
```

## Performance Benchmarks

| Scenario | Duration | Notes |
|----------|----------|-------|
| GAP-O1 (10 events) | ~500ms | Baseline |
| GAP-O2 (10 activities) | ~600ms | Baseline |
| GAP-O1 + GAP-O2 (20 events) | ~900ms | Combined |
| GAP-O1 (100 events) | ~800ms | Scales linearly |
| GAP-O2 (100 activities) | ~1.2s | Scales linearly |

**Recommendation**: Parallel execution for 100+ events to maintain < 5s total runtime.

## Customizing Tests

### Adding New Test Scenarios

```typescript
// 1. Add test data generator (if needed)
// tests/mock-data-generators.ts

// 2. Write tests following existing patterns
describe('My New Feature', () => {
  it('should pass validation', () => {
    const testInput = 'expected value';
    const validation = myFeature(testInput);
    expect(validation).toBe(true);
  });
});

// 3. Run locally to verify
npm test -- -t "should pass validation"
```

### Adjusting Coverage Thresholds

Edit `qa-tests/jest.config.js`:

```javascript
coverageThreshold: {
  global: {
    branches: 85,      // Increase from 70
    functions: 85,     // Increase from 70
    lines: 85,         // Increase from 70
    statements: 85,    // Increase from 70
  },
},
```

## FAQ

**Q: Why do some tests pass with `--passWithNoTests`?**

A: Tests may skip if dependencies aren't installed or configuration is incomplete.

**Q: How do I contribute new tests?**

A: Follow the existing patterns in `telemetry-reconstruction.test.ts` and `billing-ledger-consistency.test.ts`. Ensure tests are self-contained and run in isolation.

**Q: What if tests fail in CI but pass locally?**

A: Check Node versions, environment variables, and disk space. Review CI logs carefully for differences.

**Q: Can I run tests without installing dependencies?**

A: Tests in `test-harness/mock-data-generators.ts` use only TypeScript builtins and should run without npm install except for Jest infrastructure.

## Support

For issues or questions:
1. Check this guide
2. Review test code comments
3. Open an issue with reproduction steps
4. Include test output and environment details

## Success Metrics

Tests pass when:
- ✅ All GAP-O1 and GAP-O2 tests execute successfully
- ✅ 70%+ code coverage maintained for test files
- ✅ Test execution time < 10 seconds for default scenarios
- ✅ CI pipeline reports green status
- ✅ No existing functionality breaks
- ✅ Edge cases are handled gracefully