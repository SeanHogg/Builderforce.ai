# Builderforce macOS app (dev + signing)

The Builderforce menu bar app: it runs and supervises the local Builderforce gateway
(`builderforce` CLI from `@seanhogg/builderforce-agents`), hosts the canvas, voice wake and
chat, and acts as a gateway node.

## Layout

SwiftPM package `Builderforce` (`apps/macos/Package.swift`):

| Target / product | Kind | Sources |
|---|---|---|
| `Builderforce` | executable (the app) | `Sources/Builderforce` |
| `BuilderforceIPC` | library | `Sources/BuilderforceIPC` |
| `BuilderforceDiscovery` | library | `Sources/BuilderforceDiscovery` |
| `builderforce-mac` (target `BuilderforceMacCLI`) | executable (CLI) | `Sources/BuilderforceMacCLI` |
| `BuilderforceIPCTests` | tests | `Tests/BuilderforceIPCTests` |

Shared code comes from `apps/shared/BuilderforceKit` (`BuilderforceKit`, `BuilderforceProtocol`,
`BuilderforceChatUI`); voice wake from `agent-runtime/Swabble` (`SwabbleKit`).

`Sources/BuilderforceProtocol/GatewayModels.swift` is generated — run
`node --import tsx scripts/protocol-gen-swift.ts` from `agent-runtime/`.

## Identifiers

- Bundle id `ai.builderforce.mac`; URL scheme `builderforce://`; canvas scheme `builderforce-canvas://`.
- LaunchAgent labels: app `ai.builderforce.mac`, gateway `ai.builderforce.gateway` (same label the
  `builderforce` CLI installs).
- Gateway client id `builderforce-macos`; Bonjour service `_builderforce-gw._tcp`.
- Config `~/.builderforce/builderforce.json`; env overrides `BUILDERFORCE_AGENTS_STATE_DIR`,
  `BUILDERFORCE_AGENTS_CONFIG_PATH`, `BUILDERFORCE_AGENTS_GATEWAY_TOKEN`,
  `BUILDERFORCE_AGENTS_GATEWAY_PASSWORD`, `BUILDERFORCE_AGENTS_GATEWAY_PORT`.
- UserDefaults keys are prefixed `builderforce.`; logs go to `/tmp/builderforce`
  (override with `BUILDERFORCE_AGENTS_LOG_DIR`).

## Quick dev run

The scripts live in `agent-runtime/scripts/`; run them from `agent-runtime/`.

```bash
cd agent-runtime
scripts/restart-mac.sh
```

Options:

```bash
scripts/restart-mac.sh --no-sign   # fastest dev; ad-hoc signing (TCC permissions do not stick)
scripts/restart-mac.sh --sign      # force code signing (requires cert)
```

Plain debug build + launch without packaging:

```bash
scripts/build-and-run-mac.sh
```

## Packaging flow

```bash
cd agent-runtime
scripts/package-mac-app.sh        # debug app bundle
scripts/package-mac-dist.sh       # release: universal app + zip + dmg (+ notarization when configured)
```

Creates `agent-runtime/dist/Builderforce.app` and signs it via `scripts/codesign-mac-app.sh`.
Debug builds (`BUILD_CONFIG=debug`, the default) never enable Sparkle auto-update checks.

## Signing behavior

Auto-selects identity (first match):
1) Developer ID Application
2) Apple Distribution
3) Apple Development
4) first available identity

If none found:
- errors by default
- set `ALLOW_ADHOC_SIGNING=1` or `SIGN_IDENTITY="-"` to ad-hoc sign

## Team ID audit (Sparkle mismatch guard)

After signing, we read the app bundle Team ID and compare every Mach-O inside the app.
If any embedded binary has a different Team ID, signing fails.

Skip the audit:
```bash
SKIP_TEAM_ID_CHECK=1 scripts/package-mac-app.sh
```

## Library validation workaround (dev only)

If Sparkle Team ID mismatch blocks loading (common with Apple Development certs), opt in:

```bash
DISABLE_LIBRARY_VALIDATION=1 scripts/package-mac-app.sh
```

This adds `com.apple.security.cs.disable-library-validation` to app entitlements.
Use for local dev only; keep off for release builds.

## Useful env flags

- `SIGN_IDENTITY="Apple Development: Your Name (TEAMID)"`
- `ALLOW_ADHOC_SIGNING=1` (ad-hoc, TCC permissions do not persist)
- `CODESIGN_TIMESTAMP=off` (offline debug)
- `DISABLE_LIBRARY_VALIDATION=1` (dev-only Sparkle workaround)
- `SKIP_TEAM_ID_CHECK=1` (bypass audit)
- `BUNDLE_ID=…` (override the bundle id; a `*.debug` id also disables Sparkle)
