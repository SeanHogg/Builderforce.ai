# Contributor Guidelines

## Known Failure Patterns

### Null Reference Errors
To detect null reference errors in components:
1. Run tests with `npm test`
2. Look for `Cannot read properties of null` in output
3. Add null checks using optional chaining or conditional rendering

### Duplicate CSS Properties
To detect duplicate CSS properties:
1. Run `npx stylelint "**/*.css"` 
2. Fix any `no-duplicate-properties` violations
3. Ensure build completes without warnings