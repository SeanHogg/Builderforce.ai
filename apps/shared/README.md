# Builderforce shared Swift code

`apps/shared/BuilderforceKit` is the Swift package shared by the iOS app (`apps/ios`) and the
macOS app (`apps/macos`).

## Package `BuilderforceKit`

| Product / target | Sources | What it holds |
|---|---|---|
| `BuilderforceProtocol` | `Sources/BuilderforceProtocol` | Gateway wire models (`GatewayModels.swift`, generated) |
| `BuilderforceKit` | `Sources/BuilderforceKit` | Gateway channel + node session, Bonjour discovery types, deep links, device/node commands, canvas A2UI host resources |
| `BuilderforceChatUI` | `Sources/BuilderforceChatUI` | SwiftUI chat surface (transcript, composer, sessions) |
| `BuilderforceKitTests` | `Tests/BuilderforceKitTests` | Swift Testing suite |

`BuilderforceKit` ships its resources in the `BuilderforceKit_BuilderforceKit` bundle
(see `BuilderforceKitResources.swift`). The canvas A2UI bootstrap sources live in
`Tools/CanvasA2UI`.

## Regenerating the protocol models

`GatewayModels.swift` is generated from the gateway schema in `agent-runtime`. From `agent-runtime/`:

```bash
node --import tsx scripts/protocol-gen-swift.ts
```

This writes both `apps/shared/BuilderforceKit/Sources/BuilderforceProtocol/GatewayModels.swift`
and `apps/macos/Sources/BuilderforceProtocol/GatewayModels.swift`.

## Gateway contract the apps rely on

- Client ids sent in `connect`: `builderforce-ios`, `builderforce-macos` (accepted by
  `agent-runtime/src/gateway/protocol/client-info.ts`).
- Bonjour service type `_builderforce-gw._tcp` (wide-area domain via
  `BUILDERFORCE_AGENTS_WIDE_AREA_DOMAIN`).
- Deep links `builderforce://…`; canvas host bridge globals `builderforceA2UI` /
  `builderforceCanvasA2UIAction`.
- Redacted secrets arrive as `__BUILDERFORCE_AGENTS_REDACTED__`.
