# Changelog

## 2026.3.11

### Fixes

- Surface gateway startup errors when running as a background service (`gateway start` / `gateway restart`). Previously, if the gateway crashed immediately (e.g. port conflict, lock contention), the error messages were only written to the JSON log file and the CLI returned success silently. Now the CLI waits briefly, detects the crash via runtime status check, reads recent ERROR entries from the rolling log, and prints them to the terminal.
- Fix missing `cron` property on `DaemonInstallOptions` type causing TypeScript error in `register-service-commands.ts`
- Fix missing `beforeEach` import in `install-id.test.ts`

### Changes

- Add `readRecentGatewayLogErrors()` to `daemon/diagnostics.ts` for reading ERROR-level entries from the rolling JSON log file after a given timestamp
- Add `detectServiceCrash()` post-start health check to `lifecycle-core.ts`, used by both `runServiceStart()` and `runServiceRestart()`
