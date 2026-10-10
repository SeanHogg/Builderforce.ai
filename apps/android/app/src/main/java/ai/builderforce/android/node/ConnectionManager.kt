package ai.builderforce.android.node

import android.os.Build
import ai.builderforce.android.BuildConfig
import ai.builderforce.android.SecurePrefs
import ai.builderforce.android.gateway.GatewayClientInfo
import ai.builderforce.android.gateway.GatewayConnectOptions
import ai.builderforce.android.gateway.GatewayEndpoint
import ai.builderforce.android.gateway.GatewayTlsParams
import ai.builderforce.android.protocol.BuilderforceCanvasA2UICommand
import ai.builderforce.android.protocol.BuilderforceCanvasCommand
import ai.builderforce.android.protocol.BuilderforceCameraCommand
import ai.builderforce.android.protocol.BuilderforceLocationCommand
import ai.builderforce.android.protocol.BuilderforceScreenCommand
import ai.builderforce.android.protocol.BuilderforceSmsCommand
import ai.builderforce.android.protocol.BuilderforceCapability
import ai.builderforce.android.LocationMode
import ai.builderforce.android.VoiceWakeMode

class ConnectionManager(
  private val prefs: SecurePrefs,
  private val cameraEnabled: () -> Boolean,
  private val locationMode: () -> LocationMode,
  private val voiceWakeMode: () -> VoiceWakeMode,
  private val smsAvailable: () -> Boolean,
  private val hasRecordAudioPermission: () -> Boolean,
  private val manualTls: () -> Boolean,
) {
  companion object {
    internal fun resolveTlsParamsForEndpoint(
      endpoint: GatewayEndpoint,
      storedFingerprint: String?,
      manualTlsEnabled: Boolean,
    ): GatewayTlsParams? {
      val stableId = endpoint.stableId
      val stored = storedFingerprint?.trim().takeIf { !it.isNullOrEmpty() }
      val isManual = stableId.startsWith("manual|")

      if (isManual) {
        if (!manualTlsEnabled) return null
        if (!stored.isNullOrBlank()) {
          return GatewayTlsParams(
            required = true,
            expectedFingerprint = stored,
            allowTOFU = false,
            stableId = stableId,
          )
        }
        return GatewayTlsParams(
          required = true,
          expectedFingerprint = null,
          allowTOFU = false,
          stableId = stableId,
        )
      }

      // Prefer stored pins. Never let discovery-provided TXT override a stored fingerprint.
      if (!stored.isNullOrBlank()) {
        return GatewayTlsParams(
          required = true,
          expectedFingerprint = stored,
          allowTOFU = false,
          stableId = stableId,
        )
      }

      val hinted = endpoint.tlsEnabled || !endpoint.tlsFingerprintSha256.isNullOrBlank()
      if (hinted) {
        // TXT is unauthenticated. Do not treat the advertised fingerprint as authoritative.
        return GatewayTlsParams(
          required = true,
          expectedFingerprint = null,
          allowTOFU = false,
          stableId = stableId,
        )
      }

      return null
    }
  }

  fun buildInvokeCommands(): List<String> =
    buildList {
      add(BuilderforceCanvasCommand.Present.rawValue)
      add(BuilderforceCanvasCommand.Hide.rawValue)
      add(BuilderforceCanvasCommand.Navigate.rawValue)
      add(BuilderforceCanvasCommand.Eval.rawValue)
      add(BuilderforceCanvasCommand.Snapshot.rawValue)
      add(BuilderforceCanvasA2UICommand.Push.rawValue)
      add(BuilderforceCanvasA2UICommand.PushJSONL.rawValue)
      add(BuilderforceCanvasA2UICommand.Reset.rawValue)
      add(BuilderforceScreenCommand.Record.rawValue)
      if (cameraEnabled()) {
        add(BuilderforceCameraCommand.Snap.rawValue)
        add(BuilderforceCameraCommand.Clip.rawValue)
      }
      if (locationMode() != LocationMode.Off) {
        add(BuilderforceLocationCommand.Get.rawValue)
      }
      if (smsAvailable()) {
        add(BuilderforceSmsCommand.Send.rawValue)
      }
      if (BuildConfig.DEBUG) {
        add("debug.logs")
        add("debug.ed25519")
      }
      add("app.update")
    }

  fun buildCapabilities(): List<String> =
    buildList {
      add(BuilderforceCapability.Canvas.rawValue)
      add(BuilderforceCapability.Screen.rawValue)
      if (cameraEnabled()) add(BuilderforceCapability.Camera.rawValue)
      if (smsAvailable()) add(BuilderforceCapability.Sms.rawValue)
      if (voiceWakeMode() != VoiceWakeMode.Off && hasRecordAudioPermission()) {
        add(BuilderforceCapability.VoiceWake.rawValue)
      }
      if (locationMode() != LocationMode.Off) {
        add(BuilderforceCapability.Location.rawValue)
      }
    }

  fun resolvedVersionName(): String {
    val versionName = BuildConfig.VERSION_NAME.trim().ifEmpty { "dev" }
    return if (BuildConfig.DEBUG && !versionName.contains("dev", ignoreCase = true)) {
      "$versionName-dev"
    } else {
      versionName
    }
  }

  fun resolveModelIdentifier(): String? {
    return listOfNotNull(Build.MANUFACTURER, Build.MODEL)
      .joinToString(" ")
      .trim()
      .ifEmpty { null }
  }

  fun buildUserAgent(): String {
    val version = resolvedVersionName()
    val release = Build.VERSION.RELEASE?.trim().orEmpty()
    val releaseLabel = if (release.isEmpty()) "unknown" else release
    return "BuilderforceAndroid/$version (Android $releaseLabel; SDK ${Build.VERSION.SDK_INT})"
  }

  fun buildClientInfo(clientId: String, clientMode: String): GatewayClientInfo {
    return GatewayClientInfo(
      id = clientId,
      displayName = prefs.displayName.value,
      version = resolvedVersionName(),
      platform = "android",
      mode = clientMode,
      instanceId = prefs.instanceId.value,
      deviceFamily = "Android",
      modelIdentifier = resolveModelIdentifier(),
    )
  }

  fun buildNodeConnectOptions(): GatewayConnectOptions {
    return GatewayConnectOptions(
      role = "node",
      scopes = emptyList(),
      caps = buildCapabilities(),
      commands = buildInvokeCommands(),
      permissions = emptyMap(),
      client = buildClientInfo(clientId = "builderforce-android", clientMode = "node"),
      userAgent = buildUserAgent(),
    )
  }

  fun buildOperatorConnectOptions(): GatewayConnectOptions {
    return GatewayConnectOptions(
      role = "operator",
      scopes = listOf("operator.read", "operator.write", "operator.talk.secrets"),
      caps = emptyList(),
      commands = emptyList(),
      permissions = emptyMap(),
      client = buildClientInfo(clientId = "builderforce-control-ui", clientMode = "ui"),
      userAgent = buildUserAgent(),
    )
  }

  fun resolveTlsParams(endpoint: GatewayEndpoint): GatewayTlsParams? {
    val stored = prefs.loadGatewayTlsFingerprint(endpoint.stableId)
    return resolveTlsParamsForEndpoint(endpoint, storedFingerprint = stored, manualTlsEnabled = manualTls())
  }
}
