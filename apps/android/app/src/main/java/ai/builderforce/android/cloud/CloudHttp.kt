package ai.builderforce.android.cloud

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody

/**
 * The HTTP plumbing every cloud call shares: three clients (an API call, a platform tool
 * call, a streamed model turn — Synapse's three timeouts), request building, and turning
 * an error status into a [CloudException]. Every call suspends and is cancelled with its
 * coroutine, so the composer's Stop aborts the request in flight.
 */
internal object CloudHttp {
  val client: OkHttpClient =
    OkHttpClient.Builder()
      .connectTimeout(20, TimeUnit.SECONDS)
      .readTimeout(20, TimeUnit.SECONDS)
      .writeTimeout(20, TimeUnit.SECONDS)
      .build()

  /** A tool call can be a search or an import; give it the time it takes. */
  val toolClient: OkHttpClient = client.newBuilder().readTimeout(120, TimeUnit.SECONDS).build()

  /** One model turn, streamed: the longest a reasoning model with tools takes to finish. */
  val streamClient: OkHttpClient = client.newBuilder().readTimeout(300, TimeUnit.SECONDS).build()

  /** An upload: a phone photo over a slow link takes longer than an API call to send. */
  val uploadClient: OkHttpClient = client.newBuilder().writeTimeout(120, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build()

  private val jsonType = "application/json".toMediaType()
  private val octetType = "application/octet-stream".toMediaType()
  private val bodyMethods = setOf("POST", "PUT", "PATCH")

  fun request(url: String, method: String, body: JsonElement?, bearer: String?): Request {
    val builder =
      try {
        Request.Builder().url(url)
      } catch (e: IllegalArgumentException) {
        throw CloudException.Unreachable(e.message ?: url)
      }
    builder.header("Accept", "application/json")
    if (bearer != null) builder.header("Authorization", "Bearer $bearer")
    val payload = body?.toString() ?: if (method in bodyMethods) "{}" else null
    return builder.method(method, payload?.toRequestBody(jsonType)).build()
  }

  /**
   * One file as `multipart/form-data`, in the form field `file` — the chat uploads store's
   * contract (`POST /api/brain/upload`). A quote in the name would end the header early.
   */
  fun multipartRequest(url: String, fileName: String, mimeType: String, bytes: ByteArray, bearer: String): Request {
    val builder =
      try {
        Request.Builder().url(url)
      } catch (e: IllegalArgumentException) {
        throw CloudException.Unreachable(e.message ?: url)
      }
    val part = bytes.toRequestBody(mimeType.toMediaTypeOrNull() ?: octetType)
    val body =
      MultipartBody.Builder()
        .setType(MultipartBody.FORM)
        .addFormDataPart(UPLOAD_FIELD, fileName.replace('"', '_'), part)
        .build()
    return builder
      .header("Accept", "application/json")
      .header("Authorization", "Bearer $bearer")
      .post(body)
      .build()
  }

  /** A plain authenticated GET whose answer is bytes (a stored upload), not JSON. */
  fun getRequest(url: String, bearer: String): Request =
    try {
      Request.Builder().url(url).header("Authorization", "Bearer $bearer").get().build()
    } catch (e: IllegalArgumentException) {
      throw CloudException.Unreachable(e.message ?: url)
    }

  /** Send [request] and read its body as bytes. */
  suspend fun bytes(client: OkHttpClient, request: Request): ByteArray {
    val response = open(client, request)
    return response.use { r ->
      withContext(Dispatchers.IO) {
        val body: ResponseBody? = r.body
        try {
          body?.bytes() ?: ByteArray(0)
        } catch (e: IOException) {
          throw CloudException.Unreachable(e.message ?: e.javaClass.simpleName)
        }
      }
    }
  }

  /** Send [request]; a success comes back open (the caller closes it), anything else throws. */
  suspend fun open(client: OkHttpClient, request: Request): Response {
    val response =
      try {
        client.newCall(request).await()
      } catch (e: IOException) {
        throw CloudException.Unreachable(e.message ?: e.javaClass.simpleName)
      }
    if (response.isSuccessful) return response
    val text = response.use { readText(it) }
    throw statusError(response.code, text)
  }

  /** Send [request] and read its JSON body. */
  suspend fun call(client: OkHttpClient, request: Request): JsonElement {
    val response = open(client, request)
    return response.use { parseCloudBody(readText(it)) }
  }

  private suspend fun readText(response: Response): String =
    withContext(Dispatchers.IO) {
      val body: ResponseBody? = response.body
      try {
        body?.string().orEmpty()
      } catch (e: IOException) {
        throw CloudException.Unreachable(e.message ?: e.javaClass.simpleName)
      }
    }

  /** The body's `error` field is the platform's message, its `code` the stable reason. */
  fun statusError(code: Int, text: String): CloudException.Status {
    val body = parseCloudBody(text).objOrNull()
    val message = body?.get("error").textOrNull() ?: text.take(200)
    return CloudException.Status(code = code, reason = body?.get("code").textOrNull(), detail = message)
  }

  private const val UPLOAD_FIELD = "file"

  private suspend fun Call.await(): Response =
    suspendCancellableCoroutine { cont ->
      cont.invokeOnCancellation { cancel() }
      enqueue(
        object : Callback {
          override fun onFailure(call: Call, e: IOException) {
            if (cont.isActive) cont.resumeWithException(e)
          }

          override fun onResponse(call: Call, response: Response) {
            if (cont.isActive) cont.resume(response) else response.close()
          }
        },
      )
    }
}
