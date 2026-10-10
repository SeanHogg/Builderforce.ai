package ai.builderforce.android.chat

import ai.builderforce.android.cloud.BrainAttachment
import ai.builderforce.android.cloud.BrainChatApi
import ai.builderforce.android.cloud.CloudException
import ai.builderforce.android.cloud.ImageAttachment
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import java.io.ByteArrayOutputStream
import java.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A message's images on the platform: uploaded to the chat uploads store before the turn
 * is sent (so a reopened chat still has them — the iOS and macOS apps' contract), and read
 * back, as the signed-in person, for the thumbnails a stored turn shows.
 */
class ChatAttachments(private val api: BrainChatApi) {
  private val cache =
    object : LruCache<String, ByteArray>(CACHE_BYTES) {
      override fun sizeOf(key: String, value: ByteArray): Int = value.size
    }

  /** Upload each image; the stored records go in the turn's metadata, the links in its text. */
  suspend fun upload(images: List<ImageAttachment>): List<BrainAttachment> =
    images.map { image ->
      val (bytes, mimeType) = withContext(Dispatchers.Default) { storable(image) }
      val stored = api.upload(uploadFileName(image.fileName, mimeType), mimeType, bytes)
      cache.put(stored.key, bytes)
      stored
    }

  /** The text a turn is saved with: what was typed, then a link per stored file. */
  fun content(text: String, stored: List<BrainAttachment>): String =
    withAttachmentLinks(text, stored.map { it.name to api.uploadUrl(it.key) })

  /** A stored image's bytes, or null when it cannot be read (gone, offline, not allowed). */
  suspend fun imageBytes(key: String): ByteArray? {
    cache.get(key)?.let { return it }
    return try {
      api.uploadBytes(key).takeIf { it.isNotEmpty() }?.also { cache.put(key, it) }
    } catch (_: CloudException) {
      null
    }
  }

  private companion object {
    const val CACHE_BYTES = 12 * 1024 * 1024
    const val JPEG_QUALITY = 90
    val STORABLE_IMAGE_TYPES = setOf("image/png", "image/jpeg", "image/gif", "image/webp")

    /** The store takes the web's image types; anything else (HEIC, an unknown type) goes as JPEG. */
    fun storable(image: ImageAttachment): Pair<ByteArray, String> {
      val bytes = Base64.getDecoder().decode(image.base64)
      if (image.mimeType in STORABLE_IMAGE_TYPES) return bytes to image.mimeType
      val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return bytes to image.mimeType
      val out = ByteArrayOutputStream()
      bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
      bitmap.recycle()
      return out.toByteArray() to "image/jpeg"
    }
  }
}

/** The link a stored file leaves in its message's text (what the web app shows). */
fun attachmentLink(name: String, url: String): String = "[Attached: $name]($url)"

/** [text] followed by one link per (name, url), trimmed — the iOS and macOS apps' layout. */
fun withAttachmentLinks(text: String, links: List<Pair<String, String>>): String {
  val content = StringBuilder(text)
  for ((name, url) in links) content.append("\n\n").append(attachmentLink(name, url))
  return content.toString().trim()
}

/** [content] without the links of the attachments shown as thumbnails instead. */
fun withoutAttachmentLinks(content: String, shown: List<BrainAttachment>): String {
  var text = content
  for (attachment in shown) {
    val link = Regex("""\[Attached: [^\]\n]*]\([^)\s]*""" + Regex.escape(attachment.key) + """\)""")
    text = link.replace(text, "")
  }
  return text.replace(BLANK_RUN, "\n\n").trim()
}

private val BLANK_RUN = Regex("\n{3,}")

/** The store names an object after its file's extension: make sure there is one. */
fun uploadFileName(name: String, mimeType: String): String {
  val base = name.trim().ifEmpty { "image" }
  if (base.substringAfterLast('/').contains('.')) return base
  val subtype = mimeType.substringAfter('/', "").substringBefore('+').substringBefore(';').trim()
  val ext = if (subtype == "jpeg") "jpg" else subtype
  return if (ext.isNotEmpty() && ext.all { it.isLetterOrDigit() }) "$base.$ext" else base
}
