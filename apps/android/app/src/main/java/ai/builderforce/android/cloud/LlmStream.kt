package ai.builderforce.android.cloud

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.ResponseBody

/** A tool the model asked for, its arguments as it wrote them (a JSON object, as text). */
data class ToolCall(val id: String, val name: String, val arguments: String)

/** What the model said in one turn, and the tools it asked for. */
data class Turn(val text: String, val toolCalls: List<ToolCall>, val finishReason: String?)

/** The upstream failed after the stream opened. */
class StreamFailedException(message: String) : Exception(message)

/**
 * One streamed turn as its chunks arrive — the OpenAI shape every client speaks: text as
 * `delta.content`, tool calls as `delta.tool_calls` fragments stitched by index (Synapse's
 * `llm.rs` accumulator).
 */
class TurnAccumulator {
  private val text = StringBuilder()
  private val calls = sortedMapOf<Long, MutableCall>()
  private var finishReason: String? = null

  /** Saw `data: [DONE]`. */
  var done: Boolean = false
    private set

  private class MutableCall(var id: String = "", var name: String = "", val arguments: StringBuilder = StringBuilder())

  /** One line of the event stream; returns the text it added, if any. */
  fun line(line: String): String? {
    val trimmed = line.trim()
    if (!trimmed.startsWith("data:")) return null
    val payload = trimmed.removePrefix("data:").trim()
    if (payload == "[DONE]") {
      done = true
      return null
    }
    // A malformed chunk is skipped, never shown.
    val chunk = parseCloudBody(payload).objOrNull() ?: return null
    chunk["error"]?.takeIf { it !is JsonNull }?.let { err ->
      val message = err.textOrNull() ?: err.objOrNull()?.get("message").textOrNull() ?: "unknown error"
      throw StreamFailedException(message)
    }
    val choice = chunk["choices"].arrOrEmpty().firstOrNull().objOrNull() ?: return null
    choice["finish_reason"].textOrNull()?.let { finishReason = it }
    val delta = choice["delta"].objOrNull() ?: return null
    delta["tool_calls"].arrOrEmpty().forEachIndexed { i, el ->
      val d = el.objOrNull() ?: return@forEachIndexed
      val call = calls.getOrPut(d["index"].longOrNull() ?: i.toLong()) { MutableCall() }
      d["id"].textOrNull()?.takeIf { it.isNotEmpty() }?.let { call.id = it }
      val fn = d["function"].objOrNull()
      fn?.get("name").textOrNull()?.takeIf { it.isNotEmpty() }?.let { call.name = it }
      fn?.get("arguments").textOrNull()?.let { call.arguments.append(it) }
    }
    val piece = delta["content"].textOrNull().orEmpty()
    if (piece.isEmpty()) return null
    text.append(piece)
    return piece
  }

  /** A whole (non-streamed) completion body: a gateway that ignored `stream`. */
  fun message(body: JsonObject) {
    val choice = body["choices"].arrOrEmpty().firstOrNull().objOrNull() ?: return
    finishReason = choice["finish_reason"].textOrNull()
    val msg = choice["message"].objOrNull()
    text.setLength(0)
    text.append(msg?.get("content").textOrNull().orEmpty())
    msg?.get("tool_calls").arrOrEmpty().forEachIndexed { i, el ->
      val c = el.objOrNull() ?: return@forEachIndexed
      val fn = c["function"].objOrNull()
      calls[c["index"].longOrNull() ?: i.toLong()] =
        MutableCall(
          id = c["id"].textOrNull().orEmpty(),
          name = fn?.get("name").textOrNull().orEmpty(),
          arguments = StringBuilder(fn?.get("arguments").textOrNull().orEmpty()),
        )
    }
  }

  fun text(): String = text.toString()

  fun finish(): Turn {
    val toolCalls =
      calls.values
        .filter { it.name.isNotEmpty() }
        // A call the model sent without an id still needs one to be answered by.
        .mapIndexed { i, c -> ToolCall(id = c.id.ifEmpty { "call_$i" }, name = c.name, arguments = c.arguments.toString()) }
    return Turn(text = text.toString(), toolCalls = toolCalls, finishReason = finishReason)
  }
}

/**
 * Run one model turn on the LLM gateway (`POST /llm/v1/chat/completions`, streamed).
 * [body] is the completion request (`messages`, and `tools` when the model may call them);
 * the gateway routes the model. [onText] gets each piece of the answer as it arrives.
 * Cancelling the coroutine closes the stream.
 */
suspend fun streamChat(session: CloudSession, body: JsonObject, onText: (String) -> Unit): Turn {
  val request = JsonObject(body + ("stream" to JsonPrimitive(true)))
  val response = session.gateway("POST", "/chat/completions", request, CloudHttp.streamClient)
  val acc = TurnAccumulator()
  return withContext(Dispatchers.IO) {
    response.use { resp ->
      val body: ResponseBody? = resp.body
      val stream = body ?: return@use acc.finish()
      val closeOnCancel = coroutineContext.job.invokeOnCompletion { resp.close() }
      try {
        if (resp.header("Content-Type").orEmpty().startsWith("application/json")) {
          parseCloudBody(stream.string()).objOrNull()?.let(acc::message)
          if (acc.text().isNotEmpty()) onText(acc.text())
          return@use acc.finish()
        }
        val reader = stream.charStream().buffered()
        while (true) {
          ensureActive()
          val line = reader.readLine() ?: break
          val piece =
            try {
              acc.line(line)
            } catch (e: StreamFailedException) {
              throw midStream(e.message.orEmpty())
            }
          if (piece != null) onText(piece)
          if (acc.done) break
        }
        acc.finish()
      } catch (e: IOException) {
        ensureActive()
        throw midStream(e.message ?: e.javaClass.simpleName)
      } finally {
        closeOnCancel.dispose()
      }
    }
  }
}

private fun midStream(message: String) =
  CloudException.Status(code = 502, reason = "stream_failed", detail = "the model failed mid-answer: $message")
