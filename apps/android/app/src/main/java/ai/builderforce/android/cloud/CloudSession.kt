package ai.builderforce.android.cloud

import ai.builderforce.android.SecurePrefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import okhttp3.OkHttpClient
import okhttp3.Response

/** One of the person's workspaces. */
data class Workspace(val id: Long, val name: String, val role: String?)

/**
 * The signed-in session — Synapse's `bf_cloud::Session`: the `bfk_` key (kept in the
 * app's EncryptedSharedPreferences), exchanged for a short-lived workspace token
 * (`/api/auth/tenant-api-key-token`) and re-scoped to the chosen workspace
 * (`/api/vscode/tenants/:id/token`). The token is reused until a minute before it
 * expires; a 401 re-mints once; a refused key signs out rather than looping.
 */
class CloudSession(private val prefs: SecurePrefs, private val config: CloudConfig) {
  private class Token(val value: String, val tenantId: Long, val expiresAtNanos: Long, val base: String)

  private val mutex = Mutex()
  @Volatile private var token: Token? = null

  private val _signedIn = MutableStateFlow(savedKey() != null)
  val signedIn: StateFlow<Boolean> = _signedIn.asStateFlow()

  /** The platform refused the saved key — the UI says why it signed out. */
  private val _expired = MutableStateFlow(false)
  val expired: StateFlow<Boolean> = _expired.asStateFlow()

  /** The workspace the session works in (known once a token is minted). */
  private val _workspaceId = MutableStateFlow(prefs.getString(WORKSPACE_KEY)?.toLongOrNull())
  val workspaceId: StateFlow<Long?> = _workspaceId.asStateFlow()

  /**
   * This sign-in cannot switch workspaces (a legacy key): a fresh sign-in fixes it. Non-fatal —
   * the key still works in its own workspace, so nobody is signed out.
   */
  private val _workspaceSignInNeeded = MutableStateFlow(false)
  val workspaceSignInNeeded: StateFlow<Boolean> = _workspaceSignInNeeded.asStateFlow()

  private fun savedKey(): String? = prefs.getString(KEY)?.trim()?.takeIf { it.isNotEmpty() }

  private fun requireKey(): String = savedKey() ?: throw CloudException.SignedOut()

  /** Adopt a freshly minted key (it works in the workspace it was minted for). */
  fun adoptKey(key: String) {
    prefs.putString(KEY, key.trim())
    prefs.remove(WORKSPACE_KEY)
    token = null
    _workspaceId.value = null
    _expired.value = false
    _workspaceSignInNeeded.value = false
    _signedIn.value = true
  }

  /** Sign out here and revoke the key on the platform (best effort — offline still signs out). */
  suspend fun signOut() {
    val key = savedKey()
    forget(expired = false)
    if (key == null) return
    try {
      val body = buildJsonObject { put("apiKey", JsonPrimitive(key)) }
      CloudHttp.call(CloudHttp.client, CloudHttp.request("${config.baseUrl()}/api/auth/keys/revoke", "POST", body, null))
    } catch (_: CloudException) {
      // Offline: the key stays valid there until it is revoked from the web app.
    }
  }

  private fun forget(expired: Boolean) {
    prefs.remove(KEY)
    prefs.remove(WORKSPACE_KEY)
    token = null
    _workspaceId.value = null
    _signedIn.value = false
    _workspaceSignInNeeded.value = false
    _expired.value = expired
  }

  /** The server changed (Settings): the next call mints a token there. */
  fun invalidateToken() {
    token = null
  }

  /** Work in workspace [id] from now on (remembered across launches). */
  suspend fun selectWorkspace(id: Long) {
    prefs.putString(WORKSPACE_KEY, id.toString())
    _workspaceSignInNeeded.value = false
    token = null
    guard { bearer() }
  }

  suspend fun workspaces(): List<Workspace> {
    val v = api("GET", "/api/tenants")
    return v.objOrNull()?.get("tenants").arrOrEmpty().mapNotNull { el ->
      val o = el.objOrNull() ?: return@mapNotNull null
      val id = o["id"].longOrNull() ?: return@mapNotNull null
      Workspace(id = id, name = o["name"].textOrNull() ?: id.toString(), role = o["role"].textOrNull())
    }
  }

  /** The gateway base URL in use (where uploads are read back from). */
  fun baseUrl(): String = config.baseUrl()

  /** Call the platform API as the signed-in person. A 401 re-mints the token once. */
  suspend fun api(method: String, path: String, body: JsonElement? = null): JsonElement =
    authed { bearer -> CloudHttp.call(CloudHttp.client, CloudHttp.request("${config.baseUrl()}$path", method, body, bearer)) }

  /**
   * Upload one file to the chat uploads store (`POST /api/brain/upload`, multipart field
   * `file`); the answer is the stored `{key, name, type}`. Same bearer and 401 re-mint as [api].
   */
  suspend fun upload(fileName: String, mimeType: String, bytes: ByteArray): JsonElement =
    authed { bearer ->
      val request = CloudHttp.multipartRequest("${config.baseUrl()}/api/brain/upload", fileName, mimeType, bytes, bearer)
      CloudHttp.call(CloudHttp.uploadClient, request)
    }

  /** Read a stored file back as the signed-in person (the uploads route is tenant-checked). */
  suspend fun download(path: String): ByteArray =
    authed { bearer -> CloudHttp.bytes(CloudHttp.uploadClient, CloudHttp.getRequest("${config.baseUrl()}$path", bearer)) }

  /** Run [call] with the workspace token; a 401 drops the token and tries once more. */
  private suspend fun <T> authed(call: suspend (bearer: String) -> T): T =
    guard {
      try {
        call(bearer())
      } catch (e: CloudException.Status) {
        if (e.code != 401) throw e
        token = null
        call(bearer())
      }
    }

  /**
   * A call to the LLM gateway (`/llm/v1/...`), where the key itself is the credential —
   * the completions and the platform tools the Brain drives. The response is open; the
   * caller closes it. A refused key signs out.
   */
  suspend fun gateway(method: String, path: String, body: JsonElement?, client: OkHttpClient): Response =
    guard {
      val request = CloudHttp.request("${config.baseUrl()}/llm/v1$path", method, body, requireKey())
      try {
        CloudHttp.open(client, request)
      } catch (e: CloudException.Status) {
        if (e.code == 401) throw CloudException.KeyRejected()
        throw e
      }
    }

  /** A refused key anywhere signs out here (it is already dead there). */
  private inline fun <T> guard(block: () -> T): T =
    try {
      block()
    } catch (e: CloudException.KeyRejected) {
      forget(expired = true)
      throw e
    }

  /** A token for the chosen workspace, minted when there is none or it is about to expire. */
  private suspend fun bearer(): String =
    mutex.withLock {
      val base = config.baseUrl()
      val current = token
      if (current != null && current.base == base && current.expiresAtNanos > System.nanoTime() + REFRESH_MARGIN_NANOS) {
        return@withLock current.value
      }
      var minted: String? = null
      while (minted == null) {
        val selected = prefs.getString(WORKSPACE_KEY)?.toLongOrNull()
        val fresh = exchange(base)
        // selectWorkspace runs outside the mutex: a token minted for a superseded selection is discarded.
        // (A selection the exchange itself dropped also re-runs once, then is stable.)
        if (prefs.getString(WORKSPACE_KEY)?.toLongOrNull() != selected) continue
        token = fresh
        _workspaceId.value = fresh.tenantId
        minted = fresh.value
      }
      minted
    }

  /** Forget the saved selection only while it is still [wanted] (a newer selection is kept). */
  private fun dropSelection(wanted: Long): Boolean {
    if (prefs.getString(WORKSPACE_KEY)?.toLongOrNull() != wanted) return false
    prefs.remove(WORKSPACE_KEY)
    return true
  }

  private suspend fun mintBase(base: String, key: String): Minted =
    try {
      mint(base, "/api/auth/tenant-api-key-token", null, buildJsonObject { put("apiKey", JsonPrimitive(key)) })
    } catch (e: CloudException.Status) {
      if (e.code == 400 || e.code == 401) throw CloudException.KeyRejected()
      throw e
    }

  /**
   * The ONE classifier for the workspace switch (`/api/vscode/tenants/:id/token`):
   * - 401: the key behind the token is dead -> [CloudException.KeyRejected] (signs out).
   * - 403 `session_stale`: the base token predates the server change; re-mint it once, and
   *   if that repeats work in the key's own workspace but KEEP the saved selection.
   * - 403 `editor_key_required`: this sign-in cannot switch; fall back, forget the selection
   *   and raise [workspaceSignInNeeded] (the key still works, so no sign-out).
   * - other 403/404: no longer a member; drop the selection and fall back.
   */
  private suspend fun switchWorkspace(base: String, key: String, wanted: Long, baseToken: Minted): Minted {
    var from = baseToken
    var retried = false
    while (true) {
      try {
        return mint(base, "/api/vscode/tenants/$wanted/token", from.value, JsonObject(emptyMap()))
      } catch (e: CloudException.Status) {
        when {
          e.code == 401 -> throw CloudException.KeyRejected()
          e.code == 403 && e.reason == REASON_SESSION_STALE -> {
            if (retried) return from
            retried = true
            from = mintBase(base, key)
          }
          e.code == 403 && e.reason == REASON_EDITOR_KEY_REQUIRED -> {
            // Deliberately unlike VS Code (which signs out): mobile keeps the session and drops the selection.
            if (dropSelection(wanted)) _workspaceSignInNeeded.value = true
            return baseToken
          }
          e.code == 403 || e.code == 404 -> {
            dropSelection(wanted)
            return baseToken
          }
          else -> throw e
        }
      }
    }
  }

  private suspend fun exchange(base: String): Token {
    val key = requireKey()
    val minted = mintBase(base, key)
    val wanted = prefs.getString(WORKSPACE_KEY)?.toLongOrNull()
    val scoped = if (wanted != null && wanted != minted.tenantId) switchWorkspace(base, key, wanted, minted) else minted
    return Token(
      value = scoped.value,
      tenantId = scoped.tenantId,
      expiresAtNanos = System.nanoTime() + scoped.expiresInSeconds * 1_000_000_000L,
      base = base,
    )
  }

  private class Minted(val value: String, val tenantId: Long, val expiresInSeconds: Long)

  private suspend fun mint(base: String, path: String, bearer: String?, body: JsonElement): Minted {
    val v =
      CloudHttp.call(CloudHttp.client, CloudHttp.request("$base$path", "POST", body, bearer)).objOrNull()
        ?: throw CloudException.Unreachable("unexpected token exchange answer")
    val value = v["token"].textOrNull() ?: throw CloudException.Unreachable("no token in the exchange")
    val tenantId = v["tenantId"].longOrNull() ?: throw CloudException.Unreachable("no workspace in the exchange")
    return Minted(value = value, tenantId = tenantId, expiresInSeconds = v["expiresIn"].longOrNull() ?: DEFAULT_TOKEN_TTL_S)
  }

  private companion object {
    const val KEY = "cloud.apiKey"
    const val WORKSPACE_KEY = "cloud.workspaceId"
    const val REASON_SESSION_STALE = "session_stale"
    const val REASON_EDITOR_KEY_REQUIRED = "editor_key_required"
    const val DEFAULT_TOKEN_TTL_S = 900L
    const val REFRESH_MARGIN_NANOS = 60_000_000_000L
  }
}
