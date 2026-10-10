package ai.coderclaw.android.node

import android.os.Build
import ai.coderclaw.android.BuildConfig
import ai.coderclaw.android.SecurePrefs
import ai.coderclaw.android.gateway.GatewayClientInfo
import ai.coderclaw.android.gateway.GatewayConnectOptions
import ai.coderclaw.android.gateway.GatewayEndpoint
import ai.coderclaw.android.gateway.GatewayTlsParams
import ai.coderclaw.android.protocol.CoderClawCanvasA2UICommand
import ai.coderclaw.android.protocol.CoderClawCanvasCommand
import ai.coderclaw.android.protocol.CoderClawCameraCommand
import ai.coderclaw.android.protocol.CoderClawLocationCommand
import ai.coderclaw.android.protocol.CoderClawScreenCommand
import ai.coderclaw.android.protocol.CoderClawSmsCommand
import ai.coderclaw.android.protocol.CoderClawCapability
import ai.coderclaw.android.LocationMode
import ai.coderclaw.android.VoiceWakeMode

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
      add(CoderClawCanvasCommand.Present.rawValue)
      add(CoderClawCanvasCommand.Hide.rawValue)
      add(CoderClawCanvasCommand.Navigate.rawValue)
      add(CoderClawCanvasCommand.Eval.rawValue)
      add(CoderClawCanvasCommand.Snapshot.rawValue)
      add(CoderClawCanvasA2UICommand.Push.rawValue)
      add(CoderClawCanvasA2UICommand.PushJSONL.rawValue)
      add(CoderClawCanvasA2UICommand.Reset.rawValue)
      add(CoderClawScreenCommand.Record.rawValue)
      if (cameraEnabled()) {
        add(CoderClawCameraCommand.Snap.rawValue)
        add(CoderClawCameraCommand.Clip.rawValue)
      }
      if (locationMode() != LocationMode.Off) {
        add(CoderClawLocationCommand.Get.rawValue)
      }
      if (smsAvailable()) {
        add(CoderClawSmsCommand.Send.rawValue)
      }
      if (BuildConfig.DEBUG) {
        add("debug.logs")
        add("debug.ed25519")
      }
      add("app.update")
    }

  fun buildCapabilities(): List<String> =
    buildList {
      add(CoderClawCapability.Canvas.rawValue)
      add(CoderClawCapability.Screen.rawValue)
      if (cameraEnabled()) add(CoderClawCapability.Camera.rawValue)
      if (smsAvailable()) add(CoderClawCapability.Sms.rawValue)
      if (voiceWakeMode() != VoiceWakeMode.Off && hasRecordAudioPermission()) {
        add(CoderClawCapability.VoiceWake.rawValue)
      }
      if (locationMode() != LocationMode.Off) {
        add(CoderClawCapability.Location.rawValue)
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
    return "CoderClawAndroid/$version (Android $releaseLabel; SDK ${Build.VERSION.SDK_INT})"
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
      client = buildClientInfo(clientId = "coderclaw-android", clientMode = "node"),
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
      client = buildClientInfo(clientId = "coderclaw-control-ui", clientMode = "ui"),
      userAgent = buildUserAgent(),
    )
  }

  fun resolveTlsParams(endpoint: GatewayEndpoint): GatewayTlsParams? {
    val stored = prefs.loadGatewayTlsFingerprint(endpoint.stableId)
    return resolveTlsParamsForEndpoint(endpoint, storedFingerprint = stored, manualTlsEnabled = manualTls())
  }
}
