import Foundation

// Stable identifier used for both the macOS LaunchAgent label and Nix-managed defaults suite.
// nix-coderclaw writes app defaults into this suite to survive app bundle identifier churn.
let launchdLabel = "ai.coderclaw.mac"
let gatewayLaunchdLabel = "ai.coderclaw.gateway"
let onboardingVersionKey = "coderclaw.onboardingVersion"
let onboardingSeenKey = "coderclaw.onboardingSeen"
let currentOnboardingVersion = 7
let pauseDefaultsKey = "coderclaw.pauseEnabled"
let iconAnimationsEnabledKey = "coderclaw.iconAnimationsEnabled"
let swabbleEnabledKey = "coderclaw.swabbleEnabled"
let swabbleTriggersKey = "coderclaw.swabbleTriggers"
let voiceWakeTriggerChimeKey = "coderclaw.voiceWakeTriggerChime"
let voiceWakeSendChimeKey = "coderclaw.voiceWakeSendChime"
let showDockIconKey = "coderclaw.showDockIcon"
let defaultVoiceWakeTriggers = ["coderclaw"]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = "coderclaw.voiceWakeMicID"
let voiceWakeMicNameKey = "coderclaw.voiceWakeMicName"
let voiceWakeLocaleKey = "coderclaw.voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = "coderclaw.voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = "coderclaw.voicePushToTalkEnabled"
let talkEnabledKey = "coderclaw.talkEnabled"
let iconOverrideKey = "coderclaw.iconOverride"
let connectionModeKey = "coderclaw.connectionMode"
let remoteTargetKey = "coderclaw.remoteTarget"
let remoteIdentityKey = "coderclaw.remoteIdentity"
let remoteProjectRootKey = "coderclaw.remoteProjectRoot"
let remoteCliPathKey = "coderclaw.remoteCliPath"
let canvasEnabledKey = "coderclaw.canvasEnabled"
let cameraEnabledKey = "coderclaw.cameraEnabled"
let systemRunPolicyKey = "coderclaw.systemRunPolicy"
let systemRunAllowlistKey = "coderclaw.systemRunAllowlist"
let systemRunEnabledKey = "coderclaw.systemRunEnabled"
let locationModeKey = "coderclaw.locationMode"
let locationPreciseKey = "coderclaw.locationPreciseEnabled"
let peekabooBridgeEnabledKey = "coderclaw.peekabooBridgeEnabled"
let deepLinkKeyKey = "coderclaw.deepLinkKey"
let modelCatalogPathKey = "coderclaw.modelCatalogPath"
let modelCatalogReloadKey = "coderclaw.modelCatalogReload"
let cliInstallPromptedVersionKey = "coderclaw.cliInstallPromptedVersion"
let heartbeatsEnabledKey = "coderclaw.heartbeatsEnabled"
let debugPaneEnabledKey = "coderclaw.debugPaneEnabled"
let debugFileLogEnabledKey = "coderclaw.debug.fileLogEnabled"
let appLogLevelKey = "coderclaw.debug.appLogLevel"
let voiceWakeSupported: Bool = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
