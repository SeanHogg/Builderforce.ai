package ai.builderforce.android.cloud

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import okhttp3.ResponseBody

/**
 * One tool of the platform's catalog (`McpToolEntry`) — the ONE server-side catalog the web
 * Brain, the VS Code extension and Synapse also drive. Nothing is re-declared here.
 */
data class PlatformTool(
  /** Which server owns it; sent back on the call. */
  val extensionId: String,
  /** Its name on that server; sent back on the call. */
  val tool: String,
  /** The flat name the model sees (`builtin_tasks_create`). */
  val name: String,
  val description: String,
  val parameters: JsonElement?,
  /** Whether it changes anything. Absent (a tenant's own MCP server) counts as yes. */
  val mutates: Boolean?,
) {
  /** Whether running it needs the person's go-ahead. */
  val writes: Boolean
    get() = mutates != false

  /** The tool as a completion request offers it to the model. */
  fun asFunction(): JsonObject =
    buildJsonObject {
      put("type", JsonPrimitive("function"))
      put(
        "function",
        buildJsonObject {
          put("name", JsonPrimitive(name))
          put("description", JsonPrimitive(description))
          put("parameters", parameters?.takeIf { it !is JsonNull } ?: EMPTY_PARAMETERS)
        },
      )
    }

  private companion object {
    val EMPTY_PARAMETERS = buildJsonObject {
      put("type", JsonPrimitive("object"))
      put("properties", JsonObject(emptyMap()))
    }
  }
}

/** A tool's name as a person reads it: `builtin_tasks_create` → `tasks create`. */
fun toolLabel(name: String): String = name.removePrefix("builtin_").replace('_', ' ')

/** The platform's tools over the LLM gateway (`GET /llm/v1/mcp/tools`, `POST /llm/v1/mcp/call`). */
class PlatformTools(private val session: CloudSession) {
  /** The tools of one catalog surface (`delivery`, `readonly`, …). */
  suspend fun list(surface: String): List<PlatformTool> {
    val v = readJson(session.gateway("GET", "/mcp/tools?surface=$surface", null, CloudHttp.client))
    return v.objOrNull()?.get("tools").arrOrEmpty().mapNotNull { el ->
      val o = el.objOrNull() ?: return@mapNotNull null
      PlatformTool(
        extensionId = o["extensionId"].textOrNull() ?: return@mapNotNull null,
        tool = o["tool"].textOrNull() ?: return@mapNotNull null,
        name = o["name"].textOrNull() ?: return@mapNotNull null,
        description = o["description"].textOrNull().orEmpty(),
        parameters = o["parameters"],
        mutates = o["mutates"].boolOrNull(),
      )
    }
  }

  /** Run one tool on the platform, as the person. The result is what the model reads back. */
  suspend fun call(tool: PlatformTool, arguments: JsonObject): String {
    val body =
      buildJsonObject {
        put("extensionId", JsonPrimitive(tool.extensionId))
        put("tool", JsonPrimitive(tool.tool))
        put("arguments", arguments)
      }
    val v = readJson(session.gateway("POST", "/mcp/call", body, CloudHttp.toolClient))
    val result = v.objOrNull()?.get("result") ?: v
    return if (result is JsonPrimitive && result.isString) result.content else result.toString()
  }

  private suspend fun readJson(response: okhttp3.Response): JsonElement =
    withContext(Dispatchers.IO) {
      response.use {
        val body: ResponseBody? = it.body
        try {
          parseCloudBody(body?.string().orEmpty())
        } catch (e: IOException) {
          throw CloudException.Unreachable(e.message ?: e.javaClass.simpleName)
        }
      }
    }
}
