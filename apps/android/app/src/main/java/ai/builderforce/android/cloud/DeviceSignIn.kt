package ai.builderforce.android.cloud

import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** A code pair the platform handed out: the person approves [userCode] on `/activate`. */
data class DeviceStart(
  val deviceCode: String,
  val userCode: String,
  val verificationUri: String,
  val verificationUriComplete: String,
  val intervalSeconds: Long,
  val expiresInSeconds: Long,
)

/** How a browser sign-in ended. */
sealed interface SignInOutcome {
  data class Approved(val key: String) : SignInOutcome

  data object Denied : SignInOutcome

  data object Expired : SignInOutcome
}

/**
 * Sign in through the browser: the platform's device flow (RFC 8628), the one the VS Code
 * extension and Synapse use. [start] asks for a code pair; the person approves the code on
 * `/activate`; [awaitApproval] polls until the minted `bfk_` key is handed over (once).
 */
class DeviceSignIn(private val config: CloudConfig) {
  suspend fun start(): DeviceStart {
    val body = buildJsonObject { put("client", JsonPrimitive(CloudConfig.DEVICE_CLIENT)) }
    val v = CloudHttp.call(CloudHttp.client, CloudHttp.request("${config.baseUrl()}/api/auth/device/code", "POST", body, null))
    val o = v.objOrNull() ?: throw CloudException.Unreachable("unexpected device-code answer")
    val deviceCode = o["device_code"].textOrNull() ?: throw CloudException.Unreachable("no device code")
    val verificationUri = o["verification_uri"].textOrNull().orEmpty()
    return DeviceStart(
      deviceCode = deviceCode,
      userCode = o["user_code"].textOrNull().orEmpty(),
      verificationUri = verificationUri,
      verificationUriComplete = o["verification_uri_complete"].textOrNull() ?: verificationUri,
      intervalSeconds = o["interval"].longOrNull() ?: DEFAULT_INTERVAL_S,
      expiresInSeconds = o["expires_in"].longOrNull() ?: DEFAULT_EXPIRES_S,
    )
  }

  /**
   * Poll until the person approves, denies, or the code expires. Offline for a moment keeps
   * waiting until the code itself expires. Cancelling the coroutine cancels the sign-in.
   */
  suspend fun awaitApproval(start: DeviceStart): SignInOutcome {
    val deadline = System.nanoTime() + start.expiresInSeconds * 1_000_000_000L
    var waitMs = start.intervalSeconds.coerceAtLeast(1) * 1000L
    while (System.nanoTime() < deadline) {
      delay(waitMs)
      when (val p = poll(start.deviceCode)) {
        is Poll.Approved -> return SignInOutcome.Approved(p.key)
        Poll.Pending -> Unit
        Poll.SlowDown -> waitMs += 2000L
        Poll.Denied -> return SignInOutcome.Denied
        Poll.Expired -> return SignInOutcome.Expired
        Poll.Offline -> Unit
      }
    }
    return SignInOutcome.Expired
  }

  private sealed interface Poll {
    data class Approved(val key: String) : Poll

    data object Pending : Poll

    data object SlowDown : Poll

    data object Denied : Poll

    data object Expired : Poll

    data object Offline : Poll
  }

  private suspend fun poll(deviceCode: String): Poll {
    val body = buildJsonObject { put("device_code", JsonPrimitive(deviceCode)) }
    return try {
      val v = CloudHttp.call(CloudHttp.client, CloudHttp.request("${config.baseUrl()}/api/auth/device/token", "POST", body, null))
      val key = v.objOrNull()?.get("access_key").textOrNull()
      if (key.isNullOrBlank()) Poll.Offline else Poll.Approved(key)
    } catch (e: CloudException.Status) {
      when (e.code) {
        428 -> Poll.Pending
        429 -> Poll.SlowDown
        403 -> Poll.Denied
        410 -> Poll.Expired
        else -> Poll.Offline
      }
    } catch (_: CloudException.Unreachable) {
      Poll.Offline
    }
  }

  private companion object {
    const val DEFAULT_INTERVAL_S = 5L
    const val DEFAULT_EXPIRES_S = 600L
  }
}
