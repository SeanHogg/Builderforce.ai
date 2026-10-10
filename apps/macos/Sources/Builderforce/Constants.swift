import Foundation

// Stable identifier used for both the macOS LaunchAgent label and Nix-managed defaults suite.
// nix-builderforce writes app defaults into this suite to survive app bundle identifier churn.
let launchdLabel = "ai.builderforce.mac"
let gatewayLaunchdLabel = "ai.builderforce.gateway"
let onboardingVersionKey = "builderforce.onboardingVersion"
let onboardingSeenKey = "builderforce.onboardingSeen"
let currentOnboardingVersion = 7
let pauseDefaultsKey = "builderforce.pauseEnabled"
let iconAnimationsEnabledKey = "builderforce.iconAnimationsEnabled"
let swabbleEnabledKey = "builderforce.swabbleEnabled"
let swabbleTriggersKey = "builderforce.swabbleTriggers"
let voiceWakeTriggerChimeKey = "builderforce.voiceWakeTriggerChime"
let voiceWakeSendChimeKey = "builderforce.voiceWakeSendChime"
let showDockIconKey = "builderforce.showDockIcon"
let defaultVoiceWakeTriggers = ["builderforce"]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = "builderforce.voiceWakeMicID"
let voiceWakeMicNameKey = "builderforce.voiceWakeMicName"
let voiceWakeLocaleKey = "builderforce.voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = "builderforce.voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = "builderforce.voicePushToTalkEnabled"
let talkEnabledKey = "builderforce.talkEnabled"
let iconOverrideKey = "builderforce.iconOverride"
let connectionModeKey = "builderforce.connectionMode"
let remoteTargetKey = "builderforce.remoteTarget"
let remoteIdentityKey = "builderforce.remoteIdentity"
let remoteProjectRootKey = "builderforce.remoteProjectRoot"
let remoteCliPathKey = "builderforce.remoteCliPath"
let canvasEnabledKey = "builderforce.canvasEnabled"
let cameraEnabledKey = "builderforce.cameraEnabled"
let systemRunPolicyKey = "builderforce.systemRunPolicy"
let systemRunAllowlistKey = "builderforce.systemRunAllowlist"
let systemRunEnabledKey = "builderforce.systemRunEnabled"
let locationModeKey = "builderforce.locationMode"
let locationPreciseKey = "builderforce.locationPreciseEnabled"
let peekabooBridgeEnabledKey = "builderforce.peekabooBridgeEnabled"
let deepLinkKeyKey = "builderforce.deepLinkKey"
let modelCatalogPathKey = "builderforce.modelCatalogPath"
let modelCatalogReloadKey = "builderforce.modelCatalogReload"
let cliInstallPromptedVersionKey = "builderforce.cliInstallPromptedVersion"
let heartbeatsEnabledKey = "builderforce.heartbeatsEnabled"
let debugPaneEnabledKey = "builderforce.debugPaneEnabled"
let debugFileLogEnabledKey = "builderforce.debug.fileLogEnabled"
let appLogLevelKey = "builderforce.debug.appLogLevel"
let voiceWakeSupported: Bool = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
